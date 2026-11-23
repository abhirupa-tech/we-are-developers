import {
  memo,
  Profiler,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
  type UIEvent,
} from 'react';
import { decodeAction, encodeAction } from '../a2ui/parse';
import { renderA2ui } from '../a2ui/renderA2ui';
import { A2uiContext } from '../a2ui/Surface';
import type { A2Action } from '../a2ui/types';
import { AssistantMessage, PaneContext, useRenderCount } from '../chat/AssistantMessage';
import type { PaneStatus } from '../chat/Pane';
import { GEMINI } from '../config';
import { slowCommit } from '../debug/cpuThrottle';
import { useRenderFlash } from '../debug/renderFlash';
import type { RunCollector } from '../metrics/collector';
import type { RecordingMeta } from '../stream/ReplaySource';
import { ModelPicker } from './ModelPicker';
import { chatStore, type ChatMessage } from './chatStore';

export type LiveKind = 'chat' | 'a2ui';

const SUGGESTIONS: Record<LiveKind, { title: string; prompt: string }[]> = {
  chat: [
    { title: 'Explain a concept', prompt: 'Explain useSyncExternalStore to someone who knows useState.' },
    { title: 'Write some code', prompt: 'Write a typed debounce hook for React, with a short usage example.' },
    { title: 'Compare options', prompt: 'Compare REST, GraphQL and tRPC in a table.' },
    { title: 'Brainstorm', prompt: 'Give me five small weekend project ideas for learning React 19.' },
  ],
  a2ui: [
    { title: 'Order a pizza', prompt: 'I want to order a pizza. Help me pick size, crust and toppings.' },
    { title: 'Plan a trip', prompt: 'Help me plan a 5-day trip to Japan: budget, interests and pace.' },
    { title: 'Quiz me', prompt: 'Give me a 3-question multiple choice quiz on React hooks.' },
    { title: 'Workout plan', prompt: 'Build me a weekly workout plan. Ask about my goals and schedule first.' },
  ],
};

function Avatar() {
  return (
    <div
      className="grid size-8 shrink-0 place-items-center rounded-full bg-[conic-gradient(from_200deg,var(--s-store),var(--s-transition),var(--s-store))] text-[15px] text-bg shadow-[0_0_18px_rgb(43_228_255/0.25)]"
      aria-hidden="true"
    >
      ◐
    </div>
  );
}

/**
 * One message. memo() + the store's "only the changed message gets a new
 * object" rule means a finished bubble never re-renders while a later answer
 * streams in. Only the live answer reports its `seq` to the profiler.
 */
const Bubble = memo(function Bubble({ message, live, kind }: { message: ChatMessage; live: boolean; kind: LiveKind }) {
  const ref = useRenderFlash<HTMLDivElement>(message.role === 'user' ? 'UserMessage' : 'Bubble');
  const [copied, setCopied] = useState(false);

  if (message.role === 'user') {
    const action = decodeAction(message.text);
    return (
      <div ref={ref} className="flex justify-end">
        {action ? (
          <div className="max-w-[85%] rounded-2xl rounded-br-md border border-solid border-store/30 bg-store/10 px-4 py-2.5 text-[14px]">
            <div className="flex items-center gap-2 font-semibold text-store">
              <span aria-hidden="true">⚡</span> {action.action}
            </div>
            {Object.keys(action.data ?? {}).length > 0 && (
              <dl className="m-0 mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                {Object.entries(action.data).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="m-0 break-words font-mono text-[12px]">{typeof v === 'string' ? v || '—' : JSON.stringify(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ) : (
          <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-panel-2 px-4 py-2.5 text-[16px] leading-relaxed">
            {message.text}
          </div>
        )}
      </div>
    );
  }

  return (
    // No flash ref here: AssistantMessage flashes for the same commits.
    <div className="group flex gap-3.5" data-live={live || undefined}>
      <Avatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <AssistantMessage text={message.text} seq={live ? message.seq : -1} render={kind === 'a2ui' ? renderA2ui : undefined} />
        {!live && message.text && (
          <div className="mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              type="button"
              className="rounded-md border-0 bg-transparent px-2 py-1 text-[12px] text-muted hover:bg-panel-2 hover:text-text"
              onClick={() => {
                void navigator.clipboard?.writeText(message.text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * The demo: this component holds no state of its own. It subscribes to
 * chatStore and re-renders once per store write. useRenderCount() reports
 * each of those renders to the profiler, same as the other strategies.
 */
const Conversation = memo(function Conversation({
  liveMessageId,
  kind,
  stick,
}: {
  liveMessageId: string | null;
  kind: LiveKind;
  stick: RefObject<boolean>;
}) {
  useRenderCount();
  const messages = useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot);
  const ref = useRenderFlash<HTMLDivElement>('Conversation');

  // Follow the newest text, unless the reader has scrolled up to read.
  const count = useRef(0);
  useLayoutEffect(() => {
    const log = ref.current?.closest('[role="log"]');
    if (!log) return;
    const grew = messages.length !== count.current;
    count.current = messages.length;
    if (grew || stick.current) log.scrollTop = log.scrollHeight;
  }, [messages, stick]);

  return (
    <div ref={ref} className="live-messages flex flex-col gap-7">
      {messages.map((m) => (
        <Bubble key={m.id} message={m} live={m.id === liveMessageId} kind={kind} />
      ))}
    </div>
  );
});

/** The input. Its text is its own state, so typing re-renders nothing else. */
function Composer({
  running,
  disabled,
  kind,
  onSend,
  onStop,
}: {
  running: boolean;
  disabled: boolean;
  kind: LiveKind;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [text, setText] = useState('');
  const ref = useRenderFlash<HTMLFormElement>('Composer');
  const input = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to a limit.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (!disabled) input.current?.focus();
  }, [disabled, kind]);

  const send = () => {
    const q = text.trim();
    if (!q || running || disabled) return;
    onSend(q);
    setText('');
  };

  return (
    <form
      ref={ref}
      className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-3xl border border-solid border-line bg-panel py-2 pr-2 pl-5 shadow-[0_10px_40px_rgb(0_0_0/0.35)] transition-colors focus-within:border-store/60"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <textarea
        ref={input}
        rows={1}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={disabled ? 'Add an API key to start chatting' : kind === 'a2ui' ? 'Ask for something interactive…' : 'Message Gemini…'}
        aria-label="Your message"
        className="max-h-[200px] flex-1 resize-none self-center border-0 bg-transparent py-2 font-[inherit] text-[16px] leading-6 text-text outline-none placeholder:text-muted focus-visible:outline-none disabled:cursor-not-allowed"
      />
      {running ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop generating"
          className="grid size-10 shrink-0 place-items-center rounded-full border border-solid border-line bg-panel-2 text-text transition hover:border-muted"
        >
          <span className="block size-3 rounded-[3px] bg-current" />
        </button>
      ) : (
        <button
          type="submit"
          disabled={!text.trim() || disabled}
          aria-label="Send message"
          className="grid size-10 shrink-0 place-items-center rounded-full border-0 bg-store text-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-panel-2 disabled:text-muted"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </form>
  );
}

/** The fallback: replay a recording into the conversation instead of asking Gemini. */
function ReplayBar({
  kind,
  recordings,
  running,
  rate,
  rates,
  onRate,
  onReplay,
  onStop,
}: {
  kind: LiveKind;
  recordings: RecordingMeta[];
  running: boolean;
  rate: number;
  rates: number[];
  onRate: (rate: number) => void;
  onReplay: (id: string) => void;
  onStop: () => void;
}) {
  const preferred = kind === 'a2ui' ? 'heavy-a2ui' : 'heavy-markdown';
  const [id, setId] = useState(preferred);
  const ref = useRenderFlash<HTMLDivElement>('ReplayBar');
  const selected = recordings.some((r) => r.id === id) ? id : (recordings[0]?.id ?? '');
  const control =
    'h-11 rounded-2xl border border-solid border-line bg-panel px-3 text-[15px] text-text outline-none focus:border-store/60 disabled:opacity-60';
  return (
    <div ref={ref} className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2">
      <select className={`${control} min-w-0 flex-1`} value={selected} disabled={running} onChange={(e) => setId(e.target.value)} aria-label="Recording">
        {recordings.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title} · {r.tokenCount.toLocaleString()} tokens
          </option>
        ))}
      </select>
      <select className={control} value={rate} disabled={running} onChange={(e) => onRate(Number(e.target.value))} aria-label="Replay speed">
        {rates.map((r) => (
          <option key={r} value={r}>
            {r}× speed
          </option>
        ))}
      </select>
      {running ? (
        <button type="button" onClick={onStop} className="h-11 rounded-2xl border border-solid border-line bg-panel-2 px-5 text-[15px] font-semibold text-text">
          Stop
        </button>
      ) : (
        <button
          type="button"
          disabled={!selected}
          onClick={() => onReplay(selected)}
          className="h-11 rounded-2xl border-0 bg-store px-5 text-[15px] font-semibold text-bg transition hover:brightness-110 disabled:opacity-50"
        >
          ▶ Play
        </button>
      )}
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-3.5" aria-label="Gemini is thinking">
      <Avatar />
      <div className="flex gap-1.5 rounded-2xl bg-panel px-4 py-3">
        <span className="live-dot" />
        <span className="live-dot [animation-delay:150ms]" />
        <span className="live-dot [animation-delay:300ms]" />
      </div>
    </div>
  );
}

/**
 * A real chat with Gemini, rendered from an external store. The Profiler and
 * PaneContext are the same hooks the replay panes use, so renders, commits,
 * tokens behind and time to paint all show up in the HUD and the scorecard.
 *
 * In A2UI mode the same pipeline runs with a system prompt that lets Gemini
 * answer with interactive surfaces (src/a2ui), and button presses go back to
 * it as action messages.
 */
export function LivePane({
  kind,
  collector,
  messageId,
  status,
  error,
  onSend,
  onStop,
  onNewChat,
  recordings,
  rate,
  rates,
  onRate,
  onReplay,
}: {
  kind: LiveKind;
  recordings: RecordingMeta[];
  rate: number;
  rates: number[];
  onRate: (rate: number) => void;
  onReplay: (id: string) => void;
  collector: RunCollector | null;
  messageId: string | null;
  status: PaneStatus;
  error?: string | null;
  onSend: (text: string) => void;
  onStop: () => void;
  onNewChat: () => void;
}) {
  const ref = useRenderFlash<HTMLElement>('LivePane');
  const running = status === 'streaming' || status === 'stalled';
  const hasKey = !!GEMINI.apiKey;
  const [feed, setFeed] = useState<'gemini' | 'recorded'>(hasKey ? 'gemini' : 'recorded');
  const showReplay = feed === 'recorded' || !hasKey;

  // Stick to the bottom unless the reader scrolls up.
  const stick = useRef(true);
  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  // Surfaces get a stable callback, so a new run doesn't re-render them.
  const sendRef = useRef(onSend);
  sendRef.current = onSend;
  const onAction = useCallback((a: A2Action) => sendRef.current(encodeAction(a)), []);
  const a2ui = useMemo(() => ({ onAction, busy: running }), [onAction, running]);

  return (
    <section
      ref={ref}
      className="live-pane flex min-h-0 flex-col [--pane-color:var(--s-store)]"
      data-status={status}
      data-kind={kind}
      aria-label={kind === 'a2ui' ? 'A2UI chat with Gemini' : 'Live Gemini chat'}
    >
      <header className="flex items-center gap-3 border-0 border-b border-solid border-line px-5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold">{kind === 'a2ui' ? 'A2UI' : 'Chat'}</span>
          <ModelPicker disabled={running} />
        </div>
        <span className="hidden text-[12px] text-muted sm:inline">
          via <code className="text-store">useSyncExternalStore</code>
        </span>
        <button
          type="button"
          onClick={onNewChat}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-full border border-solid border-line bg-transparent px-3 text-[13px] text-muted transition hover:border-muted hover:text-text"
        >
          <span aria-hidden="true">＋</span> New chat
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 pt-8 pb-6" role="log" aria-live="off" aria-busy={running} onScroll={onScroll}>
        <div className="mx-auto max-w-3xl">
          {status === 'idle' && (
            <div className="flex flex-col items-center pt-[8vh] text-center">
              <div className="mb-5 scale-150">
                <Avatar />
              </div>
              <h2 className="m-0 text-[28px] font-semibold tracking-tight">{kind === 'a2ui' ? 'Ask for an interface' : 'What’s on your mind?'}</h2>
              <p className="mt-2 mb-8 max-w-md text-[15px] text-muted">
                {!hasKey ? (
                  <>
                    No API key yet. Put <code>VITE_GEMINI_API_KEY=…</code> in <code>.env.local</code> and restart the dev server.
                  </>
                ) : kind === 'a2ui' ? (
                  'Gemini can answer with cards, forms, choices and sliders. Press a button and your answer goes back to it.'
                ) : (
                  'The conversation lives in a plain store outside React. Turn on Flash renders to watch what updates.'
                )}
              </p>
              {hasKey && (
                <div className="grid w-full max-w-xl grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {SUGGESTIONS[kind].map((s) => (
                    <button
                      key={s.title}
                      type="button"
                      onClick={() => onSend(s.prompt)}
                      className="rounded-2xl border border-solid border-line bg-panel/60 px-4 py-3 text-left transition hover:border-store/50 hover:bg-panel"
                    >
                      <div className="text-[14px] font-semibold">{s.title}</div>
                      <div className="mt-0.5 line-clamp-2 text-[13px] text-muted">{s.prompt}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <A2uiContext.Provider value={a2ui}>
            <PaneContext.Provider value={collector}>
              <Profiler id="live-pane" onRender={(_id, _phase, actualDuration) => collector?.onCommit(slowCommit(actualDuration))}>
                <Conversation liveMessageId={messageId} kind={kind} stick={stick} />
              </Profiler>
            </PaneContext.Provider>
          </A2uiContext.Provider>

          {running && !messageId && (
            <div className="mt-7">
              <Thinking />
            </div>
          )}
          {status === 'stalled' && messageId && <p className="mt-4 text-[13px] text-muted">Waiting for Gemini…</p>}
          {status === 'error' && (
            <div className="mt-6 rounded-xl border border-solid border-danger/40 bg-danger/10 px-4 py-3 text-[14px] text-danger">
              Something went wrong{error ? `: ${error.replace(/\.$/, '')}` : ''}.
              {feed === 'gemini' && (
                <>
                  {' '}
                  <button type="button" className="link" onClick={() => setFeed('recorded')}>
                    Use pre-recorded responses
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pt-1 pb-4">
        <div className="mx-auto mb-2 flex w-full max-w-3xl">
          <div className="feed-tabs" role="tablist" aria-label="Answer source">
            <button type="button" role="tab" aria-selected={!showReplay} className={!showReplay ? 'on' : ''} disabled={running || !hasKey} onClick={() => setFeed('gemini')}>
              Ask Gemini
            </button>
            <button type="button" role="tab" aria-selected={showReplay} className={showReplay ? 'on' : ''} disabled={running} onClick={() => setFeed('recorded')}>
              Pre-recorded
            </button>
          </div>
        </div>
        {showReplay ? (
          <ReplayBar kind={kind} recordings={recordings} running={running} rate={rate} rates={rates} onRate={onRate} onReplay={onReplay} onStop={onStop} />
        ) : (
          <>
            <Composer running={running} disabled={!hasKey} kind={kind} onSend={onSend} onStop={onStop} />
            <p className="mt-2 mb-0 text-center text-[11px] text-muted">
              <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line
            </p>
          </>
        )}
      </div>
    </section>
  );
}
