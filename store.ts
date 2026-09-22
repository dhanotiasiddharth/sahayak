/**
 * Sahayak's own persistence: visits, rep memory (dealer notes), audit log.
 * In-memory implementation for dev; Postgres implementation for the pilot (db/schema.sql).
 */
export interface Visit { id: string; tenantId: string; repId: string; dealerId: string; dealerName: string; date: string; transcript: string;
  summary: string; complaint?: string; nextVisitDate?: string; orderNo?: string; orderTotal?: number; status: "pending" | "confirmed" | "discarded";
  draft?: unknown }
export interface AuditEvent { id: string; tenantId: string; at: string; actor: string; action: string; target?: string; detail?: unknown }

export interface Store {
  saveVisit(v: Visit): Promise<void>;
  getVisit(id: string): Promise<Visit | null>;
  visitsFor(repId: string, date: string): Promise<Visit[]>;
  audit(e: Omit<AuditEvent, "id" | "at">): Promise<void>;
  auditLog(tenantId: string, limit?: number): Promise<AuditEvent[]>;
  remember(repId: string, dealerId: string, note: string): Promise<void>;
  recall(repId: string, dealerId: string): Promise<string[]>;
}

export class MemoryStore implements Store {
  private visits = new Map<string, Visit>();
  private events: AuditEvent[] = [];
  private mem = new Map<string, string[]>();
  async saveVisit(v: Visit) { this.visits.set(v.id, v); }
  async getVisit(id: string) { return this.visits.get(id) ?? null; }
  async visitsFor(repId: string, date: string) { return [...this.visits.values()].filter(v => v.repId === repId && v.date === date); }
  async audit(e: Omit<AuditEvent, "id" | "at">) { this.events.push({ ...e, id: `A-${this.events.length + 1}`, at: new Date().toISOString() }); }
  async auditLog(tenantId: string, limit = 100) { return this.events.filter(e => e.tenantId === tenantId).slice(-limit).reverse(); }
  async remember(repId: string, dealerId: string, note: string) { const k = `${repId}:${dealerId}`; this.mem.set(k, [...(this.mem.get(k) ?? []), note].slice(-20)); }
  async recall(repId: string, dealerId: string) { return this.mem.get(`${repId}:${dealerId}`) ?? []; }
}
