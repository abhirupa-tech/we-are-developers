# MockGPT

A minimal chat app that replays a recorded LLM response stream through three
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

- **Strategy selector**: `setState`, `useTransition`, `useSyncExternalStore`
  (keys `1` `2` `3`). All three render the same `AssistantMessage` with the same
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
- **Modes**: Single (default), Compare (`C`: three panes on one shared stream,
  with a caveat banner), Presenter (`P`: bigger HUD, notes panel).
- **Interaction probe**: type in the probe field during a run, or leave
  Auto-probe on.

Keyboard: `1` `2` `3` strategy · `Space` start/stop · `R` reset · `C` compare ·
`P` presenter · `G` ghost runs · `?` help.

URL flags: `?hud=0` (HUD off, for the overhead check), `?strict=1` (StrictMode,
dev only), `?mode=compare`, `?presenter=1`, `?api=https://…` (HTTP source).

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
