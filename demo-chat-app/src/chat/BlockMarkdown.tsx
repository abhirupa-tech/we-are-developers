import { memo } from 'react';
import { MarkdownText } from './MarkdownText';

/**
 * Splits Markdown into top-level blocks: blank-line separated, never inside a
 * code fence. During a stream every block except the last is finished, and
 * its source string never changes again.
 */
export function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (m) {
      const marker = m[1][0].repeat(3);
      if (fence === null) fence = marker;
      else if (m[1].startsWith(fence)) fence = null;
    }
    if (fence === null && line.trim() === '' && current.length) {
      blocks.push(current.join('\n'));
      current = [];
    } else if (fence !== null || line.trim() !== '') {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join('\n'));
  return blocks;
}

/** One block. memo() freezes it: same source string, no re-render, no re-parse. */
const Block = memo(function Block({ source }: { source: string }) {
  return <MarkdownText text={source} />;
});

/**
 * "Code freeze": finished blocks are memoized and never re-render; only the
 * block still streaming is re-parsed. Each update costs one block, not the
 * whole answer.
 */
export function BlockMarkdown({ text }: { text: string }) {
  const blocks = splitBlocks(text);
  return (
    <>
      {blocks.map((source, i) => (
        <Block key={i} source={source} />
      ))}
    </>
  );
}
