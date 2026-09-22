import Anthropic from "@anthropic-ai/sdk";

/** The one seam between Sahayak and the LLM vendor. Swap this file to change model providers. */
export interface Model {
  text(prompt: string): Promise<string>;
  json(prompt: string): Promise<unknown>;
}

export class ClaudeModel implements Model {
  private client: Anthropic;
  constructor(apiKey: string, private model = "claude-sonnet-4-6") { this.client = new Anthropic({ apiKey }); }

  async text(prompt: string): Promise<string> {
    const r = await this.client.messages.create({ model: this.model, max_tokens: 600, messages: [{ role: "user", content: prompt }] });
    return r.content.filter(b => b.type === "text").map(b => (b as any).text).join("");
  }

  async json(prompt: string): Promise<unknown> {
    const t = await this.text(prompt);
    const clean = t.replace(/```json|```/g, "").trim();
    const start = clean.indexOf("{"), end = clean.lastIndexOf("}");
    return JSON.parse(clean.slice(start, end + 1));
  }
}

/** Deterministic stand-in for tests and offline dev: answers from a table of canned responses. */
export class FakeModel implements Model {
  constructor(private answers: Array<{ match: RegExp; json?: unknown; text?: string }>) {}
  async text(prompt: string) {
    const a = this.answers.find(x => x.match.test(prompt));
    return a?.text ?? (a?.json ? JSON.stringify(a.json) : "");
  }
  async json(prompt: string) { const a = this.answers.find(x => x.match.test(prompt)); if (!a?.json) throw new Error("FakeModel: no json answer"); return a.json; }
}
