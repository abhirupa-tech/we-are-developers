import { useMemo } from 'react';
import { ANIMAL_EMOJI, ANIMALS, type Animal } from '../debug/dropSound';
import type { RoomSnapshot } from './protocol';
import { TEAM_COLOR, TEAM_METHOD, TEAM_NAME } from './teams';

const COLORS = ['#f5b942', '#f0a35e', '#f6e7d9', '#ff5a4e', '#9b8cff', '#b6f36a', '#ffd98a'];
const MEDALS = ['🥇', '🥈', '🥉'];

/** Seeded so a re-render doesn't reshuffle the confetti mid-fall. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

/**
 * Round finale: confetti and streamers fall, party poppers fire, and the
 * winning team (lowest average drop rate per phone) is crowned.
 */
export function Celebration({ snapshot, winner, onClose }: { snapshot: RoomSnapshot; winner: Animal; onClose: () => void }) {
  const pieces = useMemo(() => {
    const r = rng(snapshot.result?.id ?? 1);
    const confetti = Array.from({ length: 140 }, (_, i) => ({
      i,
      left: r() * 100,
      delay: r() * 2.8,
      duration: 3.2 + r() * 2.6,
      color: COLORS[Math.floor(r() * COLORS.length)],
      w: 6 + r() * 8,
      h: 10 + r() * 12,
      sway: (r() - 0.5) * 160,
      spin: 360 + r() * 720,
      round: r() < 0.25,
    }));
    const streamers = Array.from({ length: 16 }, (_, i) => ({
      i,
      left: 2 + r() * 96,
      delay: r() * 2.2,
      duration: 4.5 + r() * 2.5,
      color: COLORS[Math.floor(r() * (COLORS.length - 1))],
      tilt: (r() - 0.5) * 50,
      len: 120 + r() * 120,
    }));
    return { confetti, streamers };
  }, [snapshot.result?.id]);

  const ranked = ANIMALS.map((a) => ({ a, v: snapshot.teams[a] }))
    .filter((x) => x.v && x.v.roundFinished > 0 && x.v.avgDropPct != null)
    .sort((x, y) => (x.v.avgDropPct ?? 0) - (y.v.avgDropPct ?? 0));
  const win = snapshot.teams[winner];
  const phones = ranked.reduce((n, x) => n + x.v.roundFinished, 0);

  return (
    <div className="party" role="dialog" aria-label={`Team ${TEAM_NAME[winner]} wins`} onClick={onClose}>
      <div className="party-sky" aria-hidden="true">
        {pieces.streamers.map((s) => (
          <svg
            key={`s${s.i}`}
            className="party-streamer"
            viewBox="0 0 20 200"
            preserveAspectRatio="none"
            style={
              {
                left: `${s.left}%`,
                height: s.len,
                animationDelay: `${s.delay}s`,
                animationDuration: `${s.duration}s`,
                '--tilt': `${s.tilt}deg`,
              } as React.CSSProperties
            }
          >
            <path
              d="M10 0 C 20 25, 0 50, 10 75 S 20 125, 10 150 S 0 185, 10 200"
              stroke={s.color}
              strokeWidth="5"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        ))}
        {pieces.confetti.map((c) => (
          <i
            key={c.i}
            className="party-confetti"
            style={
              {
                left: `${c.left}%`,
                width: c.round ? c.w : c.w,
                height: c.round ? c.w : c.h,
                borderRadius: c.round ? '50%' : 2,
                background: c.color,
                animationDelay: `${c.delay}s`,
                animationDuration: `${c.duration}s`,
                '--sway': `${c.sway}px`,
                '--spin': `${c.spin}deg`,
              } as React.CSSProperties
            }
          />
        ))}
        <span className="party-popper party-popper-l">🎉</span>
        <span className="party-popper party-popper-r">🎊</span>
      </div>

      <div className="party-card" style={{ '--c': TEAM_COLOR[winner] } as React.CSSProperties} onClick={(e) => e.stopPropagation()}>
        <p className="party-kicker">
          Round complete · {phones} phones
          {(snapshot.result?.out ?? 0) > 0 && ` · ${snapshot.result!.out} dropped out`}
        </p>
        <div className="party-emoji" aria-hidden="true">
          {ANIMAL_EMOJI[winner]}
        </div>
        <h1 className="party-title">Team {TEAM_NAME[winner]} wins!</h1>
        <p className="party-method">
          <code>{TEAM_METHOD[winner]}</code> is the most performant method
        </p>
        <p className="party-stat">
          <b>{win.avgDropPct?.toFixed(1)}%</b> of frames dropped on average
        </p>
        <ol className="party-podium">
          {ranked.map(({ a, v }, i) => (
            <li key={a} className={a === winner ? 'is-winner' : ''} style={{ '--c': TEAM_COLOR[a] } as React.CSSProperties}>
              <span className="party-medal">{MEDALS[i]}</span>
              <span className="party-team">
                {ANIMAL_EMOJI[a]} {TEAM_NAME[a]}
              </span>
              <code>{TEAM_METHOD[a]}</code>
              <b>{v.avgDropPct?.toFixed(1)}%</b>
              <span className="party-n">{v.roundFinished} phones</span>
            </li>
          ))}
        </ol>
        <button type="button" className="party-btn" onClick={onClose}>
          Continue
        </button>
      </div>
    </div>
  );
}
