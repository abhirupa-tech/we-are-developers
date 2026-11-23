import { currentRun, onFrame } from '../metrics/monitor';

/**
 * "Quack on drop": a rubber-duck squeak for every dropped frame during a run.
 * The squeak is synthesised with Web Audio (no audio file, no licence): a
 * squeaky pitch bend, nasal band-pass, quick decay. At most one quack every
 * 180 ms, so a burst of drops sounds like an angry duck, not a buzz.
 *
 * Browsers only allow audio after a user gesture. The Audio button is one;
 * with ?audio=1 the sound starts on the first click or key press.
 */
let enabled = new URLSearchParams(window.location.search).get('audio') === '1';
let ctx: AudioContext | null = null;
let lastQuack = 0;
const listeners = new Set<() => void>();

function context(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function quack() {
  const ac = context();
  if (!ac) return;
  if (ac.state === 'running') play(ac);
  else ac.resume().then(() => play(ac), () => {});
}

function play(ac: AudioContext) {
  const t = ac.currentTime;
  const dur = 0.2;

  // Squeak: a sawtooth that jumps up, then sags, like air through a duck.
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(620, t);
  osc.frequency.exponentialRampToValueAtTime(1150, t + 0.03);
  osc.frequency.exponentialRampToValueAtTime(880, t + 0.12);
  osc.frequency.exponentialRampToValueAtTime(700, t + dur);

  // Wobble for the rubbery flutter.
  const lfo = ac.createOscillator();
  const lfoGain = ac.createGain();
  lfo.frequency.value = 38;
  lfoGain.gain.value = 45;
  lfo.connect(lfoGain).connect(osc.frequency);

  // Nasal formant.
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1500;
  band.Q.value = 3;

  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(0.35, t + 0.015);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  osc.connect(band).connect(amp).connect(ac.destination);
  osc.start(t);
  lfo.start(t);
  osc.stop(t + dur);
  lfo.stop(t + dur);
}

onFrame(({ cls }) => {
  if (!enabled || !currentRun() || (cls !== 'dropped' && cls !== 'long')) return;
  const now = performance.now();
  if (now - lastQuack < 180) return;
  lastQuack = now;
  quack();
});

// ?audio=1: unlock on the first gesture.
const unlock = () => {
  if (enabled) context();
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
};
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

export const quackAudio = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => enabled,
  toggle() {
    enabled = !enabled;
    if (enabled) {
      context();
      quack(); // a test quack, so you know it works
    }
    listeners.forEach((l) => l());
  },
};
