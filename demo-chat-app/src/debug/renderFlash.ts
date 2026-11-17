import { useLayoutEffect, useRef } from 'react';

/**
 * "Flash renders": outline a component every time it commits, with a small
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

const OUTLINE: Keyframe[] = [
  { outlineColor: 'rgb(255 196 75 / 0.95)', boxShadow: '0 0 0 3px rgb(255 196 75 / 0.25), 0 0 22px rgb(255 196 75 / 0.25)' },
  { outlineColor: 'rgb(255 196 75 / 0)', boxShadow: '0 0 0 3px rgb(255 196 75 / 0), 0 0 22px rgb(255 196 75 / 0)' },
];
const LABEL: Keyframe[] = [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }];
const TIMING: KeyframeAnimationOptions = { duration: 700, easing: 'ease-out' };

function flash(el: HTMLElement, label: string) {
  el.dataset.flash = label;
  el.animate(OUTLINE, TIMING);
  try {
    el.animate(LABEL, { ...TIMING, pseudoElement: '::after' });
  } catch {
    // Older engines without pseudo-element animations: outline only.
  }
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
