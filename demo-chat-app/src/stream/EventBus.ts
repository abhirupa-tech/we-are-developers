import type { PublishedEvent } from './ReplaySource';

type Listener = (event: PublishedEvent) => void;

/** Key for events that belong to the run rather than a single message. */
export const RUN_CHANNEL = '*';

/**
 * A tiny synchronous pub/sub with no React dependency. Events are delivered
 * one by one, in order, in the same task they were published in: the bus
 * never merges or defers anything, so whether React batches is up to React.
 */
export class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  private history = new Map<string, PublishedEvent[]>();

  /**
   * Subscribe to a message's events (or RUN_CHANNEL). Returns an unsubscribe.
   * A message subscriber first receives, synchronously and in order, any
   * events that message already had: strategies subscribe in an effect after
   * their first render, and tokens may have arrived in the same task as
   * TEXT_MESSAGE_START. Every strategy gets the same treatment.
   */
  on(channel: string, listener: Listener): () => void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener);
    if (channel !== RUN_CHANNEL) this.history.get(channel)?.forEach((e) => listener(e));
    return () => {
      set.delete(listener);
    };
  }

  publish(event: PublishedEvent): void {
    const channel = 'messageId' in event ? event.messageId : RUN_CHANNEL;
    if (channel !== RUN_CHANNEL) {
      let past = this.history.get(channel);
      if (!past) this.history.set(channel, (past = []));
      past.push(event);
    }
    this.listeners.get(channel)?.forEach((listener) => listener(event));
    if (channel !== RUN_CHANNEL) {
      // Run-level observers (the collector, the transcript) see everything.
      this.listeners.get(RUN_CHANNEL)?.forEach((listener) => listener(event));
    }
  }

  clear(): void {
    this.listeners.clear();
    this.history.clear();
  }
}
