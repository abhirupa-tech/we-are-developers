import { useEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
import type { RunCollector } from '../metrics/collector';
import { support } from '../metrics/monitor';
import { createHud, type HudController } from './controller';

const TEXT_KEYS = [
  // Frames
  'fps',
  'hz',
  'frames',
  'expected',
  'dropped',
  'droppedPct',
  'longFrames',
  'worstFrame',
  'jank',
  // React (Profiler)
  'renders',
  'commits',
  'perToken',
  'renderAvg',
  'renderP95',
  'renderMax',
  'renderTotal',
  // Stream
  'behind',
  'received',
  'ttft',
  'p95',
  'ribbonMax',
  // Main thread
  'busy',
  'interaction',
  'pending',
] as const;

type Key = (typeof TEXT_KEYS)[number];

/** One big number. The controller writes the value and sets data-level. */
function Tile({ k, label, unit, sub, hint }: { k: Key; label: string; unit?: string; sub?: ReactNode; hint: string }) {
  return (
    <div className="tile" title={hint}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">
        <span data-t={k}>–</span>
        {unit && <span className="tile-unit">{unit}</span>}
      </span>
      {sub && <span className="tile-sub">{sub}</span>}
    </div>
  );
}

/**
 * The profiler HUD, a left-hand column sized to be read from the back of a
 * room. React lays out the static DOM once; everything that moves is driven
 * by the imperative controller, so the HUD never re-renders during a run.
 * In Compare mode the per-strategy numbers live in each pane's header, so the
 * React and stream sections (which describe one pane) are hidden.
 */
export function Hud({
  controllerRef,
  getPanes,
  showGhosts,
  compare,
  commitsAvailable,
  deviceMs,
}: {
  controllerRef: MutableRefObject<HudController | null>;
  getPanes: () => RunCollector[];
  showGhosts: () => boolean;
  compare: boolean;
  commitsAvailable: boolean;
  deviceMs: number | null;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const opts = useRef({ getPanes, showGhosts });
  opts.current = { getPanes, showGhosts };

  useEffect(() => {
    const root = rootRef.current!;
    const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
    const text: Record<string, HTMLElement> = {};
    for (const k of TEXT_KEYS) {
      const el = root.querySelector<HTMLElement>(`[data-t="${k}"]`);
      if (el) text[k] = el;
    }
    const controller = createHud(
      {
        root: document.documentElement,
        beat: q('.beat-js'),
        heat: q<HTMLCanvasElement>('canvas.heat'),
        ribbon: q<HTMLCanvasElement>('canvas.ribbon'),
        lagFill: q('.lag-fill'),
        text,
      },
      {
        getPanes: () => opts.current.getPanes(),
        showGhosts: () => opts.current.showGhosts(),
      },
    );
    controllerRef.current = controller;
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [controllerRef]);

  return (
    <aside className="hud" ref={rootRef} aria-label="Profiler">
      {/* ── Frames ─────────────────────────────────────────────── */}
      <section className="hud-section">
        <header className="hud-head">
          <h2>Frames</h2>
          <span className="hud-fps">
            <span data-t="fps">–</span>
            <span className="tile-unit">fps</span>
          </span>
        </header>

        <div className="hud-strip">
          <div className="canvas-wrap">
            <canvas className="heat" aria-label="Frame heat strip: one bar per frame" role="img" />
          </div>
          <span className="legend" aria-label="Legend">
            <span>
              <i data-c="smooth" />
              smooth
            </span>
            <span>
              <i data-c="slow" />
              slow
            </span>
            <span>
              <i data-c="dropped" />
              dropped
            </span>
            <span>
              <i data-c="long" />
              long
            </span>
          </span>
        </div>

        <div className="tiles">
          <Tile
            k="frames"
            label="Browser frames"
            sub={
              <>
                of <span data-t="expected">–</span> possible at <span data-t="hz">–</span> Hz
              </>
            }
            hint="Frames the browser painted while the run was open (its own 60 to 120 per second loop), against how many the display could show. Not React renders: those are in the React section. Close to possible means smooth."
          />
          <Tile
            k="dropped"
            label="Frames dropped"
            sub={
              <>
                <span data-t="droppedPct">–</span> of all frames
              </>
            }
            hint="Frames that took over 1.5× the display's refresh interval."
          />
          <Tile k="longFrames" label="Long frames" unit="> 50 ms" hint="Frames over 50 ms: the page visibly stuttered." />
          <Tile k="worstFrame" label="Worst frame" unit="ms" hint="The single longest frame of the run." />
        </div>

        <div className="hud-heartbeat" title="Heartbeat twins: the top dot moves with JavaScript frames and freezes when the main thread is blocked; the bottom one runs on the compositor and keeps gliding.">
          <div className="beat-row">
            <span className="beat-track">
              <span className="beat beat-js" />
            </span>
            <span>main thread</span>
          </div>
          <div className="beat-row">
            <span className="beat-track">
              <span className="beat beat-css" />
            </span>
            <span>compositor</span>
          </div>
          <span className="hud-jank">
            Jank alarms <b data-t="jank">0</b>
          </span>
        </div>
      </section>

      {/* ── React Profiler ─────────────────────────────────────── */}
      <section className={`hud-section ${compare ? 'is-hidden' : ''}`}>
        <header className="hud-head">
          <h2>React</h2>
          <span className="hud-note">{commitsAvailable ? '<Profiler>' : 'Profiler off in this build'}</span>
        </header>
        <div className="tiles">
          <Tile
            k="renders"
            label="Renders"
            sub={
              <>
                <span data-t="perToken">–</span> per token
              </>
            }
            hint="Render attempts by the strategy component, including ones React started and threw away."
          />
          <Tile k="commits" label="Commits" hint="Renders React actually applied to the DOM (Profiler onRender calls)." />
          <Tile k="renderAvg" label="Avg commit" unit="ms" hint="Mean Profiler actualDuration: time React spent rendering per commit." />
          <Tile k="renderP95" label="p95 commit" unit="ms" hint="95th percentile of Profiler actualDuration." />
          <Tile k="renderMax" label="Slowest commit" unit="ms" hint="Longest single commit." />
          <Tile k="renderTotal" label="Total render time" unit="ms" hint="Sum of Profiler actualDuration over the run." />
        </div>
      </section>

      {/* ── Stream ─────────────────────────────────────────────── */}
      <section className={`hud-section ${compare ? 'is-hidden' : ''}`}>
        <header className="hud-head">
          <h2>Stream</h2>
          <span className="hud-note">
            <span data-t="received">0</span> tokens in · first after <span data-t="ttft">–</span>
          </span>
        </header>
        <div className="hud-lag">
          <span className="tile-label">Tokens behind</span>
          <div className="lag-row">
            <div className="lag-gauge">
              <span className="lag-fill" />
            </div>
            <span className="lag-num" data-t="behind">
              0
            </span>
          </div>
        </div>
        <div className="hud-ribbon">
          <div className="hud-row-head">
            <span className="tile-label">Time to paint</span>
            <span className="hud-note">
              p95 <b data-t="p95">–</b> ms · axis <span data-t="ribbonMax">–</span>
            </span>
          </div>
          <div className="canvas-wrap">
            <canvas className="ribbon" aria-label="Token-to-paint latency over the run" role="img" />
          </div>
        </div>
      </section>

      {/* ── Main thread ────────────────────────────────────────── */}
      <section className="hud-section">
        <header className="hud-head">
          <h2>Main thread</h2>
        </header>
        <dl className="hud-list">
          <div>
            <dt>Busy (blocked)</dt>
            <dd data-t="busy">–</dd>
          </div>
          <div>
            <dt>Worst interaction</dt>
            <dd data-t="interaction">–</dd>
          </div>
          <div>
            <dt>Transition pending</dt>
            <dd data-t="pending">–</dd>
          </div>
          {deviceMs != null && (
            <div>
              <dt>Device speed</dt>
              <dd>{deviceMs} ms</dd>
            </div>
          )}
        </dl>
        {!support.eventTiming && <p className="warn">Event Timing unsupported: auto-probe only.</p>}
      </section>
    </aside>
  );
}
