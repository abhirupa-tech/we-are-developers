/**
 * The rec tape format, trimmed to what Basic GPT needs. Canonical copy lives in
 * github.com/abhirupa-tech/rec-mock-llm-response-recorder (src/tape.ts).
 */
export type Tape = {
  v: 1;
  /** Model name, echoed back in replay. */
  m: string;
  /** Milliseconds from request start to the first chunk. */
  f: number;
  /** [gap ms, delta text] pairs. */
  c: [number, string][];
};

/** Split an answer into word-ish deltas with a believable rhythm. */
export function tapeFromText(text: string, model = 'basic-gpt-1'): Tape {
  const tokens = text.match(/\S+\s*/g) ?? [];
  const c: [number, string][] = tokens.map((token, i) => [
    // Mostly 15–45 ms, with the odd longer pause.
    15 + ((i * 37) % 31) + (i % 23 === 22 ? 120 : 0),
    token,
  ]);
  return { v: 1, m: model, f: 380, c };
}

/** JSON -> deflate-raw -> base64url, the same codec the rec replay URL uses. */
export async function encodeTape(tape: Tape): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(tape));
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
