/**
 * Wire protocol between the demo app, the room screen and the room server.
 * Shared shape only; the server validates everything it receives.
 */

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
};

export type ClientMessage =
  | { t: 'hello'; id: string; role: 'player'; animal: string; mobile: boolean; deviceMs: number | null }
  | { t: 'hello'; id: string; role: 'screen'; key: string }
  | { t: 'live'; run: RunStats }
  | { t: 'final'; run: RunStats }
  | { t: 'sound'; n: number }
  | { t: 'start'; strategy: string; recording: string; rate: number; cpu: number }
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

export type Round = { strategy: string; recording: string; rate: number; cpu: number; startedAt: number };

export type RoomSnapshot = {
  t: 'room';
  room: string;
  now: number;
  online: number;
  devices: number;
  running: number;
  sounds: number;
  totals: Totals;
  byStrategy: Record<string, Totals & { devices: number }>;
  byAnimal: Record<string, { devices: number; online: number; dropped: number; frames: number; sounds: number }>;
  /** Dropped frames per second across the room, oldest first (last 90 s). */
  dropsPerSec: number[];
  /** Animal sounds per second across the room (last 90 s). */
  soundsPerSec: number[];
  round: Round | null;
};

export type ServerMessage =
  | RoomSnapshot
  | ({ t: 'go' } & Round)
  | { t: 'stop' }
  | { t: 'welcome'; presenter: boolean }
  | { t: 'error'; message: string };
