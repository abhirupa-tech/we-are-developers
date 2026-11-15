import { describe, expect, it } from 'vitest';
import { RunCollector } from './collector';
import { calibrateInterval, classifyFrame, isDropped } from './frames';
import { gradeRun, gradeValue } from './grades';
import { iqr, median, percentile, RingBuffer } from './stats';

describe('percentiles', () => {
  it('interpolates between closest ranks', () => {
    const v = [10, 20, 30, 40, 50];
    expect(percentile(v, 50)).toBe(30);
    expect(percentile(v, 95)).toBeCloseTo(48);
    expect(percentile(v, 0)).toBe(10);
    expect(percentile(v, 100)).toBe(50);
  });
  it('does not depend on input order', () => {
    expect(percentile([50, 10, 40, 20, 30], 95)).toBeCloseTo(48);
  });
  it('handles empty and single inputs', () => {
    expect(percentile([], 50)).toBeNaN();
    expect(percentile([7], 95)).toBe(7);
  });
  it('median and IQR', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(iqr([1, 2, 3, 4, 5])).toBe(2);
  });
});

describe('RingBuffer', () => {
  it('keeps the newest values once full', () => {
    const r = new RingBuffer(3);
    [1, 2, 3, 4, 5].forEach((v) => r.push(v));
    expect(r.toArray()).toEqual([3, 4, 5]);
  });
});

describe('frame classification', () => {
  const hz60 = 1000 / 60;
  const hz120 = 1000 / 120;
  it('classifies at 60 Hz', () => {
    expect(classifyFrame(16.7, hz60)).toBe('smooth');
    expect(classifyFrame(22, hz60)).toBe('slow');
    expect(classifyFrame(26, hz60)).toBe('dropped');
    expect(classifyFrame(80, hz60)).toBe('long');
  });
  it('classifies at 120 Hz with the same rules', () => {
    expect(classifyFrame(8.4, hz120)).toBe('smooth');
    expect(classifyFrame(11, hz120)).toBe('slow');
    // A normal 60 Hz frame is a dropped frame on a 120 Hz display.
    expect(classifyFrame(16.7, hz120)).toBe('dropped');
  });
  it('dropped-frame count includes long frames', () => {
    expect(isDropped('long')).toBe(true);
    expect(isDropped('dropped')).toBe(true);
    expect(isDropped('slow')).toBe(false);
  });
  it('calibrates to the display refresh rate', () => {
    const noisy60 = Array.from({ length: 60 }, (_, i) => 16.67 + ((i % 5) - 2) * 0.2);
    expect(calibrateInterval(noisy60)).toBeCloseTo(1000 / 60, 3);
    const noisy120 = Array.from({ length: 60 }, (_, i) => 8.33 + ((i % 3) - 1) * 0.1);
    expect(calibrateInterval(noisy120)).toBeCloseTo(1000 / 120, 3);
    expect(calibrateInterval([])).toBeCloseTo(1000 / 60, 3);
  });
});

describe('grades', () => {
  it('uses the threshold boundaries (upper bound exclusive)', () => {
    expect(gradeValue('smoothness', 0.5)).toBe('S');
    expect(gradeValue('smoothness', 1)).toBe('A');
    expect(gradeValue('smoothness', 14.9)).toBe('C');
    expect(gradeValue('smoothness', 15)).toBe('D');
    expect(gradeValue('freshness', 99)).toBe('A');
    expect(gradeValue('responsiveness', 199)).toBe('A');
    expect(gradeValue('responsiveness', 200)).toBe('B');
    expect(gradeValue('responsiveness', 500)).toBe('D');
  });
  it('overall is the weakest axis, ignoring unmeasured ones', () => {
    expect(gradeRun({ droppedPct: 0.2, p95Latency: 30, worstInteraction: 600 }).overall).toBe('D');
    const g = gradeRun({ droppedPct: 2, p95Latency: 30, worstInteraction: NaN });
    expect(g.responsiveness).toBeNull();
    expect(g.overall).toBe('A');
  });
});

describe('RunCollector', () => {
  it('computes backlog from received and shown tokens', () => {
    const c = new RunCollector('p', 'setState', 0);
    for (let seq = 0; seq < 10; seq++) c.onToken(seq, seq * 10);
    expect(c.backlog()).toBe(10);
    c.shownSeq = 6; // seq 0..6 on screen
    expect(c.backlog()).toBe(3);
    expect(c.maxBacklog).toBe(10);
  });
  it('reports renders per token and catch-up', () => {
    const c = new RunCollector('p', 'transition', 0);
    for (let seq = 0; seq < 4; seq++) c.onToken(seq, 0);
    for (let i = 0; i < 6; i++) c.onRenderAttempt();
    c.onCommit(2);
    c.onCommit(4);
    const m = c.snapshot(null, 1000);
    expect(m.rendersPerToken).toBe(1.5);
    expect(m.commits).toBe(2);
    expect(m.renderP50).toBe(3);
    expect(c.caughtUp()).toBe(false);
    c.shownSeq = 3;
    expect(c.caughtUp()).toBe(true);
  });
  it('accumulates transition pending time', () => {
    const c = new RunCollector('p', 'transition', 0);
    c.onPending(true, 100);
    c.onPending(false, 160);
    c.onPending(true, 200);
    c.onPending(false, 210);
    expect(c.transitionPendingMs).toBe(70);
  });
});
