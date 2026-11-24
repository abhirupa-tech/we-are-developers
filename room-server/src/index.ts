import { DurableObject } from 'cloudflare:workers';
import type { ClientMessage, Round, RoomSnapshot, RunStats, ServerMessage, Totals } from './protocol';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
}

const TICK_MS = 500; // live snapshot cadence
const SAVE_EVERY_MS = 5000; // persist at most this often
const HISTORY_SECONDS = 90;
const MAX_DEVICES = 1000;
const MAX_MESSAGE_BYTES = 4096;

type Device = {
  id: string;
  animal: string;
  mobile: boolean;
  deviceMs: number | null;
  sounds: number;
  /** The run in progress, if any (cumulative so far). */
  live: RunStats | null;
  /** Finished runs, summed per strategy. */
  done: Record<string, Totals>;
  lastSeen: number;
};

type Saved = {
  devices: Record<string, Device>;
  presenterKey: string | null;
  round: Round | null;
  dropsPerSec: number[];
  soundsPerSec: number[];
};

type Attachment = { id: string; role: 'player' | 'screen'; presenter: boolean };

const zero = (): Totals => ({ frames: 0, dropped: 0, slow: 0, long: 0, commits: 0, renderMs: 0, runs: 0, worst: 0 });

function add(into: Totals, run: Omit<RunStats, 'runId' | 'strategy' | 'cpu'> | Totals, runs = 1) {
  into.frames += run.frames;
  into.dropped += run.dropped;
  into.slow += run.slow;
  into.long += run.long;
  into.commits += run.commits;
  into.renderMs += run.renderMs;
  into.runs += 'runs' in run ? run.runs : runs;
  into.worst = Math.max(into.worst, run.worst);
}

const num = (v: unknown, max = 1e9) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), max) : 0);
const str = (v: unknown, max = 40) => (typeof v === 'string' ? v.slice(0, max) : '');

function cleanRun(r: unknown): RunStats | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const runId = str(o.runId, 64);
  const strategy = str(o.strategy, 32);
  if (!runId || !strategy) return null;
  return {
    runId,
    strategy,
    cpu: num(o.cpu, 20),
    frames: num(o.frames, 1e6),
    dropped: num(o.dropped, 1e6),
    slow: num(o.slow, 1e6),
    long: num(o.long, 1e6),
    worst: num(o.worst, 60_000),
    commits: num(o.commits, 1e6),
    renderMs: num(o.renderMs, 1e7),
  };
}

/** One room: every device in the audience reports here; screens get live totals. */
export class Room extends DurableObject<Env> {
  private state: Saved = { devices: {}, presenterKey: null, round: null, dropsPerSec: [], soundsPerSec: [] };
  private roomName = '';
  private lastDropped = 0;
  private lastSounds = 0;
  private lastSave = 0;
  private dirty = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<Saved>('state');
      if (saved) this.state = saved;
      this.roomName = (await ctx.storage.get<string>('name')) ?? '';
      this.lastDropped = this.totals().dropped;
      this.lastSounds = this.soundTotal();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const name = url.searchParams.get('room') ?? '';
    if (name && name !== this.roomName) {
      this.roomName = name;
      await this.ctx.storage.put('name', name);
    }
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      await this.ensureTicking();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname.endsWith('.csv')) return this.csv();
    return Response.json(this.snapshot());
  }

  // ── Messages ──────────────────────────────────────────────────────────
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const me = ws.deserializeAttachment() as Attachment | null;
    const now = Date.now();

    if (msg.t === 'hello') {
      const id = str(msg.id, 64);
      if (!id) return;
      if (msg.role === 'screen') {
        const key = str(msg.key, 64);
        // The first screen with a key claims the room; later screens need the same key.
        if (key && !this.state.presenterKey) this.state.presenterKey = key;
        const presenter = !!key && key === this.state.presenterKey;
        ws.serializeAttachment({ id, role: 'screen', presenter } satisfies Attachment);
        this.send(ws, { t: 'welcome', presenter });
        this.send(ws, this.snapshot());
        if (this.state.round) this.send(ws, { t: 'go', ...this.state.round });
      } else {
        if (!this.state.devices[id] && Object.keys(this.state.devices).length >= MAX_DEVICES) return;
        const d = (this.state.devices[id] ??= { id, animal: '', mobile: false, deviceMs: null, sounds: 0, live: null, done: {}, lastSeen: now });
        d.animal = str(msg.animal, 16) || d.animal;
        d.mobile = !!msg.mobile;
        d.deviceMs = msg.deviceMs == null ? null : num(msg.deviceMs, 10_000);
        d.lastSeen = now;
        ws.serializeAttachment({ id, role: 'player', presenter: false } satisfies Attachment);
        this.send(ws, { t: 'welcome', presenter: false });
      }
      this.dirty = true;
      return;
    }

    if (!me) return;

    if (me.role === 'player') {
      const d = this.state.devices[me.id];
      if (!d) return;
      d.lastSeen = now;
      if (msg.t === 'live') {
        const run = cleanRun(msg.run);
        if (run) d.live = run;
      } else if (msg.t === 'final') {
        const run = cleanRun(msg.run);
        if (run) {
          add((d.done[run.strategy] ??= zero()), run);
          if (d.live?.runId === run.runId) d.live = null;
        }
      } else if (msg.t === 'sound') {
        d.sounds += Math.min(num(msg.n, 1000), 1000);
      }
      this.dirty = true;
      return;
    }

    // Screen commands: presenter only.
    if (!me.presenter) return this.send(ws, { t: 'error', message: 'Only the presenter screen can do that.' });
    if (msg.t === 'start') {
      const round: Round = {
        strategy: str(msg.strategy, 32),
        recording: str(msg.recording, 64),
        rate: num(msg.rate, 100) || 5,
        cpu: num(msg.cpu, 20) || 1,
        startedAt: now,
      };
      this.state.round = round;
      this.broadcast({ t: 'go', ...round }, 'player');
    } else if (msg.t === 'stop') {
      this.state.round = null;
      this.broadcast({ t: 'stop' }, 'player');
    } else if (msg.t === 'reset') {
      const key = this.state.presenterKey;
      this.state = { devices: {}, presenterKey: key, round: null, dropsPerSec: [], soundsPerSec: [] };
      this.lastDropped = 0;
      this.lastSounds = 0;
      // Devices still connected rejoin on their next message.
      for (const ws2 of this.ctx.getWebSockets()) {
        const a = ws2.deserializeAttachment() as Attachment | null;
        if (a?.role === 'player') this.send(ws2, { t: 'welcome', presenter: false });
      }
    }
    this.dirty = true;
  }

  async webSocketClose(ws: WebSocket) {
    try {
      ws.close();
    } catch {
      // already closed
    }
    this.dirty = true;
  }

  async webSocketError() {
    this.dirty = true;
  }

  // ── Tick: live snapshot to everyone, history, persistence ────────────
  private tickCount = 0;

  async alarm() {
    const sockets = this.ctx.getWebSockets();
    const now = Date.now();
    this.tickCount++;
    if (this.tickCount % Math.round(1000 / TICK_MS) === 0) {
      const now1 = this.snapshot();
      const dropped = now1.totals.dropped;
      const sounds = now1.sounds;
      this.state.dropsPerSec = [...this.state.dropsPerSec, Math.max(0, dropped - this.lastDropped)].slice(-HISTORY_SECONDS);
      this.state.soundsPerSec = [...this.state.soundsPerSec, Math.max(0, sounds - this.lastSounds)].slice(-HISTORY_SECONDS);
      this.lastDropped = dropped;
      this.lastSounds = sounds;
      this.dirty = true;
    }
    if (sockets.length) {
      const snap = JSON.stringify(this.snapshot());
      for (const ws of sockets) {
        try {
          ws.send(snap);
        } catch {
          // closing
        }
      }
    }
    if (this.dirty && now - this.lastSave > SAVE_EVERY_MS) {
      await this.ctx.storage.put('state', this.state);
      this.lastSave = now;
      this.dirty = false;
    }
    if (sockets.length) await this.ctx.storage.setAlarm(now + TICK_MS);
    else if (this.dirty) await this.ctx.storage.put('state', this.state);
  }

  private async ensureTicking() {
    if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  // ── Aggregation ───────────────────────────────────────────────────────
  private onlineIds() {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.role === 'player') ids.add(a.id);
    }
    return ids;
  }

  private soundTotal() {
    return Object.values(this.state.devices).reduce((n, d) => n + d.sounds, 0);
  }

  private totals(): Totals {
    const t = zero();
    for (const d of Object.values(this.state.devices)) {
      for (const s of Object.values(d.done)) add(t, s);
      if (d.live) add(t, d.live, 0);
    }
    return t;
  }

  private snapshot(): RoomSnapshot {
    const online = this.onlineIds();
    const byStrategy: RoomSnapshot['byStrategy'] = {};
    const byAnimal: RoomSnapshot['byAnimal'] = {};
    const totals = zero();
    let running = 0;
    for (const d of Object.values(this.state.devices)) {
      const a = (byAnimal[d.animal || '?'] ??= { devices: 0, online: 0, dropped: 0, frames: 0, sounds: 0 });
      a.devices++;
      if (online.has(d.id)) a.online++;
      a.sounds += d.sounds;
      const seen = new Set<string>();
      const take = (strategy: string, t: Totals | RunStats, runs: number) => {
        const s = (byStrategy[strategy] ??= { ...zero(), devices: 0 });
        add(s, t as Totals, runs);
        if (!seen.has(strategy)) {
          s.devices++;
          seen.add(strategy);
        }
        add(totals, t as Totals, runs);
        a.dropped += t.dropped;
        a.frames += t.frames;
      };
      for (const [strategy, t] of Object.entries(d.done)) take(strategy, t, t.runs);
      if (d.live && online.has(d.id)) {
        running++;
        take(d.live.strategy, d.live, 0);
      }
    }
    return {
      t: 'room',
      room: this.roomName,
      now: Date.now(),
      online: online.size,
      devices: Object.keys(this.state.devices).length,
      running,
      sounds: this.soundTotal(),
      totals,
      byStrategy,
      byAnimal,
      dropsPerSec: this.state.dropsPerSec,
      soundsPerSec: this.state.soundsPerSec,
      round: this.state.round,
    };
  }

  private csv(): Response {
    const rows = [['device', 'animal', 'mobile', 'deviceMs', 'strategy', 'runs', 'frames', 'dropped', 'slow', 'long', 'worstMs', 'commits', 'renderMs', 'sounds']];
    for (const d of Object.values(this.state.devices)) {
      for (const [s, t] of Object.entries(d.done)) {
        rows.push([d.id, d.animal, String(d.mobile), String(d.deviceMs ?? ''), s, String(t.runs), String(t.frames), String(t.dropped), String(t.slow), String(t.long), t.worst.toFixed(1), String(t.commits), t.renderMs.toFixed(1), String(d.sounds)]);
      }
    }
    return new Response(rows.map((r) => r.join(',')).join('\n'), {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${this.roomName || 'room'}.csv"` },
    });
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // closing
    }
  }

  private broadcast(msg: ServerMessage, role?: Attachment['role']) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (role && a?.role !== role) continue;
      try {
        ws.send(text);
      } catch {
        // closing
      }
    }
  }
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS' };

/**
 * Routes:
 *   GET /rooms/:room          live snapshot (JSON)
 *   GET /rooms/:room.csv      per-device results (CSV export)
 *   GET /rooms/:room/ws       WebSocket (players and screens)
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const m = url.pathname.match(/^\/rooms\/([a-z0-9-]{1,32})(\.csv|\/ws)?$/);
    if (!m) return new Response('MockGPT room server. Use /rooms/<name>.', { status: 404, headers: CORS });
    const [, name, suffix] = m;
    const stub = env.ROOM.get(env.ROOM.idFromName(name));
    const inner = new URL(request.url);
    inner.searchParams.set('room', name);
    if (suffix === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426, headers: CORS });
      return stub.fetch(new Request(inner, request));
    }
    const res = await stub.fetch(new Request(inner, { method: 'GET' }));
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
    return out;
  },
} satisfies ExportedHandler<Env>;
