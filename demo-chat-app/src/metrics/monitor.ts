import { calibrateInterval, classifyFrame, isDropped, JANK_ALARM_MS, type FrameClass } from './frames';
import { RingBuffer } from './stats';

/**
 * Global frame monitor: one requestAnimationFrame loop and the
 * PerformanceObservers, shared by every pane (they share one main thread).
 * Plain TypeScript, no React. Widgets subscribe to per-frame ticks and draw
 * imperatively.
 */

export type FrameTick = { now: number; interval: number; cls: FrameClass; running: boolean };

export type RunFrames = {
  startedAt: number;
  baselineMs: number;
  frames: number;
  dropped: number;
  longFrames: number;
  blockingMs: number;
  worstInteraction: number;
  interactions: number;
  hidden: boolean;
  /** Frame time per frame, for the heat strip and its ghost. */
  frameTimes: number[];
  /** Set by endRun(). */
  endedAt?: number;
};

type FrameListener = (tick: FrameTick) => void;
type JankListener = (intervalMs: number) => void;

const idleIntervals = new RingBuffer(120);
const fpsWindow = new RingBuffer(240);
const frameListeners = new Set<FrameListener>();
const jankListeners = new Set<JankListener>();

let last = 0;
let baseline = 1000 / 60;
let calibrated = false;
let run: RunFrames | null = null;
let started = false;

export const support = {
  longAnimationFrame: false,
  longTask: false,
  eventTiming: false,
};

function loop(now: number) {
  if (last) {
    const interval = now - last;
    const cls = classifyFrame(interval, baseline);
    fpsWindow.push(now);
    if (run) {
      run.frames++;
      run.frameTimes.push(interval);
      if (isDropped(cls)) run.dropped++;
    } else if (!document.hidden) {
      idleIntervals.push(interval);
    }
    if (interval > JANK_ALARM_MS && !document.hidden) jankListeners.forEach((l) => l(interval));
    const tick: FrameTick = { now, interval, cls, running: run !== null };
    frameListeners.forEach((l) => l(tick));
  }
  last = now;
  requestAnimationFrame(loop);
}

function observe() {
  const types = PerformanceObserver.supportedEntryTypes ?? [];
  support.longAnimationFrame = types.includes('long-animation-frame');
  support.longTask = types.includes('longtask');
  support.eventTiming = types.includes('event');

  if (support.longAnimationFrame) {
    new PerformanceObserver((list) => {
      if (!run) return;
      for (const e of list.getEntries() as (PerformanceEntry & { blockingDuration?: number })[]) {
        run.longFrames++;
        run.blockingMs += e.blockingDuration ?? Math.max(0, e.duration - 50);
      }
    }).observe({ type: 'long-animation-frame', buffered: false });
  } else if (support.longTask) {
    new PerformanceObserver((list) => {
      if (!run) return;
      for (const e of list.getEntries()) {
        run.longFrames++;
        run.blockingMs += Math.max(0, e.duration - 50);
      }
    }).observe({ type: 'longtask', buffered: false });
  }

  if (support.eventTiming) {
    new PerformanceObserver((list) => {
      if (!run) return;
      for (const e of list.getEntries()) recordInteraction(e.duration);
    }).observe({ type: 'event', durationThreshold: 16, buffered: false } as PerformanceObserverInit);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && run) run.hidden = true;
  });
}

export function startMonitor(): void {
  if (started) return;
  started = true;
  observe();
  requestAnimationFrame(loop);
}

export function onFrame(l: FrameListener): () => void {
  frameListeners.add(l);
  return () => frameListeners.delete(l);
}

export function onJank(l: JankListener): () => void {
  jankListeners.add(l);
  return () => jankListeners.delete(l);
}

/** Record an interaction latency (Event Timing entry or the auto-probe). */
export function recordInteraction(durationMs: number): void {
  if (!run) return;
  run.interactions++;
  run.worstInteraction = Math.max(run.worstInteraction, durationMs);
}

export function beginRun(): RunFrames {
  // The display's refresh rate doesn't slow down between runs. Idle frames
  // right after a heavy run are often still janky (GC, a hot phone, the
  // scorecard animating), which used to read as "a 30 Hz screen" and double
  // the dropped-frame threshold, so later runs reported ~0 dropped frames.
  // Keep the fastest stable interval seen, so every run is judged the same.
  const measured = calibrateInterval(idleIntervals.toArray());
  baseline = calibrated ? Math.min(baseline, measured) : measured;
  calibrated = true;
  run = {
    startedAt: performance.now(),
    baselineMs: baseline,
    frames: 0,
    dropped: 0,
    longFrames: 0,
    blockingMs: 0,
    worstInteraction: 0,
    interactions: 0,
    hidden: document.hidden,
    frameTimes: [],
  };
  return run;
}

export function endRun(): RunFrames | null {
  const done = run;
  if (done) done.endedAt = performance.now();
  run = null;
  return done;
}

export function currentRun(): RunFrames | null {
  return run;
}

/** Rolling frames per second over the last second. */
export function fps(now = performance.now()): number {
  let n = 0;
  for (let i = fpsWindow.length - 1; i >= 0 && now - fpsWindow.at(i) <= 1000; i--) n++;
  return n;
}

export function refreshHz(): number {
  return Math.round(1000 / baseline);
}
