import { GEMINI } from '../config';
import type { RecordingMeta, ReplaySource, StartOptions, StreamEvent } from '../stream/ReplaySource';
import { SseParser } from '../stream/sse';
import type { ChatMessage } from './chatStore';

type GeminiChunk = { candidates?: { content?: { parts?: { text?: string }[] } }[] };

/**
 * A live answer from the Gemini API, shaped like any other stream source, so
 * the rest of the app (event bus, collector, HUD) doesn't know the difference.
 *
 *   POST /v1beta/models/{model}:streamGenerateContent?alt=sse
 *
 * Each SSE event carries one chunk of text (usually a few words). One chunk
 * is one "token" to the profiler, and the network sets the pace.
 */
export class GeminiSource implements ReplaySource {
  readonly name = `Gemini · ${GEMINI.model}`;
  readonly paced = true;

  constructor(private readonly history: ChatMessage[]) {}

  async list(): Promise<RecordingMeta[]> {
    return [];
  }

  async *start({ signal }: StartOptions): AsyncIterable<StreamEvent> {
    if (!GEMINI.apiKey) throw new Error('no API key. Add VITE_GEMINI_API_KEY to .env.local and restart the dev server');

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI.model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI.apiKey },
      body: JSON.stringify({
        contents: this.history
          .filter((m) => m.text)
          .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] })),
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error?.message ?? `Gemini answered ${res.status}`);
    }

    const runId = `gemini-${Date.now().toString(36)}`;
    const messageId = `${runId}-m1`;
    yield { type: 'RUN_STARTED', runId };
    yield { type: 'TEXT_MESSAGE_START', messageId };

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    const parser = new SseParser();
    let seq = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        for (const payload of done ? parser.end() : parser.push(value)) {
          const chunk = JSON.parse(payload) as GeminiChunk;
          const delta = (chunk.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
          if (delta) yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta, seq: seq++ };
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: 'TEXT_MESSAGE_END', messageId };
    yield { type: 'RUN_FINISHED', runId };
  }
}
