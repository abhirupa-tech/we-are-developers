import { memo, Profiler, type FC } from 'react';
import { slowCommit } from '../debug/cpuThrottle';
import { useRenderFlash } from '../debug/renderFlash';
import type { RunCollector } from '../metrics/collector';
import type { EventBus } from '../stream/EventBus';
import type { MessageBus, Strategy } from '../strategies/types';
import { PaneContext } from './AssistantMessage';

export type PaneStatus = 'idle' | 'streaming' | 'stalled' | 'done' | 'stopped' | 'error';

/**
 * Each strategy's Message, memoized once. The pane re-renders for status
 * changes (message id arriving, stall, run end); without memo those would
 * re-render the strategy and inflate its render count. Only the stream should.
 */
const memoized = new Map<Strategy['id'], FC<{ bus: MessageBus; messageId: string }>>();
function messageFor(strategy: Strategy) {
  let m = memoized.get(strategy.id);
  if (!m) memoized.set(strategy.id, (m = memo(strategy.Message)));
  return m;
}

/**
 * One chat transcript. The strategy's Message is wrapped in a Profiler so
 * commits and render durations are counted per pane. The transcript is a log
 * with aria-live off: screen readers get one announcement at the end, not a
 * flood of tokens.
 */
export function Pane({
  strategy,
  prompt,
  bus,
  messageId,
  collector,
  status,
  error,
  onRetry,
  onFallback,
  emptyHint = 'recorded',
  compact,
}: {
  strategy: Strategy;
  prompt: string | null;
  bus: EventBus | null;
  messageId: string | null;
  collector: RunCollector | null;
  status: PaneStatus;
  error?: string | null;
  onRetry?: () => void;
  /** Offered when a Gemini run fails (quota, network): switch to the recordings. */
  onFallback?: () => void;
  emptyHint?: 'gemini' | 'recorded';
  compact?: boolean;
}) {
  const Message = messageFor(strategy);
  const ref = useRenderFlash<HTMLElement>('Pane');

  return (
    <section
      ref={ref}
      className={`pane ${compact ? 'pane-compact' : ''}`}
      data-strategy={strategy.id}
      data-status={status}
      aria-label={`${strategy.label} transcript`}
    >
      {compact && (
        <header className="pane-head">
          <code>{strategy.label}</code>
          <span className="pane-readout" data-pane-readout={collector?.paneId ?? ''}>
            <span data-m="renders">0</span> renders · <span data-m="behind">0</span> behind ·{' '}
            p95 <span data-m="p95">–</span>
          </span>
        </header>
      )}
      <div className="transcript" role="log" aria-live="off" aria-busy={status === 'streaming'}>
        {!prompt && (
          <p className="empty">
            {emptyHint === 'gemini' ? (
              <>
                Ask Gemini a question below. Its answer streams through <code>{strategy.label}</code>.
              </>
            ) : (
              <>
                Pick a recording and press <kbd>Start run</kbd>. The same stream replays through <code>{strategy.label}</code>.
              </>
            )}
          </p>
        )}
        {prompt && (
          <div className="msg msg-user">
            <div className="msg-who">You</div>
            <p>{prompt}</p>
          </div>
        )}
        {bus && messageId && collector && (
          <PaneContext.Provider value={collector}>
            <Profiler id={collector.paneId} onRender={(_id, _phase, actualDuration) => collector.onCommit(slowCommit(actualDuration))}>
              <Message bus={bus} messageId={messageId} />
            </Profiler>
          </PaneContext.Provider>
        )}
        {status === 'stalled' && <p className="notice">Waiting for the stream…</p>}
        {status === 'error' && (
          <p className="notice notice-error">
            The stream failed{error ? `: ${error}` : ''}.{' '}
            {onRetry && (
              <button type="button" className="link" onClick={onRetry}>
                Retry run
              </button>
            )}
            {onFallback && (
              <>
                {' · '}
                <button type="button" className="link" onClick={onFallback}>
                  Use pre-recorded responses
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
