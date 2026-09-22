/**
 * Pure builders/parsers for Tally Prime's XML-over-HTTP interface.
 * Kept free of network I/O so they can be unit-tested against captured Tally responses.
 *
 * Tally exposes: Export (reports/collections) and Import (vouchers). We use:
 *  - a Collection of Ledgers under "Sundry Debtors" for dealers + closing balances
 *  - a Collection of StockItems for catalogue + closing quantity
 *  - Bills Receivable report for overdue ageing
 *  - Import of a Sales Order voucher for order creation
 */
import { XMLParser } from "fast-xml-parser";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Tally wants dates as YYYYMMDD. */
export const tallyDate = (iso: string) => iso.replace(/-/g, "");

export function buildLedgerCollection(company: string): string {
  return `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SahayakDealers</ID></HEADER>
<BODY><DESC>
<STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="SahayakDealers" ISMODIFY="No">
<TYPE>Ledger</TYPE>
<CHILDOF>Sundry Debtors</CHILDOF>
<BELONGSTO>Yes</BELONGSTO>
<FETCH>Name, Guid, ClosingBalance, LedgerPhone, LedgerMobile, LedgerStateName, Address</FETCH>
</COLLECTION>
</TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;
}

export function buildStockCollection(company: string, godown?: string): string {
  const godownVar = godown ? `<SVGODOWN>${esc(godown)}</SVGODOWN>` : "";
  return `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>SahayakStock</ID></HEADER>
<BODY><DESC>
<STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>${godownVar}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="SahayakStock" ISMODIFY="No">
<TYPE>StockItem</TYPE>
<FETCH>Name, Guid, BaseUnits, ClosingBalance, ClosingRate, PartNo</FETCH>
</COLLECTION>
</TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;
}

export function buildBillsReceivable(company: string, asOf: string): string {
  return `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>Bills Receivable</ID></HEADER>
<BODY><DESC>
<STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY><SVFROMDATE>20200401</SVFROMDATE><SVTODATE>${tallyDate(asOf)}</SVTODATE><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
</DESC></BODY></ENVELOPE>`;
}

export interface SalesOrderInput {
  company: string;
  date: string;            // ISO
  dealerName: string;      // Tally ledger name
  salesLedger: string;     // e.g. "Sales"
  reference: string;       // Sahayak visit id -> voucher REFERENCE
  narration: string;
  lines: { itemName: string; qty: number; unit: string; rate: number }[];
  isDraft: boolean;        // draft = optional voucher
}

export function buildSalesOrderImport(o: SalesOrderInput): string {
  const total = o.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const items = o.lines.map(l => `
<ALLINVENTORYENTRIES.LIST>
<STOCKITEMNAME>${esc(l.itemName)}</STOCKITEMNAME>
<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
<RATE>${l.rate}/${esc(l.unit)}</RATE>
<AMOUNT>${(l.qty * l.rate).toFixed(2)}</AMOUNT>
<ACTUALQTY>${l.qty} ${esc(l.unit)}</ACTUALQTY>
<BILLEDQTY>${l.qty} ${esc(l.unit)}</BILLEDQTY>
<ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${esc(o.salesLedger)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${(l.qty * l.rate).toFixed(2)}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>`).join("");

  return `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(o.company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales Order" ACTION="Create" OBJVIEW="Invoice Voucher View">
<DATE>${tallyDate(o.date)}</DATE>
<VOUCHERTYPENAME>Sales Order</VOUCHERTYPENAME>
<REFERENCE>${esc(o.reference)}</REFERENCE>
<PARTYLEDGERNAME>${esc(o.dealerName)}</PARTYLEDGERNAME>
<PARTYNAME>${esc(o.dealerName)}</PARTYNAME>
<NARRATION>${esc(o.narration)}</NARRATION>
<ISOPTIONAL>${o.isDraft ? "Yes" : "No"}</ISOPTIONAL>
<PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
<LEDGERENTRIES.LIST><LEDGERNAME>${esc(o.dealerName)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${total.toFixed(2)}</AMOUNT></LEDGERENTRIES.LIST>${items}
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;
}

// ---------------- parsers ----------------

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true });

const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

/** Tally amounts come as "1,84,500.00 Dr" or "-184500.00". Debit = dealer owes us. */
export function parseTallyAmount(s: unknown): number {
  if (s === undefined || s === null) return 0;
  const str = String(s).trim();
  const neg = /\bCr\b/i.test(str) || str.startsWith("-");
  const n = parseFloat(str.replace(/[^0-9.]/g, "")) || 0;
  return neg ? -n : n;
}

/** "2400 length" -> 2400 */
export function parseTallyQty(s: unknown): number {
  if (s === undefined || s === null) return 0;
  const m = String(s).match(/-?[\d,]*\.?\d+/);
  return m ? parseFloat(m[0].replace(/,/g, "")) : 0;
}

export interface TallyLedger { name: string; guid: string; closing: number; phone?: string; state?: string }

export function parseLedgerCollection(xml: string): TallyLedger[] {
  const doc = parser.parse(xml);
  const ledgers = arr<any>(doc?.ENVELOPE?.BODY?.DATA?.COLLECTION?.LEDGER);
  return ledgers.map(l => ({
    name: l["@_NAME"] ?? l.NAME,
    guid: l.GUID,
    closing: parseTallyAmount(l.CLOSINGBALANCE),   // positive = debit = receivable
    phone: l.LEDGERMOBILE || l.LEDGERPHONE || undefined,
    state: l.LEDGERSTATENAME || undefined,
  }));
}

export interface TallyStockItem { name: string; guid: string; unit: string; qty: number; rate: number; partNo?: string }

export function parseStockCollection(xml: string): TallyStockItem[] {
  const doc = parser.parse(xml);
  const items = arr<any>(doc?.ENVELOPE?.BODY?.DATA?.COLLECTION?.STOCKITEM);
  return items.map(i => ({
    name: i["@_NAME"] ?? i.NAME,
    guid: i.GUID,
    unit: i.BASEUNITS ?? "",
    qty: parseTallyQty(i.CLOSINGBALANCE),
    rate: Math.abs(parseTallyAmount(i.CLOSINGRATE)),
    partNo: i.PARTNO || undefined,
  }));
}

export interface TallyBill { party: string; billName: string; date: string; dueDate?: string; pending: number; overdueDays: number }

/** Bills Receivable report rows -> per-party overdue ageing. asOf ISO. */
export function parseBillsReceivable(xml: string, asOf: string): TallyBill[] {
  const doc = parser.parse(xml);
  const bills = arr<any>(doc?.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE).flatMap((m: any) => arr(m.BILL ?? m.BILLFIXED ?? []));
  const today = new Date(asOf + "T00:00:00Z").getTime();
  return bills.map(b => {
    const due = b.BILLDUE ?? b.BILLCREDITDATE;
    const dueIso = due ? `${String(due).slice(0,4)}-${String(due).slice(4,6)}-${String(due).slice(6,8)}` : undefined;
    const overdueDays = dueIso ? Math.max(0, Math.floor((today - new Date(dueIso + "T00:00:00Z").getTime()) / 86400000)) : 0;
    return {
      party: b.BILLPARTY ?? b.PARTYLEDGERNAME ?? "",
      billName: b.BILLREF ?? b.BILLNAME ?? "",
      date: b.BILLDATE ?? "",
      dueDate: dueIso,
      pending: parseTallyAmount(b.BILLCL ?? b.BILLFINAL ?? b.BILLAMOUNT),
      overdueDays,
    };
  });
}

export function parseImportResult(xml: string): { created: number; errors: string[] } {
  const doc = parser.parse(xml);
  const r = doc?.RESPONSE ?? doc?.ENVELOPE?.BODY?.DATA?.IMPORTRESULT ?? {};
  const created = parseInt(r.CREATED ?? "0", 10) || 0;
  const errors: string[] = [];
  const le = r.LINEERROR ?? doc?.ENVELOPE?.BODY?.DATA?.LINEERROR;
  for (const e of arr<any>(le)) if (e) errors.push(String(e));
  if (!created && errors.length === 0 && r.ERRORS && parseInt(r.ERRORS, 10) > 0) errors.push("Tally reported errors without detail");
  return { created, errors };
}
