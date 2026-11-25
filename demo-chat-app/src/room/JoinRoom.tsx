import { useSyncExternalStore } from 'react';
import { ANIMAL_EMOJI, ANIMALS, type Animal } from '../debug/dropSound';
import { ROOM_NAME, room } from './roomClient';
import { TEAM_COLOR, TEAM_METHOD, TEAM_NAME } from './teams';


/** Full-screen welcome for audience devices: one tap joins and turns sound on. */
export function JoinRoom({ onJoin }: { onJoin: () => void }) {
  return (
    <div className="join-overlay" role="dialog" aria-label={`Join room ${ROOM_NAME}`}>
      <div className="join-card">
        <div className="join-emoji join-emoji-trio" aria-hidden="true">
          {ANIMALS.map((a) => (
            <span key={a}>{ANIMAL_EMOJI[a]}</span>
          ))}
        </div>
        <p className="join-kicker">Live experiment · {ROOM_NAME}</p>
        <h1 className="join-title">Three teams, three ways to render</h1>
        <ul className="join-teams">
          {ANIMALS.map((a) => (
            <li key={a} style={{ '--c': TEAM_COLOR[a] } as React.CSSProperties}>
              <span>{ANIMAL_EMOJI[a]}</span>
              <b>{TEAM_NAME[a]}</b>
              <code>{TEAM_METHOD[a]}</code>
            </li>
          ))}
        </ul>
        <p className="join-line">You'll be put on a team at random. Your screen flashes your team's animal every time it drops a frame, and the stage hears it in their headphones. Lowest average drop rate wins.</p>
        <button type="button" className="join-btn" onClick={onJoin}>
          Join the experiment
        </button>
        <p className="join-fine">Keep your phone on silent. Anonymous: no names, no sign-in, just frame counts.</p>
      </div>
    </div>
  );
}

/** After joining: which team this phone is on, until the first round starts. */
export function TeamCard({ team, onClose }: { team: Animal; onClose: () => void }) {
  return (
    <div className="join-overlay" role="dialog" aria-label={`You're on team ${TEAM_NAME[team]}`} onClick={onClose}>
      <div className="join-card" style={{ '--c': TEAM_COLOR[team] } as React.CSSProperties}>
        <div className="join-emoji" aria-hidden="true">
          {ANIMAL_EMOJI[team]}
        </div>
        <p className="join-kicker">You're on</p>
        <h1 className="join-title">Team {TEAM_NAME[team]}</h1>
        <p className="join-method">
          <code>{TEAM_METHOD[team]}</code>
        </p>
        <p className="join-line">
          Your screen flashes {ANIMAL_EMOJI[team]} on every dropped frame. Keep this page open and wait for the presenter to start the round.
        </p>
        <p className="join-wait">
          <i /> Waiting for the round…
        </p>
      </div>
    </div>
  );
}

/** Topbar badge: connection, team, how many phones are in. */
export function RoomChip() {
  const s = useSyncExternalStore(room.subscribe, room.getSnapshot);
  const online = s.snapshot?.online ?? 0;
  return (
    <span className={`room-chip ${s.connected ? 'is-live' : ''}`} title={s.connected ? `Connected to room ${ROOM_NAME}` : 'Reconnecting…'}>
      <i aria-hidden="true" />
      <span className="room-chip-label">{s.team ? `Team ${TEAM_NAME[s.team]}` : ROOM_NAME}</span>
      <b>{s.connected ? `${online} in` : '…'}</b>
    </span>
  );
}
