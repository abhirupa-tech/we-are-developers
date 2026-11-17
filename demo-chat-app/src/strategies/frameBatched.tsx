import { useEffect, useSyncExternalStore } from 'react';
import { AssistantMessage, useRenderCount } from '../chat/AssistantMessage';
import type { EventBus } from '../stream/EventBus';
import type { MessageSnapshot, MessageStore } from './messageStore';
import type { Strategy } from './types';

const EMPTY: MessageSnapshot = { text: '', seq: -1 };

/**
 * An external store that coalesces: appends go into a buffer, and the store
 * publishes (and notifies React) at most once per animation frame. However
 * many tokens arrive between two frames, React renders once for all of them.
 *
 * This is the one strategy that changes how much work there is, not just
 * when it happens: renders are capped at the display's refresh rate, so a
 * fast stream can't render more often than the screen can show.
 *
 * In a hidden tab requestAnimationFrame pauses, so it falls back to a timer
 * and the text still arrives.
 */
function createFrameStore(): MessageStore {
  let snapshot = EMPTY;
  let pendingText = '';
  let pendingSeq = -1;
  let scheduled = false;
  let frame = 0;
  let timer = 0;
  const listeners = new Set<() => void>();

  const flush = () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    scheduled = false;
    if (!pendingText) return;
    snapshot = { text: snapshot.text + pendingText, seq: pendingSeq };
    pendingText = '';
    listeners.forEach((l) => l());
  };

  return {
    append(delta, seq) {
      pendingText += delta;
      pendingSeq = seq;
      if (scheduled) return;
      scheduled = true;
      if (document.hidden) timer = window.setTimeout(flush, 100);
      else frame = requestAnimationFrame(flush);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY,
    detach: () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    },
  };
}

const stores = new WeakMap<EventBus, Map<string, MessageStore>>();

function storeFor(bus: EventBus, messageId: string): MessageStore {
  const byId = stores.get(bus) ?? new Map<string, MessageStore>();
  stores.set(bus, byId);
  let store = byId.get(messageId);
  if (!store) {
    const s = (store = createFrameStore());
    const off = bus.on(messageId, (e) => e.type === 'TEXT_MESSAGE_CONTENT' && s.append(e.delta, e.seq));
    const stopFrames = s.detach;
    s.detach = () => {
      off();
      stopFrames?.();
    };
    byId.set(messageId, s);
  }
  return store;
}

function Message({ bus, messageId }: { bus: EventBus; messageId: string }) {
  useRenderCount();
  const store = storeFor(bus, messageId);
  useEffect(
    () => () => {
      store.detach?.();
      stores.get(bus)?.delete(messageId);
    },
    [bus, messageId, store],
  );
  const msg = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  return <AssistantMessage text={msg.text} seq={msg.seq} />;
}

export const frameBatchedStrategy: Strategy = {
  id: 'frameBatched',
  label: 'syncStore + rAF',
  note: 'External store that publishes once per animation frame: renders are capped at the refresh rate, however fast tokens arrive.',
  Message,
};
