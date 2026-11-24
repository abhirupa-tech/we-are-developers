import { useSyncExternalStore } from 'react';
import { ANIMAL_EMOJI, type Animal } from '../debug/dropSound';
import { ROOM_NAME, room } from './roomClient';

const TEAM_LINE: Record<Animal, string> = {
  dog: 'Your phone barks every time it drops a frame.',
  cat: 'Your phone meows every time it drops a frame.',
  rooster: 'Your phone crows every time it drops a frame.',
  duck: 'Your phone quacks every time it drops a frame.',
};

/** Full-screen welcome for audience devices: one tap joins and turns sound on. */
export function JoinRoom({ animal, onJoin }: { animal: Animal; onJoin: () => void }) {
  return (
    <div className="join-overlay" role="dialog" aria-label={`Join room ${ROOM_NAME}`}>
      <div className="join-card">
        <div className="join-emoji" aria-hidden="true">
          {ANIMAL_EMOJI[animal]}
        </div>
        <p className="join-kicker">Live room · {ROOM_NAME}</p>
        <h1 className="join-title">You're Team {animal[0].toUpperCase() + animal.slice(1)}</h1>
        <p className="join-line">{TEAM_LINE[animal]} The stage screen adds up every phone in the room.</p>
        <button type="button" className="join-btn" onClick={onJoin}>
          Join &amp; turn on sound
        </button>
        <p className="join-fine">Anonymous: no names, no sign-in. Just frame counts and animal noises.</p>
      </div>
    </div>
  );
}

/** Topbar badge: connection, room name, how many devices are in. */
export function RoomChip() {
  const s = useSyncExternalStore(room.subscribe, room.getSnapshot);
  const online = s.snapshot?.online ?? 0;
  return (
    <span className={`room-chip ${s.connected ? 'is-live' : ''}`} title={s.connected ? `Connected to room ${ROOM_NAME}` : 'Reconnecting…'}>
      <i aria-hidden="true" />
      {ROOM_NAME}
      <b>{s.connected ? `${online} in` : '…'}</b>
    </span>
  );
}
