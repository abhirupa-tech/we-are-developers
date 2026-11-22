import { memo, Profiler, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FC } from 'react';
import { useRenderFlash } from '../debug/renderFlash';
import type { RunCollector } from '../metrics/collector';
import type { EventBus } from '../stream/EventBus';
import type { MessageBus, Strategy } from '../strategies/types';
import { createHoldGate } from './holdGate';
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

  // Follow the stream while the reader is at the bottom. A sentinel after the
  // last message tells us (IntersectionObserver): visible means pinned, so
  // every commit scrolls to the bottom; scrolled away means held, so the
  // gate queues tokens and nothing renders until the reader comes back.
  const transcriptRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [held, setHeld] = useState(false);
  const gate = useMemo(() => (bus ? createHoldGate(bus) : null), [bus]);

  const follow = useCallback(() => {
    const t = transcriptRef.current;
    if (pinned.current && t) t.scrollTop = t.scrollHeight;
  }, []);

  useEffect(() => {
    const root = transcriptRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        pinned.current = entry.isIntersecting;
        if (entry.isIntersecting) gate?.release();
        else gate?.hold();
        setHeld(!entry.isIntersecting);
      },
      { root, rootMargin: '0px 0px 40px 0px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [gate]);

  // Leave the bottom the moment the reader scrolls up, before the next
  // commit can pull them back down (the observer only reports a frame later).
  useEffect(() => {
    const t = transcriptRef.current;
    if (!t) return;
    let lastTop = t.scrollTop;
    const leave = () => {
      if (!pinned.current) return;
      pinned.current = false;
      gate?.hold();
      setHeld(true);
    };
    const onWheel = (e: WheelEvent) => e.deltaY < 0 && leave();
    const onKey = (e: KeyboardEvent) => ['ArrowUp', 'PageUp', 'Home'].includes(e.key) && leave();
    const onScroll = () => {
      if (t.scrollTop < lastTop - 2) leave(); // scrollbar drag, touch
      lastTop = t.scrollTop;
    };
    t.addEventListener('wheel', onWheel, { passive: true });
    t.addEventListener('touchmove', leave, { passive: true });
    t.addEventListener('keydown', onKey);
    t.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      t.removeEventListener('wheel', onWheel);
      t.removeEventListener('touchmove', leave);
      t.removeEventListener('keydown', onKey);
      t.removeEventListener('scroll', onScroll);
    };
  }, [gate]);

  // Pane-level changes (notices, status) also grow the transcript.
  useLayoutEffect(follow);

  const jumpToLatest = () => {
    const t = transcriptRef.current;
    if (t) t.scrollTop = t.scrollHeight;
  };
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
      <div ref={transcriptRef} className="transcript" role="log" aria-live="off" aria-busy={status === 'streaming'}>
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
            <Profiler
              id={collector.paneId}
              onRender={(_id, _phase, actualDuration) => {
                collector.onCommit(actualDuration);
                follow();
              }}
            >
              <Message bus={gate!.bus} messageId={messageId} />
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
        <div ref={sentinelRef} className="transcript-end" aria-hidden="true" />
      </div>
      {held && status === 'streaming' && (
        <button type="button" className="jump-latest" onClick={jumpToLatest}>
          Rendering paused · Jump to latest ↓
        </button>
      )}
    </section>
  );
}
