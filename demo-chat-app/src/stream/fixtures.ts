import { DEMO_3K, HEAVY_A2UI, HEAVY_FIELD_GUIDE_4500, HEAVY_MARKDOWN } from './heavyFixtures';
import { mulberry32 } from './prng';
import type { RecordingMeta } from './ReplaySource';

/**
 * Recorded answers for MockReplaySource. Each is Markdown split into
 * token-sized deltas with recorded inter-token gaps. Gaps come from a PRNG
 * seeded by the recording id, so a recording always replays identically.
 * About one gap in six is zero: several tokens that arrived in one network
 * chunk, which is exactly where batching behaviour differs.
 */

const BACKPRESSURE_PROSE = `Backpressure is what happens when a producer can emit data faster than a consumer can use it. In a streaming UI the producer is the model, and the consumer is everything between the network and the pixels: parsing, state updates, rendering, layout and paint.

When the consumer keeps up, every token appears almost as soon as it arrives. When it falls behind, tokens pile up in a queue you never asked for. The screen shows text that is already seconds old, the scroll position fights the reader, and typing into the composer starts to feel sticky.

There are only three things you can do about it. You can make each unit of work cheaper, so the consumer is faster. You can do less work per token, by coalescing many tokens into one update. Or you can change the priority of the work, so that the things a person is actively doing stay responsive while the stream catches up in the background.

Most chat interfaces do none of these on purpose. They append every token to a string in state, re-render the whole message, and re-parse the whole Markdown document on each update. That is fine for a short answer on a fast laptop. It is quadratic work, and it falls apart on long, structured answers on ordinary hardware.

The interesting part is that React already gives you the tools for all three. Automatic batching, transitions and external stores each change how updates reach the tree. They don't change the amount of text, but they change how often you pay for it, and when.`;

const CODE_HEAVY = `## Backpressure in a streaming chat UI

The naive version appends every token to state:

\`\`\`tsx
function Message({ stream }: { stream: AsyncIterable<string> }) {
  const [text, setText] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for await (const delta of stream) {
        if (cancelled) return;
        setText((t) => t + delta); // one render per token
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stream]);
  return <Markdown>{text}</Markdown>;
}
\`\`\`

Each \`setText\` that lands in its own task becomes its own render. Automatic batching only merges updates **inside one task**, and separate network chunks are separate tasks.

### Coalescing with requestAnimationFrame

\`\`\`ts
export function createCoalescer(onFlush: (text: string) => void) {
  let pending = '';
  let frame = 0;
  return {
    push(delta: string) {
      pending += delta;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const chunk = pending;
        pending = '';
        onFlush(chunk);
      });
    },
    cancel() {
      cancelAnimationFrame(frame);
      frame = 0;
      pending = '';
    },
  };
}
\`\`\`

Now the tree renders at most once per frame, no matter how fast tokens arrive.

### An external store

\`\`\`ts
type Listener = () => void;

export function createMessageStore() {
  let text = '';
  const listeners = new Set<Listener>();
  return {
    append(delta: string) {
      text += delta;
      listeners.forEach((l) => l());
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => text,
    getServerSnapshot: () => '',
  };
}
\`\`\`

\`getSnapshot\` returns a string, which is stable between changes, so React won't loop. Updates from an external store are always synchronous: they **cannot** be marked as transitions.

### Memoizing completed blocks

\`\`\`tsx
const Block = memo(function Block({ source }: { source: string }) {
  return <Markdown>{source}</Markdown>;
});

function StreamingMarkdown({ text }: { text: string }) {
  const blocks = splitIntoBlocks(text); // paragraphs, fences, tables
  const done = blocks.slice(0, -1);
  const live = blocks.at(-1) ?? '';
  return (
    <>
      {done.map((b, i) => (
        <Block key={i} source={b} />
      ))}
      <Markdown>{live}</Markdown>
    </>
  );
}
\`\`\`

Completed blocks never re-render, so the cost of each update stops growing with the length of the answer.

1. Measure first: renders per token, and how many tokens behind the screen is.
2. Coalesce before you optimise parsing.
3. Keep urgent input outside the streaming update path.
   - A controlled composer should never wait on the transcript.
   - Transitions help here, but they don't reduce work.`;

const TABLES = `## How the three strategies compare

| Strategy | Renders per token | Can be interrupted | Batches across tasks | Good for |
| --- | --- | --- | --- | --- |
| \`setState\` per event | about 1 | no | no | short answers |
| \`useTransition\` | 1 or more | yes | no | keeping input responsive |
| \`useSyncExternalStore\` | about 1 | no | no | sharing one stream across views |
| store + rAF coalescing | under 0.1 | no | yes | long, structured answers |

### What each metric means

| Metric | Measured by | Healthy |
| --- | --- | --- |
| Tokens behind | received minus shown, every frame | under 20 |
| Time to paint | arrival to estimated paint | p95 under 100 ms |
| Dropped frames | frame interval over 1.5 times normal | under 3% |
| Renders per token | render attempts / tokens | under 1 |
| Worst interaction | Event Timing, while the stream runs | under 200 ms |

### Where the time goes on a long answer

| Stage | Short answer | Long answer | Why it grows |
| --- | --- | --- | --- |
| Network and parse | 2% | 1% | constant per token |
| State update | 3% | 2% | constant per token |
| Markdown parse | 25% | 61% | whole document each time |
| Reconcile and commit | 40% | 27% | whole message each time |
| Layout and paint | 30% | 9% | grows with visible text |

- The Markdown row is the quadratic one.
  - Every update re-parses everything received so far.
  - Memoizing completed blocks turns it back into linear work.
- Commit cost falls with coalescing, because there are fewer commits.

> Numbers in these tables are illustrative, from one machine. Run Bench mode on yours.`;

function tokenize(text: string): string[] {
  // Token-sized chunks: whitespace stays attached to the following word,
  // and long words split into pieces of up to four characters.
  const words = text.match(/\s*\S+|\s+/g) ?? [];
  const out: string[] = [];
  for (const w of words) {
    if (w.length <= 5) {
      out.push(w);
      continue;
    }
    for (let i = 0; i < w.length; i += 4) out.push(w.slice(i, i + 4));
  }
  return out;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export type Recording = RecordingMeta & { deltas: { delta: string; t: number }[] };

function record(meta: Omit<RecordingMeta, 'tokenCount' | 'durationMs'>, text: string, meanGapMs: number): Recording {
  const rand = mulberry32(hash(meta.id));
  const tokens = tokenize(text);
  let t = 0;
  const deltas = tokens.map((delta, i) => {
    if (i > 0) {
      // ~1 in 6 tokens shares a network chunk with the previous one (gap 0);
      // the rest arrive with a jittered gap around the mean.
      t += rand() < 0.17 ? 0 : Math.round(meanGapMs * (0.4 + rand() * 1.2));
    }
    return { delta, t };
  });
  return { ...meta, tokenCount: deltas.length, durationMs: t, deltas };
}

export const RECORDINGS: Recording[] = [
  record(
    {
      id: 'demo-3k',
      title: 'Demo: 3K tokens',
      description: '~3,000 tokens: code fences, snippets, tables, diagrams and links. The stage demo.',
      prompt: 'How do I stream an LLM answer into React without dropping frames? Show code, tables and links.',
      contentTags: ['code', 'tables', 'links'],
    },
    DEMO_3K,
    12,
  ),
  record(
    {
      id: 'field-guide-4500',
      title: 'Heavy: field guide (4.5K)',
      description: '~4,500 tokens: code, ASCII diagrams, flow charts, tables, task lists and links.',
      prompt: 'Give me a field guide to streaming LLM answers into React, with code, diagrams and tables.',
      contentTags: ['code', 'tables', 'diagrams', 'links', 'long'],
    },
    HEAVY_FIELD_GUIDE_4500,
    14,
  ),
  record(
    {
      id: 'heavy-markdown',
      title: 'Heavy: field guide',
      description: '~8,000 tokens: code, ASCII diagrams, flow charts, tables, task lists and links. The real stress test.',
      prompt: 'Give me the complete field guide to streaming LLM answers into React, with code, diagrams and tables.',
      contentTags: ['code', 'tables', 'diagrams', 'links', 'long'],
    },
    HEAVY_MARKDOWN,
    16,
  ),
  record(
    {
      id: 'heavy-a2ui',
      title: 'Heavy: A2UI labs',
      description: '~8,400 tokens of A2UI: 9 interactive surfaces with cards, radios, selects, sliders, checkboxes, fields, ratings and buttons.',
      prompt: 'Build me an interactive lab for each React streaming technique, as A2UI.',
      contentTags: ['a2ui', 'interactive', 'long'],
    },
    HEAVY_A2UI,
    16,
  ),
  record(
    {
      id: 'code-heavy',
      title: 'Code-heavy answer',
      description: 'Four fenced code blocks, headings and a nested list.',
      prompt: 'How do I handle backpressure when streaming an LLM answer into React?',
      contentTags: ['code', 'lists'],
    },
    CODE_HEAVY,
    22,
  ),
  record(
    {
      id: 'tables-heavy',
      title: 'Tables-heavy answer',
      description: 'Three GFM tables, a nested list and a quote.',
      prompt: 'Compare the React strategies for rendering a streamed answer.',
      contentTags: ['tables', 'lists'],
    },
    TABLES,
    22,
  ),
  record(
    {
      id: 'prose',
      title: 'Prose only',
      description: 'Five plain paragraphs. The easy case.',
      prompt: 'Explain how backpressure works in streaming UIs.',
      contentTags: ['prose'],
    },
    BACKPRESSURE_PROSE,
    24,
  ),
  record(
    {
      id: 'everything-long',
      title: 'Everything, long',
      description: 'Prose, then code, then tables, in one long answer. The stress test.',
      prompt: 'Give me the full picture on streaming answers into a React UI.',
      contentTags: ['prose', 'code', 'tables', 'long'],
    },
    `${BACKPRESSURE_PROSE}\n\n${CODE_HEAVY}\n\n${TABLES}`,
    18,
  ),
];
