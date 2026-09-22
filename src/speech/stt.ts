/**
 * Speech-to-text seam. The Android app streams audio here; the provider is chosen by the month-0 Hinglish benchmark.
 * Candidates: Sarvam (Indian languages), Google STT (hi-IN / en-IN), Whisper-large-v3 self-hosted.
 */
export interface Stt { transcribe(audio: Buffer, opts: { mime: string; lang: "hi-IN" | "en-IN" | "auto" }): Promise<{ text: string; confidence?: number }> }

export class NoopStt implements Stt {
  async transcribe(): Promise<{ text: string }> { throw new Error("STT provider not configured — set STT_PROVIDER after the benchmark"); }
}
