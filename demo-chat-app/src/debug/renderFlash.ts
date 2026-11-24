import { useLayoutEffect, useRef } from 'react';
import { onFrame } from '../metrics/monitor';

/**
 * "Flash renders": light up a component every time it commits, with a small
 * label naming it and counting its commits. Like React DevTools' "highlight
 * updates", but always available and scoped to the components we care about.
 *
 * Built so that it doesn't change what it measures:
 * - The on/off flag is a plain module variable. Components read it inside an
 *   effect, never subscribe to it, so toggling it re-renders nothing but the
 *   toggle button.
 * - The flash is a Web Animation on the element (and its ::after label). No
 *   React state, no class toggling, no forced layout.
 *
 * It still costs a little main-thread time per commit, so turn it off before
 * reading numbers off the scorecard.
 */
let enabled = new URLSearchParams(window.location.search).get('flash') === '1';
const listeners = new Set<() => void>();

function apply() {
  document.documentElement.classList.toggle('flash-renders', enabled);
}
apply();

export const renderFlash = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => enabled,
  set(next: boolean) {
    if (next === enabled) return;
    enabled = next;
    apply();
    listeners.forEach((l) => l());
  },
  toggle() {
    renderFlash.set(!enabled);
  },
};

// The whole component lights up (an inset shadow fills the box, under its
// content), with a thin ring on the edge. Cyan for a render that painted on
// time; orange when the frame it landed in was dropped.
const tint = (rgb: string): Keyframe[] => [
  { boxShadow: `inset 0 0 0 100vmax rgb(${rgb} / 0.22), 0 0 0 2px rgb(${rgb} / 0.9)` },
  { boxShadow: `inset 0 0 0 100vmax rgb(${rgb} / 0), 0 0 0 2px rgb(${rgb} / 0)` },
];
const TINT_OK = tint('246 231 217'); // warm cream: painted on time
const TINT_DROPPED = tint('255 140 26');
const LABEL: Keyframe[] = [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }];
const TIMING: KeyframeAnimationOptions = { duration: 700, easing: 'ease-out' };

function play(el: HTMLElement, dropped: boolean) {
  if (dropped) el.dataset.flashDropped = '';
  else delete el.dataset.flashDropped;
  el.animate(dropped ? TINT_DROPPED : TINT_OK, TIMING);
  try {
    el.animate(LABEL, { ...TIMING, pseudoElement: '::after' });
  } catch {
    // Older engines without pseudo-element animations: tint only.
  }
}

// Elements flashed since the last frame. The next frame tick measures the
// frame these commits landed in; if it was dropped, they flash orange.
let pending: HTMLElement[] = [];
let offFrame: (() => void) | null = null;

function watchFrames() {
  if (offFrame) return;
  offFrame = onFrame(({ cls }) => {
    if (cls === 'dropped' || cls === 'long') pending.forEach((el) => play(el, true));
    pending = [];
  });
}

function flash(el: HTMLElement, label: string) {
  el.dataset.flash = label;
  play(el, false);
  pending.push(el);
  watchFrames();
}

/**
 * Attach the returned ref to the component's root element. Runs after every
 * commit of the component (no dependency list, on purpose).
 */
export function useRenderFlash<T extends HTMLElement>(name: string) {
  const ref = useRef<T>(null);
  const commits = useRef(0);
  useLayoutEffect(() => {
    commits.current++;
    if (enabled && ref.current) flash(ref.current, `${name} ×${commits.current}`);
  });
  return ref;
}
