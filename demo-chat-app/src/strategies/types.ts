import type { FC } from 'react';
import type { EventBus } from '../stream/EventBus';

export type StrategyId = 'setState' | 'transition' | 'syncStore';

export interface Strategy {
  id: StrategyId;
  /** Shown in code font in the selector so it matches the slide. */
  label: string;
  /** One-line talking point. */
  note: string;
  /** Mounts the strategy-specific plumbing and renders the shared message. */
  Message: FC<{ bus: EventBus; messageId: string }>;
}
