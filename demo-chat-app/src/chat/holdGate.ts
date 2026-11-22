import type { EventBus } from '../stream/EventBus';
import type { MessageBus } from '../strategies/types';

/**
 * Pauses rendering while the reader is scrolled up. Wraps the bus a strategy
 * subscribes to: while held, events are queued instead of delivered, so no
 * strategy updates state and React renders nothing. On release the queue is
 * replayed in one task, and each strategy catches up the way it normally
 * would. Tokens keep arriving (the HUD's "behind" counter shows them).
 */
export function createHoldGate(bus: EventBus) {
  let held = false;
  const queued: (() => void)[] = [];

  const gated: MessageBus = {
    on: (channel, listener) => bus.on(channel, (e) => (held ? queued.push(() => listener(e)) : listener(e))),
  };

  return {
    bus: gated,
    get held() {
      return held;
    },
    hold() {
      held = true;
    },
    release() {
      if (!held) return;
      held = false;
      queued.splice(0).forEach((deliver) => deliver());
    },
  };
}

export type HoldGate = ReturnType<typeof createHoldGate>;
