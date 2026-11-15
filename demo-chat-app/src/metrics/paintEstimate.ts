/**
 * Estimates when the frame containing the latest commit was painted:
 * requestAnimationFrame runs just before the next paint, and a MessageChannel
 * message posted from it runs just after that paint. Accurate to about one
 * frame, which is stated in the HUD help and should be on the slide.
 *
 * One shared channel and queue, so many commits in one frame cost one rAF.
 */
type Callback = (paintedAt: number) => void;

let queue: Callback[] = [];
let scheduled = false;
let channel: MessageChannel | null = null;

function flush() {
  const now = performance.now();
  const callbacks = queue;
  queue = [];
  scheduled = false;
  for (const cb of callbacks) cb(now);
}

export function afterNextPaint(cb: Callback): void {
  queue.push(cb);
  if (scheduled) return;
  scheduled = true;
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = flush;
  }
  const port = channel.port2;
  requestAnimationFrame(() => port.postMessage(0));
}
