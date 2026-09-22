import { describe, it, expect } from "vitest";
import { TallyConnector } from "../src/connectors/tally/index.js";

/** Fake Tally: answers each request type with a captured-style response. */
function fakeTally(log: string[]) {
  return async (_url: any, init: any) => {
    const body = String(init.body); log.push(body);
    let xml = "";
    if (body.includes("SahayakDealers")) xml = `<ENVELOPE><BODY><DATA><COLLECTION><LEDGER NAME="Sharma Traders"><GUID>g1</GUID><CLOSINGBALANCE>1,84,500.00 Dr</CLOSINGBALANCE><LEDGERMOBILE>9800021044</LEDGERMOBILE></LEDGER></COLLECTION></DATA></BODY></ENVELOPE>`;
    else if (body.includes("SahayakStock")) xml = `<ENVELOPE><BODY><DATA><COLLECTION><STOCKITEM NAME="PVC pipe 25mm (3m length)"><GUID>s1</GUID><BASEUNITS>length</BASEUNITS><CLOSINGBALANCE>2400 length</CLOSINGBALANCE><CLOSINGRATE>186.00/length</CLOSINGRATE><PARTNO>PVC-25</PARTNO></STOCKITEM></COLLECTION></DATA></BODY></ENVELOPE>`;
    else if (body.includes("Bills Receivable")) xml = `<ENVELOPE><BODY><DATA><TALLYMESSAGE><BILL><BILLPARTY>Sharma Traders</BILLPARTY><BILLDUE>20260812</BILLDUE><BILLCL>62000.00 Dr</BILLCL></BILL></TALLYMESSAGE></DATA></BODY></ENVELOPE>`;
    else if (body.includes("Import Data")) xml = `<RESPONSE><CREATED>1</CREATED><ERRORS>0</ERRORS></RESPONSE>`;
    return { ok: true, status: 200, text: async () => xml } as any;
  };
}

describe("TallyConnector", () => {
  it("maps ledgers + bills into dealers with overdue ageing, and creates a draft sales order", async () => {
    const log: string[] = [];
    const t = new TallyConnector({ url: "http://tally:9000", company: "SFS", fetch: fakeTally(log) as any });
    const dealers = await t.listDealers({ repId: "r1" });
    expect(dealers[0]).toMatchObject({ name: "Sharma Traders", phone: "+919800021044", outstanding: 184500, overdue: 62000 });
    expect(dealers[0].overdueDays).toBeGreaterThan(30);
    const products = await t.listProducts({});
    expect(products[0]).toMatchObject({ sku: "PVC-25", stock: 2400, rate: 186 });
    const o = await t.createOrder({ dealerId: "g1", lines: [{ sku: "PVC-25", qty: 200 }], status: "draft", reference: "V-9" });
    expect(o.total).toBe(37200);
    const imp = log.find(x => x.includes("Import Data"))!;
    expect(imp).toContain("<PARTYLEDGERNAME>Sharma Traders</PARTYLEDGERNAME>");
    expect(imp).toContain("<ISOPTIONAL>Yes</ISOPTIONAL>");
  });
});
