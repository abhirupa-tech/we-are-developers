# We Are Developers

Demos for the WeAreDevelopers talk on rendering streamed LLM responses.

| Folder | What it is |
| --- | --- |
| [`naive-streaming-response`](./naive-streaming-response) | **Basic GPT** — a dummy chat UI with a deliberately naive streaming renderer: every chunk re-parses the whole answer as Markdown and replaces the DOM. O(n²) on purpose. |
| [`demo-chat-app`](./demo-chat-app) | **MockGPT**: replays a recorded LLM stream through `setState`, `useTransition` and `useSyncExternalStore`, with a live profiler HUD (heartbeat twins, frame heat strip, time to paint, render counts) and graded scorecards. |

Each folder is a standalone app. `cd` into it, `npm install`, `npm run dev`.
