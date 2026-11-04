import { useState } from 'react';
import { BUILD, REACT_VERSION } from '../config';
import type { Metrics } from '../metrics/collector';
import { GRADE_THRESHOLDS, type Axis, type Grades } from '../metrics/grades';
import { strategyById } from '../strategies';
import type { StrategyId } from '../strategies/types';

export type PaneResult = { strategy: StrategyId; metrics: Metrics; grades: Grades };

export type RunResult = {
  outcome: 'done' | 'stopped' | 'error';
  recording: string;
  rate: number;
  compare: boolean;
  hidden: boolean;
  deviceMs: number | null;
  /** How long the recording should take at this rate, for the pacing line. */
  expectedMs: number;
  panes: PaneResult[];
};

const AXES: Axis[] = ['smoothness', 'freshness', 'responsiveness'];

const n = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d }) : '–');

function toMarkdown(r: RunResult): string {
  const head = `MockGPT run · ${r.recording} at ${r.rate}x · React ${REACT_VERSION} · ${BUILD} build${
    r.deviceMs != null ? ` · device ${r.deviceMs} ms` : ''
  }${r.compare ? ' · compare mode (shared main thread, illustrative)' : ''}`;
  const rows = r.panes.map((p) => {
    const m = p.metrics;
    return `| \`${strategyById[p.strategy].label}\` | ${p.grades.overall ?? '–'} | ${n(m.droppedPct, 1)}% | ${n(
      m.p95Latency,
    )} ms | ${n(m.worstInteraction)} ms | ${n(m.renders)} | ${n(m.commits)} | ${n(m.rendersPerToken, 2)} | ${n(m.maxBacklog)} |`;
  });
  return [
    head,
    '',
    '| Strategy | Grade | Dropped frames | p95 time to paint | Worst interaction | Renders | Commits | Renders / token | Max tokens behind |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/** End-of-run card: three grades per strategy, key numbers, copy as Markdown. */
export function Scorecard({ result, onClose }: { result: RunResult; onClose: () => void }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const label = BUILD === 'bench' ? 'Benchmark run' : `Indicative run (${BUILD} build, not a benchmark)`;

  return (
    <aside className="scorecard" aria-label="Run scorecard">
      <header className="sc-head">
        <div>
          <h2>{result.outcome === 'done' ? 'Run complete' : result.outcome === 'stopped' ? 'Run stopped early' : 'Run failed'}</h2>
          <p className="sc-meta">
            {label} · {result.recording} at {result.rate}x
          </p>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close scorecard">
          ×
        </button>
      </header>
      {result.panes[0] && Number.isFinite(result.panes[0].metrics.durationMs) && (
        <p className="sc-pace">
          Replay took {n(result.panes[0].metrics.durationMs / 1000, 1)} s; the recording paces at {n(result.expectedMs / 1000, 1)} s at {result.rate}x.
          {result.panes[0].metrics.durationMs > result.expectedMs * 1.25 &&
            ' The stream is read on the same main thread as rendering, so slow renders also delay when tokens arrive.'}
        </p>
      )}
      {result.hidden && <p className="notice notice-warn">The tab was hidden during this run, so the browser throttled it. Rerun before trusting these numbers.</p>}
      <div className="sc-panes">
        {result.panes.map((p) => (
          <section key={p.strategy} className="sc-pane" data-strategy={p.strategy}>
            <header>
              <code>{strategyById[p.strategy].label}</code>
              <span className="grade grade-overall" data-grade={p.grades.overall ?? 'na'}>
                {p.grades.overall ?? '–'}
              </span>
            </header>
            <dl className="sc-grades">
              {AXES.map((axis) => (
                <div key={axis}>
                  <dt>{GRADE_THRESHOLDS[axis].label}</dt>
                  <dd>
                    <span className="grade" data-grade={p.grades[axis] ?? 'na'}>
                      {p.grades[axis] ?? '–'}
                    </span>
                    <span className="sc-val">
                      {axis === 'smoothness' && `${n(p.metrics.droppedPct, 1)}% dropped`}
                      {axis === 'freshness' && `${n(p.metrics.p95Latency)} ms p95`}
                      {axis === 'responsiveness' &&
                        (Number.isFinite(p.metrics.worstInteraction) ? `${n(p.metrics.worstInteraction)} ms worst` : 'not measured')}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="sc-nums">
              {n(p.metrics.renders)} renders · {n(p.metrics.commits)} commits · {n(p.metrics.rendersPerToken, 2)} per token ·{' '}
              {n(p.metrics.maxBacklog)} max behind · first paint {n(p.metrics.timeToFirstPaint)} ms
            </p>
          </section>
        ))}
      </div>
      <footer className="sc-foot">
        <button
          type="button"
          className="btn"
          onClick={async () => {
            // Some embedded views refuse clipboard writes; say so instead of failing silently.
            try {
              await navigator.clipboard.writeText(toMarkdown(result));
              setCopied('copied');
            } catch {
              setCopied('failed');
            }
            setTimeout(() => setCopied('idle'), 2000);
          }}
        >
          {copied === 'copied' ? 'Copied' : copied === 'failed' ? 'Clipboard blocked here' : 'Copy results'}
        </button>
        <span className="sc-note">Time to paint is estimated to within about one frame.</span>
      </footer>
    </aside>
  );
}
