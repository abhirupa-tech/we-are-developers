import { MarkdownText } from '../chat/MarkdownText';
import { splitA2ui } from './parse';
import { A2Surface, A2SurfacePending } from './Surface';

/**
 * The A2UI message body: Markdown for prose, a live surface for each
 * complete ```a2ui block, a placeholder for the one still streaming.
 * Keys are positional, so a finished surface keeps its state (and its memo)
 * while text after it keeps arriving.
 */
export function renderA2ui(text: string) {
  return splitA2ui(text).map((seg, i) => {
    if (seg.kind === 'markdown') return <MarkdownText key={`md-${i}`} text={seg.text} />;
    if (!seg.complete) return <A2SurfacePending key={`ui-${i}`} />;
    return <A2Surface key={`ui-${i}`} json={seg.json} />;
  });
}
