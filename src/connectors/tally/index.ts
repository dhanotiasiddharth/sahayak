import type { Connector, Dealer, Product, OrderRequest, OrderResult, VisitLog } from "../types.js";
import * as X from "./xml.js";

export interface TallyConfig {
  url: string;           // http://<tally-host>:9000
  company: string;       // exact Tally company name
  salesLedger?: string;  // default "Sales"
  godown?: string;       // rep's depot; undefined = all
  /** Sahayak SKU -> Tally stock item name. Filled from the admin console; falls back to name match. */
  skuMap?: Record<string, string>;
  fetch?: typeof fetch;  // injectable for tests
}

/**
 * Tally Prime adapter. Tally has no CRM, so visits are stored in Sahayak's own DB (see memory/),
 * and this adapter's logVisit only annotates; the orchestrator writes the visit row.
 */
export class TallyConnector implements Connector {
  readonly kind = "tally" as const;
  private cache: { dealers?: { at: number; v: Dealer[] }; products?: { at: number; v: Product[] } } = {};
  private readonly ttl = 60_000; // ERP reads are cached for a minute; orders bypass cache
  private readonly f: typeof fetch;

  constructor(private cfg: TallyConfig) { this.f = cfg.fetch ?? fetch; }

  private async post(xml: string): Promise<string> {
    const res = await this.f(this.cfg.url, { method: "POST", headers: { "Content-Type": "text/xml" }, body: xml });
    if (!res.ok) throw new Error(`Tally HTTP ${res.status}`);
    return res.text();
  }

  async ping() {
    try {
      const xml = await this.post(X.buildStockCollection(this.cfg.company));
      return { ok: xml.includes("<ENVELOPE>"), detail: `Tally at ${this.cfg.url}` };
    } catch (e: any) { return { ok: false, detail: e.message }; }
  }

  async listDealers(): Promise<Dealer[]> {
    const c = this.cache.dealers;
    if (c && Date.now() - c.at < this.ttl) return c.v;
    const asOf = new Date().toISOString().slice(0, 10);
    const [ledXml, billsXml] = await Promise.all([
      this.post(X.buildLedgerCollection(this.cfg.company)),
      this.post(X.buildBillsReceivable(this.cfg.company, asOf)),
    ]);
    const ledgers = X.parseLedgerCollection(ledXml);
    const bills = X.parseBillsReceivable(billsXml, asOf);
    const dealers = ledgers.map(l => {
      const mine = bills.filter(b => b.party === l.name && b.overdueDays > 0);
      return {
        id: l.guid || l.name,
        name: l.name,
        phone: normalizePhone(l.phone),
        outstanding: Math.max(0, l.closing),
        overdue: mine.reduce((s, b) => s + Math.max(0, b.pending), 0),
        overdueDays: mine.reduce((m, b) => Math.max(m, b.overdueDays), 0),
      } satisfies Dealer;
    });
    this.cache.dealers = { at: Date.now(), v: dealers };
    return dealers;
  }

  async getDealer(id: string) {
    return (await this.listDealers()).find(d => d.id === id || d.name === id) ?? null;
  }

  async listProducts(): Promise<Product[]> {
    const c = this.cache.products;
    if (c && Date.now() - c.at < this.ttl) return c.v;
    const xml = await this.post(X.buildStockCollection(this.cfg.company, this.cfg.godown));
    const items = X.parseStockCollection(xml);
    const inverse = Object.fromEntries(Object.entries(this.cfg.skuMap ?? {}).map(([k, v]) => [v, k]));
    const products = items.map(i => ({
      sku: inverse[i.name] ?? i.partNo ?? i.name,
      name: i.name,
      unit: i.unit,
      rate: i.rate,
      stock: i.qty,
      godown: this.cfg.godown,
    } satisfies Product));
    this.cache.products = { at: Date.now(), v: products };
    return products;
  }

  async getStock(sku: string) {
    return (await this.listProducts()).find(p => p.sku === sku || p.name === sku) ?? null;
  }

  async createOrder(req: OrderRequest): Promise<OrderResult> {
    const [dealer, products] = await Promise.all([this.getDealer(req.dealerId), this.listProducts()]);
    if (!dealer) throw new Error(`Dealer ${req.dealerId} not found in Tally`);
    const lines = req.lines.map(l => {
      const p = products.find(x => x.sku === l.sku);
      if (!p) throw new Error(`SKU ${l.sku} not found in Tally`);
      return { itemName: p.name, qty: l.qty, unit: p.unit, rate: p.rate };
    });
    const date = new Date().toISOString().slice(0, 10);
    const xml = X.buildSalesOrderImport({
      company: this.cfg.company, date, dealerName: dealer.name,
      salesLedger: this.cfg.salesLedger ?? "Sales", reference: req.reference,
      narration: `Sahayak voice order${req.deliveryDate ? `, delivery ${req.deliveryDate}` : ""}${req.note ? `. ${req.note}` : ""}`,
      lines, isDraft: req.status === "draft",
    });
    const res = X.parseImportResult(await this.post(xml));
    if (res.errors.length || res.created < 1) throw new Error(`Tally rejected order: ${res.errors.join("; ") || "nothing created"}`);
    this.cache.products = undefined; // stock changed
    const total = lines.reduce((s, l) => s + l.qty * l.rate, 0);
    // Tally does not return the voucher number on import; we use our reference and let reconciliation map it.
    return { orderNo: `TALLY-SO/${req.reference}`, total, status: req.status };
  }

  async logVisit(_v: VisitLog) {
    // Tally has no visit object. The orchestrator persists visits in Sahayak's DB.
    return { id: `local` };
  }
}

function normalizePhone(p?: string): string | undefined {
  if (!p) return undefined;
  const digits = p.replace(/\D/g, "");
  if (digits.length === 10) return "+91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return "+" + digits;
  return undefined;
}
