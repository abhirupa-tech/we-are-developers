import { describe, expect, it } from 'vitest';
import { splitBlocks } from './BlockMarkdown';
import { RECORDINGS } from '../stream/fixtures';

describe('splitBlocks', () => {
  it('splits on blank lines but never inside a code fence', () => {
    const md = 'para one\nstill one\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n- item\n- item';
    expect(splitBlocks(md)).toEqual(['para one\nstill one', '```ts\nconst a = 1;\n\nconst b = 2;\n```', '- item\n- item']);
  });

  it('keeps finished blocks identical as the stream grows (so memo can freeze them)', () => {
    const text = RECORDINGS.find((r) => r.id === 'demo-3k')!.deltas.map((d) => d.delta).join('');
    let prev: string[] = [];
    for (let n = 50; n <= text.length; n += 97) {
      const blocks = splitBlocks(text.slice(0, n));
      // Every block before the last one in the previous step is unchanged now.
      for (let i = 0; i < prev.length - 1; i++) expect(blocks[i]).toBe(prev[i]);
      prev = blocks;
    }
    expect(prev.length).toBeGreaterThan(20);
  });
});
