import type { RunCollector } from '../metrics/collector';
import { classifyFrame } from '../metrics/frames';
import type { RunFrames } from '../metrics/monitor';
import type { RunStats } from './protocol';
import { room } from './roomClient';

/**
 * Reports the current run to the room: live every second, final at the end.
 * Reads the same counters the HUD shows, so the room screen and the phone
 * always agree.
 */
type Active = { runId: string; strategy: string; cpu: number; frames: RunFrames; collector: RunCollector; timer: number };
let active: Active | null = null;

function stats(a: Active): RunStats {
  let slow = 0;
  let worst = 0;
  for (const t of a.frames.frameTimes) {
    if (classifyFrame(t, a.frames.baselineMs) === 'slow') slow++;
    if (t > worst) worst = t;
  }
  return {
    runId: a.runId,
    strategy: a.strategy,
    cpu: a.cpu,
    frames: a.frames.frames,
    dropped: a.frames.dropped,
    slow,
    long: a.frames.longFrames,
    worst: Math.round(worst),
    commits: a.collector.commits,
    renderMs: Math.round(a.collector.renderDurations.reduce((s, d) => s + d, 0) * 10) / 10,
  };
}

export function beginReport(strategy: string, cpu: number, frames: RunFrames, collector: RunCollector) {
  endReport();
  const a: Active = { runId: crypto.randomUUID(), strategy, cpu, frames, collector, timer: 0 };
  a.timer = window.setInterval(() => room.live(stats(a)), 1000);
  active = a;
}

export function endReport() {
  if (!active) return;
  clearInterval(active.timer);
  room.final(stats(active));
  active = null;
}
