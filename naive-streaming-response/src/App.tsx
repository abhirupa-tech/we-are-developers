import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { marked } from 'marked';
import { Mascot, type MascotMood } from './Mascot';
import { Meter, type MeterHandle } from './Meter';
import { answerFor } from './stream/answers';
import { openStream, readDeltas, type Source } from './stream/sources';
import { tapeFromText } from './stream/tape';

type Message = { id: number; role: 'user' | 'assistant'; text: string; done: boolean; error?: string };

const SESSIONS: { group: string; items: string[] }[] = [
  { group: 'Today', items: ['Why streaming gets slower', 'Quadratic re-parse, explained'] },
  {
    group: 'Previous 7 days',
    items: ['KV cache in plain words', 'INP vs. long animation frames', 'Sourdough hydration math'],
  },
  {
    group: 'Older',
    items: ['Lisbon in four days', 'Regex for Markdown fences', 'Naming a houseplant', 'Talk outline: WeAreDevelopers'],
  },
];

const SUGGESTIONS = ['Why does streaming get slower?', 'Show me the code', 'Hi, who are you?'];

const SOURCE_KEY = 'basic-gpt:source';

function loadSource(): Source {
  try {
    const raw = localStorage.getItem(SOURCE_KEY);
    if (raw) return JSON.parse(raw) as Source;
  } catch {
    /* storage blocked: fall through */
  }
  return { kind: 'local' };
}

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [mood, setMood] = useState<MascotMood>('idle');
  const [source, setSource] = useState<Source>(loadSource);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const liveEl = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const meter = useRef<MeterHandle>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const busy = mood !== 'idle';

  useEffect(() => {
    try {
      localStorage.setItem(SOURCE_KEY, JSON.stringify(source));
    } catch {
      /* ignore */
    }
  }, [source]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = '';
    if (draft) el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  const nearBottom = () => {
    const el = scroller.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  const toBottom = () => scroller.current?.scrollTo({ top: scroller.current.scrollHeight });

  async function send(prompt: string) {
    prompt = prompt.trim();
    if (!prompt || busy) return;
    setDraft('');
    const id = Date.now();
    setMessages((m) => [
      ...m,
      { id: id - 1, role: 'user', text: prompt, done: true },
      { id, role: 'assistant', text: '', done: false },
    ]);
    setMood('thinking');
    meter.current?.reset();
    requestAnimationFrame(toBottom);

    const controller = new AbortController();
    abort.current = controller;
    let text = '';
    let error: string | undefined;

    try {
      const res = await openStream(source, tapeFromText(answerFor(prompt)), prompt, controller.signal);
      for await (const delta of readDeltas(res)) {
        if (!liveEl.current) continue;
        if (text === '') setMood('streaming');
        const stick = nearBottom();

        // The naive renderer, on purpose: re-parse everything, replace the DOM.
        const t0 = performance.now();
        text += delta;
        liveEl.current.innerHTML = marked.parse(text) as string;
        meter.current?.push(performance.now() - t0);

        if (stick) toBottom();
      }
    } catch (err) {
      if (!controller.signal.aborted) error = err instanceof Error ? err.message : String(err);
    } finally {
      abort.current = null;
      setMessages((m) => m.map((msg) => (msg.id === id ? { ...msg, text, done: true, error } : msg)));
      setMood('idle');
      textarea.current?.focus();
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  }

  function newChat() {
    abort.current?.abort();
    setMessages([]);
    setActiveSession(null);
    meter.current?.reset();
    setNavOpen(false);
  }

  return (
    <div className={`app ${navOpen ? 'app--nav-open' : ''}`}>
      <aside className="sidebar" aria-label="Conversations">
        <div className="sidebar__brand">
          <Mascot size={26} mood={mood} />
          <span>Basic GPT</span>
        </div>

        <button className="sidebar__new" onClick={newChat}>
          <PlusIcon /> New chat
        </button>

        <label className="sidebar__search">
          <SearchIcon />
          <input placeholder="Search chats" aria-label="Search chats" />
        </label>

        <nav className="sidebar__sessions">
          {SESSIONS.map(({ group, items }) => (
            <section key={group}>
              <h2>{group}</h2>
              <ul>
                {items.map((title) => (
                  <li key={title}>
                    <button
                      className={activeSession === title ? 'is-active' : ''}
                      onClick={() => {
                        setActiveSession(title);
                        setNavOpen(false);
                      }}
                    >
                      {title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>

        <div className="sidebar__me">
          <span className="avatar">AM</span>
          <div>
            <strong>Abhirupa</strong>
            <span>Free plan</span>
          </div>
        </div>
      </aside>

      <div className="scrim" onClick={() => setNavOpen(false)} />

      <main className="chat">
        <header className="chat__top">
          <button className="icon-btn nav-toggle" aria-label="Open conversations" onClick={() => setNavOpen(true)}>
            <MenuIcon />
          </button>
          <div className="chat__model">
            Basic GPT <span className="chip">naive renderer</span>
          </div>
          <SourcePicker source={source} onChange={setSource} disabled={busy} />
        </header>

        <div className="chat__scroll" ref={scroller}>
          {messages.length === 0 ? (
            <div className="empty">
              <Mascot size={88} mood={mood} />
              <h1>What should we stream today?</h1>
              <p>Every chunk re-parses the whole answer. Long replies get slower near the end.</p>
              <div className="empty__chips">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ol className="thread">
              {messages.map((msg) =>
                msg.role === 'user' ? (
                  <li key={msg.id} className="msg msg--user">
                    <div className="bubble">{msg.text}</div>
                  </li>
                ) : (
                  <li key={msg.id} className="msg msg--assistant">
                    <Mascot size={28} mood={msg.done ? 'idle' : mood} />
                    <div className="msg__body">
                      {!msg.done && mood === 'thinking' && <span className="dots" aria-label="Thinking" />}
                      {msg.done ? (
                        <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(msg.text) as string }} />
                      ) : (
                        <div className="md" ref={liveEl} />
                      )}
                      {msg.error && <p className="msg__error">Stream failed: {msg.error}</p>}
                    </div>
                  </li>
                ),
              )}
            </ol>
          )}
        </div>

        <footer className="chat__bottom">
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <textarea
              ref={textarea}
              rows={1}
              value={draft}
              placeholder="Message Basic GPT"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              autoFocus
            />
            {busy ? (
              <button type="button" className="send send--stop" aria-label="Stop" onClick={() => abort.current?.abort()}>
                <span />
              </button>
            ) : (
              <button type="submit" className="send" aria-label="Send" disabled={!draft.trim()}>
                <ArrowIcon />
              </button>
            )}
          </form>
          <Meter ref={meter} />
        </footer>
      </main>
    </div>
  );
}

function SourcePicker({
  source,
  onChange,
  disabled,
}: {
  source: Source;
  onChange: (s: Source) => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState(source.kind === 'url' ? source.url : '');
  return (
    <div className="source">
      <select
        aria-label="Response source"
        value={source.kind}
        disabled={disabled}
        onChange={(e) => {
          const kind = e.target.value as Source['kind'];
          onChange(kind === 'url' ? { kind, url } : { kind });
        }}
      >
        <option value="local">Local tape</option>
        <option value="rec">rec replay</option>
        <option value="url">rec URL…</option>
      </select>
      {source.kind === 'url' && (
        <input
          className="source__url"
          placeholder="https://…/t/<tape>"
          value={url}
          disabled={disabled}
          onChange={(e) => {
            setUrl(e.target.value);
            onChange({ kind: 'url', url: e.target.value.trim() });
          }}
        />
      )}
    </div>
  );
}

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
const MenuIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);
const ArrowIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);
