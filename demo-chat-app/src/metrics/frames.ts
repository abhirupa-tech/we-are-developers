/**
 * Frame classification, relative to the display's own refresh interval so it
 * works the same at 60 Hz (16.7 ms) and 120 Hz (8.3 ms).
 */
export type FrameClass = 'smooth' | 'slow' | 'dropped' | 'long';

/** A frame over this is "long" whatever the refresh rate. */
export const LONG_FRAME_MS = 50;
/** A frame over this triggers the jank alarm. */
export const JANK_ALARM_MS = 100;

/**
 * - dropped: interval over 1.5x the calibrated median interval (spec 5.2)
 * - long:    dropped and over 50 ms
 * - slow:    over 1.2x but within 1.5x
 * - smooth:  everything else
 */
export function classifyFrame(intervalMs: number, baselineMs: number): FrameClass {
  if (intervalMs > baselineMs * 1.5) return intervalMs > LONG_FRAME_MS ? 'long' : 'dropped';
  if (intervalMs > baselineMs * 1.2) return 'slow';
  return 'smooth';
}

/** True for frames the "dropped frames" metric counts (dropped and long). */
export const isDropped = (c: FrameClass) => c === 'dropped' || c === 'long';

/**
 * Median of recent idle frame intervals, snapped to a common refresh rate when
 * close (so one noisy sample can't skew the baseline). Falls back to 60 Hz.
 */
export function calibrateInterval(intervals: number[]): number {
  const clean = intervals.filter((v) => v > 2 && v < 50).sort((a, b) => a - b);
  if (clean.length < 10) return 1000 / 60;
  const mid = clean[Math.floor(clean.length / 2)];
  for (const hz of [240, 165, 144, 120, 90, 75, 60, 50, 30]) {
    const period = 1000 / hz;
    if (Math.abs(mid - period) / period < 0.08) return period;
  }
  return mid;
}
