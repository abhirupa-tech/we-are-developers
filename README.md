# We Are Developers

Demos for the WeAreDevelopers talk on rendering streamed LLM responses.

| Folder | What it is |
| --- | --- |
| [`naive-streaming-response`](./naive-streaming-response) | **Basic GPT** — a dummy chat UI with a deliberately naive streaming renderer: every chunk re-parses the whole answer as Markdown and replaces the DOM. O(n²) on purpose. |
| [`demo-chat-app`](./demo-chat-app) | A standalone chat app demo. Placeholder for now. |

Each folder is a standalone app. `cd` into it, `npm install`, `npm run dev`.
