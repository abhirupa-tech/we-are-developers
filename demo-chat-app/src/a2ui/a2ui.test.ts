import { describe, expect, it } from 'vitest';
import { decodeAction, encodeAction, getPath, parseSurface, setPath, splitA2ui } from './parse';

const surface = JSON.stringify({
  surfaceId: 'pizza',
  dataModel: { size: 'm', extra: false },
  root: {
    type: 'Card',
    title: 'Order',
    children: [
      { type: 'RadioGroup', path: 'size', options: [{ value: 'm', label: 'Medium' }] },
      { type: 'CheckBox', label: 'Extra cheese', path: 'extra' },
      { type: 'Button', label: 'Order', action: 'submit' },
    ],
  },
});

describe('splitA2ui', () => {
  it('returns plain Markdown untouched', () => {
    expect(splitA2ui('Hello **there**')).toEqual([{ kind: 'markdown', text: 'Hello **there**' }]);
  });

  it('splits prose and a complete block', () => {
    const segs = splitA2ui(`Pick one:\n\n\`\`\`a2ui\n${surface}\n\`\`\`\n\nThanks!`);
    expect(segs.map((s) => s.kind)).toEqual(['markdown', 'a2ui', 'markdown']);
    expect(segs[1]).toEqual({ kind: 'a2ui', json: surface, complete: true });
  });

  it('marks a block still streaming as incomplete', () => {
    const segs = splitA2ui('Pick:\n```a2ui\n{"surfaceId":"x",');
    expect(segs[1]).toEqual({ kind: 'a2ui', json: '{"surfaceId":"x",', complete: false });
  });

  it('handles the fence before its newline arrives', () => {
    expect(splitA2ui('```a2ui')).toEqual([{ kind: 'a2ui', json: '', complete: false }]);
  });
});

describe('parseSurface', () => {
  it('accepts a valid surface', () => {
    const r = parseSurface(surface);
    expect(r.ok && r.surface.surfaceId).toBe('pizza');
  });

  it('rejects bad JSON, unknown components and missing fields', () => {
    expect(parseSurface('{').ok).toBe(false);
    const unknown = parseSurface(JSON.stringify({ root: { type: 'Script', src: 'x' } }));
    expect(!unknown.ok && unknown.error).toMatch(/not in the catalog/);
    const missing = parseSurface(JSON.stringify({ root: { type: 'Column', children: [{ type: 'Button', label: 'Go' }] } }));
    expect(!missing.ok && missing.error).toMatch(/"action" must be a string/);
  });

  it('only allows https images', () => {
    expect(parseSurface(JSON.stringify({ root: { type: 'Image', url: 'javascript:alert(1)', alt: '' } })).ok).toBe(false);
  });
});

describe('data model paths', () => {
  it('reads and writes dotted paths immutably', () => {
    const data = { trip: { nights: 2 } };
    const next = setPath(data, 'trip.nights', 5);
    expect(getPath(next, 'trip.nights')).toBe(5);
    expect(data.trip.nights).toBe(2);
  });
});

describe('actions', () => {
  it('round-trips', () => {
    const a = { surfaceId: 's', action: 'submit', data: { x: 1 } };
    expect(decodeAction(encodeAction(a))).toEqual(a);
    expect(decodeAction('hello')).toBeNull();
  });
});
