import { setAnimal } from '../debug/dropSound';
import type { ClientMessage, Round, RoomSnapshot, RunStats, ServerMessage, Team } from './protocol';

/**
 * Connects this page to a live room (?room=<name>), so a whole audience can
 * run the demo together: every device reports its frame stats, the room
 * screen (?view=room) shows the totals, and the presenter can start a round
 * on every device at once.
 *
 * Anonymous: a random id per page load, the page's animal and a device-speed
 * reading. No names, no accounts.
 */
const params = new URLSearchParams(window.location.search);

export const ROOM_NAME = (params.get('room') ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
const SERVER = (params.get('server') ?? (import.meta.env.VITE_ROOM_SERVER as string | undefined) ?? '').replace(/\/$/, '');
export const ROOM_ENABLED = !!ROOM_NAME && !!SERVER;

export type RoomStatus = {
  connected: boolean;
  joined: boolean;
  presenter: boolean;
  /** The team the room assigned this phone. */
  team: Team | null;
  snapshot: RoomSnapshot | null;
  error: string | null;
};

const id = crypto.randomUUID();
let status: RoomStatus = { connected: false, joined: false, presenter: false, team: null, snapshot: null, error: null };
const listeners = new Set<() => void>();
const goListeners = new Set<(round: Round) => void>();
const stopListeners = new Set<() => void>();

let ws: WebSocket | null = null;
let hello: Extract<ClientMessage, { t: 'hello' }> | null = null;
let retry = 0;
let queue: ClientMessage[] = [];
let pendingSounds = 0;

function set(patch: Partial<RoomStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

function wsUrl() {
  return `${SERVER.replace(/^http/, 'ws')}/rooms/${ROOM_NAME}/ws`;
}

function connect() {
  if (!ROOM_ENABLED || ws) return;
  const sock = new WebSocket(wsUrl());
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    set({ connected: true, error: null });
    if (hello) sock.send(JSON.stringify(hello));
    flush();
  };
  sock.onmessage = (ev) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(ev.data as string);
    } catch {
      return;
    }
    if (msg.t === 'room') set({ snapshot: msg });
    else if (msg.t === 'welcome') {
      if (msg.team) {
        setAnimal(msg.team);
        if (hello?.role === 'player') hello = { ...hello, team: msg.team };
      }
      set({ presenter: msg.presenter, joined: true, team: msg.team ?? status.team });
    } else if (msg.t === 'rejoin') {
      // The room was reset: join again (keeping our team if the room can).
      if (hello && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(hello));
    } else if (msg.t === 'go') {
      const { t: _t, ...round } = msg;
      goListeners.forEach((l) => l(round));
    } else if (msg.t === 'stop') stopListeners.forEach((l) => l());
    else if (msg.t === 'error') set({ error: msg.message });
  };
  sock.onclose = () => {
    ws = null;
    set({ connected: false });
    // Back off: 0.5 s, 1 s, 2 s … up to 10 s, with jitter so 50 phones don't reconnect in lockstep.
    const delay = Math.min(10_000, 500 * 2 ** retry++) * (0.75 + Math.random() * 0.5);
    setTimeout(connect, delay);
  };
}

function flush() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (pendingSounds) {
    queue.push({ t: 'sound', n: pendingSounds });
    pendingSounds = 0;
  }
  for (const m of queue) ws.send(JSON.stringify(m));
  queue = [];
}

function send(msg: ClientMessage) {
  // Only the newest live update matters; finals and commands are kept in order.
  if (msg.t === 'live') queue = queue.filter((m) => m.t !== 'live');
  queue.push(msg);
  flush();
}

export const room = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => status,

  /** Audience device: join; the room assigns a team. */
  joinAsPlayer(deviceMs: number | null) {
    hello = { t: 'hello', id, role: 'player', mobile: matchMedia('(pointer: coarse)').matches, deviceMs };
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(hello));
    else connect();
  },

  /** Room screen: watch, or present with the presenter key. */
  joinAsScreen(key: string) {
    hello = { t: 'hello', id, role: 'screen', key };
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(hello));
    else connect();
  },

  live(run: RunStats) {
    if (status.joined && hello?.role === 'player') send({ t: 'live', run });
  },
  final(run: RunStats) {
    if (hello?.role === 'player') send({ t: 'final', run });
  },
  sound() {
    if (hello?.role !== 'player') return;
    pendingSounds++;
    // Sounds are batched: at most one message every 500 ms.
    if (pendingSounds === 1) setTimeout(flush, 500);
  },

  start(round: Omit<Round, 'startedAt' | 'id'>) {
    send({ t: 'start', ...round });
  },
  stop() {
    send({ t: 'stop' });
  },
  reset() {
    send({ t: 'reset' });
  },

  onGo(l: (round: Round) => void) {
    goListeners.add(l);
    return () => {
      goListeners.delete(l);
    };
  },
  onStop(l: () => void) {
    stopListeners.add(l);
    return () => {
      stopListeners.delete(l);
    };
  },

  /** Link for the audience: the same page, in this room, with sound on. */
  joinUrl() {
    const u = new URL(window.location.href);
    u.search = '';
    u.searchParams.set('room', ROOM_NAME);
    u.searchParams.set('audio', '1');
    if (params.get('server')) u.searchParams.set('server', SERVER);
    return u.toString();
  },
  csvUrl() {
    return `${SERVER}/rooms/${ROOM_NAME}.csv`;
  },
};
