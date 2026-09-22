/** Meta WhatsApp Cloud API. Sends from the company's business number; templates required outside the 24h window. */
export interface WhatsAppConfig { phoneNumberId: string; accessToken: string; fetch?: typeof fetch }

export class WhatsAppClient {
  private readonly f: typeof fetch;
  constructor(private cfg: WhatsAppConfig) { this.f = cfg.fetch ?? fetch; }
  get enabled() { return !!(this.cfg.phoneNumberId && this.cfg.accessToken); }

  async sendText(to: string, body: string): Promise<{ id: string }> {
    const r = await this.f(`https://graph.facebook.com/v21.0/${this.cfg.phoneNumberId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${this.cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "text", text: { body } }),
    });
    if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${await r.text()}`);
    const j: any = await r.json();
    return { id: j.messages?.[0]?.id ?? "" };
  }

  /** Approved template send (order_confirmation, payment_reminder) — used when the dealer hasn't messaged us in 24h. */
  async sendTemplate(to: string, name: string, params: string[], lang = "en"): Promise<{ id: string }> {
    const r = await this.f(`https://graph.facebook.com/v21.0/${this.cfg.phoneNumberId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${this.cfg.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "template",
        template: { name, language: { code: lang }, components: [{ type: "body", parameters: params.map(p => ({ type: "text", text: p })) }] } }),
    });
    if (!r.ok) throw new Error(`WhatsApp ${r.status}: ${await r.text()}`);
    const j: any = await r.json();
    return { id: j.messages?.[0]?.id ?? "" };
  }
}
