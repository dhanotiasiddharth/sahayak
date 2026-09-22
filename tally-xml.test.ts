import { describe, it, expect } from "vitest";
import * as X from "../src/connectors/tally/xml.js";

describe("Tally XML", () => {
  it("builds a sales order voucher Tally will accept", () => {
    const xml = X.buildSalesOrderImport({ company: "SFS Industries", date: "2026-09-22", dealerName: "Sharma Traders", salesLedger: "Sales",
      reference: "V-1", narration: "voice order", isDraft: true, lines: [{ itemName: "PVC pipe 25mm", qty: 200, unit: "length", rate: 186 }] });
    expect(xml).toContain("<VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME>");
    expect(xml).toContain("<DATE>20260922</DATE>");
    expect(xml).toContain("<ISOPTIONAL>Yes</ISOPTIONAL>");
    expect(xml).toContain("<AMOUNT>-37200.00</AMOUNT>");
    expect(xml).toContain("<ACTUALQTY>200 length</ACTUALQTY>");
  });

  it("parses Indian-format amounts and Dr/Cr", () => {
    expect(X.parseTallyAmount("1,84,500.00 Dr")).toBe(184500);
    expect(X.parseTallyAmount("5,000.00 Cr")).toBe(-5000);
    expect(X.parseTallyAmount("-184500.00")).toBe(-184500);
    expect(X.parseTallyQty("2400 length")).toBe(2400);
  });

  it("parses a ledger collection export", () => {
    const xml = `<ENVELOPE><HEADER><VERSION>1</VERSION></HEADER><BODY><DATA><COLLECTION>
      <LEDGER NAME="Sharma Traders"><GUID>abc-1</GUID><CLOSINGBALANCE>184500.00</CLOSINGBALANCE><LEDGERMOBILE>9800021044</LEDGERMOBILE></LEDGER>
      <LEDGER NAME="Jain Sanitary"><GUID>abc-2</GUID><CLOSINGBALANCE>-0.00</CLOSINGBALANCE></LEDGER>
    </COLLECTION></DATA></BODY></ENVELOPE>`;
    const l = X.parseLedgerCollection(xml);
    expect(l).toHaveLength(2);
    expect(l[0]).toMatchObject({ name: "Sharma Traders", guid: "abc-1", closing: 184500, phone: "9800021044" });
  });

  it("parses bills receivable into overdue days", () => {
    const xml = `<ENVELOPE><BODY><DATA><TALLYMESSAGE><BILL><BILLPARTY>Sharma Traders</BILLPARTY><BILLREF>INV/221</BILLREF><BILLDATE>20260712</BILLDATE><BILLDUE>20260812</BILLDUE><BILLCL>62000.00 Dr</BILLCL></BILL></TALLYMESSAGE></DATA></BODY></ENVELOPE>`;
    const b = X.parseBillsReceivable(xml, "2026-09-22");
    expect(b[0]).toMatchObject({ party: "Sharma Traders", pending: 62000, overdueDays: 41 });
  });

  it("reads import results", () => {
    expect(X.parseImportResult(`<RESPONSE><CREATED>1</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS></RESPONSE>`)).toEqual({ created: 1, errors: [] });
    expect(X.parseImportResult(`<RESPONSE><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Ledger 'X' does not exist!</LINEERROR></RESPONSE>`).errors[0]).toMatch(/does not exist/);
  });
});
