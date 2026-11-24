/**
 * The heavy recordings: about 8,000 tokens each, built to make the strategies'
 * differences obvious. Every update re-parses the whole answer, so the cost
 * of an update grows with everything above it: code to highlight, tables,
 * diagrams, links, and in the A2UI one, dozens of live interactive surfaces.
 *
 * Generated from chapter templates so the content stays varied, and cut off
 * once it reaches the target token count. Deterministic: same text every time.
 */

export const HEAVY_TARGET_TOKENS = 8000;

type Topic = {
  slug: string;
  title: string;
  hook: string;
  api: string;
  verb: string;
  doc: string;
  metric: string;
};

const TOPICS: Topic[] = [
  { slug: 'batching', title: 'Automatic batching', hook: 'useState', api: 'setState', verb: 'batches', doc: 'https://react.dev/blog/2022/03/29/react-v18#new-feature-automatic-batching', metric: 'renders per token' },
  { slug: 'transitions', title: 'Transitions', hook: 'useTransition', api: 'startTransition', verb: 'deprioritises', doc: 'https://react.dev/reference/react/useTransition', metric: 'render attempts vs commits' },
  { slug: 'external-stores', title: 'External stores', hook: 'useSyncExternalStore', api: 'subscribe', verb: 'reads synchronously', doc: 'https://react.dev/reference/react/useSyncExternalStore', metric: 'store writes per frame' },
  { slug: 'deferred-values', title: 'Deferred values', hook: 'useDeferredValue', api: 'useDeferredValue', verb: 'lags behind', doc: 'https://react.dev/reference/react/useDeferredValue', metric: 'stale frames' },
  { slug: 'memoisation', title: 'Memoisation', hook: 'memo', api: 'memo', verb: 'skips', doc: 'https://react.dev/reference/react/memo', metric: 'skipped subtrees' },
  { slug: 'suspense', title: 'Suspense boundaries', hook: 'Suspense', api: 'use', verb: 'reveals', doc: 'https://react.dev/reference/react/Suspense', metric: 'fallback time' },
  { slug: 'profiler', title: 'The Profiler API', hook: 'Profiler', api: 'onRender', verb: 'measures', doc: 'https://react.dev/reference/react/Profiler', metric: 'actualDuration' },
  { slug: 'scheduling', title: 'Scheduling and yielding', hook: 'scheduler', api: 'scheduler.yield', verb: 'yields', doc: 'https://developer.mozilla.org/en-US/docs/Web/API/Scheduler/yield', metric: 'long tasks' },
  { slug: 'virtualisation', title: 'Virtualised transcripts', hook: 'useVirtualizer', api: 'measureElement', verb: 'windows', doc: 'https://tanstack.com/virtual/latest', metric: 'DOM nodes' },
  { slug: 'markdown', title: 'Incremental Markdown', hook: 'useMemo', api: 'parseBlocks', verb: 'caches', doc: 'https://github.com/remarkjs/react-markdown', metric: 'parse time' },
  { slug: 'workers', title: 'Parsing off the main thread', hook: 'useWorker', api: 'postMessage', verb: 'offloads', doc: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API', metric: 'main-thread busy' },
  { slug: 'paint', title: 'Layout and paint', hook: 'useLayoutEffect', api: 'requestAnimationFrame', verb: 'coalesces', doc: 'https://web.dev/articles/rendering-performance', metric: 'time to paint' },
  { slug: 'interaction', title: 'Interaction to Next Paint', hook: 'useOptimistic', api: 'PerformanceObserver', verb: 'protects', doc: 'https://web.dev/articles/inp', metric: 'INP' },
  { slug: 'sse', title: 'Server-sent events', hook: 'useEventSource', api: 'EventSource', verb: 'streams', doc: 'https://html.spec.whatwg.org/multipage/server-sent-events.html', metric: 'chunks per second' },
  { slug: 'ag-ui', title: 'Agent protocols', hook: 'useAgent', api: 'TEXT_MESSAGE_CONTENT', verb: 'carries', doc: 'https://docs.ag-ui.com', metric: 'events per answer' },
  { slug: 'a2ui', title: 'Declarative agent UI', hook: 'useSurface', api: 'surfaceUpdate', verb: 'describes', doc: 'https://a2ui.org', metric: 'components per surface' },
];

function pascal(s: string) {
  return s.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase());
}

/** One Markdown chapter: prose, code, a diagram, a flow, a table, links, tasks. */
function markdownChapter(t: Topic, i: number): string {
  const name = pascal(t.slug);
  const n = i + 2;
  return `## ${i + 1}. ${t.title}

**${t.title}** ${t.verb} work so the stream and the person reading it stop competing for the same main thread. The short version: \`${t.hook}\` changes *when* you pay for an update, not *how much text* there is. See the [official docs](${t.doc}) and the [MDN performance guide](https://developer.mozilla.org/en-US/docs/Web/Performance) for background, then measure **${t.metric}** before and after.

> Rule of thumb ${i + 1}: if ${t.metric} grows with answer length, the cost is quadratic. Fix the shape of the work before tuning constants.

### How the update flows

\`\`\`text
 network chunk ──▶ SSE parser ──▶ event bus ──▶ ${t.api.padEnd(22)}──▶ React render
       │                │               │                 │                       │
       ▼                ▼               ▼                 ▼                       ▼
   ~${(18 + i * 3).toString().padStart(3)} ms gap       JSON.parse      fan-out to ${n} panes   ${t.verb.padEnd(20)} commit + paint
\`\`\`

\`\`\`text
┌──────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│  Producer (model)    │────▶│  ${name.padEnd(20)}│────▶│  Consumer (pixels)   │
│  ${String(40 + i * 5).padStart(3)} tokens / second  │     │  queue depth: ${String(i * 7).padStart(3)}    │     │  ${String(60 - (i % 4) * 15).padStart(3)} frames / second  │
└──────────────────────┘     └──────────────────────┘     └──────────────────────┘
            ▲                                                          │
            └──────────────────── backpressure signal ◀────────────────┘
\`\`\`

### A minimal implementation

\`\`\`tsx
import { ${t.hook === 'memo' ? 'memo' : 'useEffect'}, useRef, useState } from 'react';

type ${name}Options = { flushEveryMs?: number; maxBatch?: number };

export function use${name}Stream(stream: AsyncIterable<string>, opts: ${name}Options = {}) {
  const { flushEveryMs = ${16 + i}, maxBatch = ${32 + i * 8} } = opts;
  const [text, setText] = useState('');
  const pending = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const flush = () => {
      timer = 0;
      const batch = pending.current.splice(0, maxBatch).join('');
      if (batch) setText((prev) => prev + batch); // ${t.api}: one update per flush
      if (pending.current.length) timer = window.setTimeout(flush, flushEveryMs);
    };
    (async () => {
      for await (const delta of stream) {
        if (cancelled) return;
        pending.current.push(delta);
        if (!timer) timer = window.setTimeout(flush, flushEveryMs);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stream, flushEveryMs, maxBatch]);

  return text;
}
\`\`\`

\`\`\`ts
// Measuring it: wire the Profiler and count ${t.metric}.
export function on${name}Render(id: string, phase: 'mount' | 'update' | 'nested-update', actual: number) {
  metrics.commits += 1;
  metrics.renderMs += actual;
  if (actual > ${8 + (i % 5) * 4}) console.warn(\`[\${id}] slow \${phase}: \${actual.toFixed(1)} ms\`);
}
\`\`\`

### Decision flow

\`\`\`mermaid
flowchart LR
  A[Token arrives] --> B{Same task as last?}
  B -- yes --> C[Batched into one render]
  B -- no --> D{${t.hook}?}
  D -- yes --> E[${t.verb} the update]
  D -- no --> F[Render immediately]
  E --> G[Commit when idle]
  F --> G
  G --> H[(Paint ${n} panes)]
\`\`\`

| Scenario | Naive \`setState\` | With \`${t.hook}\` | ${t.metric} | Verdict |
| --- | ---: | ---: | ---: | :---: |
| Short answer, fast laptop | ${4 + i} ms | ${3 + i} ms | ${1 + (i % 3)} | ✅ |
| Long answer, 4× CPU throttle | ${40 + i * 6} ms | ${12 + i * 2} ms | ${8 + i} | ⚠️ |
| Code + tables, 6× throttle | ${90 + i * 9} ms | ${24 + i * 3} ms | ${20 + i * 2} | ❌ → ✅ |
| Three panes, shared thread | ${130 + i * 11} ms | ${36 + i * 4} ms | ${30 + i * 3} | ⚠️ |

**Checklist for ${t.title.toLowerCase()}:**

- [x] Count renders with \`<Profiler onRender>\` ([reference](https://react.dev/reference/react/Profiler))
- [x] Watch dropped frames under ${4 + (i % 3) * 2}× CPU throttle
- [ ] Compare \`${t.hook}\` against plain \`setState\` on the *same* recording
- [ ] Check [INP](https://web.dev/articles/inp) while typing during the stream
  - typing in the probe field counts
  - the auto-probe fires every 250 ms
- [ ] Record the result in the scorecard and copy it as Markdown

Further reading: [${t.title} on GitHub](https://github.com/search?q=${encodeURIComponent(t.hook)}+streaming), [React working group notes](https://github.com/reactwg/react-18/discussions), and the [web.dev rendering guide](https://web.dev/articles/rendering-performance).

---

`;
}

/** One A2UI chapter: a short explanation and one big interactive surface. */
function a2uiChapter(t: Topic, i: number): string {
  const surface = {
    surfaceId: `${t.slug}-lab-${i + 1}`,
    title: `${t.title} lab`,
    dataModel: {
      strategy: 'syncStore',
      throttle: 4 + (i % 3) * 2,
      rate: 5,
      panes: 'single',
      showGhosts: true,
      flash: i % 2 === 0,
      profiler: true,
      notes: '',
      email: '',
      confidence: 3,
      goals: { smooth: true, fresh: i % 2 === 1, responsive: true },
    },
    root: {
      type: 'Column',
      gap: 'md',
      children: [
        {
          type: 'Row',
          gap: 'sm',
          align: 'between',
          children: [
            { type: 'Text', text: `${i + 1}. ${t.title}`, variant: 'h1' },
            { type: 'Badge', text: t.metric, tone: (['info', 'success', 'warning', 'danger'] as const)[i % 4] },
          ],
        },
        { type: 'Text', text: `Tune how ${t.hook} ${t.verb} streamed updates, then run the same recording against each strategy.`, variant: 'caption' },
        { type: 'Progress', label: `Lab ${i + 1}`, value: i + 1, max: 9 },
        {
          type: 'Card',
          title: 'Rendering strategy',
          subtitle: 'Which React primitive receives the stream',
          children: [
            {
              type: 'RadioGroup',
              path: 'strategy',
              options: [
                { value: 'setState', label: 'setState: one render per network task' },
                { value: 'transition', label: 'useTransition: lower priority, same work' },
                { value: 'syncStore', label: 'useSyncExternalStore: writes outside React' },
                { value: 'deferred', label: `${t.hook}: ${t.verb} the update` },
              ],
            },
            {
              type: 'Select',
              label: 'Panes',
              path: 'panes',
              options: [
                { value: 'single', label: 'Single pane' },
                { value: 'compare', label: 'Compare all three' },
                { value: 'presenter', label: 'Presenter layout' },
              ],
            },
          ],
        },
        {
          type: 'Row',
          gap: 'md',
          children: [
            {
              type: 'Card',
              title: 'Load',
              children: [
                { type: 'Slider', label: 'CPU throttle', path: 'throttle', min: 1, max: 20, step: 1, unit: '×' },
                { type: 'Slider', label: 'Replay speed', path: 'rate', min: 1, max: 10, step: 1, unit: '×' },
              ],
            },
            {
              type: 'Card',
              title: 'Instruments',
              children: [
                { type: 'CheckBox', label: 'Ghost runs', path: 'showGhosts' },
                { type: 'CheckBox', label: 'Flash renders', path: 'flash' },
                { type: 'CheckBox', label: '<Profiler> onRender', path: 'profiler' },
                { type: 'CheckBox', label: 'Optimise for smoothness', path: 'goals.smooth' },
                { type: 'CheckBox', label: 'Optimise for freshness', path: 'goals.fresh' },
                { type: 'CheckBox', label: 'Optimise for responsiveness', path: 'goals.responsive' },
              ],
            },
          ],
        },
        {
          type: 'Card',
          title: 'Results',
          subtitle: `Expected ${t.metric} with each strategy`,
          children: [
            { type: 'Progress', label: 'setState', value: 92 - (i % 5) * 6, max: 100 },
            { type: 'Progress', label: 'useTransition', value: 61 - (i % 4) * 5, max: 100 },
            { type: 'Progress', label: 'useSyncExternalStore', value: 48 - (i % 3) * 7, max: 100 },
            { type: 'Divider' },
            { type: 'Text', text: `Docs: ${t.doc}`, variant: 'caption' },
          ],
        },
        {
          type: 'Card',
          title: 'Your notes',
          children: [
            { type: 'TextField', label: 'What did you observe?', path: 'notes', multiline: true, placeholder: `e.g. ${t.metric} doubled at 6× throttle` },
            { type: 'TextField', label: 'Send the results to', path: 'email', inputType: 'email', placeholder: 'you@example.com' },
            { type: 'Rating', label: 'How confident are you in these numbers?', path: 'confidence', max: 5 },
          ],
        },
        {
          type: 'Row',
          gap: 'sm',
          align: 'end',
          children: [
            { type: 'Button', label: 'Reset', action: 'reset', variant: 'secondary' },
            { type: 'Button', label: 'Discard run', action: 'discard', variant: 'danger' },
            { type: 'Button', label: 'Run experiment', action: 'run', variant: 'primary' },
          ],
        },
      ],
    },
  };

  return `### ${i + 1}. ${t.title}

\`${t.hook}\` ${t.verb} streamed work. Read the [reference](${t.doc}), then use the lab below: every control is a real component bound to the surface's data model, and **Run experiment** sends the settings back to the agent.

\`\`\`a2ui
${JSON.stringify(surface)}
\`\`\`

`;
}

/** Same tokenizer as fixtures.ts: whitespace sticks to the next word, long words split by four. */
export function countTokens(text: string): number {
  let n = 0;
  for (const w of text.match(/\s*\S+|\s+/g) ?? []) n += w.length <= 5 ? 1 : Math.ceil(w.length / 4);
  return n;
}

/** Adds chapters while the whole answer stays within the target. */
/**
 * Adds chapters while the whole answer stays within the target. The intro is
 * a function of the chapters that made it in, so its contents list matches.
 */
function build(intro: (topics: Topic[]) => string, chapter: (t: Topic, i: number) => string, outro: string, target = HEAVY_TARGET_TOKENS): string {
  let body = '';
  let n = 0;
  for (; n < TOPICS.length; n++) {
    const next = chapter(TOPICS[n], n);
    const included = TOPICS.slice(0, n + 1);
    if (n > 0 && countTokens(intro(included) + body + next + outro) > target) break;
    body += next;
  }
  return intro(TOPICS.slice(0, n)) + body + outro;
}

export const HEAVY_MARKDOWN = build(
  (topics) => `# Streaming an LLM answer into React: the complete field guide

This answer is deliberately **huge**: roughly eight thousand tokens of headings, highlighted code, ASCII architecture diagrams, flow charts, GFM tables, task lists, quotes and links. Every update re-parses all of it, so whichever strategy renders it least often (or at the right priority) wins visibly.

**Contents:** ${topics.map((t, i) => `[${i + 1}. ${t.title}](#${i + 1}-${t.slug})`).join(' · ')}

`,
  markdownChapter,
  `## Summary

| Strategy | Renders | Priority | Best for |
| --- | --- | --- | --- |
| \`setState\` | one per network task | urgent | short answers |
| \`useTransition\` | interruptible, may be thrown away | low | keeping input responsive |
| \`useSyncExternalStore\` | one per store write | urgent, tear-free | shared state outside React |

That's the whole tour. Measure on your own hardware, with the [Profiler](https://react.dev/reference/react/Profiler) and [DevTools performance panel](https://developer.chrome.com/docs/devtools/performance), before you believe any of it.
`,
);

export const HEAVY_A2UI = build(
  (topics) => `# A2UI stress test: ${topics.length} interactive labs

Each section below is an **A2UI surface**: the agent describes the UI as JSON, and the client renders it with trusted components (cards, radio groups, selects, sliders, checkboxes, text fields, ratings, progress bars, badges and buttons). Every surface is live: change anything and only that surface re-renders. Background: [A2UI](https://a2ui.org), [AG-UI](https://docs.ag-ui.com), [React docs](https://react.dev).

`,
  a2uiChapter,
  `---

**Done.** That's a lot of UI streamed as JSON. Compare how each strategy coped: the strategies that render less often re-parse these surfaces less often.
`,
  // A2UI chapters are ~900 tokens each; leave room for one more surface.
  HEAVY_TARGET_TOKENS + 600,
);

/** The stage demo: about 3,000 tokens of prose, code fences, tables and links. */
export const DEMO_TARGET_TOKENS = 3000;

export const DEMO_3K = build(
  (topics) => `# Streaming an LLM answer into React without dropping frames

About **three thousand tokens** of prose, highlighted code, diagrams, tables and links, streamed fast. Every update re-parses all of it, so the strategy that renders least often, *at the right moment*, wins. Background: [React docs](https://react.dev), [web.dev on rendering performance](https://web.dev/articles/rendering-performance), [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).

**Contents:** ${topics.map((t, i) => `[${i + 1}. ${t.title}](#${i + 1}-${t.slug})`).join(' · ')}

`,
  markdownChapter,
  `## Summary

| Strategy | Renders | Work per render | Dropped frames |
| --- | --- | --- | --- |
| \`setState\` | one per network task | the whole answer | most |
| \`setState\` + \`React.memo\` freeze | one per network task | the streaming block | fewer |
| \`useSyncExternalStore\` + rAF + memo | at most one per frame | the streaming block | fewest |

\`\`\`ts
// The winner, in one line: buffer outside React, publish once per frame.
append(delta) { pending += delta; if (!scheduled) { scheduled = true; requestAnimationFrame(flush); } }
\`\`\`

Measure it yourself with the [Profiler](https://react.dev/reference/react/Profiler) and the [Chrome performance panel](https://developer.chrome.com/docs/devtools/performance).
`,
  DEMO_TARGET_TOKENS,
);

/** The mid-size field guide: about 4,500 tokens, same chapters as the big one. */
export const FIELD_GUIDE_TARGET_TOKENS = 4500;

export const HEAVY_FIELD_GUIDE_4500 = build(
  (topics) => `# Streaming an LLM answer into React: the field guide

About **four and a half thousand tokens** of headings, highlighted code, ASCII architecture diagrams, flow charts, GFM tables, task lists, quotes and links. Every update re-parses all of it, so the strategy that renders least often, at the right moment, drops the fewest frames.

**Contents:** ${topics.map((t, i) => `[${i + 1}. ${t.title}](#${i + 1}-${t.slug})`).join(' · ')}

`,
  markdownChapter,
  `## Summary

| Strategy | Renders | Work per render | Dropped frames |
| --- | --- | --- | --- |
| \`setState\` | one per network task | the whole answer | most |
| \`setState\` + \`React.memo\` freeze | one per network task | the streaming block | fewer |
| \`useSyncExternalStore\` + rAF + memo | at most one per frame | the streaming block | fewest |

## FAQ

**Why not just \`useDeferredValue\`?** It drops stale renders only when React is already behind. Frame batching makes sure it never falls behind in the first place. See [useDeferredValue](https://react.dev/reference/react/useDeferredValue).

**Doesn't React 18 batch automatically?** Only updates inside one task. Every network chunk is a new task, so every chunk is a new render. The [automatic batching notes](https://react.dev/blog/2022/03/29/react-v18#new-feature-automatic-batching) spell it out.

**What about a 50 ms timer?** Fewer renders, but the timer fires mid-frame, so a render that would have fit can still miss the paint.

\`\`\`ts
// Timer buffer: fewer renders, not aligned to frames.
const timer = setInterval(() => {
  if (!pending) return;
  setText((t) => t + pending);
  pending = '';
}, 50);

// Frame batching: one publish per frame, at the start of the frame.
function append(delta: string) {
  pending += delta;
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    text += pending;
    pending = '';
    listeners.forEach((l) => l());
  });
}
\`\`\`

**How do I know it worked?** Count dropped frames, not renders. A run with fewer renders can still drop more frames if each render lands at the wrong moment.

- [ ] Run each strategy on the same recording
- [ ] Turn on **Flash renders**: orange means the frame dropped
- [ ] Compare *Frames dropped* and *Slow frames* in the HUD

Further reading: [web.dev on INP](https://web.dev/articles/inp), [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame), [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore).

Measure on your own hardware, with the [Profiler](https://react.dev/reference/react/Profiler) and the [DevTools performance panel](https://developer.chrome.com/docs/devtools/performance), before you believe any of it.
`,
  FIELD_GUIDE_TARGET_TOKENS + 100,
);
