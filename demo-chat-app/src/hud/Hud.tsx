import { useEffect, useRef, type MutableRefObject } from 'react';
import type { RunCollector } from '../metrics/collector';
import { support } from '../metrics/monitor';
import { createHud, type HudController } from './controller';

const TEXT_KEYS = [
  'behind',
  'received',
  'renders',
  'commits',
  'perToken',
  'p95',
  'dropped',
  'fps',
  'busy',
  'interaction',
  'pending',
  'jank',
  'ribbonMax',
] as const;

/**
 * The profiler HUD. React lays out the static DOM once; everything that moves
 * is driven by the imperative controller, so the HUD never re-renders during
 * a run. In Compare mode the per-strategy numbers live in each pane's header.
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
  const rootRef = useRef<HTMLDivElement>(null);
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
    <div className="hud" ref={rootRef} aria-label="Profiler">
      <div className="hud-cell hud-beat" title="Heartbeat twins: left moves with JavaScript frames and freezes when the main thread is blocked; right runs on the compositor and keeps gliding.">
        <span className="hud-label">Heartbeat</span>
        <div className="beats">
          <span className="beat-track">
            <span className="beat beat-js" />
          </span>
          <span className="beat-track">
            <span className="beat beat-css" />
          </span>
        </div>
        <span className="hud-sub">
          <span>main</span>
          <span>compositor</span>
        </span>
      </div>

      <div className="hud-cell hud-strip">
        <div className="hud-row-head">
          <span className="hud-label">Frames</span>
          <span className="legend" aria-label="Legend">
            <i data-c="smooth" />smooth <i data-c="slow" />slow <i data-c="dropped" />dropped <i data-c="long" />long
          </span>
          <span className="hud-mini">
            <span data-t="fps">–</span> fps · <span data-t="dropped">0</span> dropped · jank <span data-t="jank">0</span>
          </span>
        </div>
        <div className="canvas-wrap">
          <canvas className="heat" aria-label="Frame heat strip" role="img" />
        </div>
      </div>

      <div className={`hud-cell hud-odo ${compare ? 'is-hidden' : ''}`}>
        <span className="hud-label">Renders</span>
        <span className="odo-big" data-t="renders">0</span>
        <span className="odo-small">
          <span data-t="commits">{commitsAvailable ? '0' : 'n/a'}</span> commits ·{' '}
          <span data-t="perToken">–</span> / token
        </span>
      </div>

      <div className={`hud-cell hud-lag ${compare ? 'is-hidden' : ''}`}>
        <span className="hud-label">Tokens behind</span>
        <div className="lag-gauge">
          <span className="lag-fill" />
        </div>
        <span className="lag-num">
          <span data-t="behind">0</span> <span className="unit">behind</span> ·{' '}
          <span data-t="received">0</span> <span className="unit">received</span>
        </span>
      </div>

      <div className="hud-cell hud-ribbon">
        <div className="hud-row-head">
          <span className="hud-label">Time to paint</span>
          <span className="hud-mini">
            p95 <span data-t="p95">–</span> ms · axis <span data-t="ribbonMax">–</span>
          </span>
        </div>
        <div className="canvas-wrap">
          <canvas className="ribbon" aria-label="Token-to-paint latency over the run" role="img" />
        </div>
      </div>

      <div className="hud-cell hud-stats">
        <span>
          Main thread busy <b data-t="busy">–</b>
        </span>
        <span>
          Worst interaction <b data-t="interaction">–</b>
          {!support.eventTiming && <em className="warn"> Event Timing unsupported, auto-probe only</em>}
        </span>
        <span>
          Transition pending <b data-t="pending">–</b>
        </span>
        {deviceMs != null && (
          <span>
            Device speed <b>{deviceMs} ms</b>
          </span>
        )}
      </div>
    </div>
  );
}
