# MockGPT

A minimal chat app that replays a recorded LLM response stream through four
React state strategies, with a live profiler on top. A conference demo first,
a reproducible benchmark second.

```bash
npm install
npm run dev        # dev build, http://localhost:5181
npm run build      # bench build: production React + react-dom/profiling
npm run preview    # serve the bench build, http://localhost:5181
npm test           # Vitest: metric maths, SSE parser, bus, replay
```

Use the **bench build** for any number you publish. The dev build is labelled
"Indicative" on the scorecard, and the badge says which build is running.

## What's on screen

- **Strategy selector**: `setState`, `useTransition`, `useSyncExternalStore`,
  `syncStore + rAF` (keys `1` `2` `3` `4`). All four render the same `AssistantMessage` with the same
  Markdown pipeline (`react-markdown` + `remark-gfm` + `rehype-highlight`,
  re-parsed in full on every update, on purpose).
- **HUD**, drawn imperatively so it never re-renders during a run:
  - Heartbeat twins: the left dot moves with JavaScript frames and freezes when
    the main thread is blocked; the right dot runs on the compositor and keeps
    gliding.
  - Frame heat strip: one bar per frame (smooth, slow, dropped, long), with the
    previous run as a faint ghost line.
  - Renders, commits and renders per token.
  - Tokens behind, with a gauge.
  - Time to paint (token-to-paint latency) ribbon with p50/p95 guides and ghost
    runs.
  - Main thread busy, worst interaction, transition pending time, device speed.
  - Jank alarm: the screen edge flashes when a frame takes over 100 ms.
- **Scorecard** at the end of a run: smoothness, freshness and responsiveness
  graded S to D (thresholds in `src/metrics/grades.ts`), the key numbers, and
  "Copy results" as a Markdown table.
- **Modes**: Single (default), Compare (`C`: four panes on one shared stream,
  with a caveat banner), Presenter (`P`: bigger HUD, notes panel).
- **Live** (`L`): a real chat with Gemini in one `useSyncExternalStore` pane.
  See [Live mode](#live-mode-gemini--usesyncexternalstore).
- **Interaction probe**: type in the probe field during a run, or leave
  Auto-probe on.

Keyboard: `1` `2` `3` `4` strategy · `5` A2UI · `F` flash renders · `Space` start/stop · `R` reset · `C` compare ·
`L` live · `P` presenter · `G` ghost runs · `?` help.

URL flags: `?hud=0` (HUD off, for the overhead check), `?strict=1` (StrictMode,
dev only), `?mode=compare`, `?mode=live`, `?presenter=1`, `?api=https://…` (HTTP source).

## Live mode (Gemini + useSyncExternalStore)

A multi-turn chat with the Gemini API whose state lives outside React.

```bash
cp .env.example .env.local   # then set VITE_GEMINI_API_KEY
npm run dev                  # open http://localhost:5181/?mode=live
```

| File | What it does |
| --- | --- |
| `src/live/chatStore.ts` | The external store: `subscribe`, `getSnapshot`, immutable writes. |
| `src/live/GeminiSource.ts` | `streamGenerateContent?alt=sse`, turned into the app's stream events. |
| `src/live/LivePane.tsx` | The view (Tailwind). `Conversation` reads the store with `useSyncExternalStore`. |

The stream writes to the store, the store notifies React, and `Conversation`
re-renders once per write. Finished messages keep their object identity, so
`memo` skips them and only the streaming answer re-parses.

The pane sits inside the same `Profiler` and `PaneContext` as the replay panes,
so the HUD and scorecard track it the same way: renders (`useRenderCount`),
commits, tokens behind, time to paint, frames, interactions. One Gemini SSE
chunk (a few words) counts as one token, and the network sets the pace, so runs
are not repeatable: use the recordings for numbers you publish.

`VITE_GEMINI_MODEL` picks the model (default `gemini-3.5-flash`). Vite
inlines `VITE_` variables into the bundle, so the key is visible to anyone who
gets the build: keep Live mode to local demos, or put a proxy in front.

Tailwind (v4, `@tailwindcss/vite`) is loaded without preflight in
`src/tailwind.css`, so the rest of the app's CSS is unaffected.

## syncStore + rAF (the fourth strategy)

`src/strategies/frameBatched.tsx`: an external store that buffers appends and
publishes at most once per animation frame. The other three render once per
token or network chunk; this one renders at most once per frame, however fast
tokens arrive, so it is the only strategy that reduces the amount of work
rather than when it happens. Expect renders per token well under 1 on the
heavy recordings at 5x or 10x. Time to paint goes up by at most one frame.

## A2UI mode (Gemini + interactive UI)

`A2UI` in the mode selector (key `5`, or `?mode=a2ui`) is Live mode with a
system prompt that lets Gemini answer with interactive UI, in the spirit of
Google's A2UI: the agent sends a declarative JSON description built only from
a trusted component catalog, and the client renders it with its own
components.

| File | What it does |
| --- | --- |
| `src/a2ui/types.ts` | The catalog: Column, Row, Card, Text, Badge, Divider, Image, Button, CheckBox, RadioGroup, Select, TextField, Slider, Rating, Progress. |
| `src/a2ui/prompt.ts` | The contract Gemini gets: format, catalog, bindings, actions. |
| `src/a2ui/parse.ts` | Splits a streaming answer into Markdown and ```` ```a2ui ```` blocks, validates surfaces (unknown components and non-https images are rejected), data-model paths. |
| `src/a2ui/Surface.tsx` | The React renderer. Inputs bind to the surface's `dataModel` by `path`. |

A Button sends `[a2ui action] {surfaceId, action, data}` back to Gemini as the
next user turn, with the surface's current data model, and the surface locks.
Simplified from the A2UI spec: one JSON object per surface with a nested tree,
instead of a flat component list streamed in parts.

## Flash renders

`Flash renders` in the top bar (key `F`, or `?flash=1`) outlines a component
every time it commits, with its name and commit count. It covers the chat
components (Conversation, each message, the composer, every A2UI component)
and the replay panes. Flags and animations live outside React, so toggling it
re-renders nothing, but each flash costs a little main-thread time: turn it off
before reading the scorecard.

## Stream sources

- `MockReplaySource` (default): four local recordings (code-heavy, tables-heavy,
  prose, and a long mix), split into token-sized deltas with recorded gaps.
  About one token in six shares a network chunk with the previous one.
- `HttpReplaySource`: the proposed recorded-stream API (`GET /recordings`,
  `POST /replay` returning AG-UI events over SSE), read with `fetch` +
  `TextDecoderStream`. Choose it in settings or with `?api=`. If the server
  doesn't honour `rate`, untick "Server paces" and the client paces from `t`.

## Measurement notes

- **Time to paint** is estimated with `requestAnimationFrame` followed by a
  `MessageChannel` message: accurate to about one frame.
- **Render attempts** are counted in each strategy's own component
  (`useRenderCount`), not in `AssistantMessage` as the spec suggests. React
  abandons interrupted transition renders before it reaches the leaf, so
  counting there missed exactly the work transitions throw away (it showed
  fewer attempts than commits). Counted one level up, transitions show attempts
  above commits, as expected.
- **Tokens behind** is received minus shown, per the spec. The stream is read on
  the same main thread as rendering, so slow renders also delay when tokens
  arrive. The scorecard shows how long the replay took against the recording's
  pace, so that slowdown is visible.
- **Auto-probe** can't use Event Timing (synthetic events aren't measured), so
  it fires an urgent update every 250 ms and records due-time to paint. Typing
  in the probe field is measured by Event Timing.
- Each simulated network chunk lands in its own task (a `MessageChannel` post,
  not `setTimeout(0)`, which browsers clamp to 4 ms). Runs start in a fresh
  task, so no strategy inherits the priority of the click or key that started
  them.
- Long frames use `long-animation-frame` where supported, else `longtask`.
  Chrome is recommended; unsupported APIs show as unavailable, never faked.

## Not built yet

From the spec's P1 and P2: Bench mode (automatic N-run matrix, median and IQR,
JSON export), the Advanced drawer (flush cadence, Markdown modes), the React
Compiler build flag, run history, and Playwright e2e tests in the repo.
