import type { RunCollector } from '../metrics/collector';
import { classifyFrame, type FrameClass } from '../metrics/frames';
import { currentRun, fps, onFrame, onJank, type RunFrames } from '../metrics/monitor';
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

type Level = 'ok' | 'warn' | 'bad' | '';

/** Colours a tile (or list row) by how worrying its number is. */
function setLevel(el: HTMLElement | undefined, level: Level) {
  const host = el?.closest<HTMLElement>('.tile, .hud-list > div');
  if (host && host.dataset.level !== level) host.dataset.level = level;
}

const level = (v: number, warn: number, bad: number): Level => (!Number.isFinite(v) ? '' : v >= bad ? 'bad' : v >= warn ? 'warn' : 'ok');

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

  // Per-run frame stats, scanned incrementally from the run's frame times.
  let scanRun: RunFrames | null = null;
  let scanned = 0;
  let longFrames = 0;
  let slowFrames = 0;
  let worstFrame = 0;

  const writeFrames = (run: RunFrames, now: number) => {
    if (run !== scanRun) {
      scanRun = run;
      scanned = longFrames = slowFrames = worstFrame = 0;
    }
    for (; scanned < run.frameTimes.length; scanned++) {
      const t = run.frameTimes[scanned];
      const cls = classifyFrame(t, run.baselineMs);
      if (cls === 'long') longFrames++;
      else if (cls === 'slow') slowFrames++;
      if (t > worstFrame) worstFrame = t;
    }
    const end = Number.isNaN(run.endedAt ?? NaN) ? now : run.endedAt!;
    const expected = Math.max(run.frames, Math.round((end - run.startedAt) / run.baselineMs));
    const droppedPct = run.frames ? (run.dropped / run.frames) * 100 : 0;
    const busyPct = (run.blockingMs / Math.max(1, end - run.startedAt)) * 100;
    const t = els.text;
    setText(t.frames, fmt(run.frames));
    setText(t.expected, fmt(expected));
    setText(t.hz, fmt(1000 / run.baselineMs));
    setText(t.dropped, fmt(run.dropped));
    setText(t.droppedPct, `${fmt(droppedPct, 1)}%`);
    setLevel(t.dropped, level(droppedPct, 1, 5));
    const slowPct = run.frames ? (slowFrames / run.frames) * 100 : 0;
    setText(t.slowFrames, fmt(slowFrames));
    setText(t.slowPct, `${fmt(slowPct, 1)}%`);
    setLevel(t.slowFrames, level(slowPct, 5, 15));
    setText(t.longFrames, fmt(longFrames));
    setLevel(t.longFrames, level(longFrames, 1, 4));
    setText(t.worstFrame, fmt(worstFrame));
    setLevel(t.worstFrame, run.frames ? level(worstFrame, run.baselineMs * 1.5, 50) : '');
    setText(t.busy, `${fmt(busyPct)}%`);
    setLevel(t.busy, level(busyPct, 10, 30));
    setText(t.interaction, run.interactions ? `${fmt(run.worstInteraction)} ms` : '–');
    setLevel(t.interaction, run.interactions ? level(run.worstInteraction, 100, 200) : '');
  };

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
      // Time to first token: how long the source (Gemini) kept us waiting.
      const first = main.arrivedAt[0];
      const waited = (first ?? (Number.isNaN(main.endedAt) ? now : main.endedAt)) - main.startedAt;
      setText(els.text.ttft, `${fmt(waited / 1000, 1)} s`);
      setText(els.text.renders, fmt(main.renders));
      setText(els.text.commits, fmt(main.commits));
      setText(els.text.perToken, main.received ? fmt(main.renders / main.received, 2) : '–');
      const d = main.renderDurations;
      const total = d.reduce((a, b) => a + b, 0);
      setText(els.text.renderAvg, d.length ? fmt(total / d.length, 1) : '–');
      const p95 = percentile(d, 95);
      setText(els.text.renderP95, d.length ? fmt(p95, 1) : '–');
      setLevel(els.text.renderP95, d.length ? level(p95, 8, 16) : '');
      const max = d.length ? Math.max(...d) : NaN;
      setText(els.text.renderMax, d.length ? fmt(max, 1) : '–');
      setLevel(els.text.renderMax, level(max, 16, 50));
      setText(els.text.renderTotal, d.length ? fmt(total) : '–');
      const recent = main.latencies.slice(-200).map(([, l]) => l);
      setText(els.text.p95, fmt(percentile(recent, 95)));
      setText(els.text.pending, main.strategy === 'transition' ? `${fmt(main.transitionPendingMs / 1000, 1)} s` : '–');
    }
    if (run) writeFrames(run, now);
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
      // Final, exact frame numbers for the run that just ended.
      if (scanRun) writeFrames(scanRun, performance.now());
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
