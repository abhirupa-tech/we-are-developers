import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ANIMAL_EMOJI, ANIMALS, type Animal } from '../debug/dropSound';
import { CPU_FACTORS } from '../debug/cpuThrottle';
import { RECORDINGS } from '../stream/fixtures';
import type { RoomSnapshot, Totals } from './protocol';
import { ROOM_ENABLED, ROOM_NAME, room } from './roomClient';
import { Celebration } from './Celebration';
import { TEAM_COLOR, TEAM_METHOD, TEAM_NAME } from './teams';
import './room.css';

const params = new URLSearchParams(window.location.search);
const KEY = params.get('key') ?? '';
const RATES = [1, 2, 5, 10];

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    // not allowed here
  }
}

const fmt = (n: number, digits = 0) =>
  Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '–';
const rate = (t: Totals) => (t.frames ? (t.dropped / t.frames) * 100 : NaN);
const avgRender = (t: Totals) => (t.commits ? t.renderMs / t.commits : NaN);

/** Eases a number towards its target, so counters roll instead of jumping. */
function useTween(target: number, ms = 600) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  const shown = useRef(target);
  useEffect(() => {
    from.current = shown.current;
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const eased = 1 - (1 - k) ** 3;
      shown.current = from.current + (target - from.current) * eased;
      setValue(shown.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

function Counter({ value, digits = 0 }: { value: number; digits?: number }) {
  const v = useTween(Number.isFinite(value) ? value : 0);
  return <>{Number.isFinite(value) ? fmt(v, digits) : '–'}</>;
}

function QrCode({ text }: { text: string }) {
  const path = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c},${r}h1v1h-1z`;
    return { d, n };
  }, [text]);
  return (
    <svg className="rs-qr" viewBox={`-2 -2 ${path.n + 4} ${path.n + 4}`} role="img" aria-label={`QR code: ${text}`}>
      <rect x={-2} y={-2} width={path.n + 4} height={path.n + 4} fill="#fff" rx={2} />
      <path d={path.d} fill="#0c0910" />
    </svg>
  );
}

/** Area chart of a per-second series, newest on the right. */
function Sparkline({ drops, sounds }: { drops: number[]; sounds: number[] }) {
  const W = 600;
  const H = 140;
  const N = 90;
  const pad = (a: number[]) => [...Array(Math.max(0, N - a.length)).fill(0), ...a.slice(-N)];
  const d = pad(drops);
  const s = pad(sounds);
  const max = Math.max(10, ...d, ...s);
  const x = (i: number) => (i / (N - 1)) * W;
  const y = (v: number) => H - (v / max) * (H - 8) - 2;
  const line = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg className="rs-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="rs-drop-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ff4d6d" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ff4d6d" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="rs-grid" />
      ))}
      <path d={`${line(d)}L${W},${H}L0,${H}Z`} fill="url(#rs-drop-fill)" />
      <path d={line(d)} className="rs-line-drop" />
      <path d={line(s)} className="rs-line-sound" />
    </svg>
  );
}

type Particle = { id: number; emoji: string; x: number; drift: number; size: number; delay: number; spin: number };

/** Dropped frames, literally: animal emojis fall down the screen as the room makes noise. */
function useParticles(snapshot: RoomSnapshot | null) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const prev = useRef<Record<string, number>>({});
  const seq = useRef(0);
  useEffect(() => {
    if (!snapshot) return;
    const born: Particle[] = [];
    for (const team of ANIMALS) {
      const sounds = snapshot.teams[team]?.sounds ?? 0;
      const before = prev.current[team];
      prev.current[team] = sounds;
      if (before === undefined) continue;
      const n = Math.min(2, sounds - before);
      for (let i = 0; i < n; i++) {
        born.push({
          id: seq.current++,
          emoji: ANIMAL_EMOJI[team],
          x: 4 + Math.random() * 92,
          drift: (Math.random() - 0.5) * 120,
          size: 40 + Math.random() * 30,
          delay: Math.random() * 400,
          spin: (Math.random() - 0.5) * 300,
        });
      }
    }
    if (!born.length) return;
    setParticles((p) => [...p, ...born.slice(0, 6)].slice(-24));
    const ids = new Set(born.map((b) => b.id));
    const t = setTimeout(() => setParticles((p) => p.filter((x) => !ids.has(x.id))), 4200);
    return () => clearTimeout(t);
  }, [snapshot]);
  return particles;
}

function Presenter({ snapshot, onClose }: { snapshot: RoomSnapshot | null; onClose: () => void }) {
  const [recording, setRecording] = useState('demo-3k');
  const [speed, setSpeed] = useState(5);
  // 2×: big enough gaps between the methods to be reliable on fast phones too.
  const [cpu, setCpu] = useState(2);
  // Every phone stops at the limit, so all teams are scored on the same window.
  const [limit, setLimit] = useState(30);
  const [confirmReset, setConfirmReset] = useState(false);
  const live = (snapshot?.running ?? 0) > 0;

  // Start → loading: "Starting…" until the room confirms the new round, then
  // "Round running" until every phone has reported (or time is up).
  const [awaiting, setAwaiting] = useState<{ prevId: number | null } | null>(null);
  const roundId = snapshot?.round?.id ?? null;
  useEffect(() => {
    if (awaiting && roundId !== awaiting.prevId) setAwaiting(null);
  }, [roundId, awaiting]);
  useEffect(() => {
    if (!awaiting) return;
    const t = setTimeout(() => setAwaiting(null), 8000); // never stuck if the start is lost
    return () => clearTimeout(t);
  }, [awaiting]);
  const round = snapshot?.round;
  const inRound = !!round && !snapshot?.result?.complete;
  const loading = !!awaiting || inRound;
  const secondsLeft = round && round.limitMs > 0 && snapshot ? Math.max(0, Math.ceil((round.limitMs - (snapshot.now - round.startedAt)) / 1000)) : null;
  return (
    <section className="rs-card rs-presenter" aria-label="Presenter controls">
      <header className="rs-card-head">
        <h2>Run a round</h2>
        <button type="button" className="rs-x" onClick={onClose} aria-label="Hide controls">
          ✕
        </button>
      </header>
      <p className="rs-muted rs-presenter-note">Every phone streams the same answer at once, each with its team's method.</p>
      <ul className="rs-team-legend">
        {ANIMALS.map((a) => (
          <li key={a} style={{ '--c': TEAM_COLOR[a] } as React.CSSProperties}>
            {ANIMAL_EMOJI[a]} <code>{TEAM_METHOD[a]}</code>
          </li>
        ))}
      </ul>
      <div className="rs-row">
        <label>
          Response
          <select value={recording} onChange={(e) => setRecording(e.target.value)}>
            {RECORDINGS.filter((r) => !r.id.includes('a2ui')).map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Speed
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        </label>
        <label>
          Time limit
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[30, 45, 60, 0].map((l) => (
              <option key={l} value={l}>
                {l ? `${l} s` : 'none'}
              </option>
            ))}
          </select>
        </label>
        <label>
          CPU
          <select value={cpu} onChange={(e) => setCpu(Number(e.target.value))}>
            {CPU_FACTORS.map((f) => (
              <option key={f} value={f}>
                {f}×
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="rs-actions">
        <button
          type="button"
          className={`rs-go ${loading ? 'is-loading' : ''}`}
          disabled={loading}
          aria-busy={loading}
          onClick={() => {
            setAwaiting({ prevId: roundId });
            room.start({ recording, rate: speed, cpu, limitMs: limit * 1000 });
          }}
        >
          {loading && <span className="rs-spinner" aria-hidden="true" />}
          {awaiting
            ? 'Starting…'
            : inRound
              ? round?.stopped
                ? 'Wrapping up…'
                : `Round running${secondsLeft != null ? ` · ${secondsLeft} s` : '…'}`
              : '▶ Start round on all phones'}
        </button>
        <button type="button" className="rs-ghost" onClick={room.stop} disabled={!live && !inRound}>
          ■ Stop
        </button>
      </div>
      <div className="rs-actions rs-small">
        <a className="rs-ghost" href={room.csvUrl()} download>
          ⤓ Export CSV
        </a>
        {confirmReset ? (
          <button
            type="button"
            className="rs-danger"
            onClick={() => {
              room.reset();
              setConfirmReset(false);
            }}
          >
            Really clear all data?
          </button>
        ) : (
          <button type="button" className="rs-ghost" onClick={() => setConfirmReset(true)}>
            ↺ Reset room
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * The projector view (?view=room&room=<name>[&key=<presenter key>]):
 * three teams, three rendering methods, one winner per round.
 */
export function RoomScreen() {
  const s = useSyncExternalStore(room.subscribe, room.getSnapshot);
  useEffect(() => {
    if (ROOM_ENABLED) room.joinAsScreen(KEY);
  }, []);
  const snap = s.snapshot;
  const particles = useParticles(snap);
  const [controls, setControls] = useState(true);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const joinUrl = useMemo(() => (ROOM_ENABLED ? room.joinUrl() : ''), []);
  // Shown under the QR: the page and room only (the QR carries the full link).
  const shortUrl = useMemo(() => {
    if (!joinUrl) return '';
    const u = new URL(joinUrl);
    return `${u.host}${u.pathname.replace(/\/$/, '')}?room=${ROOM_NAME}`;
  }, [joinUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'SELECT') return;
      if (e.key === 'c') setControls((c) => !c);
      if (e.key === 'f') void toggleFullscreen();
      if (e.key === 'Escape' && snap?.result) setDismissed(snap.result.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snap?.result]);

  // Flash the hero when the room is dropping lots of frames right now.
  const recentDrops = snap?.dropsPerSec.at(-1) ?? 0;
  const hot = recentDrops > Math.max(30, (snap?.online ?? 0) * 3);

  if (!ROOM_ENABLED) {
    return (
      <div className="rs-empty">
        <h1>Live room</h1>
        <p>
          Add <code>?view=room&amp;room=your-room</code> to the URL (and <code>&amp;key=…</code> on the presenter's screen).
        </p>
      </div>
    );
  }

  const t = snap?.totals;
  const round = snap?.round;
  const result = snap?.result;
  const teams = ANIMALS.map((a) => ({ a, v: snap?.teams[a] }));
  const roundPhones = teams.reduce((n, x) => n + (x.v?.roundPhones ?? 0), 0);
  const roundFinished = teams.reduce((n, x) => n + (x.v?.roundFinished ?? 0), 0);
  const pcts = teams.map((x) => x.v?.avgDropPct ?? NaN);
  const maxPct = Math.max(1, ...pcts.filter(Number.isFinite));
  const leader = result?.complete ? result.winner : null;
  const loudest = teams.reduce((m, x) => ((x.v?.sounds ?? 0) > (m.v?.sounds ?? 0) ? x : m), teams[0]);
  const maxSounds = Math.max(1, ...teams.map((x) => x.v?.sounds ?? 0));
  const celebrate = !!(result?.complete && result.winner && dismissed !== result.id);

  return (
    <div className="rs">
      <div className="rs-particles" aria-hidden="true">
        {particles.map((p) => (
          <span
            key={p.id}
            style={{ left: `${p.x}%`, fontSize: p.size, animationDelay: `${p.delay}ms`, '--drift': `${p.drift}px`, '--spin': `${p.spin}deg` } as React.CSSProperties}
          >
            {p.emoji}
          </span>
        ))}
      </div>

      <header className="rs-top">
        <div className="rs-brand">
          <span className="rs-logo">◐</span> MockGPT <span className="rs-live">Live</span>
          <span className="rs-room">#{ROOM_NAME}</span>
        </div>
        <div className={`rs-round ${round && !result?.complete ? 'is-running' : ''}`}>
          {round ? (
            result?.complete ? (
              <>
                <i className="is-done" /> Round complete · <b>{roundFinished}</b> phones
              </>
            ) : (
              <>
                <i /> Round running · <b>{roundFinished}</b>
                <span className="rs-muted">/ {roundPhones} phones finished</span>
                {round.limitMs > 0 && !round.stopped && snap && (
                  <span className="rs-countdown">{Math.max(0, Math.ceil((round.limitMs - (snap.now - round.startedAt)) / 1000))} s left</span>
                )}
                {round.stopped && <span className="rs-countdown">time's up · wrapping up</span>}
              </>
            )
          ) : (
            <span className="rs-muted">Waiting for the first round</span>
          )}
        </div>
        <div className="rs-top-right">
          <div className={`rs-online ${s.connected ? 'is-on' : ''}`}>
            <i />
            <b>
              <Counter value={snap?.online ?? 0} />
            </b>{' '}
            {s.connected ? 'phones online' : 'connecting…'}
          </div>
          {s.presenter && (
            <button
              type="button"
              className={`rs-pill-btn ${controls ? 'on' : ''}`}
              onClick={() => setControls((c) => !c)}
              title="Presenter controls (C)"
            >
              🎛 Run a round
            </button>
          )}
          <button
            type="button"
            className="rs-pill-btn rs-icon"
            onClick={() => void toggleFullscreen()}
            title="Fullscreen (F)"
            aria-label="Fullscreen"
          >
            ⛶
          </button>
        </div>
      </header>
      {s.presenter && controls && <Presenter snapshot={snap} onClose={() => setControls(false)} />}

      <main className="rs-grid">
        <section className={`rs-card rs-hero ${hot ? 'is-hot' : ''}`}>
          <div className="rs-hero-top">
            <div className="rs-hero-main">
              <p className="rs-kicker">Frames dropped across the room</p>
              <div className="rs-big">
                <Counter value={t?.dropped ?? 0} />
              </div>
              <div className="rs-hero-sub">
                <span>
                  <b>
                    <Counter value={t ? rate(t) : NaN} digits={1} />%
                  </b>{' '}
                  drop rate
                </span>
                <span>
                  <b>
                    <Counter value={t?.frames ?? 0} />
                  </b>{' '}
                  frames painted
                </span>
                <span>
                  <b>
                    <Counter value={snap?.devices ?? 0} />
                  </b>{' '}
                  phones
                </span>
              </div>
            </div>
            <div className="rs-tiles">
              <div className="rs-tile">
                <span>Avg render time</span>
                <b>
                  <Counter value={t ? avgRender(t) : NaN} digits={1} />
                  <small>ms</small>
                </b>
              </div>
              <div className="rs-tile">
                <span>Slow frames</span>
                <b>
                  <Counter value={t?.slow ?? 0} />
                </b>
              </div>
              <div className="rs-tile">
                <span>Worst frame</span>
                <b>
                  <Counter value={t?.worst ?? 0} />
                  <small>ms</small>
                </b>
              </div>
              <div className="rs-tile rs-tile-noise">
                <span>Animal noises</span>
                <b>
                  <Counter value={snap?.sounds ?? 0} />
                </b>
              </div>
            </div>
          </div>
          <div className="rs-chart">
            <div className="rs-chart-legend">
              <span className="rs-leg-drop">dropped frames / s</span>
              <span className="rs-leg-sound">animal noises / s</span>
              <span className="rs-muted">last 90 s</span>
            </div>
            <Sparkline drops={snap?.dropsPerSec ?? []} sounds={snap?.soundsPerSec ?? []} />
          </div>
        </section>

        <section className="rs-card rs-join">
          <QrCode text={joinUrl} />
          <div>
            <p className="rs-kicker">Scan to join</p>
            <p className="rs-url">{shortUrl}</p>
            <p className="rs-muted">You'll land on a random team. Your phone makes its animal's noise every time it drops a frame.</p>
          </div>
        </section>

        <section className="rs-card rs-race">
          <header className="rs-card-head">
            <h2>Round showdown</h2>
            <span className="rs-muted">average drop rate per phone · lower wins</span>
          </header>
          {!round && <p className="rs-muted rs-pad">Start a round: each team streams the same answer with its own method.</p>}
          {round &&
            teams.map(({ a, v }, i) => {
              const pct = pcts[i];
              return (
                <div
                  key={a}
                  className={`rs-lane ${leader === a ? 'is-winner' : ''}`}
                  style={{ '--c': TEAM_COLOR[a] } as React.CSSProperties}
                >
                  <div className="rs-lane-name">
                    <span className="rs-lane-team">
                      {ANIMAL_EMOJI[a]} {TEAM_NAME[a]}
                    </span>
                    <code>{TEAM_METHOD[a]}</code>
                    {leader === a && <span className="rs-trophy">🏆 winner</span>}
                  </div>
                  <div className="rs-bar">
                    <span style={{ width: `${Number.isFinite(pct) ? Math.max(2, (pct / maxPct) * 100) : 0}%` }} />
                  </div>
                  <div className="rs-lane-num">
                    <b>
                      {Number.isFinite(pct) ? (
                        <>
                          <Counter value={pct} digits={1} />%
                        </>
                      ) : (
                        '–'
                      )}
                    </b>
                    <span>
                      {v?.roundFinished ?? 0}/{v?.roundPhones ?? 0} done ·{' '}
                      {v?.avgRenderMs != null ? `${fmt(v.avgRenderMs, 1)} ms render` : '– ms render'}
                    </span>
                  </div>
                </div>
              );
            })}
        </section>

        <section className="rs-card rs-teams">
          <header className="rs-card-head">
            <h2>Teams</h2>
            <span className="rs-muted">noise = dropped frames, out loud</span>
          </header>
          {teams.map(({ a, v }) => (
            <div key={a} className={`rs-team ${loudest.a === a && (v?.sounds ?? 0) > 0 ? 'is-loudest' : ''}`}>
              <span className="rs-team-emoji">{ANIMAL_EMOJI[a]}</span>
              <div className="rs-team-body">
                <div className="rs-team-line">
                  <b>{TEAM_NAME[a]}</b>
                  <span className="rs-muted">
                    {fmt(v?.online ?? 0)} online · {fmt(v?.devices ?? 0)} joined
                  </span>
                </div>
                <div className="rs-bar rs-bar-team">
                  <span style={{ width: `${((v?.sounds ?? 0) / maxSounds) * 100}%` }} />
                </div>
              </div>
              <span className="rs-team-num">
                <Counter value={v?.sounds ?? 0} />
                {loudest.a === a && (v?.sounds ?? 0) > 0 && <span className="rs-crown">📣</span>}
              </span>
            </div>
          ))}
        </section>
      </main>
      {celebrate && snap && result?.winner && (
        <Celebration snapshot={snap} winner={result.winner as Animal} onClose={() => setDismissed(result.id)} />
      )}
      {s.error && <p className="rs-error">{s.error}</p>}
    </div>
  );
}
