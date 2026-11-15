import { createContext, useContext, useEffect, useLayoutEffect } from 'react';
import Markdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import type { RunCollector } from '../metrics/collector';

/** The pane's collector. A stable object, so reading it never causes a render. */
export const PaneContext = createContext<RunCollector | null>(null);

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

/**
 * The one leaf every strategy renders: same Markdown pipeline, same CSS.
 * Deliberately plain: the whole answer is re-parsed on every update, so the
 * cost of each strategy's update frequency is visible.
 *
 * The only place the on-screen token (`seq`) is recorded. Render attempts
 * are counted one level up, in each strategy's own component (useRenderCount):
 * interrupted transition renders are abandoned before React reaches this leaf,
 * so counting here would miss exactly the work transitions throw away.
 */
export function AssistantMessage({ text, seq }: { text: string; seq: number }) {
  const collector = useContext(PaneContext);

  // Runs once per commit: `seq` is now on screen.
  useLayoutEffect(() => {
    if (seq >= 0) collector?.onShown(seq);
  });

  return (
    <div className="msg msg-assistant">
      <div className="msg-who">Assistant</div>
      <div className="md">
        <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
          {text}
        </Markdown>
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
