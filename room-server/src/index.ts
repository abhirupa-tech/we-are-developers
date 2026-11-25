import { DurableObject } from 'cloudflare:workers';
import { TEAMS, type ClientMessage, type Round, type RoomSnapshot, type RunStats, type ServerMessage, type Team, type TeamStats, type Totals } from './protocol';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
}

const TICK_MS = 500; // live snapshot cadence
const SAVE_EVERY_MS = 5000; // persist at most this often
const HISTORY_SECONDS = 90;
const MAX_DEVICES = 1000;
const MAX_MESSAGE_BYTES = 4096;
/** A phone that sends nothing for this long during a round is treated as gone. */
const STALL_MS = 3000;
/** Phones get this long after the start to send their first update. */
const STARTUP_MS = 5000;
/** After the time limit, wait this long for final reports, then close the round. */
const GRACE_MS = 2000;

type Device = {
  id: string;
  team: Team;
  mobile: boolean;
  deviceMs: number | null;
  sounds: number;
  /** The run in progress, if any (cumulative so far). */
  live: RunStats | null;
  /** Finished runs, summed per strategy (all rounds). */
  done: Record<string, Totals>;
  /** This device's finished run for the current round. */
  roundFinal: RunStats | null;
  /** Dropped out of the current round: not waited for, not scored. */
  roundOut: boolean;
  /** The page is in the background (it can't measure frames there). */
  away: boolean;
  /** Last live/final update during the current round. */
  lastUpdate: number;
  lastSeen: number;
};

type Saved = {
  devices: Record<string, Device>;
  presenterKey: string | null;
  round: Round | null;
  /** Phones online when the current round started. */
  participants: string[];
  dropsPerSec: number[];
  soundsPerSec: number[];
};

type Attachment = { id: string; role: 'player' | 'screen'; presenter: boolean };

const zero = (): Totals => ({ frames: 0, dropped: 0, slow: 0, long: 0, commits: 0, renderMs: 0, runs: 0, worst: 0 });
const empty = (): Saved => ({ devices: {}, presenterKey: null, round: null, participants: [], dropsPerSec: [], soundsPerSec: [] });

function add(into: Totals, run: Totals | RunStats, runs = 1) {
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
const isTeam = (v: unknown): v is Team => typeof v === 'string' && (TEAMS as readonly string[]).includes(v);

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
    round: typeof o.round === 'number' && Number.isFinite(o.round) ? o.round : undefined,
  };
}

/** One room: every device in the audience reports here; screens get live totals. */
export class Room extends DurableObject<Env> {
  private state: Saved = empty();
  private roomName = '';
  private lastDropped = 0;
  private lastSounds = 0;
  private lastSave = 0;
  private dirty = false;
  private tickCount = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<Saved>('state');
      // Rooms saved before teams existed start fresh.
      if (saved && Array.isArray(saved.participants)) this.state = saved;
      else if (saved) this.state = { ...empty(), presenterKey: saved.presenterKey ?? null };
      this.roomName = (await ctx.storage.get<string>('name')) ?? '';
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
      } else {
        let d = this.state.devices[id];
        if (!d) {
          if (Object.keys(this.state.devices).length >= MAX_DEVICES) return;
          d = this.state.devices[id] = {
            id,
            team: this.assignTeam(msg.team),
            mobile: false,
            deviceMs: null,
            sounds: 0,
            live: null,
            done: {},
            roundFinal: null,
            roundOut: false,
            away: false,
            lastUpdate: 0,
            lastSeen: now,
          };
        }
        d.mobile = !!msg.mobile;
        d.deviceMs = msg.deviceMs == null ? null : num(msg.deviceMs, 10_000);
        d.lastSeen = now;
        ws.serializeAttachment({ id, role: 'player', presenter: false } satisfies Attachment);
        this.send(ws, { t: 'welcome', presenter: false, team: d.team });
      }
      this.dirty = true;
      return;
    }

    if (!me) return;

    if (me.role === 'player') {
      const d = this.state.devices[me.id];
      if (!d) return this.send(ws, { t: 'rejoin' });
      d.lastSeen = now;
      if (msg.t === 'live') {
        const run = cleanRun(msg.run);
        if (run) {
          d.live = run;
          if (run.round != null && run.round === this.state.round?.id) d.lastUpdate = now;
        }
      } else if (msg.t === 'final') {
        const run = cleanRun(msg.run);
        if (run) {
          add((d.done[run.strategy] ??= zero()), run);
          if (d.live?.runId === run.runId) d.live = null;
          if (run.round != null && run.round === this.state.round?.id && !d.roundOut) {
            d.roundFinal = run;
            d.lastUpdate = now;
          }
        }
      } else if (msg.t === 'away') {
        d.away = !!msg.away;
        // Backgrounded mid-round: out of this round straight away (its frame counts are meaningless).
        if (d.away && this.inRound(d)) d.roundOut = true;
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
        id: now,
        recording: str(msg.recording, 64),
        rate: num(msg.rate, 100) || 5,
        cpu: num(msg.cpu, 20) || 1,
        startedAt: now,
        limitMs: num(msg.limitMs, 600_000),
      };
      this.state.round = round;
      // Phones in the background don't take part: they can't measure frames.
      this.state.participants = [...this.onlineIds()].filter((id) => !this.state.devices[id]?.away);
      for (const d of Object.values(this.state.devices)) {
        d.roundFinal = null;
        d.roundOut = false;
        d.lastUpdate = 0;
      }
      this.broadcast({ t: 'go', ...round }, 'player');
    } else if (msg.t === 'stop') {
      if (this.state.round) this.state.round.stopped = true;
      this.broadcast({ t: 'stop' }, 'player');
    } else if (msg.t === 'reset') {
      const key = this.state.presenterKey;
      this.state = { ...empty(), presenterKey: key };
      this.lastDropped = 0;
      this.lastSounds = 0;
      // Phones still connected join again (and get a team again).
      this.broadcast({ t: 'rejoin' }, 'player');
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

  /**
   * Balanced random teams: a new phone joins the smallest team (ties broken
   * at random), so teams stay within one phone of each other. A phone that
   * rejoins after a reset keeps its team if that doesn't unbalance things.
   */
  private assignTeam(preferred: unknown): Team {
    const counts = Object.fromEntries(TEAMS.map((t) => [t, 0])) as Record<Team, number>;
    for (const d of Object.values(this.state.devices)) counts[d.team]++;
    const min = Math.min(...TEAMS.map((t) => counts[t]));
    if (isTeam(preferred) && counts[preferred] === min) return preferred;
    const smallest = TEAMS.filter((t) => counts[t] === min);
    return smallest[Math.floor(Math.random() * smallest.length)];
  }

  // ── Tick: live snapshot to everyone, history, persistence ────────────
  async alarm() {
    const sockets = this.ctx.getWebSockets();
    const now = Date.now();
    this.tickCount++;
    // Time limit: stop every phone at once, so all teams get the same window.
    const r = this.state.round;
    if (r && r.limitMs > 0 && !r.stopped && now - r.startedAt >= r.limitMs) {
      r.stopped = true;
      this.broadcast({ t: 'stop' }, 'player');
      this.dirty = true;
    }
    this.settleRound(now);
    const snap = this.snapshot();
    if (this.tickCount === 1) {
      // Fresh instance: start the per-second history from current totals.
      this.lastDropped = snap.totals.dropped;
      this.lastSounds = snap.sounds;
    }
    if (this.tickCount % Math.round(1000 / TICK_MS) === 0) {
      this.state.dropsPerSec = [...this.state.dropsPerSec, Math.max(0, snap.totals.dropped - this.lastDropped)].slice(-HISTORY_SECONDS);
      this.state.soundsPerSec = [...this.state.soundsPerSec, Math.max(0, snap.sounds - this.lastSounds)].slice(-HISTORY_SECONDS);
      this.lastDropped = snap.totals.dropped;
      this.lastSounds = snap.sounds;
      this.dirty = true;
    }
    if (sockets.length) {
      const text = JSON.stringify(snap);
      for (const ws of sockets) {
        try {
          ws.send(text);
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

  /** Taking part in the current round and not finished or out yet. */
  private inRound(d: Device) {
    return !!this.state.round && this.state.participants.includes(d.id) && !d.roundFinal && !d.roundOut;
  }

  /**
   * Never wait on a phone that isn't coming: mark phones out of the current
   * round when they went quiet (no update for STALL_MS, after STARTUP_MS),
   * disconnected, or are still missing GRACE_MS after the time limit.
   */
  private settleRound(now: number) {
    const r = this.state.round;
    if (!r) return;
    const online = this.onlineIds();
    const pastDeadline = r.limitMs > 0 && now - r.startedAt >= r.limitMs + GRACE_MS;
    for (const id of this.state.participants) {
      const d = this.state.devices[id];
      if (!d || !this.inRound(d)) continue;
      const since = Math.max(d.lastUpdate, r.startedAt + STARTUP_MS);
      if (!online.has(id) || d.away || pastDeadline || now - since > STALL_MS) {
        d.roundOut = true;
        this.dirty = true;
      }
    }
  }

  // ── Aggregation ───────────────────────────────────────────────────────
  private onlineIds() {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.role === 'player' && this.state.devices[a.id]) ids.add(a.id);
    }
    return ids;
  }

  private snapshot(): RoomSnapshot {
    const online = this.onlineIds();
    const roundId = this.state.round?.id;
    const participants = new Set(this.state.participants);
    const byStrategy: RoomSnapshot['byStrategy'] = {};
    const totals = zero();
    let running = 0;
    let sounds = 0;

    const teams = Object.fromEntries(
      TEAMS.map((t) => [
        t,
        { devices: 0, online: 0, sounds: 0, roundPhones: 0, roundFinished: 0, roundRunning: 0, roundOut: 0, avgDropPct: null, avgRenderMs: null, frames: 0, dropped: 0 } satisfies TeamStats,
      ]),
    ) as Record<Team, TeamStats>;
    const pcts: Record<Team, number[]> = { dog: [], duck: [], cat: [] };
    const render: Record<Team, { ms: number; commits: number }> = { dog: { ms: 0, commits: 0 }, duck: { ms: 0, commits: 0 }, cat: { ms: 0, commits: 0 } };
    let outstanding = 0;

    for (const d of Object.values(this.state.devices)) {
      const team = teams[d.team];
      const isOnline = online.has(d.id);
      team.devices++;
      if (isOnline) team.online++;
      team.sounds += d.sounds;
      sounds += d.sounds;

      // All-time totals and per-strategy breakdown.
      const seen = new Set<string>();
      const take = (strategy: string, t: Totals | RunStats, runs: number) => {
        const s = (byStrategy[strategy] ??= { ...zero(), devices: 0 });
        add(s, t, runs);
        if (!seen.has(strategy)) {
          s.devices++;
          seen.add(strategy);
        }
        add(totals, t, runs);
      };
      for (const [strategy, t] of Object.entries(d.done)) take(strategy, t, t.runs);
      const liveNow = d.live && isOnline ? d.live : null;
      if (liveNow) {
        running++;
        take(liveNow.strategy, liveNow, 0);
      }

      // The current round, by team.
      if (roundId != null && participants.has(d.id)) {
        team.roundPhones++;
        const liveRound = liveNow?.round === roundId ? liveNow : null;
        // Phones that dropped out are neither waited for nor scored.
        const run = d.roundOut ? null : (d.roundFinal ?? liveRound);
        if (d.roundOut) team.roundOut++;
        else if (d.roundFinal) team.roundFinished++;
        else {
          if (liveRound) team.roundRunning++;
          outstanding++;
        }
        if (run && run.frames > 0) {
          pcts[d.team].push((run.dropped / run.frames) * 100);
          render[d.team].ms += run.renderMs;
          render[d.team].commits += run.commits;
          team.frames += run.frames;
          team.dropped += run.dropped;
        }
      }
    }

    for (const t of TEAMS) {
      const p = pcts[t];
      teams[t].avgDropPct = p.length ? p.reduce((a, b) => a + b, 0) / p.length : null;
      teams[t].avgRenderMs = render[t].commits ? render[t].ms / render[t].commits : null;
    }

    let result: RoomSnapshot['result'] = null;
    if (roundId != null) {
      // Complete once nobody is outstanding; a round where everyone dropped out has no winner.
      const complete = outstanding === 0;
      let winner: Team | null = null;
      if (complete) {
        for (const t of TEAMS) {
          const v = teams[t].avgDropPct;
          if (v == null || teams[t].roundFinished === 0) continue;
          if (winner == null || v < (teams[winner].avgDropPct ?? Infinity)) winner = t;
        }
      }
      result = { id: roundId, complete, winner, out: TEAMS.reduce((n, t) => n + teams[t].roundOut, 0) };
    }

    return {
      t: 'room',
      room: this.roomName,
      now: Date.now(),
      online: online.size,
      devices: Object.keys(this.state.devices).length,
      running,
      sounds,
      totals,
      byStrategy,
      teams,
      dropsPerSec: this.state.dropsPerSec,
      soundsPerSec: this.state.soundsPerSec,
      round: this.state.round,
      result,
    };
  }

  private csv(): Response {
    const rows = [['device', 'team', 'mobile', 'deviceMs', 'strategy', 'runs', 'frames', 'dropped', 'dropPct', 'slow', 'long', 'worstMs', 'commits', 'renderMs', 'sounds']];
    for (const d of Object.values(this.state.devices)) {
      for (const [s, t] of Object.entries(d.done)) {
        rows.push([
          d.id,
          d.team,
          String(d.mobile),
          String(d.deviceMs ?? ''),
          s,
          String(t.runs),
          String(t.frames),
          String(t.dropped),
          t.frames ? ((t.dropped / t.frames) * 100).toFixed(2) : '',
          String(t.slow),
          String(t.long),
          t.worst.toFixed(1),
          String(t.commits),
          t.renderMs.toFixed(1),
          String(d.sounds),
        ]);
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
