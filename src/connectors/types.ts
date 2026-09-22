/**
 * The connector contract. Every ERP/CRM adapter (Tally, SAP B1, mock) implements this.
 * The orchestrator only ever talks to this interface, so adding an ERP is one module.
 * All money in INR (number), all dates ISO YYYY-MM-DD.
 */

export interface Dealer {
  id: string;            // ERP ledger id / business partner code
  name: string;
  area?: string;
  phone?: string;        // E.164 where known, used for WhatsApp
  outstanding: number;   // total receivable
  overdue: number;       // portion past due
  overdueDays: number;   // age of the oldest overdue bill
}

export interface Product {
  sku: string;
  name: string;
  unit: string;          // "length", "tin", "pc", "bag"
  rate: number;          // list price, INR
  stock: number;         // at the rep's depot / godown
  godown?: string;
}

export interface OrderLine {
  sku: string;
  qty: number;
}

export interface OrderRequest {
  dealerId: string;
  lines: OrderLine[];
  deliveryDate?: string;
  note?: string;
  /** "draft" when the dealer is over credit; ERP decides final status */
  status: "draft" | "approved";
  reference: string;     // Sahayak visit id, for reconciliation
}

export interface OrderResult {
  orderNo: string;       // e.g. "SO/IND/26-27/1421"
  total: number;
  status: "draft" | "approved";
}

export interface VisitLog {
  dealerId: string;
  repId: string;
  date: string;
  summary: string;
  complaint?: string;
  nextVisitDate?: string;
  orderNo?: string;
}

export interface Connector {
  readonly kind: "mock" | "tally" | "sapb1";
  /** Cheap liveness check for the admin console. */
  ping(): Promise<{ ok: boolean; detail?: string }>;
  /** Dealers on a rep's beat (or all, when beat unknown). */
  listDealers(opts: { repId: string }): Promise<Dealer[]>;
  getDealer(dealerId: string): Promise<Dealer | null>;
  /** Product catalogue with live stock at the rep's depot. */
  listProducts(opts: { godown?: string }): Promise<Product[]>;
  getStock(sku: string, godown?: string): Promise<Product | null>;
  createOrder(req: OrderRequest): Promise<OrderResult>;
  /** Visit logging — Tally has no CRM so the adapter may store this in a Sahayak table instead. */
  logVisit(v: VisitLog): Promise<{ id: string }>;
}
