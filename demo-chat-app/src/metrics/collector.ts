import type { StrategyId } from '../strategies/types';
import { afterNextPaint } from './paintEstimate';
import type { RunFrames } from './monitor';
import { percentile } from './stats';

/**
 * Per-pane metrics for one run: tokens, renders, commits, latency. Plain
 * TypeScript with plain counters and arrays, no React state. The shared
 * AssistantMessage is the only writer of render counts and shown seq.
 */
export type MetricKey =
  | 'tokensReceived'
  | 'tokensShown'
  | 'maxBacklog'
  | 'timeToFirstPaint'
  | 'p50Latency'
  | 'p95Latency'
  | 'renders'
  | 'commits'
  | 'rendersPerToken'
  | 'renderP50'
  | 'renderP95'
  | 'renderMax'
  | 'frames'
  | 'droppedFrames'
  | 'droppedPct'
  | 'longFrames'
  | 'busyPct'
  | 'worstInteraction'
  | 'transitionPendingMs'
  | 'durationMs';

export type Metrics = Record<MetricKey, number>;

export class RunCollector {
  readonly arrivedAt: number[] = [];
  received = 0;
  shownSeq = -1;
  renders = 0;
  commits = 0;
  readonly renderDurations: number[] = [];
  /** [ms since run start, token-to-paint latency ms] pairs, for the ribbon. */
  readonly latencies: [number, number][] = [];
  maxBacklog = 0;
  firstPaintAt = NaN;
  endedAt = NaN;
  lastSeq = -1;
  transitionPendingMs = 0;
  private pendingSince = NaN;
  private lastPaintedSeq = -1;

  constructor(
    readonly paneId: string,
    readonly strategy: StrategyId,
    readonly startedAt: number,
  ) {}

  onToken(seq: number, arrivedAt: number): void {
    this.arrivedAt[seq] = arrivedAt;
    this.received++;
    this.lastSeq = Math.max(this.lastSeq, seq);
  }

  onRenderAttempt(): void {
    this.renders++;
  }

  onCommit(actualDuration: number): void {
    this.commits++;
    this.renderDurations.push(actualDuration);
  }

  /** From AssistantMessage's layout effect: `seq` is now on screen (committed). */
  onShown(seq: number): void {
    if (seq <= this.shownSeq) return;
    this.shownSeq = seq;
    afterNextPaint((paintedAt) => {
      if (seq <= this.lastPaintedSeq) return;
      this.lastPaintedSeq = seq;
      if (Number.isNaN(this.firstPaintAt)) this.firstPaintAt = paintedAt;
      const arrived = this.arrivedAt[seq];
      if (arrived != null) this.latencies.push([paintedAt - this.startedAt, paintedAt - arrived]);
    });
  }

  onPending(isPending: boolean, now = performance.now()): void {
    if (isPending && Number.isNaN(this.pendingSince)) this.pendingSince = now;
    if (!isPending && !Number.isNaN(this.pendingSince)) {
      this.transitionPendingMs += now - this.pendingSince;
      this.pendingSince = NaN;
    }
  }

  /** Tokens received but not yet on screen. Sampled every frame by the HUD. */
  backlog(): number {
    const b = this.received - (this.shownSeq + 1);
    if (b > this.maxBacklog) this.maxBacklog = b;
    return Math.max(0, b);
  }

  caughtUp(): boolean {
    return this.lastSeq >= 0 && this.shownSeq >= this.lastSeq;
  }

  snapshot(frames: RunFrames | null, now = performance.now()): Metrics {
    const end = Number.isNaN(this.endedAt) ? now : this.endedAt;
    const duration = end - this.startedAt;
    const lat = this.latencies.map(([, l]) => l);
    const f = frames ?? { frames: 0, dropped: 0, longFrames: 0, blockingMs: 0, worstInteraction: NaN, interactions: 0 };
    return {
      tokensReceived: this.received,
      tokensShown: this.shownSeq + 1,
      maxBacklog: this.maxBacklog,
      timeToFirstPaint: this.firstPaintAt - this.startedAt,
      p50Latency: percentile(lat, 50),
      p95Latency: percentile(lat, 95),
      renders: this.renders,
      commits: this.commits,
      rendersPerToken: this.received ? this.renders / this.received : 0,
      renderP50: percentile(this.renderDurations, 50),
      renderP95: percentile(this.renderDurations, 95),
      renderMax: this.renderDurations.length ? Math.max(...this.renderDurations) : NaN,
      frames: f.frames,
      droppedFrames: f.dropped,
      droppedPct: f.frames ? (f.dropped / f.frames) * 100 : 0,
      longFrames: f.longFrames,
      busyPct: duration > 0 ? (f.blockingMs / duration) * 100 : 0,
      worstInteraction: f.interactions ? f.worstInteraction : NaN,
      transitionPendingMs: this.transitionPendingMs,
      durationMs: duration,
    };
  }
}
