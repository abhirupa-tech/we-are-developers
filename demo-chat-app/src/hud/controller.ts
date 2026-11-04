import type { RunCollector } from '../metrics/collector';
import { classifyFrame, type FrameClass } from '../metrics/frames';
import { currentRun, fps, onFrame, onJank } from '../metrics/monitor';
import { percentile } from '../metrics/stats';
import { strategyColor } from '../strategies';
import type { StrategyId } from '../strategies/types';

/**
 * Draws the HUD imperatively: canvases and direct text writes, no React state.
 * - heat strip and heartbeat: every frame (they are the instruments)
 * - numbers, lag gauge, latency ribbon: 10 Hz
 * The observer must not disturb the experiment.
 */

export type Ghost = {
  strategy: StrategyId;
  latencies: [number, number][];
  frameTimes: number[];
  baselineMs: number;
  durationMs: number;
};

export type HudElements = {
  root: HTMLElement;
  beat: HTMLElement;
  heat: HTMLCanvasElement;
  ribbon: HTMLCanvasElement;
  lagFill: HTMLElement;
  text: Record<string, HTMLElement>;
};

const STRIP_BAR = 3; // px per frame
const LAG_FULL = 150; // tokens at which the gauge reads full
const CLASS_COLOR: Record<FrameClass, string> = {
  smooth: '#2f3f78',
  slow: '#6f7fd8',
  dropped: '#ffc24b',
  long: '#ff4d6d',
};
const CLASS_HEIGHT: Record<FrameClass, number> = { smooth: 0.28, slow: 0.5, dropped: 0.78, long: 1 };

function fmt(n: number, digits = 0): string {
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '–';
}

function setText(el: HTMLElement | undefined, value: string) {
  if (el && el.textContent !== value) el.textContent = value;
}

function sizeCanvas(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(c.clientWidth * dpr));
  const h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function createHud(els: HudElements, opts: { getPanes: () => RunCollector[]; showGhosts: () => boolean }) {
  let ghosts: Ghost[] = [];
  let jankCount = 0;
  let lastFlash = 0;
  let lastFrameTimes: number[] = [];
  let lastBaseline = 1000 / 60;
  let paneReadouts: { collector: RunCollector; el: Record<string, HTMLElement> }[] = [];

  // Heartbeat (JS half): moves only when a frame is produced.
  const beat = (now: number) => {
    const phase = (now / 900) % 1;
    const x = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    els.beat.style.transform = `translateX(${(x * 26).toFixed(1)}px)`;
  };

  const drawHeat = () => {
    const ctx = sizeCanvas(els.heat);
    const w = els.heat.clientWidth;
    const h = els.heat.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const run = currentRun();
    const frames = run ? run.frameTimes : lastFrameTimes;
    const baseline = run ? run.baselineMs : lastBaseline;
    const cap = Math.floor(w / STRIP_BAR);
    const from = Math.max(0, frames.length - cap);

    // While running, the ghost is the previous run. After a run ends it has
    // itself become the newest ghost, so compare against the one before it.
    const ghost = opts.showGhosts() ? (run ? ghosts.at(-1) : ghosts.at(-2)) : undefined;
    if (ghost) {
      // Previous run as a faint seismograph line, aligned frame for frame.
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = strategyColor(ghost.strategy);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = from; i < Math.min(ghost.frameTimes.length, from + cap); i++) {
        const cls = classifyFrame(ghost.frameTimes[i], ghost.baselineMs);
        const x = (i - from) * STRIP_BAR + 1;
        const y = h - CLASS_HEIGHT[cls] * h;
        if (i === from) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    for (let i = from; i < frames.length; i++) {
      const cls = classifyFrame(frames[i], baseline);
      const bh = CLASS_HEIGHT[cls] * h;
      ctx.fillStyle = CLASS_COLOR[cls];
      ctx.fillRect((i - from) * STRIP_BAR, h - bh, STRIP_BAR - 1, bh);
    }
  };

  const drawRibbon = (panes: RunCollector[]) => {
    const ctx = sizeCanvas(els.ribbon);
    const w = els.ribbon.clientWidth;
    const h = els.ribbon.clientHeight;
    ctx.clearRect(0, 0, w, h);
    const shownGhosts = opts.showGhosts() ? ghosts : [];
    const now = performance.now();
    const spans = [
      10_000,
      ...shownGhosts.map((g) => g.durationMs),
      ...panes.map((p) => (Number.isNaN(p.endedAt) ? now : p.endedAt) - p.startedAt),
    ];
    const xMax = Math.max(...spans);
    const all = panes.flatMap((p) => p.latencies.map(([, l]) => l));
    const yMax = Math.min(1000, Math.max(200, percentile(all, 95) * 1.4 || 0));
    const X = (t: number) => (t / xMax) * w;
    const Y = (l: number) => h - Math.min(1, l / yMax) * (h - 4) - 2;

    const line = (pts: [number, number][], color: string, alpha: number, width: number) => {
      if (!pts.length) return;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      // Thin the series so long runs stay cheap to draw.
      const step = Math.max(1, Math.floor(pts.length / w));
      for (let i = 0; i < pts.length; i += step) {
        const [t, l] = pts[i];
        if (i === 0) ctx.moveTo(X(t), Y(l));
        else ctx.lineTo(X(t), Y(l));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    shownGhosts.forEach((g) => line(g.latencies, strategyColor(g.strategy), 0.3, 1));
    panes.forEach((p) => line(p.latencies, strategyColor(p.strategy), 1, 1.5));

    // p50 / p95 guides for the first (or only) pane.
    const lat = panes[0]?.latencies.map(([, l]) => l) ?? [];
    if (lat.length) {
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(232,236,255,0.45)';
      for (const p of [50, 95]) {
        const y = Y(percentile(lat, p));
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    setText(els.text.ribbonMax, `${fmt(yMax)} ms`);
  };

  const tick10 = () => {
    const panes = opts.getPanes();
    const run = currentRun();
    const now = performance.now();
    const main = panes[0];
    if (main) {
      const behind = main.backlog();
      els.lagFill.style.transform = `scaleX(${Math.min(1, behind / LAG_FULL)})`;
      els.lagFill.dataset.level = behind > 100 ? 'high' : behind > 20 ? 'mid' : 'low';
      setText(els.text.behind, fmt(behind));
      setText(els.text.received, fmt(main.received));
      setText(els.text.renders, fmt(main.renders));
      setText(els.text.commits, fmt(main.commits));
      setText(els.text.perToken, main.received ? fmt(main.renders / main.received, 2) : '–');
      const recent = main.latencies.slice(-200).map(([, l]) => l);
      setText(els.text.p95, fmt(percentile(recent, 95)));
      setText(els.text.pending, main.strategy === 'transition' ? `${fmt(main.transitionPendingMs / 1000, 1)} s` : '–');
    }
    if (run) {
      setText(els.text.dropped, fmt(run.dropped));
      setText(els.text.busy, `${fmt((run.blockingMs / Math.max(1, now - run.startedAt)) * 100)}%`);
      setText(els.text.interaction, run.interactions ? `${fmt(run.worstInteraction)} ms` : '–');
    }
    setText(els.text.fps, fmt(fps(now)));
    for (const r of paneReadouts) {
      setText(r.el.renders, fmt(r.collector.renders));
      setText(r.el.behind, fmt(r.collector.backlog()));
      const recent = r.collector.latencies.slice(-200).map(([, l]) => l);
      setText(r.el.p95, recent.length ? `${fmt(percentile(recent, 95))} ms` : '–');
    }
    drawRibbon(panes);
  };

  const offFrame = onFrame(({ now }) => {
    beat(now);
    if (currentRun()) drawHeat();
  });
  const offJank = onJank(() => {
    if (!currentRun()) return;
    jankCount++;
    setText(els.text.jank, fmt(jankCount));
    const now = performance.now();
    if (now - lastFlash < 1000) return;
    lastFlash = now;
    els.root.classList.remove('jank-flash');
    void els.root.offsetWidth; // restart the CSS animation
    els.root.classList.add('jank-flash');
  });
  const interval = window.setInterval(tick10, 100);

  return {
    /** Call when a run starts: resets per-run counters and binds pane readouts. */
    beginRun(panes: RunCollector[]) {
      jankCount = 0;
      setText(els.text.jank, '0');
      paneReadouts = panes.map((collector) => {
        const host = document.querySelector<HTMLElement>(`[data-pane-readout="${collector.paneId}"]`);
        const el: Record<string, HTMLElement> = {};
        host?.querySelectorAll<HTMLElement>('[data-m]').forEach((n) => (el[n.dataset.m!] = n));
        return { collector, el };
      });
    },
    /** Call when a run ends: freezes its strip and keeps it as a ghost. */
    endRun(frameTimes: number[], baselineMs: number, main: RunCollector | undefined) {
      lastFrameTimes = frameTimes;
      lastBaseline = baselineMs;
      if (main && frameTimes.length) {
        ghosts = [
          ...ghosts.slice(-2),
          {
            strategy: main.strategy,
            latencies: main.latencies.slice(),
            frameTimes,
            baselineMs,
            durationMs: main.endedAt - main.startedAt,
          },
        ];
      }
      tick10();
      drawHeat();
    },
    redraw() {
      tick10();
      drawHeat();
    },
    clear() {
      ghosts = [];
      lastFrameTimes = [];
      paneReadouts = [];
      tick10();
      drawHeat();
    },
    destroy() {
      offFrame();
      offJank();
      clearInterval(interval);
    },
  };
}

export type HudController = ReturnType<typeof createHud>;
