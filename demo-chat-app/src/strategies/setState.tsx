import { useEffect, useState } from 'react';
import { AssistantMessage, useRenderCount } from '../chat/AssistantMessage';
import type { MessageBus } from './types';
import type { Strategy } from './types';

/**
 * Baseline: append each delta with setState.
 * Automatic batching only merges updates inside one task. Separate network
 * chunks are separate tasks, so each becomes its own render.
 */
function Message({ bus, messageId }: { bus: MessageBus; messageId: string }) {
  useRenderCount();
  const [msg, setMsg] = useState({ text: '', seq: -1 });

  useEffect(
    () =>
      bus.on(messageId, (e) => {
        if (e.type === 'TEXT_MESSAGE_CONTENT') {
          setMsg((m) => ({ text: m.text + e.delta, seq: e.seq }));
        }
      }),
    [bus, messageId],
  );

  return <AssistantMessage text={msg.text} seq={msg.seq} />;
}

export const setStateStrategy: Strategy = {
  id: 'setState',
  label: 'setState',
  note: 'One render per network task. Batching only merges updates inside one task.',
  Message,
};
