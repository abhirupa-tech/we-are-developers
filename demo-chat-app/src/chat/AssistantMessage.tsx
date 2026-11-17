import { createContext, useContext, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { renderA2ui } from '../a2ui/renderA2ui';
import { useRenderFlash } from '../debug/renderFlash';
import { MarkdownText } from './MarkdownText';
import type { RunCollector } from '../metrics/collector';

/** The pane's collector. A stable object, so reading it never causes a render. */
export const PaneContext = createContext<RunCollector | null>(null);


/**
 * The one leaf every strategy renders: same Markdown pipeline, same CSS.
 * Deliberately plain: the whole answer is re-parsed on every update, so the
 * cost of each strategy's update frequency is visible.
 *
 * The only place the on-screen token (`seq`) is recorded. Render attempts
 * are counted one level up, in each strategy's own component (useRenderCount):
 * interrupted transition renders are abandoned before React reaches this leaf,
 * so counting here would miss exactly the work transitions throw away.
 *
 * Answers containing ```a2ui blocks render them as interactive surfaces, in
 * every strategy, so heavy UI can be compared across strategies too.
 * `render` overrides the body; the profiler hooks stay the same.
 */
export function AssistantMessage({ text, seq, render }: { text: string; seq: number; render?: (text: string) => ReactNode }) {
  const collector = useContext(PaneContext);
  const ref = useRenderFlash<HTMLDivElement>('AssistantMessage');

  // Runs once per commit: `seq` is now on screen.
  useLayoutEffect(() => {
    if (seq >= 0) collector?.onShown(seq);
  });

  return (
    <div ref={ref} className="msg msg-assistant">
      <div className="msg-who">Assistant</div>
      <div className="md">
        {render ? render(text) : text.includes('```a2ui') ? renderA2ui(text) : <MarkdownText text={text} />}
        <span className="caret" aria-hidden="true" />
      </div>
    </div>
  );
}

/**
 * Counts a render attempt for the calling strategy component. Called in the
 * render body, so renders React starts and then abandons (transitions) are
 * counted too: attempts can exceed commits. Identical in all three strategies.
 */
export function useRenderCount(): void {
  useContext(PaneContext)?.onRenderAttempt();
}

/** Lets the transition strategy report how long it spent pending. */
export function useReportPending(isPending: boolean): void {
  const collector = useContext(PaneContext);
  useEffect(() => {
    collector?.onPending(isPending);
  }, [collector, isPending]);
}
