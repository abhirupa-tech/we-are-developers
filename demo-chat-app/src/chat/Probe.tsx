import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { recordInteraction } from '../metrics/monitor';
import { afterNextPaint } from '../metrics/paintEstimate';

const CADENCE_MS = 250;

/**
 * The interaction probe. Typing in the input is measured by the browser's
 * Event Timing API (see metrics/monitor). Auto-probe can't use Event Timing,
 * because synthetic events aren't measured, so instead it fires an urgent
 * (non-transition) update every 250 ms and records the time from when the
 * tick was due to when its result was painted. That includes waiting for
 * the main thread, which is the point. Accurate to about one frame.
 */
export function Probe({ auto, running }: { auto: boolean; running: boolean }) {
  const [value, setValue] = useState('');
  const [tick, setTick] = useState(0);
  const dueAt = useRef(0);

  useEffect(() => {
    if (!auto || !running) return;
    let timer = 0;
    let next = performance.now() + CADENCE_MS;
    const fire = () => {
      dueAt.current = next;
      setTick((t) => t + 1); // urgent update, competes with the stream
      next += CADENCE_MS;
      timer = window.setTimeout(fire, Math.max(0, next - performance.now()));
    };
    timer = window.setTimeout(fire, CADENCE_MS);
    return () => clearTimeout(timer);
  }, [auto, running]);

  useLayoutEffect(() => {
    if (!tick) return;
    const due = dueAt.current;
    afterNextPaint((paintedAt) => recordInteraction(paintedAt - due));
  }, [tick]);

  return (
    <label className="probe">
      <span className="probe-label">Probe</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type here during a run…"
        aria-describedby="probe-help"
      />
      <span className="probe-pulse" data-on={auto && running ? '' : undefined} aria-hidden="true">
        {auto && running ? `auto ${tick % 2 ? '●' : '○'}` : ''}
      </span>
      <span id="probe-help" className="sr-only">
        Typing here during a run measures how responsive the page stays.
      </span>
    </label>
  );
}
