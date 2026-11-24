import type { FC } from 'react';
import type { EventBus } from '../stream/EventBus';

export type StrategyId = 'setState' | 'memo' | 'transition' | 'syncStore' | 'frameBatched';

/** What a strategy needs from the bus: subscribe to one message's events. */
export type MessageBus = Pick<EventBus, 'on'>;

export interface Strategy {
  id: StrategyId;
  /** Shown in code font in the selector so it matches the slide. */
  label: string;
  /** One-line talking point. */
  note: string;
  /** Mounts the strategy-specific plumbing and renders the shared message. */
  Message: FC<{ bus: MessageBus; messageId: string }>;
}
