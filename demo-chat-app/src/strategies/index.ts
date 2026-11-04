import { setStateStrategy } from './setState';
import { syncStoreStrategy } from './syncStore';
import { transitionStrategy } from './transition';
import type { Strategy, StrategyId } from './types';

export const STRATEGIES: Strategy[] = [setStateStrategy, transitionStrategy, syncStoreStrategy];

export const strategyById = Object.fromEntries(STRATEGIES.map((s) => [s.id, s])) as Record<StrategyId, Strategy>;

/** CSS variable owning each strategy's colour (selector, ghosts, grades). */
export const STRATEGY_COLOR_VAR: Record<StrategyId, string> = {
  setState: '--s-setstate',
  transition: '--s-transition',
  syncStore: '--s-store',
};

export function strategyColor(id: StrategyId): string {
  return getComputedStyle(document.documentElement).getPropertyValue(STRATEGY_COLOR_VAR[id]).trim();
}
