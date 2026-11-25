import { ANIMAL_EMOJI, getAnimal } from '../debug/dropSound';
import { currentRun, onFrame } from '../metrics/monitor';
import { TEAM_COLOR } from './teams';

/**
 * Silent-stage feedback on audience phones: every dropped frame during a run
 * makes the screen edge glow in the team's colour and the team's animal pop
 * up, plus a short buzz where the browser allows it (Android; iOS has no web
 * vibration). In a dark hall you can see which team's phones are struggling.
 *
 * Built to be cheap while the phone is measuring itself: the glow is a
 * pre-rendered layer whose opacity animates, and the emoji only moves and
 * fades, so the compositor does the work, not the main thread.
 */
const MIN_GAP_MS = 140;
const BUZZ_GAP_MS = 300;

let layer: HTMLDivElement | null = null;
let glow: HTMLDivElement | null = null;
let last = 0;
let lastBuzz = 0;
let off: (() => void) | null = null;

function ensureLayer() {
  if (layer) return;
  layer = document.createElement('div');
  layer.className = 'drop-flash';
  layer.setAttribute('aria-hidden', 'true');
  glow = document.createElement('div');
  glow.className = 'drop-flash-glow';
  layer.appendChild(glow);
  document.body.appendChild(layer);
}

function flash() {
  if (!layer || !glow) return;
  const team = getAnimal();
  layer.style.setProperty('--c', TEAM_COLOR[team]);
  glow.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 420, easing: 'ease-out' });

  const pop = document.createElement('span');
  pop.className = 'drop-flash-pop';
  pop.textContent = ANIMAL_EMOJI[team];
  pop.style.left = `${10 + Math.random() * 70}%`;
  pop.style.top = `${15 + Math.random() * 55}%`;
  layer.appendChild(pop);
  const a = pop.animate(
    [
      { opacity: 0, transform: 'translateY(10px) scale(0.6)' },
      { opacity: 1, transform: 'translateY(0) scale(1.1)', offset: 0.25 },
      { opacity: 0, transform: 'translateY(60px) scale(0.9)' },
    ],
    { duration: 700, easing: 'ease-out' },
  );
  a.onfinish = () => pop.remove();

  const now = performance.now();
  if (now - lastBuzz > BUZZ_GAP_MS) {
    lastBuzz = now;
    try {
      navigator.vibrate?.(25);
    } catch {
      // not allowed
    }
  }
}

/** Turn the effect on for this page (once the phone has joined a room). */
export function enableDropFlash() {
  if (off) return;
  ensureLayer();
  off = onFrame(({ cls }) => {
    if (!currentRun() || (cls !== 'dropped' && cls !== 'long')) return;
    const now = performance.now();
    if (now - last < MIN_GAP_MS) return;
    last = now;
    flash();
  });
}
