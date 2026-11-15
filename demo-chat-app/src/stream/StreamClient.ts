import type { EventBus } from './EventBus';
import type { PublishedEvent, ReplaySource, StreamEvent } from './ReplaySource';
import { nextTask } from './schedule';

export type RunOutcome = 'finished' | 'aborted' | 'error';

export type RunHooks = {
  /** Called synchronously for every event, before it reaches the bus. */
  onEvent?: (event: PublishedEvent) => void;
  /** Called when no event has arrived for `stallMs` (and again when it resumes). */
  onStall?: (stalled: boolean) => void;
  onError?: (message: string) => void;
};

const STALL_MS = 3000;

/**
 * Consumes a ReplaySource and publishes to the EventBus, following the
 * spec's fairness rules:
 * - every event is published on its own, in order, in the task it arrived in;
 * - each is stamped `arrivedAt = performance.now()` before any React work;
 * - if the source doesn't pace, delivery is scheduled from recorded `t / rate`
 *   against one absolute start time (drift-correcting, not setInterval);
 * - an AbortSignal cancels the run (Stop, strategy switch, new run).
 */
export async function runStream(
  source: ReplaySource,
  bus: EventBus,
  opts: { recordingId: string; rate: number; seed?: number; signal: AbortSignal },
  hooks: RunHooks = {},
): Promise<RunOutcome> {
  const { signal, rate } = opts;
  let lastArrival = performance.now();
  let stalled = false;
  const stallTimer = setInterval(() => {
    const quiet = performance.now() - lastArrival > STALL_MS;
    if (quiet !== stalled) {
      stalled = quiet;
      hooks.onStall?.(quiet);
    }
  }, 250);

  const publish = (event: StreamEvent) => {
    const stamped = { ...event, arrivedAt: performance.now() } as PublishedEvent;
    lastArrival = stamped.arrivedAt;
    if (stalled) {
      stalled = false;
      hooks.onStall?.(false);
    }
    hooks.onEvent?.(stamped);
    bus.publish(stamped);
  };

  try {
    // Start in a fresh task, outside whatever click or keypress started the
    // run, so no strategy inherits that event's urgent update priority.
    await nextTask(0, signal);
    const start = performance.now();
    let lastT = -1;
    for await (const event of source.start(opts)) {
      if (signal.aborted) return 'aborted';
      if (!source.paced && event.type === 'TEXT_MESSAGE_CONTENT' && event.t != null) {
        // Same recorded time = same chunk = same task; otherwise a new task.
        if (event.t !== lastT) await nextTask(start + event.t / rate - performance.now(), signal);
        lastT = event.t;
        if (signal.aborted) return 'aborted';
      }
      if (event.type === 'RUN_ERROR') {
        hooks.onError?.(event.message);
        publish(event);
        return 'error';
      }
      publish(event);
    }
    return signal.aborted ? 'aborted' : 'finished';
  } catch (err) {
    if (signal.aborted) return 'aborted';
    const message = err instanceof Error ? err.message : String(err);
    hooks.onError?.(message);
    return 'error';
  } finally {
    clearInterval(stallTimer);
  }
}
