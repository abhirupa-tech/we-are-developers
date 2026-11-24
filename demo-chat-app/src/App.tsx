import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { decodeAction } from './a2ui/parse';
import { A2UI_SYSTEM_PROMPT } from './a2ui/prompt';
import { Pane, type PaneStatus } from './chat/Pane';
import { Probe } from './chat/Probe';
import { AskBar } from './chat/AskBar';
import { BUILD, FLAGS, GEMINI, PROFILER_ACTIVE, REACT_VERSION } from './config';
import { CPU_FACTORS, setCpuFactor } from './debug/cpuThrottle';
import type { Round } from './room/protocol';
import { JoinRoom, RoomChip, TeamCard } from './room/JoinRoom';
import { beginReport, endReport } from './room/reporter';
import { ROOM_ENABLED, room } from './room/roomClient';
import { ANIMAL_EMOJI, ANIMALS, dropSound, getAnimal, onDropSound, subscribeAnimal } from './debug/dropSound';
import { TEAM_STRATEGY } from './room/teams';
import { renderFlash, useRenderFlash } from './debug/renderFlash';
import { Hud } from './hud/Hud';
import type { HudController } from './hud/controller';
import { Scorecard, type RunResult } from './hud/Scorecard';
import { chatStore } from './live/chatStore';
import { GeminiSource } from './live/GeminiSource';
import { LivePane, type LiveKind } from './live/LivePane';
import { ModelPicker } from './live/ModelPicker';
import { calibrateDevice } from './metrics/calibration';
import { RunCollector } from './metrics/collector';
import { gradeRun } from './metrics/grades';
import { beginRun, endRun, startMonitor } from './metrics/monitor';
import { STRATEGIES, strategyById } from './strategies';
import type { StrategyId } from './strategies/types';
import { EventBus, RUN_CHANNEL } from './stream/EventBus';
import { HttpReplaySource } from './stream/HttpReplaySource';
import { MockReplaySource } from './stream/MockReplaySource';
import type { RecordingMeta, ReplaySource } from './stream/ReplaySource';
import { runStream } from './stream/StreamClient';

const RATES = [1, 2, 5, 10];
const CATCH_UP_MS = 3000;

/** Where a strategy run's answer comes from. */
type Feed = 'gemini' | 'recorded';

type RunView = {
  id: number;
  /** 'chat' is the Live / A2UI modes; the others are the strategy panes' feeds. */
  source: Feed | 'chat';
  /** Scorecard title and expected duration, fixed when the run starts. */
  title: string;
  expectedMs: number;
  bus: EventBus;
  messageId: string | null;
  prompt: string;
  panes: { strategy: StrategyId; collector: RunCollector }[];
  status: PaneStatus;
  error: string | null;
};

/** Scorecard label for a live run: the question, or the A2UI action it sent. */
function promptLabel(prompt: string) {
  const action = decodeAction(prompt);
  return action ? `A2UI action: ${action.action}` : prompt;
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function App() {
  const [strategy, setStrategy] = useState<StrategyId>(() => STRATEGIES.find((s) => s.id === FLAGS.strategy)?.id ?? 'setState');
  const [compare, setCompare] = useState(FLAGS.compare);
  const [presenter, setPresenter] = useState(FLAGS.presenter);
  /** Live modes: a real Gemini chat in one useSyncExternalStore pane, plain or with A2UI. */
  const [live, setLive] = useState<LiveKind | false>(FLAGS.compare ? false : FLAGS.a2ui ? 'a2ui' : FLAGS.live ? 'chat' : false);
  /** The strategy panes' feed. Always a recording: the Gemini feed is hidden in the UI. */
  const [feed, setFeed] = useState<Feed>('recorded');
  const flashOn = useSyncExternalStore(renderFlash.subscribe, renderFlash.getSnapshot);
  const audioOn = useSyncExternalStore(dropSound.subscribe, dropSound.getSnapshot);
  /** This page's animal: random, or the team the live room assigned. */
  const animal = useSyncExternalStore(subscribeAnimal, getAnimal);
  const roomStatus = useSyncExternalStore(room.subscribe, room.getSnapshot);
  /** The presenter round the next run belongs to (live room only). */
  const roomRound = useRef<number | undefined>(undefined);
  const [teamCardOpen, setTeamCardOpen] = useState(true);
  /** Live room (?room=…): this device has tapped Join. */
  const [joined, setJoined] = useState(false);
  /** A round the presenter started, waiting for the matching settings to apply. */
  const [pendingGo, setPendingGo] = useState<Round | null>(null);
  const appRef = useRenderFlash<HTMLDivElement>('App');
  const [ghostsOn, setGhostsOn] = useState(true);
  const [autoProbe, setAutoProbe] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Phone only: the ☰ menu holding the recording, speed, CPU and toggles. */
  const [menuOpen, setMenuOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(true);
  const [apiUrl, setApiUrl] = useState(FLAGS.api);
  const [serverPaces, setServerPaces] = useState(true);
  const [recordings, setRecordings] = useState<RecordingMeta[]>([]);
  const [recordingId, setRecordingId] = useState(FLAGS.recording || 'demo-3k');
  const [rate, setRate] = useState(RATES.includes(FLAGS.rate) ? FLAGS.rate : 5);
  const [cpu, setCpu] = useState(CPU_FACTORS.includes(FLAGS.cpu) ? FLAGS.cpu : 1);
  const [run, setRun] = useState<RunView | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [deviceMs, setDeviceMs] = useState<number | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  const hud = useRef<HudController | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runRef = useRef<RunView | null>(null);
  runRef.current = run;
  const ghostsRef = useRef(ghostsOn);
  ghostsRef.current = ghostsOn;
  const runSeq = useRef(0);

  const source: ReplaySource = useMemo(
    () => (apiUrl ? new HttpReplaySource(apiUrl.replace(/\/$/, ''), serverPaces) : new MockReplaySource()),
    [apiUrl, serverPaces],
  );

  useEffect(() => {
    startMonitor();
    setDeviceMs(calibrateDevice());
  }, []);

  useEffect(() => {
    let live = true;
    source
      .list()
      .then((list) => {
        if (!live) return;
        setRecordings(list);
        setSourceError(null);
        setRecordingId((id) => (list.some((r) => r.id === id) ? id : (list[0]?.id ?? id)));
      })
      .catch((err: Error) => live && setSourceError(err.message));
    return () => {
      live = false;
    };
  }, [source]);

  useEffect(() => {
    document.documentElement.classList.toggle('presenter', presenter);
  }, [presenter]);

  useEffect(() => setCpuFactor(cpu), [cpu]);

  // Keep the current selection in the URL, so a setup can be shared or reloaded.
  useEffect(() => {
    const url = new URL(window.location.href);
    const p = url.searchParams;
    p.set('mode', live || (compare ? 'compare' : 'single'));
    if (live) p.delete('strategy');
    else p.set('strategy', strategy);
    p.set('recording', recordingId);
    p.set('rate', String(rate));
    p.set('cpu', String(cpu));
    p.set('flash', flashOn ? '1' : '0');
    p.set('audio', audioOn ? '1' : '0');
    window.history.replaceState(null, '', url);
  }, [live, compare, strategy, recordingId, rate, cpu, flashOn, audioOn]);

  const recording = recordings.find((r) => r.id === recordingId);

  /** Ends the current run: freeze metrics, grade, keep ghosts. */
  const finalize = useCallback(
    (view: RunView, outcome: RunResult['outcome'], error: string | null = null) => {
      if (view.id !== runSeq.current) return;
      const frames = endRun();
      endReport();
      const now = performance.now();
      view.panes.forEach(({ collector }) => {
        if (Number.isNaN(collector.endedAt)) collector.endedAt = now;
      });
      hud.current?.endRun(frames?.frameTimes ?? [], frames?.baselineMs ?? 1000 / 60, view.panes[0]?.collector);
      const panes = view.panes.map(({ strategy: s, collector }) => {
        const metrics = collector.snapshot(frames, now);
        return { strategy: s, metrics, grades: gradeRun(metrics) };
      });
      const asked = view.source !== 'recorded';
      setResult({
        outcome,
        recording: asked ? promptLabel(view.prompt) : view.title,
        rate: asked ? 1 : rate,
        compare: view.panes.length > 1,
        hidden: frames?.hidden ?? false,
        deviceMs,
        expectedMs: asked ? 0 : view.expectedMs,
        panes,
      });
      setRun((r) => (r && r.id === view.id ? { ...r, status: outcome === 'done' ? 'done' : outcome, error } : r));
      setAnnounce(outcome === 'done' ? 'Answer complete. Scorecard ready.' : outcome === 'stopped' ? 'Run stopped.' : 'Run failed.');
    },
    [rate, deviceMs],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * Starts a run. Strategy panes: asks Gemini `text`, or replays the selected
   * recording. Chat modes: asks Gemini `text`, or replays `replayId` into the
   * conversation (the Pre-recorded fallback).
   */
  const start = useCallback((text?: string, replayId?: string) => {
    const question = text?.trim() ?? '';
    const replay = live ? recordings.find((r) => r.id === replayId) : recording;
    const asking = live ? !replay : feed === 'gemini';
    if (asking ? !question : !replay) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const id = ++runSeq.current;
    const bus = new EventBus();
    const frames = beginRun();
    const ids: StrategyId[] = live ? ['syncStore'] : compare ? STRATEGIES.map((s) => s.id) : [strategy];
    const panes = ids.map((s, i) => ({ strategy: s, collector: new RunCollector(`run${id}-pane${i}`, s, frames.startedAt) }));
    // Live room: report this run (single strategy or A2UI; Compare shares one thread, so it isn't reported).
    if (ROOM_ENABLED && !compare) beginReport(live === 'a2ui' ? 'a2ui' : ids[0], cpu, frames, panes[0].collector, roomRound.current);
    roomRound.current = undefined;
    const view: RunView = {
      id,
      source: asking ? (live ? 'chat' : 'gemini') : 'recorded',
      title: asking ? question : replay!.title,
      expectedMs: asking ? 0 : replay!.durationMs / rate,
      bus,
      messageId: null,
      prompt: asking ? question : replay!.prompt,
      panes,
      status: 'streaming',
      error: null,
    };

    // Live mode: the question goes into the external store, the store listens
    // to the stream, and Gemini gets the conversation so far.
    let runSource = source;
    if (live) {
      chatStore.addUserMessage(view.prompt);
      if (asking) runSource = new GeminiSource(chatStore.getSnapshot(), live === 'a2ui' ? A2UI_SYSTEM_PROMPT : undefined);
      bus.on(RUN_CHANNEL, chatStore.onStreamEvent);
    } else if (asking) {
      // One question, one answer, streamed through the selected strategy.
      runSource = new GeminiSource([{ id: 'q', role: 'user', text: question, seq: -1 }]);
    }
    let errorMessage: string | null = null;

    setResult(null);
    setAnnounce('');
    setRun(view);

    bus.on(RUN_CHANNEL, (e) => {
      if (e.type === 'TEXT_MESSAGE_START') {
        setRun((r) => (r && r.id === id ? { ...r, messageId: e.messageId } : r));
      }
    });

    runStream(
      runSource,
      bus,
      { recordingId: replay?.id ?? '', rate, seed: 1, signal: ac.signal },
      {
        onError: (message) => (errorMessage = message),
        onEvent: (e) => {
          if (e.type === 'TEXT_MESSAGE_CONTENT') panes.forEach(({ collector }) => collector.onToken(e.seq, e.arrivedAt));
        },
        onStall: (stalled) =>
          setRun((r) => (r && r.id === id && (r.status === 'streaming' || r.status === 'stalled') ? { ...r, status: stalled ? 'stalled' : 'streaming' } : r)),
      },
    ).then((outcome) => {
      if (outcome === 'aborted') return finalize(view, 'stopped');
      if (outcome === 'error') return finalize(view, 'error', errorMessage ?? 'see console for details');
      // Stream finished: wait for every pane to catch up (or give up after 3 s).
      const until = performance.now() + CATCH_UP_MS;
      const waitForPaint = () => {
        if (view.id !== runSeq.current) return;
        if (panes.every(({ collector }) => collector.caughtUp()) || performance.now() > until) {
          // Give the last commit one frame to paint before freezing numbers.
          requestAnimationFrame(() => requestAnimationFrame(() => finalize(view, 'done')));
        } else {
          requestAnimationFrame(waitForPaint);
        }
      };
      waitForPaint();
    });
  }, [recording, recordings, compare, strategy, source, rate, finalize, live, feed, cpu]);

  // Bind the pane readouts once the panes for this run are in the DOM.
  useEffect(() => {
    if (run?.status === 'streaming' && run.messageId === null) hud.current?.beginRun(run.panes.map((p) => p.collector));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    endReport();
    runSeq.current++;
    endRun();
    setRun(null);
    setResult(null);
    chatStore.clear();
    hud.current?.redraw();
  }, []);

  /** Switching strategy (or mode) unmounts the old one and resets the run, keeping ghosts. */
  const switchTo = useCallback(
    (next: StrategyId) => {
      if (next === strategy && !live) return;
      reset();
      setLive(false);
      setStrategy(next);
    },
    [strategy, live, reset],
  );

  const toggleCompare = useCallback(() => {
    reset();
    setLive(false);
    setCompare((c) => !c);
  }, [reset]);

  const toggleLive = useCallback(
    (kind: LiveKind) => {
      reset();
      setCompare(false);
      setLive((l) => (l === kind ? false : kind));
    },
    [reset],
  );

  const running = run?.status === 'streaming' || run?.status === 'stalled';

  // ── Live room ─────────────────────────────────────────────────────────
  const joinRoom = useCallback(() => {
    if (!dropSound.getSnapshot()) dropSound.toggle(); // the tap unlocks audio
    room.joinAsPlayer(deviceMs);
    setJoined(true);
  }, [deviceMs]);

  // In a room, each phone runs its team's method.
  useEffect(() => {
    if (roomStatus.team) setStrategy(TEAM_STRATEGY[roomStatus.team]);
  }, [roomStatus.team]);

  // Every animal noise counts towards the room's noise meter.
  useEffect(() => onDropSound(room.sound), []);

  // The presenter starts a round: apply its settings, then start once they're in.
  useEffect(
    () =>
      room.onGo((round) => {
        reset();
        setLive(false);
        setCompare(false);
        setMenuOpen(false);
        setTeamCardOpen(false);
        setStrategy(TEAM_STRATEGY[getAnimal()]);
        if (round.recording) setRecordingId(round.recording);
        if (RATES.includes(round.rate)) setRate(round.rate);
        if (CPU_FACTORS.includes(round.cpu)) setCpu(round.cpu);
        setPendingGo(round);
      }),
    [reset],
  );
  useEffect(() => room.onStop(stop), [stop]);
  useEffect(() => {
    if (!pendingGo) return;
    const knownRecording = recordings.some((r) => r.id === pendingGo.recording);
    if (strategy !== TEAM_STRATEGY[getAnimal()]) return;
    if (knownRecording && recording?.id !== pendingGo.recording) return;
    if (RATES.includes(pendingGo.rate) && rate !== pendingGo.rate) return;
    if (CPU_FACTORS.includes(pendingGo.cpu) && cpu !== pendingGo.cpu) return;
    if (live || compare || !recording) return;
    setPendingGo(null);
    roomRound.current = pendingGo.id;
    start();
  }, [pendingGo, strategy, recording, recordings, rate, cpu, live, compare, start]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === '1' || k === '2' || k === '3') switchTo(STRATEGIES[Number(k) - 1].id);
      else if (k === '4') toggleLive('a2ui');
      else if (k === 'f') renderFlash.toggle();
      else if (k === 'a') dropSound.toggle();
      else if (k === ' ') {
        e.preventDefault();
        if (running) stop();
        else start();
      } else if (k === 'r') reset();
      else if (k === 'c') toggleCompare();
      else if (k === 'p') setPresenter((p) => !p);
      else if (k === 'g') {
        setGhostsOn((g) => !g);
        requestAnimationFrame(() => hud.current?.redraw());
      } else if (k === '?') setHelpOpen((h) => !h);
      else if (k === 'escape') {
        setHelpOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [switchTo, running, stop, start, reset, toggleCompare, toggleLive]);

  const getPanes = useCallback(() => runRef.current?.panes.map((p) => p.collector) ?? [], []);
  const showGhosts = useCallback(() => ghostsRef.current, []);

  const paneStrategies = compare ? STRATEGIES : [strategyById[strategy]];
  /** The strategy highlighted in the selector. Live mode always uses the external store. */
  const shownStrategy: StrategyId | null = live === 'a2ui' ? null : live ? 'syncStore' : strategy;

  return (
    <div ref={appRef} className={`app ${compare ? 'is-compare' : ''} ${FLAGS.hud ? '' : 'no-hud'}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ◐
          </span>
          MockGPT
          <span
            className="brand-animals"
            role="img"
            aria-label={`Drop-sound animals; this page got the ${animal}`}
            title={`This page got the ${animal}, picked at random on every load. It makes a sound on every dropped frame when Audio is on.`}
          >
            {ANIMALS.map((a) => (
              <span key={a} className={a === animal ? 'is-picked' : ''}>
                {ANIMAL_EMOJI[a]}
              </span>
            ))}
          </span>
          {ROOM_ENABLED && joined && <RoomChip />}
          {!presenter && (
            <span className={`badge badge-${BUILD}`} title={`React ${REACT_VERSION}`}>
              {BUILD} build · React {REACT_VERSION}
            </span>
          )}
        </div>

        <div className="segmented" role="radiogroup" aria-label="Mode">
          {STRATEGIES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={compare || s.id === shownStrategy}
              data-strategy={s.id}
              className={compare || s.id === shownStrategy ? 'on' : ''}
              disabled={compare}
              onClick={() => switchTo(s.id)}
              title={`${s.note} (key ${i + 1})`}
            >
              <code>{s.label}</code>
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={live === 'a2ui'}
            data-strategy="a2ui"
            className={live === 'a2ui' ? 'on' : ''}
            onClick={() => toggleLive('a2ui')}
            title="Gemini answers with interactive A2UI surfaces, on useSyncExternalStore (key 4)"
          >
            <code>A2UI</code>
          </button>
        </div>

        <button
          type="button"
          className="icon-btn menu-btn"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Menu"
          aria-expanded={menuOpen}
          aria-controls="top-actions"
        >
          {menuOpen ? '✕' : '☰'}
        </button>

        <div id="top-actions" className={`top-actions ${menuOpen ? 'is-open' : ''}`}>
          {/* Phone menu only: the replay choices that live in the footer on desktop. */}
          <label className="menu-field">
            <span>Response</span>
            <select value={recordingId} onChange={(e) => setRecordingId(e.target.value)} disabled={running}>
              {recordings.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} · {r.tokenCount.toLocaleString()} tokens
                </option>
              ))}
            </select>
          </label>
          <label className="menu-field">
            <span>Speed</span>
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))} disabled={running}>
              {RATES.map((r) => (
                <option key={r} value={r}>
                  {r}x
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={`chip ${compare ? 'on' : ''}`} onClick={toggleCompare} aria-pressed={compare}>
            Compare
          </button>
          <button
            type="button"
            className={`chip ${flashOn ? 'on' : ''}`}
            onClick={renderFlash.toggle}
            aria-pressed={flashOn}
            title="Light up each component every time it re-renders: cyan on time, orange when the frame dropped (key F). Adds a little overhead to the numbers."
          >
            Flash renders
          </button>
          <button
            type="button"
            className={`chip ${audioOn ? 'on' : ''}`}
            onClick={dropSound.toggle}
            aria-pressed={audioOn}
            title={`A ${animal} sound on every dropped frame during a run (key A). The animal is picked at random on every page load.`}
          >
            {audioOn ? '🔊' : '🔇'} Audio
          </button>
          <label className="chip cpu-select" title="Simulated CPU throttle: each commit also blocks the main thread for (N - 1) times its render time">
            CPU
            <select value={cpu} onChange={(e) => setCpu(Number(e.target.value))} disabled={running} aria-label="Simulated CPU throttle">
              {CPU_FACTORS.map((f) => (
                <option key={f} value={f}>
                  {f}×
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={`chip ${presenter ? 'on' : ''}`} onClick={() => setPresenter((p) => !p)} aria-pressed={presenter}>
            Presenter
          </button>
          <button type="button" className="icon-btn" onClick={() => setSettingsOpen((o) => !o)} aria-label="Settings" aria-expanded={settingsOpen}>
            ⚙
          </button>
          <button type="button" className="icon-btn" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts">
            ?
          </button>
        </div>
      </header>
      {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
      {ROOM_ENABLED && !joined && <JoinRoom onJoin={joinRoom} />}
      {ROOM_ENABLED && joined && roomStatus.team && teamCardOpen && !running && <TeamCard team={roomStatus.team} onClose={() => setTeamCardOpen(false)} />}

      {FLAGS.hud && (
        <Hud
          controllerRef={hud}
          getPanes={getPanes}
          showGhosts={showGhosts}
          compare={compare}
          commitsAvailable={PROFILER_ACTIVE}
          deviceMs={deviceMs}
        />
      )}

      {compare && (
        <p className="banner" role="note">
          Compare mode: all three panes share one main thread, so these numbers are relative and illustrative. Use single runs (or Bench mode, coming next) for figures you publish.
        </p>
      )}

      <main className="stage">
        <div className="panes">
          {live && (
            <LivePane
              kind={live}
              onSend={start}
              recordings={recordings}
              rate={rate}
              rates={RATES}
              onRate={setRate}
              onReplay={(id) => start(undefined, id)}
              onStop={stop}
              onNewChat={reset}
              collector={run?.panes[0]?.collector ?? null}
              messageId={run?.messageId ?? null}
              status={run?.status ?? 'idle'}
              error={run?.error}
            />
          )}
          {!live && paneStrategies.map((s, i) => {
            const pane = run?.panes[i];
            return (
              <Pane
                key={`${s.id}-${run?.id ?? 0}`}
                strategy={s}
                compact={compare}
                prompt={run?.prompt ?? null}
                bus={run?.bus ?? null}
                messageId={run?.messageId ?? null}
                collector={pane?.collector ?? null}
                status={run?.status ?? 'idle'}
                error={run?.error}
                onRetry={() => start(run?.source === 'gemini' ? run.prompt : undefined)}
                onFallback={run?.source === 'gemini' ? () => setFeed('recorded') : undefined}
                emptyHint={feed}
              />
            );
          })}
        </div>
        {result && <div className="sc-backdrop" onClick={() => setResult(null)} aria-hidden="true" />}
        {result && <Scorecard result={result} onClose={() => setResult(null)} />}
      </main>

      {/* Hidden in the chat modes (they have their own composer), but kept
          mounted so Auto-probe still measures responsiveness during a run. */}
      <footer className="composer" hidden={!!live}>
        {feed === 'gemini' && (
          <>
            <AskBar running={running} disabled={!GEMINI.apiKey} onAsk={start} />
            <ModelPicker disabled={running} />
          </>
        )}
        <label className="field" hidden={feed !== 'recorded'}>
          <span className="sr-only">Recording</span>
          <select value={recordingId} onChange={(e) => setRecordingId(e.target.value)} disabled={running}>
            {recordings.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} · {r.tokenCount.toLocaleString()} tokens
              </option>
            ))}
          </select>
        </label>
        <label className="field" hidden={feed !== 'recorded'}>
          <span className="sr-only">Replay speed</span>
          <select value={rate} onChange={(e) => setRate(Number(e.target.value))} disabled={running}>
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}x
              </option>
            ))}
          </select>
        </label>
        <Probe auto={autoProbe} running={running} />
        <label className="toggle">
          <input type="checkbox" checked={autoProbe} onChange={(e) => setAutoProbe(e.target.checked)} />
          Auto-probe
        </label>
        {running ? (
          <button type="button" className="btn btn-stop" onClick={stop}>
            Stop
          </button>
        ) : (
          feed === 'recorded' && (
            <button type="button" className="btn btn-go" onClick={() => start()} disabled={!recording}>
              Start run
            </button>
          )
        )}
      </footer>

      {sourceError && <p className="toast" role="alert">Couldn’t load recordings from the API: {sourceError}. Switch to the mock source in settings.</p>}

      {settingsOpen && (
        <div className="sheet" role="dialog" aria-label="Settings">
          <h2>Settings</h2>
          <fieldset>
            <legend>Stream source</legend>
            <label className="radio">
              <input type="radio" checked={!apiUrl} onChange={() => setApiUrl('')} /> Mock (local recordings)
            </label>
            <label className="radio">
              <input type="radio" checked={!!apiUrl} onChange={() => setApiUrl(apiUrl || 'http://localhost:8787')} /> Recorded-stream API
            </label>
            {!!apiUrl && (
              <>
                <input className="text" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} aria-label="API base URL" />
                <label className="toggle">
                  <input type="checkbox" checked={serverPaces} onChange={(e) => setServerPaces(e.target.checked)} /> Server paces at the chosen rate
                </label>
              </>
            )}
          </fieldset>
          <label className="toggle">
            <input
              type="checkbox"
              checked={ghostsOn}
              onChange={(e) => {
                setGhostsOn(e.target.checked);
                requestAnimationFrame(() => hud.current?.redraw());
              }}
            />{' '}
            Ghost runs (G)
          </label>
          <div className="row">
            <button type="button" className="btn" onClick={() => setDeviceMs(calibrateDevice())}>
              Recalibrate device
            </button>
            <span className="muted">{deviceMs != null ? `${deviceMs} ms` : ''}</span>
          </div>
          <p className="muted small">
            The heartbeat twins and frame strip are measurement instruments, so they stay on with reduced motion. The jank flash and
            scorecard reveal respect it. Add <code>?hud=0</code> to the URL to measure without the HUD.
          </p>
          <button type="button" className="btn" onClick={() => setSettingsOpen(false)}>
            Done
          </button>
        </div>
      )}

      {helpOpen && (
        <div className="overlay" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setHelpOpen(false)}>
          <div className="help" onClick={(e) => e.stopPropagation()}>
            <h2>Keyboard shortcuts</h2>
            <dl>
              <dt>
                <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>
              </dt>
              <dd>Switch strategy</dd>
              <dt>
                <kbd>4</kbd>
              </dt>
              <dd>A2UI mode (Gemini with interactive UI)</dd>
              <dt>
                <kbd>Space</kbd>
              </dt>
              <dd>Start run or stop</dd>
              <dt>
                <kbd>R</kbd>
              </dt>
              <dd>Reset</dd>
              <dt>
                <kbd>C</kbd>
              </dt>
              <dd>Compare mode</dd>
              <dt>
                <kbd>P</kbd>
              </dt>
              <dd>Presenter mode</dd>
              <dt>
                <kbd>G</kbd>
              </dt>
              <dd>Ghost runs on or off</dd>
              <dt>
                <kbd>F</kbd>
              </dt>
              <dd>Flash renders on or off</dd>
              <dt>
                <kbd>A</kbd>
              </dt>
              <dd>Audio: an animal sound on every dropped frame</dd>
              <dt>
                <kbd>?</kbd>
              </dt>
              <dd>This help</dd>
            </dl>
            <button type="button" className="btn" onClick={() => setHelpOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      {presenter && (
        <aside className={`notes ${notesOpen ? '' : 'is-collapsed'}`} aria-label="Presenter notes">
          <button type="button" className="notes-toggle" onClick={() => setNotesOpen((o) => !o)} aria-expanded={notesOpen}>
            Notes
          </button>
          {notesOpen && (
            <ul>
              <li>Set DevTools CPU throttle to 4x or 6x before loading, then recalibrate so the reading is on screen.</li>
              <li>Close other tabs, plug in power, disable extensions.</li>
              <li>
                Run <code>setState</code> first on a heavy recording and let it jank. Then switch strategy and rerun to draw the ghost
                comparison.
              </li>
              <li>If the API is unreachable, switch to the mock source in settings.</li>
            </ul>
          )}
        </aside>
      )}

      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
