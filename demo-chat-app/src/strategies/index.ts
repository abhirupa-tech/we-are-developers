import { bufferedStrategy } from './buffered';
import { frameBatchedStrategy } from './frameBatched';
import { setStateStrategy } from './setState';
import { syncStoreStrategy } from './syncStore';
import { transitionStrategy } from './transition';
import type { Strategy, StrategyId } from './types';

/** The three the demo compares, worst to best. */
export const STRATEGIES: Strategy[] = [setStateStrategy, bufferedStrategy, frameBatchedStrategy];

/** Every strategy, including ones no longer in the selector (the A2UI mode reports as syncStore). */
export const strategyById = Object.fromEntries(
  [...STRATEGIES, transitionStrategy, syncStoreStrategy].map((s) => [s.id, s]),
) as Record<StrategyId, Strategy>;

/** CSS variable owning each strategy's colour (selector, ghosts, grades). */
export const STRATEGY_COLOR_VAR: Record<StrategyId, string> = {
  setState: '--s-setstate',
  buffered: '--s-transition',
  transition: '--s-transition',
  syncStore: '--s-store',
  frameBatched: '--s-frame',
};

export function strategyColor(id: StrategyId): string {
  return getComputedStyle(document.documentElement).getPropertyValue(STRATEGY_COLOR_VAR[id]).trim();
}
