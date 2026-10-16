# Basic GPT — naive streaming response

A dummy chat client with a deliberately naive streaming renderer. Every chunk is appended to the full answer, the whole string is re-parsed as Markdown, and the DOM is replaced:

```js
text += delta
el.innerHTML = marked.parse(text)
```

That's O(n²) over an answer of n chunks. The meter under the composer plots the per-chunk cost (parse + `innerHTML`) against the 16.7 ms frame budget, so you can watch it climb.

## Run

```sh
npm install
npm run dev   # http://localhost:5180
```

## Response sources

Pick one from the menu in the top-right corner:

| Source | What happens |
| --- | --- |
| Local tape | The tape plays in the browser as OpenAI Chat Completions SSE bytes, with its timing. No network. |
| rec replay | The tape is encoded into a [rec](https://github.com/abhirupa-tech/rec-mock-llm-response-recorder) URL and `POST`ed to the deployed replay function. |
| rec URL… | `POST` to a replay URL you paste, such as one recorded in the [rec gateway](https://abhirupamitra.com/lab/rec/). |

All three go through the same SSE reader, so the renderer sees identical input.

The sidebar and the answers are static. Answers live in `src/stream/answers.ts`.

## Layout

```
src/App.tsx              chat UI and the naive render loop
src/Meter.tsx            per-chunk cost sparkline
src/Mascot.tsx           Pip
src/stream/sources.ts    local / rec sources, SSE reader
src/stream/tape.ts       rec tape format and URL codec
src/stream/answers.ts    canned answers
```
