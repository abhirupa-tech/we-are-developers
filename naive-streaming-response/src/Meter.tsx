import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';

export type MeterHandle = { push: (ms: number) => void; reset: () => void };

/** Frame budget at 60 Hz. */
const BUDGET_MS = 16.7;

/**
 * Per-chunk render cost (parse + innerHTML), drawn as a sparkline against the
 * frame budget. Samples live in a ref and draw on rAF, so measuring doesn't
 * add React renders to the thing being measured.
 */
export function Meter({ ref }: { ref: Ref<MeterHandle> }) {
  const samples = useRef<number[]>([]);
  const dirty = useRef(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stats = useRef<HTMLSpanElement>(null);

  useImperativeHandle(ref, () => ({
    push(ms) {
      samples.current.push(ms);
      dirty.current = true;
    },
    reset() {
      samples.current = [];
      dirty.current = true;
    },
  }));

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (!dirty.current || !canvas.current || !stats.current) return;
      dirty.current = false;

      const s = samples.current;
      const last = s.at(-1) ?? 0;
      const max = s.reduce((a, b) => Math.max(a, b), 0);
      const total = s.reduce((a, b) => a + b, 0);
      stats.current.textContent = s.length
        ? `chunk ${s.length} · ${last.toFixed(2)} ms · max ${max.toFixed(1)} · total ${total.toFixed(0)} ms`
        : 'per-chunk render cost';

      const c = canvas.current;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== w * dpr) c.width = w * dpr;
      if (c.height !== h * dpr) c.height = h * dpr;
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);

      const top = Math.max(BUDGET_MS * 1.25, max);
      const y = (ms: number) => h - 2 - (ms / top) * (h - 4);

      g.strokeStyle = 'rgba(232, 140, 98, .45)';
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(0, y(BUDGET_MS));
      g.lineTo(w, y(BUDGET_MS));
      g.stroke();
      g.setLineDash([]);

      if (s.length < 2) return;
      g.strokeStyle = '#cfd2d6';
      g.lineWidth = 1.25;
      g.beginPath();
      s.forEach((ms, i) => {
        const x = (i / (s.length - 1)) * w;
        if (i === 0) g.moveTo(x, y(ms));
        else g.lineTo(x, y(ms));
      });
      g.stroke();
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="meter" title="Time spent in marked.parse + innerHTML for each chunk. Dashed line: 16.7 ms frame budget.">
      <canvas ref={canvas} />
      <span ref={stats} />
    </div>
  );
}
