import { describe, expect, it } from 'vitest';
import { parseSurface, splitA2ui } from '../a2ui/parse';
import { RECORDINGS } from './fixtures';

describe('heavy recordings', () => {
  for (const id of ['heavy-markdown', 'heavy-a2ui']) {
    it(`${id} is about 8,000 tokens`, () => {
      const rec = RECORDINGS.find((r) => r.id === id)!;
      expect(rec.tokenCount).toBeGreaterThanOrEqual(7500);
      expect(rec.tokenCount).toBeLessThan(10000);
    });
  }

  it('every A2UI surface in the A2UI recording is valid', () => {
    const rec = RECORDINGS.find((r) => r.id === 'heavy-a2ui')!;
    const text = rec.deltas.map((d) => d.delta).join('');
    const blocks = splitA2ui(text).filter((s) => s.kind === 'a2ui');
    expect(blocks.length).toBeGreaterThanOrEqual(8);
    for (const b of blocks) {
      expect(b.kind === 'a2ui' && b.complete).toBe(true);
      const r = b.kind === 'a2ui' ? parseSurface(b.json) : null;
      expect(r?.ok ? 'ok' : r?.error).toBe('ok');
    }
  });
});

describe('stage demo recording', () => {
  it('is about 3,000 tokens with code fences and links', () => {
    const rec = RECORDINGS.find((r) => r.id === 'demo-3k')!;
    const text = rec.deltas.map((d) => d.delta).join('');
    expect(rec.tokenCount).toBeGreaterThanOrEqual(2500);
    expect(rec.tokenCount).toBeLessThanOrEqual(3200);
    expect(text).toContain('```');
    expect(text).toMatch(/\]\(https:\/\//);
  });
});
