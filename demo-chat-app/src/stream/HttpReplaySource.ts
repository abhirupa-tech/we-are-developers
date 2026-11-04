import type { RecordingMeta, ReplaySource, StartOptions, StreamEvent } from './ReplaySource';
import { SseParser } from './sse';

/**
 * Reads the recorded-stream API (proposed contract, TBD with the API team):
 *   GET  {base}/recordings -> RecordingMeta[]
 *   POST {base}/replay     -> text/event-stream of AG-UI events
 * Uses fetch + ReadableStream + TextDecoderStream rather than EventSource,
 * which can't send a POST body. Only this adapter changes if the API does.
 */
export class HttpReplaySource implements ReplaySource {
  readonly name: string;

  constructor(
    private readonly baseUrl: string,
    /** Set false if the server ignores `rate`; StreamClient will pace instead. */
    readonly paced = true,
  ) {
    this.name = `HTTP · ${baseUrl}`;
  }

  async list(): Promise<RecordingMeta[]> {
    const res = await fetch(`${this.baseUrl}/recordings`);
    if (!res.ok) throw new Error(`GET /recordings failed: ${res.status}`);
    const rows = (await res.json()) as Partial<RecordingMeta>[];
    return rows.map((r) => ({
      id: String(r.id),
      title: r.title ?? String(r.id),
      description: r.description ?? '',
      prompt: r.prompt ?? r.title ?? '',
      tokenCount: r.tokenCount ?? 0,
      durationMs: r.durationMs ?? 0,
      contentTags: r.contentTags ?? [],
    }));
  }

  async *start({ recordingId, rate, seed, signal }: StartOptions): AsyncIterable<StreamEvent> {
    const res = await fetch(`${this.baseUrl}/replay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ recordingId, rate, seed }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`POST /replay failed: ${res.status}`);

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    const parser = new SseParser();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        const payloads = done ? parser.end() : parser.push(value);
        // Every event in a chunk is yielded on its own, in order, in this task.
        for (const payload of payloads) yield JSON.parse(payload) as StreamEvent;
        if (done) return;
      }
    } finally {
      reader.releaseLock();
    }
  }
}
