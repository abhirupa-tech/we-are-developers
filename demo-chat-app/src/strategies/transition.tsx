import { useEffect, useState, useTransition } from 'react';
import { AssistantMessage, useRenderCount, useReportPending } from '../chat/AssistantMessage';
import type { EventBus } from '../stream/EventBus';
import type { Strategy } from './types';

/**
 * Same appends, wrapped in startTransition. Lower priority keeps urgent input
 * responsive, but it doesn't reduce the work: renders can be started,
 * interrupted and restarted, so render attempts can exceed commits.
 */
function Message({ bus, messageId }: { bus: EventBus; messageId: string }) {
  useRenderCount();
  const [msg, setMsg] = useState({ text: '', seq: -1 });
  const [isPending, startTransition] = useTransition();
  useReportPending(isPending);

  useEffect(
    () =>
      bus.on(messageId, (e) => {
        if (e.type === 'TEXT_MESSAGE_CONTENT') {
          startTransition(() => setMsg((m) => ({ text: m.text + e.delta, seq: e.seq })));
        }
      }),
    [bus, messageId],
  );

  return <AssistantMessage text={msg.text} seq={msg.seq} />;
}

export const transitionStrategy: Strategy = {
  id: 'transition',
  label: 'useTransition',
  note: 'Lower priority, same work. Watch render attempts outrun commits.',
  Message,
};
