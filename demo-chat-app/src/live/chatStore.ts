import type { PublishedEvent } from '../stream/ReplaySource';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Index of the last stream chunk in `text`. -1 for user messages. */
  seq: number;
};

/**
 * The conversation, kept outside React. Components read it with
 * useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot).
 *
 * The one rule that makes it work: never mutate. Every write builds a new
 * array, and only the message that changed gets a new object. So
 * - getSnapshot returns the same reference until something changes
 *   (otherwise React would re-render forever), and
 * - finished messages keep their identity, so memo() can skip them.
 */
let messages: ChatMessage[] = [];
const listeners = new Set<() => void>();

function write(next: ChatMessage[]) {
  messages = next;
  listeners.forEach((listener) => listener());
}

export const chatStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot: () => messages,

  addUserMessage(text: string) {
    write([...messages, { id: `user-${messages.length}`, role: 'user', text, seq: -1 }]);
  },

  /** Fed straight from the stream: no React involved in the write path. */
  onStreamEvent(event: PublishedEvent) {
    if (event.type === 'TEXT_MESSAGE_START') {
      write([...messages, { id: event.messageId, role: 'assistant', text: '', seq: -1 }]);
    }
    if (event.type === 'TEXT_MESSAGE_CONTENT') {
      write(messages.map((m) => (m.id === event.messageId ? { ...m, text: m.text + event.delta, seq: event.seq } : m)));
    }
  },

  clear() {
    write([]);
  },
};
