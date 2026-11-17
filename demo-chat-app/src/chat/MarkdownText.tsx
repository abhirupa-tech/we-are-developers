import Markdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

/**
 * The shared Markdown pipeline. Deliberately plain: the whole text is
 * re-parsed on every update, so the cost of each strategy's update
 * frequency is visible.
 */
export function MarkdownText({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
      {text}
    </Markdown>
  );
}
