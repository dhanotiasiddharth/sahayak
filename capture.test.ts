import { describe, it, expect } from "vitest";
import { buildApp } from "../src/index.js";
import { FakeModel } from "../src/orchestrator/model.js";

const model = new FakeModel([
  { match: /spoke this note/, json: { dealer: "Sharma Traders", dealer_matched: true, order_lines: [{ sku: "PVC-25", qty: 200 }, { sku: "SOL-100", qty: 50 }],
    delivery_date: "2026-09-25", complaint: "Last month's dispatch was 4 days late", other_notes: null, next_visit_date: "2026-10-03",
    confirm_question: "Sharma Traders, 200 PVC 25mm, 50 solvent, delivery Friday, next visit 3 Oct. Confirm?",
    whatsapp_message: "Namaste Sharma ji, aapka order 200 x PVC 25mm aur 50 x solvent confirm ho gaya hai, delivery Friday tak. - SFS Industries" } },
  { match: /Question:/, text: "Indore depot mein 25mm pipe ka stock 2,400 length hai." },
  { match: /morning briefing/, text: "Good morning Rahul. 5 dealers aaj.\nSharma Traders se ₹62,000 aur Malwa Hardware se ₹1,48,000 collect karna hai.\nGupta ko kal ki delivery confirm karo.\nBolo, kya karna hai?" },
]);

describe("capture -> confirm -> rollup", () => {
  it("runs the whole post-visit flow end to end against the mock ERP", async () => {
    const app = buildApp({ model, env: { CONNECTOR: "mock", NODE_ENV: "test" } });
    const h0 = { "x-tenant-id": "t1", "x-rep-id": "rahul" }; const h = { ...h0, "content-type": "application/json" };

    const draft = await app.inject({ method: "POST", url: "/visits/draft", headers: h, payload: { transcript: "Sharma Traders visited, 200 lengths 25mm, 50 tins solvent, Friday delivery, complained late dispatch, meet 3rd" } });
    expect(draft.statusCode).toBe(200);
    const d = draft.json();
    expect(d.dealer.name).toBe("Sharma Traders");
    expect(d.total).toBe(200 * 186 + 50 * 62);
    expect(d.orderStatus).toBe("draft");                 // Sharma is overdue -> draft
    expect(d.warnings.join(" ")).toMatch(/overdue/);

    const conf = await app.inject({ method: "POST", url: `/visits/${d.visitId}/confirm`, headers: h0 });
    const c = conf.json();
    expect(c.order.orderNo).toMatch(/^SO\/IND/);
    expect(c.order.status).toBe("draft");
    expect(c.complaintRaised).toBe(true);
    expect(c.whatsapp.to).toBe("+919800021044");
    expect(c.whatsapp.body).toMatch(/Sharma/);

    const roll = (await app.inject({ method: "GET", url: "/rollup", headers: h })).json();
    expect(roll).toMatchObject({ visits: 1, orders: 1, orderValue: 40300, complaints: 1 });

    const ask = (await app.inject({ method: "POST", url: "/ask", headers: h, payload: { question: "25mm ka stock?" } })).json();
    expect(ask.answer).toMatch(/2,400/);

    const brief = (await app.inject({ method: "GET", url: "/brief", headers: h })).json();
    expect(brief.collect.map((x: any) => x.name)).toEqual(["Malwa Hardware", "Sharma Traders"]);

    const audit = (await app.inject({ method: "GET", url: "/audit", headers: h })).json();
    expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(["visit.draft", "erp.order.create", "visit.confirm", "ask"]));
  });

  it("refuses to confirm twice", async () => {
    const app = buildApp({ model, env: { CONNECTOR: "mock", NODE_ENV: "test" } });
    const h0 = { "x-tenant-id": "t1", "x-rep-id": "rahul" }; const h = { ...h0, "content-type": "application/json" };
    const d = (await app.inject({ method: "POST", url: "/visits/draft", headers: h, payload: { transcript: "Sharma Traders, 200 25mm" } })).json();
    await app.inject({ method: "POST", url: `/visits/${d.visitId}/confirm`, headers: h0 });
    const again = await app.inject({ method: "POST", url: `/visits/${d.visitId}/confirm`, headers: h0 });
    expect(again.statusCode).toBe(409);
  });
});
