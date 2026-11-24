import { useEffect, useState } from 'react';
import { AssistantMessage, useRenderCount } from '../chat/AssistantMessage';
import type { MessageBus, Strategy } from './types';

/**
 * setState per network chunk, like the baseline, but the answer is rendered
 * as memoized blocks: finished paragraphs and code fences are frozen with
 * React.memo, so each update only re-parses the block still streaming.
 * Cheaper renders, but just as many of them.
 */
function Message({ bus, messageId }: { bus: MessageBus; messageId: string }) {
  useRenderCount();
  const [msg, setMsg] = useState({ text: '', seq: -1 });

  useEffect(
    () =>
      bus.on(messageId, (e) => {
        if (e.type === 'TEXT_MESSAGE_CONTENT') setMsg((m) => ({ text: m.text + e.delta, seq: e.seq }));
      }),
    [bus, messageId],
  );

  return <AssistantMessage text={msg.text} seq={msg.seq} blocks />;
}

export const memoBlocksStrategy: Strategy = {
  id: 'memo',
  label: 'setState + memo freeze',
  note: 'setState per chunk; finished blocks frozen with React.memo, only the streaming block re-renders.',
  Message,
};
