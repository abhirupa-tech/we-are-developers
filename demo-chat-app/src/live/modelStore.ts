import { GEMINI } from '../config';

/**
 * Which Gemini model to ask, plus the fallbacks. Gemini models go overloaded
 * (503 "high demand") or slow without warning, so a request tries the chosen
 * model first and then the others in order. A tiny external store, so only
 * the model pickers re-render when it changes.
 */
export const MODELS = [
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
] as const;

const KEY = 'mockgpt.geminiModel';

function load(): string {
  try {
    return localStorage.getItem(KEY) || GEMINI.model;
  } catch {
    return GEMINI.model;
  }
}

type State = { preferred: string; /** The model that answered the last request. */ answered: string | null };
let state: State = { preferred: load(), answered: null };
const listeners = new Set<() => void>();

function write(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export const modelStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot: () => state,
  setPreferred(model: string) {
    try {
      localStorage.setItem(KEY, model);
    } catch {
      // Private mode: the choice just won't survive a reload.
    }
    write({ preferred: model, answered: null });
  },
  setAnswered(model: string) {
    if (state.answered !== model) write({ answered: model });
  },
  /** The order to try: the chosen model, then the rest of the list. */
  chain(): string[] {
    const all = [state.preferred, ...MODELS, GEMINI.model];
    return all.filter((m, i) => all.indexOf(m) === i);
  },
};
