/**
 * Simulated CPU throttle for the demo, so a slow device can be chosen from
 * the page (and the URL). A page can't read or set DevTools' CPU throttle.
 *
 * At N×, every React commit blocks the main thread for (N - 1) times its own
 * render time, right after it: the same extra work a CPU N times slower would
 * spend rendering. Layout and paint are not slowed.
 */
export const CPU_FACTORS = [1, 2, 4, 6];

let factor = 1;

export function setCpuFactor(next: number) {
  factor = CPU_FACTORS.includes(next) ? next : 1;
}

/** Call from Profiler onRender. Burns the extra time; returns the slowed duration. */
export function slowCommit(actualDuration: number): number {
  if (factor > 1) {
    const until = performance.now() + actualDuration * (factor - 1);
    while (performance.now() < until) {
      // busy-wait: this is the throttle
    }
  }
  return actualDuration * factor;
}
