// Copied from room-server/src/protocol.ts: keep the two in sync.
/**
 * Wire protocol between the demo app, the room screen and the room server.
 * Shared shape only; the server validates everything it receives.
 * Keep demo-chat-app/src/room/protocol.ts in sync (it's a copy).
 */

/** The three teams. Each team runs one rendering strategy on its phones. */
export const TEAMS = ['dog', 'duck', 'cat'] as const;
export type Team = (typeof TEAMS)[number];

/** One run's numbers, cumulative since the run started. */
export type RunStats = {
  runId: string;
  strategy: string;
  cpu: number;
  frames: number;
  dropped: number;
  slow: number;
  long: number;
  worst: number;
  commits: number;
  renderMs: number;
  /** The presenter round this run belongs to (its startedAt), if any. */
  round?: number;
};

export type ClientMessage =
  | { t: 'hello'; id: string; role: 'player'; team?: string; mobile: boolean; deviceMs: number | null }
  | { t: 'hello'; id: string; role: 'screen'; key: string }
  | { t: 'live'; run: RunStats }
  | { t: 'final'; run: RunStats }
  | { t: 'sound'; n: number }
  | { t: 'start'; recording: string; rate: number; cpu: number; limitMs?: number }
  | { t: 'stop' }
  | { t: 'reset' };

export type Totals = {
  frames: number;
  dropped: number;
  slow: number;
  long: number;
  commits: number;
  renderMs: number;
  runs: number;
  worst: number;
};

export type Round = {
  id: number;
  recording: string;
  rate: number;
  cpu: number;
  startedAt: number;
  /** Every phone stops after this long (0 = no limit), so all teams are scored on the same window. */
  limitMs: number;
  /** Set once the time limit (or the presenter) stopped the round. */
  stopped?: boolean;
};

export type TeamStats = {
  devices: number;
  online: number;
  sounds: number;
  /** This round: phones that were in when it started, finished, still running. */
  roundPhones: number;
  roundFinished: number;
  roundRunning: number;
  /** This round: mean of each phone's own drop % (every phone counts equally). */
  avgDropPct: number | null;
  /** This round: render time per commit, across the team's phones. */
  avgRenderMs: number | null;
  /** This round: frames and drops, summed. */
  frames: number;
  dropped: number;
};

export type RoundResult = {
  id: number;
  /** Every phone that was in at the start has finished (or left). */
  complete: boolean;
  /** Lowest average drop %, once complete. */
  winner: Team | null;
};

export type RoomSnapshot = {
  t: 'room';
  room: string;
  now: number;
  online: number;
  devices: number;
  running: number;
  sounds: number;
  /** All rounds, all phones. */
  totals: Totals;
  byStrategy: Record<string, Totals & { devices: number }>;
  teams: Record<Team, TeamStats>;
  /** Dropped frames per second across the room, oldest first (last 90 s). */
  dropsPerSec: number[];
  /** Animal sounds per second across the room (last 90 s). */
  soundsPerSec: number[];
  round: Round | null;
  result: RoundResult | null;
};

export type ServerMessage =
  | RoomSnapshot
  | ({ t: 'go' } & Round)
  | { t: 'stop' }
  | { t: 'welcome'; presenter: boolean; team?: Team }
  | { t: 'rejoin' }
  | { t: 'error'; message: string };
