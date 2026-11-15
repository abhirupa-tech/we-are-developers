export type MessageSnapshot = { text: string; seq: number };

export type MessageStore = {
  append(delta: string, seq: number): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): MessageSnapshot;
  getServerSnapshot(): MessageSnapshot;
  /** Set by the owner to stop feeding the store from the bus. */
  detach?: () => void;
};

const EMPTY: MessageSnapshot = { text: '', seq: -1 };

/** A minimal external store: a new snapshot object only when text changes. */
export function createMessageStore(): MessageStore {
  let snapshot = EMPTY;
  const listeners = new Set<() => void>();
  return {
    append(delta, seq) {
      snapshot = { text: snapshot.text + delta, seq };
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY,
  };
}
