import { useEffect, useSyncExternalStore } from 'react';
import { AssistantMessage, useRenderCount } from '../chat/AssistantMessage';
import type { MessageBus } from './types';
import type { MessageSnapshot, MessageStore } from './messageStore';
import type { Strategy } from './types';

const EMPTY: MessageSnapshot = { text: '', seq: -1 };

/**
 * An external store that coalesces: appends go into a buffer, and the store
 * publishes (and notifies React) at most once per animation frame, at the
 * start of the frame, so a render gets the whole frame budget.
 *
 * It also listens to backpressure: after each publish it measures how long
 * React took. A render that fits the frame budget keeps the every-frame pace;
 * one that doesn't (a long answer is expensive to re-parse) makes the store
 * skip frames, so the main thread is never fully booked and the frames in
 * between paint on time.
 *
 * In a hidden tab requestAnimationFrame pauses, so it falls back to a timer.
 */
const FRAME_BUDGET_MS = 12;

function createFrameStore(): MessageStore {
  let snapshot = EMPTY;
  let pendingText = '';
  let pendingSeq = -1;
  let scheduled = false;
  let frame = 0;
  let timer = 0;
  let notBefore = 0; // earliest next publish, set by the last render's cost
  const listeners = new Set<() => void>();

  const schedule = () => {
    if (document.hidden) timer = window.setTimeout(flush, 100);
    else frame = requestAnimationFrame(flush);
  };

  const flush = () => {
    const start = performance.now();
    if (start < notBefore) return schedule(); // still cooling down: wait a frame
    scheduled = false;
    if (!pendingText) return;
    snapshot = { text: snapshot.text + pendingText, seq: pendingSeq };
    pendingText = '';
    listeners.forEach((l) => l());
    // React renders the store update in a microtask queued by the notify
    // above; this one runs after it, so the difference is the render's cost.
    queueMicrotask(() => {
      const cost = performance.now() - start;
      notBefore = cost > FRAME_BUDGET_MS ? start + cost * 3 : 0;
    });
  };

  return {
    append(delta, seq) {
      pendingText += delta;
      pendingSeq = seq;
      if (scheduled) return;
      scheduled = true;
      schedule();
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

const stores = new WeakMap<MessageBus, Map<string, MessageStore>>();

function storeFor(bus: MessageBus, messageId: string): MessageStore {
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

function Message({ bus, messageId }: { bus: MessageBus; messageId: string }) {
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
  label: 'syncStore + rAF batching',
  note: 'External store that publishes at most once per frame, at the frame start, and skips frames when a render is too slow.',
  Message,
};
