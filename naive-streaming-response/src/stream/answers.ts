/**
 * Canned answers Basic GPT plays back until it's wired to real rec tapes.
 * They're long on purpose: the naive renderer only gets slow near the end.
 */

const STREAMING = `## Why long answers get slower

When a chat UI streams a response, the simplest renderer does three things on **every chunk**:

1. Append the chunk to the full string.
2. Re-parse the *whole* string as Markdown.
3. Throw away the old DOM and build a new one.

\`\`\`js
text += chunk
el.innerHTML = marked.parse(text)
\`\`\`

Chunk 1 parses one chunk of text. Chunk 2 parses two. Chunk 1,000 parses all 1,000. The total is an arithmetic series:

> 1 + 2 + 3 + … + n = n(n + 1) / 2 ≈ n² / 2

So a 1,000-chunk answer does roughly **500,000 chunk-parses** instead of 1,000.

### What users feel

- The start of the answer is fast.
- The end of a long answer is slow.
- Once per-chunk work passes the frame budget, frames drop: scroll stutters, typing lags and text arrives in clumps.

| Refresh rate | Frame budget |
| --- | --- |
| 60 Hz | 16.7 ms |
| 120 Hz | 8.3 ms |

### Hidden multipliers

Parsing is only part of the bill. Each naive re-render also pays for:

- **Syntax highlighting**, which reruns over every code block.
- **Sanitising**, which rescans all the accumulated text.
- **Style and layout** on a DOM that keeps growing.
- **Reconciliation**, if the tree is rendered through React.

### The fix

Use a streaming Markdown parser that reads each chunk once, holds back output until it knows what it is, and appends finished nodes with \`appendChild()\`. Earlier content is never touched again, so every chunk costs about the same and the total stays **O(n)**.

Watch the meter under the composer while this answer streams. The line climbing toward the dashed budget is this renderer re-doing work it already did.`;

const CODE = `## A streaming renderer, the naive way

Here's the pattern Basic GPT uses right now. It works, and it's quadratic.

\`\`\`ts
async function render(res: Response, el: HTMLElement) {
  let text = ''
  for await (const delta of readDeltas(res)) {
    text += delta
    // Re-parse everything that has arrived so far…
    const html = marked.parse(text)
    // …and rebuild the DOM from scratch.
    el.innerHTML = html
  }
}
\`\`\`

### What each line costs at chunk *k*

| Step | Work at chunk k |
| --- | --- |
| \`text += delta\` | O(1) amortised |
| \`marked.parse(text)\` | O(k) |
| \`el.innerHTML = html\` | O(k) nodes destroyed and rebuilt |

Summed over *n* chunks, the two O(k) steps give **n(n + 1) / 2** units of work.

### The React version has the same shape

\`\`\`tsx
function Answer({ text }: { text: string }) {
  // Every new chunk re-parses and re-diffs the whole tree.
  return <ReactMarkdown>{text}</ReactMarkdown>
}
\`\`\`

### An append-only sketch

\`\`\`ts
const parser = createStreamingParser({
  onNode: (node) => el.appendChild(node),
})
for await (const delta of readDeltas(res)) parser.write(delta)
parser.end()
\`\`\`

Each delta is read once. A \`**\` that might open bold text waits until its closing \`**\` arrives, then the finished node is appended and never revisited.

Try both against the same rec tape and compare the per-chunk timings: one line climbs, the other stays flat.`;

const SHORT = `Hi! I'm **Basic GPT**, a deliberately naive chat client.

Every chunk I receive gets appended to the full answer, re-parsed as Markdown and written back with \`innerHTML\`. Short answers like this one feel instant.

Ask me something longer, such as *"why does streaming get slower?"* or *"show me the code"*, and watch the meter climb.`;

export function answerFor(prompt: string): string {
  const p = prompt.toLowerCase();
  if (/\b(hi|hello|hey|who are you)\b/.test(p) && p.length < 40) return SHORT;
  if (/\b(code|ts|typescript|react|implement|example|snippet)\b/.test(p)) return CODE;
  return STREAMING;
}
