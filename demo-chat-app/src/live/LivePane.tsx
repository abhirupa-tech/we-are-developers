import { memo, Profiler, useEffect, useRef, useSyncExternalStore } from 'react';
import { AssistantMessage, PaneContext, useRenderCount } from '../chat/AssistantMessage';
import type { PaneStatus } from '../chat/Pane';
import { GEMINI } from '../config';
import type { RunCollector } from '../metrics/collector';
import { chatStore, type ChatMessage } from './chatStore';

/**
 * One message. memo() + the store's "only the changed message gets a new
 * object" rule means a finished bubble never re-renders while a later answer
 * streams in. Only the live answer reports its `seq` to the profiler.
 */
const Bubble = memo(function Bubble({ message, live }: { message: ChatMessage; live: boolean }) {
  if (message.role === 'user') {
    return (
      <div className="mb-6">
        <div className="mb-1 text-[13px] font-semibold text-muted">You</div>
        <p className="m-0 text-[19px]">{message.text}</p>
      </div>
    );
  }
  return <AssistantMessage text={message.text} seq={live ? message.seq : -1} />;
});

/**
 * The demo: this component holds no state of its own. It subscribes to
 * chatStore and re-renders once per store write. useRenderCount() reports
 * each of those renders to the profiler, same as the other strategies.
 */
const Conversation = memo(function Conversation({ liveMessageId }: { liveMessageId: string | null }) {
  useRenderCount();
  const messages = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot);

  // Keep the newest text in view.
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  return (
    <div className="live-messages">
      {messages.map((m) => (
        <Bubble key={m.id} message={m} live={m.id === liveMessageId} />
      ))}
      <div ref={end} />
    </div>
  );
});

/**
 * A real chat with Gemini, rendered from an external store. The Profiler and
 * PaneContext are the same hooks the replay panes use, so renders, commits,
 * tokens behind and time to paint all show up in the HUD and the scorecard.
 */
export function LivePane({
  collector,
  messageId,
  status,
  error,
}: {
  collector: RunCollector | null;
  messageId: string | null;
  status: PaneStatus;
  error?: string | null;
}) {
  return (
    <section
      className="live-pane flex min-h-0 flex-col [--pane-color:var(--s-store)]"
      data-status={status}
      aria-label="Live Gemini chat"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 border-0 border-b-2 border-solid border-store px-5 py-2">
        <code className="text-store">useSyncExternalStore</code>
        <span className="text-[13px] text-muted">
          chatStore → React · live from <code>{GEMINI.model}</code>
        </span>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pt-7 pb-10 *:mx-auto *:max-w-[70ch]" role="log" aria-live="off" aria-busy={status === 'streaming'}>
        {status === 'idle' && (
          <p className="text-lg text-muted">
            {GEMINI.apiKey ? (
              'Ask Gemini something below. The conversation lives in a plain store outside React.'
            ) : (
              <>
                No API key yet. Put <code>VITE_GEMINI_API_KEY=…</code> in <code>.env.local</code> and restart the dev server.
              </>
            )}
          </p>
        )}

        <PaneContext.Provider value={collector}>
          <Profiler id="live-pane" onRender={(_id, _phase, actualDuration) => collector?.onCommit(actualDuration)}>
            <Conversation liveMessageId={messageId} />
          </Profiler>
        </PaneContext.Provider>

        {status === 'stalled' && <p className="text-[15px] text-muted">Waiting for Gemini…</p>}
        {status === 'error' && <p className="text-[15px] text-[#ff8a80]">The stream failed{error ? `: ${error.replace(/\.$/, '')}` : ''}.</p>}
      </div>
    </section>
  );
}
