import Fastify from "fastify";
import cors from "@fastify/cors";
import fstatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { makeConnector } from "./connectors/index.js";
import { MemoryStore } from "./memory/store.js";
import { Orchestrator, type Ctx } from "./orchestrator/index.js";
import { ClaudeModel, FakeModel, type Model } from "./orchestrator/model.js";
import { WhatsAppClient } from "./whatsapp/client.js";

export function buildApp(opts: { model?: Model; env?: NodeJS.ProcessEnv } = {}) {
  const env = opts.env ?? process.env;
  const app = Fastify({ logger: env.NODE_ENV !== "test" });
  app.register(cors, { origin: true });
  const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
  app.register(fstatic, { root: pub, prefix: "/" });

  const erp = makeConnector(env);
  const store = new MemoryStore();
  const model = opts.model ?? (env.ANTHROPIC_API_KEY ? new ClaudeModel(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL) : new FakeModel([]));
  const brain = new Orchestrator(erp, store, model);
  const wa = new WhatsAppClient({ phoneNumberId: env.WA_PHONE_NUMBER_ID ?? "", accessToken: env.WA_ACCESS_TOKEN ?? "" });
  const companyName = env.TALLY_COMPANY ?? env.COMPANY_NAME ?? "the company";

  /** Auth is SSO/JWT in phase 2; for now identity comes from headers set by the app. */
  const ctxOf = (req: any): Ctx => ({
    tenantId: req.headers["x-tenant-id"] ?? "demo",
    repId: req.headers["x-rep-id"] ?? "rep-1",
    repName: req.headers["x-rep-name"],
    today: new Date().toISOString().slice(0, 10),
    companyName,
  });

  app.get("/health", async () => ({ ok: true, connector: erp.kind, erp: await erp.ping(), whatsapp: wa.enabled }));

  // Job 1
  app.get("/brief", async req => brain.brief(ctxOf(req)));

  // Job 2
  app.post("/visits/draft", async (req, reply) => {
    const body = z.object({ transcript: z.string().min(3) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "transcript required" });
    return brain.draftVisit(ctxOf(req), body.data.transcript);
  });
  app.post("/visits/:id/confirm", async (req: any, reply) => {
    try { return await brain.confirmVisit(ctxOf(req), req.params.id); }
    catch (e: any) { if (/not found|already/.test(e.message)) return reply.code(409).send({ error: e.message }); throw e; }
  });
  app.post("/visits/:id/discard", async (req: any) => { await brain.discardVisit(ctxOf(req), req.params.id); return { ok: true }; });

  // Job 3
  app.post("/ask", async (req, reply) => {
    const body = z.object({ question: z.string().min(2) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "question required" });
    return { answer: await brain.ask(ctxOf(req), body.data.question) };
  });

  // Job 4 — rep approved the draft; send from the company number
  app.post("/whatsapp/send", async (req, reply) => {
    const body = z.object({ to: z.string(), body: z.string().min(1), visitId: z.string().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "to and body required" });
    const ctx = ctxOf(req);
    if (!wa.enabled) { await store.audit({ tenantId: ctx.tenantId, actor: ctx.repId, action: "whatsapp.simulated", target: body.data.to }); return { sent: false, simulated: true }; }
    const r = await wa.sendText(body.data.to, body.data.body);
    await store.audit({ tenantId: ctx.tenantId, actor: ctx.repId, action: "whatsapp.sent", target: body.data.to, detail: { id: r.id, visitId: body.data.visitId } });
    return { sent: true, id: r.id };
  });
  // Meta webhook verification + inbound (dealer replies land here in phase 2)
  app.get("/whatsapp/webhook", async (req: any, reply) => {
    if (req.query["hub.verify_token"] === (env.WA_VERIFY_TOKEN ?? "sahayak-verify")) return reply.send(req.query["hub.challenge"]);
    return reply.code(403).send();
  });
  app.post("/whatsapp/webhook", async () => ({ ok: true }));

  // Job 5 — manager rollup: confirmed visits for a rep today (aggregation across reps in phase 2)
  app.get("/rollup", async (req: any) => {
    const ctx = ctxOf(req);
    const visits = await store.visitsFor(req.query.repId ?? ctx.repId, req.query.date ?? ctx.today);
    const confirmed = visits.filter(v => v.status === "confirmed");
    return { date: ctx.today, visits: confirmed.length, orders: confirmed.filter(v => v.orderNo).length,
      orderValue: confirmed.reduce((s, v) => s + (v.orderTotal ?? 0), 0), complaints: confirmed.filter(v => v.complaint).length, items: confirmed };
  });

  // Admin
  app.get("/audit", async (req: any) => store.auditLog(ctxOf(req).tenantId, Number(req.query.limit ?? 100)));

  return app;
}

if (process.argv[1] && process.argv[1].endsWith("index.js") || process.argv[1]?.endsWith("index.ts")) {
  const app = buildApp();
  app.listen({ port: Number(process.env.PORT ?? 8080), host: "0.0.0.0" }).catch(e => { console.error(e); process.exit(1); });
}
