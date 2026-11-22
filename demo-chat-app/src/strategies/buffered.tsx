import { useEffect, useState } from 'react';
import { AssistantMessage, useRenderCount } from '../chat/AssistantMessage';
import type { Strategy, MessageBus } from './types';

/** How often the buffer is flushed into React state. */
export const FLUSH_MS = 50;

/**
 * setState with a manual buffer: tokens collect in a plain variable and a
 * timer flushes them into state every 50 ms. Far fewer renders than plain
 * setState, but the timer knows nothing about frames: flushes drift against
 * the display's refresh and can land mid-frame.
 */
function Message({ bus, messageId }: { bus: MessageBus; messageId: string }) {
  useRenderCount();
  const [msg, setMsg] = useState({ text: '', seq: -1 });

  useEffect(() => {
    let pending = '';
    let lastSeq = -1;

    const flush = () => {
      if (!pending) return;
      const delta = pending;
      pending = '';
      setMsg((m) => ({ text: m.text + delta, seq: lastSeq }));
    };

    const off = bus.on(messageId, (e) => {
      if (e.type === 'TEXT_MESSAGE_CONTENT') {
        pending += e.delta;
        lastSeq = e.seq;
      } else if (e.type === 'TEXT_MESSAGE_END') {
        flush();
      }
    });
    const timer = window.setInterval(flush, FLUSH_MS);

    return () => {
      off();
      clearInterval(timer);
    };
  }, [bus, messageId]);

  return <AssistantMessage text={msg.text} seq={msg.seq} />;
}

export const bufferedStrategy: Strategy = {
  id: 'buffered',
  label: 'setState + 50ms buffer',
  note: 'Tokens buffered, flushed into state every 50 ms. Fewer renders, but not aligned to frames.',
  Message,
};
