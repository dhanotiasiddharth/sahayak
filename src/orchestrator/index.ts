import { z } from "zod";
import type { Connector, Dealer, Product } from "../connectors/types.js";
import type { Store, Visit } from "../memory/store.js";
import type { Model } from "./model.js";

/** What Claude must return after reading a post-visit note. */
export const ExtractionSchema = z.object({
  dealer: z.string(),
  dealer_matched: z.boolean(),
  order_lines: z.array(z.object({ sku: z.string(), qty: z.number().positive() })).default([]),
  delivery_date: z.string().nullable().default(null),
  complaint: z.string().nullable().default(null),
  other_notes: z.string().nullable().default(null),
  next_visit_date: z.string().nullable().default(null),
  confirm_question: z.string(),
  whatsapp_message: z.string(),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export interface VisitDraft {
  visitId: string;
  extraction: Extraction;
  dealer: Dealer | null;
  lines: { sku: string; name: string; qty: number; rate: number; amount: number; shortStock?: number }[];
  total: number;
  warnings: string[];          // e.g. dealer over credit, stock short, dealer not matched
  orderStatus: "draft" | "approved" | "none";
}

export interface Ctx { tenantId: string; repId: string; repName?: string; today: string; companyName: string; language?: "hi" | "en" | "auto" }

export class Orchestrator {
  constructor(private erp: Connector, private store: Store, private model: Model) {}

  // ---------------- Job 2: post-visit capture ----------------

  /** Step 1: read the note, validate against the ERP, return a draft for the rep to confirm. Writes nothing to the ERP. */
  async draftVisit(ctx: Ctx, transcript: string): Promise<VisitDraft> {
    const [dealers, products] = await Promise.all([this.erp.listDealers({ repId: ctx.repId }), this.erp.listProducts({})]);
    const prompt = extractionPrompt(ctx, transcript, dealers, products);
    const raw = await this.model.json(prompt);
    const ex = ExtractionSchema.parse(raw);

    const dealer = dealers.find(d => d.name === ex.dealer) ?? null;
    const warnings: string[] = [];
    if (!dealer) warnings.push(`"${ex.dealer}" is not on your beat list. Order will be held until admin maps the dealer.`);

    const lines = ex.order_lines.flatMap(l => {
      const p = products.find(x => x.sku === l.sku);
      if (!p) { warnings.push(`Item ${l.sku} not in catalogue — dropped.`); return []; }
      const shortStock = p.stock < l.qty ? p.stock : undefined;
      if (shortStock !== undefined) warnings.push(`${p.name}: only ${p.stock} ${p.unit} in stock, asked ${l.qty}.`);
      return [{ sku: p.sku, name: p.name, qty: l.qty, rate: p.rate, amount: p.rate * l.qty, shortStock }];
    });
    const total = lines.reduce((s, l) => s + l.amount, 0);

    let orderStatus: VisitDraft["orderStatus"] = "none";
    if (lines.length) {
      const overCredit = !!dealer && dealer.overdue > 0;
      orderStatus = !dealer || overCredit ? "draft" : "approved";
      if (overCredit) warnings.push(`${dealer!.name} has ₹${fmt(dealer!.overdue)} overdue by ${dealer!.overdueDays} days. Order goes in as draft until accounts clears it.`);
    }

    const visitId = `V-${ctx.tenantId}-${Date.now().toString(36)}`;
    const visit: Visit = {
      id: visitId, tenantId: ctx.tenantId, repId: ctx.repId, dealerId: dealer?.id ?? "", dealerName: ex.dealer, date: ctx.today,
      transcript, summary: summarize(ex, lines), complaint: ex.complaint ?? undefined, nextVisitDate: ex.next_visit_date ?? undefined,
      status: "pending", draft: { extraction: ex, lines, total, orderStatus },
    };
    await this.store.saveVisit(visit);
    await this.store.audit({ tenantId: ctx.tenantId, actor: ctx.repId, action: "visit.draft", target: visitId, detail: { dealer: ex.dealer, lines: lines.length, total } });

    return { visitId, extraction: ex, dealer, lines, total, warnings, orderStatus };
  }

  /** Step 2: the rep said "haan". Now write to the ERP, log the visit, remember the notes, return the WhatsApp draft. */
  async confirmVisit(ctx: Ctx, visitId: string) {
    const v = await this.store.getVisit(visitId);
    if (!v || v.status !== "pending") throw new Error("Visit not found or already handled");
    const d = v.draft as { extraction: Extraction; lines: VisitDraft["lines"]; total: number; orderStatus: VisitDraft["orderStatus"] };

    let order: { orderNo: string; total: number; status: "draft" | "approved" } | undefined;
    if (d.orderStatus !== "none" && v.dealerId) {
      order = await this.erp.createOrder({
        dealerId: v.dealerId, lines: d.lines.map(l => ({ sku: l.sku, qty: l.qty })),
        deliveryDate: d.extraction.delivery_date ?? undefined, note: d.extraction.other_notes ?? undefined,
        status: d.orderStatus, reference: visitId,
      });
      await this.store.audit({ tenantId: ctx.tenantId, actor: ctx.repId, action: "erp.order.create", target: order.orderNo, detail: { visitId, total: order.total, status: order.status } });
    }

    if (v.dealerId) {
      await this.erp.logVisit({ dealerId: v.dealerId, repId: ctx.repId, date: v.date, summary: v.summary, complaint: v.complaint, nextVisitDate: v.nextVisitDate, orderNo: order?.orderNo });
      if (d.extraction.other_notes) await this.store.remember(ctx.repId, v.dealerId, `${v.date}: ${d.extraction.other_notes}`);
      if (d.extraction.complaint) await this.store.remember(ctx.repId, v.dealerId, `${v.date} complaint: ${d.extraction.complaint}`);
    }

    const confirmed: Visit = { ...v, status: "confirmed", orderNo: order?.orderNo, orderTotal: order?.total };
    await this.store.saveVisit(confirmed);
    await this.store.audit({ tenantId: ctx.tenantId, actor: ctx.repId, action: "visit.confirm", target: visitId });

    return {
      visit: confirmed,
      order,
      complaintRaised: !!v.complaint,
      nextVisit: v.nextVisitDate,
      whatsapp: { to: (await this.erp.getDealer(v.dealerId))?.phone, body: d.extraction.whatsapp_message },
    };
  }

  async discardVisit(ctx: Ctx, visitId: string) {
    const v = await this.store.getVisit(visitId);
    if (v) { await this.store.saveVisit({ ...v, status: "discarded" }); await this.store.audit({ tenantId: ctx.tenantId, actor: ctx.repId, action: "visit.discard", target: visitId }); }
  }

  // ---------------- Job 3: instant answers ----------------

  async ask(ctx: Ctx, question: string): Promise<string> {
    const [dealers, products] = await Promise.all([this.erp.listDealers({ repId: ctx.repId }), this.erp.listProducts({})]);
    const prompt = `You are Sahayak, answering a field sales rep at ${ctx.companyName} using ONLY this data read from the ERP just now (INR).
Stock: ${JSON.stringify(products.map(p => ({ name: p.name, sku: p.sku, stock: p.stock, unit: p.unit, rate: p.rate })))}
Dealers: ${JSON.stringify(dealers.map(d => ({ name: d.name, outstanding: d.outstanding, overdue: d.overdue, overdue_days: d.overdueDays })))}
Question: "${question}"
Answer in one or two short sentences, in the same language mix as the question (Hinglish in Roman script if the question is Hinglish). Indian number format with ₹. If the data doesn't cover it, say so in one line. Never invent a number.`;
    const answer = await this.model.text(prompt);
    await this.store.audit({ tenantId: ctx.tenantId, actor: ctx.repId, action: "ask", detail: { question } });
    return answer.trim();
  }

  // ---------------- Job 1: morning brief ----------------

  async brief(ctx: Ctx): Promise<{ text: string; collect: Dealer[]; visitsToday: Visit[] }> {
    const dealers = await this.erp.listDealers({ repId: ctx.repId });
    const collect = dealers.filter(d => d.overdue > 0).sort((a, b) => b.overdue - a.overdue);
    const visitsToday = await this.store.visitsFor(ctx.repId, ctx.today);
    const prompt = `Write a 4-line morning briefing for ${ctx.repName ?? "the rep"}, a field sales rep at ${ctx.companyName}, for ${ctx.today}. Plain, spoken Hinglish (Roman script), no headings, no emojis.
Dealers to collect from (overdue): ${JSON.stringify(collect.map(d => ({ name: d.name, overdue: d.overdue, days: d.overdueDays })))}
Dealers on beat: ${dealers.map(d => d.name).join(", ")}
Line 1: greeting + how many dealers today. Line 2: who to collect from, with amounts. Line 3: one practical reminder. Line 4: end with "Bolo, kya karna hai?"`;
    const text = await this.model.text(prompt);
    return { text: text.trim(), collect, visitsToday };
  }
}

// ---------------- helpers ----------------

function extractionPrompt(ctx: Ctx, transcript: string, dealers: Dealer[], products: Product[]): string {
  return `You are Sahayak, an assistant for a field sales rep at ${ctx.companyName}. The rep just spoke this note after a dealer visit (may be Hindi, English or mixed):

"""${transcript}"""

Today is ${ctx.today}. Dealers on this rep's beat: ${JSON.stringify(dealers.map(d => d.name))}.
Product catalogue (match spoken items to a sku; rates in INR): ${JSON.stringify(products.map(p => ({ sku: p.sku, name: p.name, unit: p.unit })))}.

Rules: match the dealer to the closest name on the list (spelling and transliteration vary); if nothing is close, keep the spoken name and set dealer_matched false. Resolve relative dates ("Friday", "kal", "3 tarikh") from today. Quantities are in the product's unit. Do not invent an order if none was spoken.

Return ONLY a JSON object, no prose:
{
 "dealer": "exact dealer name from the list, or the spoken name",
 "dealer_matched": true|false,
 "order_lines": [{"sku":"...", "qty": number}],
 "delivery_date": "YYYY-MM-DD or null",
 "complaint": "one short sentence or null",
 "other_notes": "one short sentence or null (payment promises, rate requests, competitor mentions)",
 "next_visit_date": "YYYY-MM-DD or null",
 "confirm_question": "one sentence in the rep's own language mix, reading back dealer, items, delivery and next visit, ending with 'Confirm?'",
 "whatsapp_message": "polite 2-3 line WhatsApp to the dealer in Hinglish (Roman script), confirming order and delivery date, or a courteous follow-up if no order; sign off as ${ctx.companyName}"
}`;
}

function summarize(ex: Extraction, lines: VisitDraft["lines"]): string {
  const parts = [ex.dealer];
  if (lines.length) parts.push(lines.map(l => `${l.qty} ${l.name}`).join(", "));
  else parts.push("no order");
  if (ex.delivery_date) parts.push(`delivery ${ex.delivery_date}`);
  if (ex.complaint) parts.push(`complaint: ${ex.complaint}`);
  if (ex.other_notes) parts.push(ex.other_notes);
  return parts.join(" · ");
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");
