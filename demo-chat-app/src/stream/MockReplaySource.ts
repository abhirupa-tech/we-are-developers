import { RECORDINGS, type Recording } from './fixtures';
import type { RecordingMeta, ReplaySource, StartOptions, StreamEvent } from './ReplaySource';
import { nextTask } from './schedule';

/**
 * Replays a local recording with timers, paced like a server honouring
 * `rate`. Unblocks development and is the offline fallback on stage.
 * Deterministic: the same recording always yields the same events and gaps
 * (the gaps are fixed in the fixture, so `seed` has nothing left to vary).
 */
export class MockReplaySource implements ReplaySource {
  readonly name = 'Mock (local recordings)';
  readonly paced = true;

  constructor(private readonly recordings: Recording[] = RECORDINGS) {}

  async list(): Promise<RecordingMeta[]> {
    return this.recordings.map(({ deltas: _deltas, ...meta }) => meta);
  }

  async *start({ recordingId, rate, signal }: StartOptions): AsyncIterable<StreamEvent> {
    const rec = this.recordings.find((r) => r.id === recordingId);
    if (!rec) throw new Error(`Unknown recording: ${recordingId}`);
    const runId = `run-${Date.now().toString(36)}`;
    const messageId = `${runId}-m1`;

    yield { type: 'RUN_STARTED', runId };
    yield { type: 'TEXT_MESSAGE_START', messageId };

    // Drift-correcting schedule: each event is due at start + t / rate,
    // measured against one absolute start time rather than chained intervals.
    const start = performance.now();
    for (let seq = 0; seq < rec.deltas.length; seq++) {
      if (signal.aborted) return;
      const { delta, t } = rec.deltas[seq];
      // Tokens recorded with a zero gap arrived in the same network chunk, so
      // they stay in the same task. Every other token starts a new task, even
      // when it's already overdue: a slow consumer can fall behind, but it
      // can't turn the rest of the stream into one endless task.
      const sameChunk = seq > 0 && t === rec.deltas[seq - 1].t;
      if (!sameChunk) await nextTask(start + t / rate - performance.now(), signal);
      if (signal.aborted) return;
      yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta, seq, t };
    }

    yield { type: 'TEXT_MESSAGE_END', messageId };
    yield { type: 'RUN_FINISHED', runId };
  }
}
