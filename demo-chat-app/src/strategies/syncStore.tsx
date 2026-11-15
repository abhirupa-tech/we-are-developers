import { useEffect, useSyncExternalStore } from 'react';
import { AssistantMessage, useRenderCount } from '../chat/AssistantMessage';
import type { EventBus } from '../stream/EventBus';
import { createMessageStore, type MessageStore } from './messageStore';
import type { Strategy } from './types';

/**
 * Writes happen outside React, into a plain store; React reads snapshots.
 * getSnapshot returns a stable object between changes, so React won't loop.
 * External store updates are always synchronous: they can't be transitions.
 */
const stores = new WeakMap<EventBus, Map<string, MessageStore>>();

function storeFor(bus: EventBus, messageId: string): MessageStore {
  const byId = stores.get(bus) ?? new Map<string, MessageStore>();
  stores.set(bus, byId);
  let store = byId.get(messageId);
  if (!store) {
    const s = (store = createMessageStore());
    s.detach = bus.on(messageId, (e) => e.type === 'TEXT_MESSAGE_CONTENT' && s.append(e.delta, e.seq));
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

export const syncStoreStrategy: Strategy = {
  id: 'syncStore',
  label: 'useSyncExternalStore',
  note: 'Writes outside React, synchronous reads. Can’t be a transition.',
  Message,
};
