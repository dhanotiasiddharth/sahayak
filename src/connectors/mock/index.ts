import type { Connector, Dealer, Product, OrderRequest, OrderResult, VisitLog } from "../types.js";

/** In-memory ERP used for development, demos and tests. Same shape as the real ones. */
export class MockConnector implements Connector {
  readonly kind = "mock" as const;
  private seq = 1420;
  readonly orders: (OrderRequest & OrderResult)[] = [];
  readonly visits: (VisitLog & { id: string })[] = [];

  dealers: Dealer[] = [
    { id: "L-1001", name: "Sharma Traders", area: "Vijay Nagar", phone: "+919800021044", outstanding: 184500, overdue: 62000, overdueDays: 41 },
    { id: "L-1002", name: "Gupta Agencies", area: "Palasia", phone: "+919400077812", outstanding: 96200, overdue: 0, overdueDays: 0 },
    { id: "L-1003", name: "Malwa Hardware", area: "Rau", phone: "+919900040311", outstanding: 312000, overdue: 148000, overdueDays: 58 },
    { id: "L-1004", name: "Patel Distributors", area: "Dewas Naka", phone: "+919700055620", outstanding: 41000, overdue: 0, overdueDays: 0 },
    { id: "L-1005", name: "Jain Sanitary", area: "Bhawarkua", phone: "+919300010987", outstanding: 0, overdue: 0, overdueDays: 0 },
  ];

  products: Product[] = [
    { sku: "PVC-25", name: "PVC pipe 25mm (3m length)", unit: "length", rate: 186, stock: 2400, godown: "Indore" },
    { sku: "PVC-32", name: "PVC pipe 32mm (3m length)", unit: "length", rate: 248, stock: 1150, godown: "Indore" },
    { sku: "CPVC-20", name: "CPVC pipe 20mm (3m length)", unit: "length", rate: 212, stock: 0, godown: "Indore" },
    { sku: "SOL-100", name: "Solvent cement 100ml", unit: "tin", rate: 62, stock: 860, godown: "Indore" },
    { sku: "ELB-25", name: "PVC elbow 25mm", unit: "pc", rate: 9, stock: 12000, godown: "Indore" },
    { sku: "TEE-25", name: "PVC tee 25mm", unit: "pc", rate: 11, stock: 9800, godown: "Indore" },
  ];

  async ping() { return { ok: true, detail: "mock" }; }
  async listDealers() { return this.dealers; }
  async getDealer(id: string) { return this.dealers.find(d => d.id === id) ?? null; }
  async listProducts() { return this.products; }
  async getStock(sku: string) { return this.products.find(p => p.sku === sku) ?? null; }

  async createOrder(req: OrderRequest): Promise<OrderResult> {
    const total = req.lines.reduce((s, l) => {
      const p = this.products.find(x => x.sku === l.sku);
      if (!p) throw new Error(`Unknown sku ${l.sku}`);
      return s + p.rate * l.qty;
    }, 0);
    const res: OrderResult = { orderNo: `SO/IND/26-27/${++this.seq}`, total, status: req.status };
    this.orders.push({ ...req, ...res });
    return res;
  }

  async logVisit(v: VisitLog) {
    const id = `V-${Date.now()}`;
    this.visits.push({ ...v, id });
    return { id };
  }
}
