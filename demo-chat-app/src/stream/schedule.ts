/**
 * Waits until `ms` from now, always resolving in a new task. Zero or negative
 * waits use a MessageChannel post rather than setTimeout(0), which browsers
 * clamp to 4 ms once timers nest, and which would cap high replay rates.
 *
 * Used so each simulated network chunk lands in its own task, as it would
 * from a real socket: a consumer that falls behind must never turn the rest
 * of the stream into one endless task.
 */
let channel: MessageChannel | null = null;
const waiting: (() => void)[] = [];

export function nextTask(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    if (ms > 1) {
      const id = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(id);
        resolve();
      }, { once: true });
      return;
    }
    if (!channel) {
      channel = new MessageChannel();
      channel.port1.onmessage = () => waiting.shift()?.();
    }
    waiting.push(resolve);
    channel.port2.postMessage(0);
  });
}
