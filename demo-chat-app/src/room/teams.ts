import type { Animal } from '../debug/dropSound';
import type { StrategyId } from '../strategies/types';

/** Each team runs one rendering method: the experiment's three arms. */
export const TEAM_STRATEGY: Record<Animal, StrategyId> = {
  dog: 'frameBatched',
  duck: 'memo',
  cat: 'setState',
};

export const TEAM_NAME: Record<Animal, string> = { dog: 'Dogs', duck: 'Ducks', cat: 'Cats' };

/** How each method is described to the room. */
export const TEAM_METHOD: Record<Animal, string> = {
  dog: 'useSyncExternalStore + rAF + memo',
  duck: 'setState + React.memo freeze',
  cat: 'setState',
};

export const TEAM_COLOR: Record<Animal, string> = {
  dog: 'var(--s-setstate)',
  duck: 'var(--s-transition)',
  cat: 'var(--s-frame)',
};
