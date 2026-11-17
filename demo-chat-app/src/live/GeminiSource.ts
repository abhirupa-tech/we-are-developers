import { GEMINI } from '../config';
import type { RecordingMeta, ReplaySource, StartOptions, StreamEvent } from '../stream/ReplaySource';
import { SseParser } from '../stream/sse';
import type { ChatMessage } from './chatStore';
import { modelStore } from './modelStore';

/** Give up on a model if its first words haven't arrived by then, and try the next. */
const FIRST_TOKEN_MS = 15_000;
/** Overloaded, rate-limited, retired or failing: worth trying another model. */
const RETRYABLE = new Set([404, 429, 500, 502, 503, 504]);

type GeminiChunk = { candidates?: { content?: { parts?: { text?: string }[] } }[] };

/**
 * A live answer from the Gemini API, shaped like any other stream source, so
 * the rest of the app (event bus, collector, HUD) doesn't know the difference.
 *
 *   POST /v1beta/models/{model}:streamGenerateContent?alt=sse
 *
 * Each SSE event carries one chunk of text (usually a few words). One chunk
 * is one "token" to the profiler, and the network sets the pace.
 *
 * Models go overloaded without warning, so it tries modelStore.chain() in
 * order: the chosen model first, then the fallbacks, until one starts
 * answering. Once text is flowing it stays on that model.
 */
export class GeminiSource implements ReplaySource {
  readonly paced = true;

  constructor(
    private readonly history: ChatMessage[],
    /** Optional system instruction, e.g. the A2UI contract. */
    private readonly system?: string,
  ) {}

  get name() {
    return `Gemini · ${modelStore.getSnapshot().preferred}`;
  }

  async list(): Promise<RecordingMeta[]> {
    return [];
  }

  async *start({ signal }: StartOptions): AsyncIterable<StreamEvent> {
    if (!GEMINI.apiKey) throw new Error('no API key. Add VITE_GEMINI_API_KEY to .env.local and restart the dev server');

    const body = JSON.stringify({
      ...(this.system ? { systemInstruction: { parts: [{ text: this.system }] } } : {}),
      contents: this.history
        .filter((m) => m.text)
        .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] })),
    });
    const failures: string[] = [];

    for (const model of modelStore.chain()) {
      if (signal.aborted) return;
      // Per attempt: aborts with the run, or on the first-token timeout.
      const attempt = new AbortController();
      const onAbort = () => attempt.abort();
      signal.addEventListener('abort', onAbort);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        attempt.abort();
      }, FIRST_TOKEN_MS);
      let reader: ReadableStreamDefaultReader<string> | null = null;
      let started = false;

      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI.apiKey },
          body,
          signal: attempt.signal,
        });
        if (!res.ok || !res.body) {
          const err = await res.json().catch(() => null);
          const message = err?.error?.message ?? `HTTP ${res.status}`;
          if (RETRYABLE.has(res.status)) {
            failures.push(`${model}: ${shorten(message)}`);
            continue;
          }
          throw new Error(`${model}: ${message}`);
        }

        const runId = `gemini-${Date.now().toString(36)}`;
        const messageId = `${runId}-m1`;
        reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        const parser = new SseParser();
        let seq = 0;
        for (;;) {
          const { value, done } = await reader.read();
          for (const payload of done ? parser.end() : parser.push(value)) {
            const chunk = JSON.parse(payload) as GeminiChunk;
            const delta = (chunk.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
            if (!delta) continue;
            if (!started) {
              // Committed to this model from here on.
              started = true;
              clearTimeout(timer);
              modelStore.setAnswered(model);
              yield { type: 'RUN_STARTED', runId };
              yield { type: 'TEXT_MESSAGE_START', messageId };
            }
            yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta, seq: seq++ };
          }
          if (done) break;
        }
        if (!started) {
          failures.push(`${model}: empty answer`);
          continue;
        }
        yield { type: 'TEXT_MESSAGE_END', messageId };
        yield { type: 'RUN_FINISHED', runId };
        return;
      } catch (err) {
        if (signal.aborted) throw err;
        if (timedOut && !started) {
          failures.push(`${model}: no answer within ${FIRST_TOKEN_MS / 1000} s`);
          continue;
        }
        throw err;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reader?.releaseLock();
      }
    }

    throw new Error(`no Gemini model answered (${failures.join('; ')}). Try again shortly, or use Pre-recorded`);
  }
}

function shorten(message: string) {
  return message.length > 80 ? `${message.slice(0, 77)}…` : message;
}
