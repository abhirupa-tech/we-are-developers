/**
 * The contract between MockGPT and wherever recorded streams come from. The
 * three strategies never see HTTP: they only see events on the EventBus.
 * Event names follow AG-UI so the app maps cleanly onto that protocol.
 */

export type StreamEvent =
  | { type: 'RUN_STARTED'; runId: string }
  | { type: 'TEXT_MESSAGE_START'; messageId: string }
  | { type: 'TEXT_MESSAGE_CONTENT'; messageId: string; delta: string; seq: number; t?: number }
  | { type: 'TEXT_MESSAGE_END'; messageId: string }
  | { type: 'RUN_FINISHED'; runId: string }
  | { type: 'RUN_ERROR'; message: string };

/** A StreamEvent stamped with the moment it left the parser, before any React work. */
export type PublishedEvent = StreamEvent & { arrivedAt: number };

export type RecordingMeta = {
  id: string;
  title: string;
  description: string;
  /** The user prompt the recorded answer replied to, shown in the transcript. */
  prompt: string;
  tokenCount: number;
  durationMs: number;
  contentTags: string[];
};

export type StartOptions = {
  recordingId: string;
  /** 1 = original timing; 5 = five times faster. */
  rate: number;
  seed?: number;
  signal: AbortSignal;
};

export interface ReplaySource {
  /** Human-readable name for the settings panel. */
  readonly name: string;
  /**
   * True when the source already paces events in real time (the mock does;
   * a server that honours `rate` does). When false, StreamClient schedules
   * delivery from each event's recorded `t`.
   */
  readonly paced: boolean;
  list(): Promise<RecordingMeta[]>;
  start(opts: StartOptions): AsyncIterable<StreamEvent>;
}
