import type { Connector, Dealer, Product, OrderRequest, OrderResult, VisitLog } from "../types.js";

export interface SapB1Config { url: string; companyDb: string; user: string; password: string; warehouse?: string; fetch?: typeof fetch }

/**
 * SAP Business One Service Layer adapter (REST). Phase 2 — logic in place, verified against a
 * Service Layer sandbox before the pilot. Business partners = dealers, Items = products, Orders = sales orders.
 */
export class SapB1Connector implements Connector {
  readonly kind = "sapb1" as const;
  private cookie?: string;
  private readonly f: typeof fetch;
  constructor(private cfg: SapB1Config) { this.f = cfg.fetch ?? fetch; }

  private async login() {
    const r = await this.f(`${this.cfg.url}/Login`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ CompanyDB: this.cfg.companyDb, UserName: this.cfg.user, Password: this.cfg.password }) });
    if (!r.ok) throw new Error(`SAP login ${r.status}`);
    this.cookie = r.headers.get("set-cookie") ?? undefined;
  }
  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.cookie) await this.login();
    const r = await this.f(`${this.cfg.url}${path}`, { ...init, headers: { "Content-Type": "application/json", Cookie: this.cookie!, ...(init.headers as Record<string,string> ?? {}) } });
    if (r.status === 401) { this.cookie = undefined; return this.call(path, init); }
    if (!r.ok) throw new Error(`SAP ${path} ${r.status}: ${await r.text()}`);
    return r.json() as Promise<T>;
  }

  async ping() { try { await this.login(); return { ok: true, detail: this.cfg.companyDb }; } catch (e: any) { return { ok: false, detail: e.message }; } }

  async listDealers(): Promise<Dealer[]> {
    const r = await this.call<{ value: any[] }>(`/BusinessPartners?$filter=CardType eq 'cCustomer'&$select=CardCode,CardName,Phone1,Cellular,CurrentAccountBalance,City`);
    return r.value.map(b => ({ id: b.CardCode, name: b.CardName, area: b.City ?? undefined, phone: b.Cellular || b.Phone1 || undefined,
      outstanding: Number(b.CurrentAccountBalance ?? 0), overdue: 0, overdueDays: 0 })); // ageing via /sml.svc/AgingReport in phase 2
  }
  async getDealer(id: string) { return (await this.listDealers()).find(d => d.id === id) ?? null; }
  async listProducts(): Promise<Product[]> {
    const r = await this.call<{ value: any[] }>(`/Items?$filter=SalesItem eq 'tYES'&$select=ItemCode,ItemName,SalesUnit,QuantityOnStock,ItemPrices`);
    return r.value.map(i => ({ sku: i.ItemCode, name: i.ItemName, unit: i.SalesUnit ?? "pc", rate: Number(i.ItemPrices?.[0]?.Price ?? 0), stock: Number(i.QuantityOnStock ?? 0) }));
  }
  async getStock(sku: string) { return (await this.listProducts()).find(p => p.sku === sku) ?? null; }
  async createOrder(req: OrderRequest): Promise<OrderResult> {
    const body: any = { CardCode: req.dealerId, DocDueDate: req.deliveryDate, Comments: `Sahayak ${req.reference}${req.note ? `. ${req.note}` : ""}`,
      DocumentLines: req.lines.map(l => ({ ItemCode: l.sku, Quantity: l.qty, WarehouseCode: this.cfg.warehouse })) };
    const isDraft = req.status === "draft";
    const r = await this.call<any>(isDraft ? "/Drafts" : "/Orders", { method: "POST", body: JSON.stringify(isDraft ? { ...body, DocObjectCode: "oOrders" } : body) });
    return { orderNo: String(r.DocNum ?? r.DocEntry), total: Number(r.DocTotal ?? 0), status: req.status };
  }
  async logVisit(v: VisitLog) {
    const r = await this.call<any>(`/Activities`, { method: "POST", body: JSON.stringify({ CardCode: v.dealerId, ActivityDate: v.date, Notes: v.summary, Activity: "cn_Meeting" }) });
    return { id: String(r.ActivityCode ?? "sap") };
  }
}
