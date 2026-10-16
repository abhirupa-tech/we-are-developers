import { encodeTape, type Tape } from './tape';

export const REC_ORIGIN = 'https://rec-mock-llm-response-recorder.vercel.app';

export type Source =
  /** Play the tape in the browser, emitting OpenAI SSE bytes with its timing. */
  | { kind: 'local' }
  /** POST to the deployed rec replay function with this tape in the URL. */
  | { kind: 'rec' }
  /** POST to a rec replay URL the user pasted. */
  | { kind: 'url'; url: string };

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(signal.reason);
    });
  });

function sseEvent(model: string, delta: Record<string, string>, finish: string | null = null) {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-basic-gpt',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

/** An in-browser stand-in for the rec replay function: same bytes on the wire. */
function localResponse(tape: Tape, signal: AbortSignal): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await sleep(tape.f, signal);
        controller.enqueue(enc.encode(sseEvent(tape.m, { role: 'assistant', content: '' })));
        for (const [gap, text] of tape.c) {
          await sleep(gap, signal);
          controller.enqueue(enc.encode(sseEvent(tape.m, { content: text })));
        }
        controller.enqueue(enc.encode(sseEvent(tape.m, {}, 'stop') + 'data: [DONE]\n\n'));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

export async function openStream(
  source: Source,
  tape: Tape,
  prompt: string,
  signal: AbortSignal,
): Promise<Response> {
  if (source.kind === 'local') return localResponse(tape, signal);

  const url =
    source.kind === 'url'
      ? source.url
      : `${REC_ORIGIN}/t/${await encodeTape(tape)}/v1/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: tape.m,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Replay answered ${res.status}`);
  return res;
}

/** Read an OpenAI Chat Completions SSE body and yield each content delta. */
export async function* readDeltas(res: Response): AsyncGenerator<string> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        const content = JSON.parse(data).choices?.[0]?.delta?.content;
        if (content) yield content;
      }
    }
  }
}
