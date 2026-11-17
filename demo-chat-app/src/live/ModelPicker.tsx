import { useSyncExternalStore } from 'react';
import { MODELS, modelStore } from './modelStore';

/**
 * Picks the Gemini model to try first. If it's overloaded the request falls
 * back through the others; the note says which one actually answered.
 */
export function ModelPicker({ disabled }: { disabled?: boolean }) {
  const { preferred, answered } = useSyncExternalStore(modelStore.subscribe, modelStore.getSnapshot);
  const options = MODELS.includes(preferred as (typeof MODELS)[number]) ? MODELS : [preferred, ...MODELS];
  return (
    <span className="model-picker">
      <select
        value={preferred}
        disabled={disabled}
        onChange={(e) => modelStore.setPreferred(e.target.value)}
        aria-label="Gemini model to try first"
        title="Tried first. If it's overloaded or slow, the next model in the list answers instead."
      >
        {options.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {answered && answered !== preferred && <span className="model-note">answered by {answered}</span>}
    </span>
  );
}
