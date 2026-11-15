import { describe, expect, it } from 'vitest';
import { EventBus, RUN_CHANNEL } from './EventBus';
import { RECORDINGS } from './fixtures';
import { MockReplaySource } from './MockReplaySource';
import type { PublishedEvent, StreamEvent } from './ReplaySource';
import { SseParser } from './sse';
import { runStream } from './StreamClient';

const stamp = (e: StreamEvent): PublishedEvent => ({ ...e, arrivedAt: 0 }) as PublishedEvent;

describe('SseParser', () => {
  it('returns every event in a chunk separately, in order', () => {
    const p = new SseParser();
    const out = p.push('data: {"n":1}\n\ndata: {"n":2}\n\ndata: {"n":3}\n\n');
    expect(out).toEqual(['{"n":1}', '{"n":2}', '{"n":3}']);
  });
  it('reassembles events split across chunks, with CRLF and comments', () => {
    const p = new SseParser();
    expect(p.push(': keep-alive\r\ndata: {"a"')).toEqual([]);
    expect(p.push(':1}\r\n\r\ndata: x\n')).toEqual(['{"a":1}']);
    expect(p.end()).toEqual(['x']);
  });
});

describe('EventBus', () => {
  it('delivers per message and to the run channel, in order', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('m1', (e) => seen.push(`m1:${e.type}`));
    bus.on(RUN_CHANNEL, (e) => seen.push(`run:${e.type}`));
    bus.publish(stamp({ type: 'RUN_STARTED', runId: 'r' }));
    bus.publish(stamp({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'a', seq: 0 }));
    expect(seen).toEqual(['run:RUN_STARTED', 'm1:TEXT_MESSAGE_CONTENT', 'run:TEXT_MESSAGE_CONTENT']);
  });
  it('replays a message’s earlier events to a late subscriber', () => {
    const bus = new EventBus();
    bus.publish(stamp({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'a', seq: 0 }));
    bus.publish(stamp({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'b', seq: 1 }));
    let text = '';
    bus.on('m1', (e) => e.type === 'TEXT_MESSAGE_CONTENT' && (text += e.delta));
    bus.publish(stamp({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'c', seq: 2 }));
    expect(text).toBe('abc');
  });
});

describe('MockReplaySource and StreamClient', () => {
  const rec = RECORDINGS.find((r) => r.id === 'prose')!;
  const collect = async () => {
    const bus = new EventBus();
    const events: PublishedEvent[] = [];
    bus.on(RUN_CHANNEL, (e) => events.push(e));
    const outcome = await runStream(new MockReplaySource(), bus, {
      recordingId: rec.id,
      rate: 1000,
      seed: 1,
      signal: new AbortController().signal,
    });
    return { outcome, events };
  };

  it('replays a recording completely: final text equals the concatenated deltas', async () => {
    const { outcome, events } = await collect();
    expect(outcome).toBe('finished');
    const text = events.flatMap((e) => (e.type === 'TEXT_MESSAGE_CONTENT' ? [e.delta] : [])).join('');
    expect(text).toBe(rec.deltas.map((d) => d.delta).join(''));
    expect(events[0].type).toBe('RUN_STARTED');
    expect(events.at(-1)?.type).toBe('RUN_FINISHED');
  });

  it('is deterministic: same recording gives identical events', async () => {
    const strip = (es: PublishedEvent[]) =>
      es.flatMap((e) => (e.type === 'TEXT_MESSAGE_CONTENT' ? [[e.seq, e.delta, e.t]] : []));
    const a = await collect();
    const b = await collect();
    expect(strip(a.events)).toEqual(strip(b.events));
  });

  it('stops publishing when aborted', async () => {
    const bus = new EventBus();
    let count = 0;
    bus.on(RUN_CHANNEL, () => count++);
    const ac = new AbortController();
    const run = runStream(new MockReplaySource(), bus, { recordingId: rec.id, rate: 1, signal: ac.signal });
    await new Promise((r) => setTimeout(r, 60));
    ac.abort();
    const outcome = await run;
    const at = count;
    await new Promise((r) => setTimeout(r, 60));
    expect(outcome).toBe('aborted');
    expect(count).toBe(at);
    expect(count).toBeLessThan(rec.deltas.length);
  });

  it('fixtures include the structures that expose the problem', () => {
    const everything = RECORDINGS.find((r) => r.id === 'everything-long')!;
    const text = everything.deltas.map((d) => d.delta).join('');
    expect(text).toContain('```tsx');
    expect(text).toContain('| --- |');
    expect(text).toMatch(/\n {3}- /); // nested list
    expect(everything.deltas.some((d, i) => i > 0 && d.t === everything.deltas[i - 1].t)).toBe(true); // bursts
  });
});
