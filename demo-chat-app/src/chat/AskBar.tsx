import { useRef, useState } from 'react';
import { useRenderFlash } from '../debug/renderFlash';

/**
 * The question box for the Gemini feed. Its text is its own state, so typing
 * re-renders this component only, never App or the panes being measured.
 */
export function AskBar({ running, disabled, onAsk }: { running: boolean; disabled: boolean; onAsk: (text: string) => void }) {
  const [text, setText] = useState('');
  const ref = useRenderFlash<HTMLFormElement>('AskBar');
  const input = useRef<HTMLInputElement>(null);

  return (
    <form
      ref={ref}
      className="ask"
      onSubmit={(e) => {
        e.preventDefault();
        const q = text.trim();
        if (!q || running || disabled) return;
        onAsk(q);
      }}
    >
      <input
        ref={input}
        className="text ask-input"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        placeholder={disabled ? 'No Gemini API key: add one to .env.local, or use Pre-recorded' : 'Ask Gemini anything. Long answers with code and tables stress React most.'}
        aria-label="Question for Gemini"
      />
      {!running && (
        <button type="submit" className="btn btn-go" disabled={!text.trim() || disabled}>
          Ask
        </button>
      )}
    </form>
  );
}
