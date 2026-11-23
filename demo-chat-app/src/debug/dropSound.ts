import { currentRun, onFrame } from '../metrics/monitor';

/**
 * Drop sound: an animal noise for every dropped frame during a run.
 *
 * Each browser session gets one animal, picked at random: duck, cat, frog or
 * dog. It's kept in sessionStorage, so a refresh keeps the same animal, and
 * closing the tab or browser and opening the URL again rolls a new one.
 * Nobody chooses it.
 *
 * Sounds are synthesised with Web Audio (no audio files, no licences).
 * Browsers only allow audio after a user gesture: the Audio button is one;
 * with ?audio=1 the sound starts on the first click or key press.
 */
export type Animal = 'duck' | 'cat' | 'frog' | 'dog';

const ANIMALS: Animal[] = ['duck', 'cat', 'frog', 'dog'];
export const ANIMAL_EMOJI: Record<Animal, string> = { duck: '🦆', cat: '🐱', frog: '🐸', dog: '🐶' };

function pickAnimal(): Animal {
  const KEY = 'dropSoundAnimal';
  try {
    const saved = sessionStorage.getItem(KEY) as Animal | null;
    if (saved && ANIMALS.includes(saved)) return saved;
  } catch {
    // Storage blocked: still pick, just not sticky across refreshes.
  }
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  try {
    sessionStorage.setItem(KEY, animal);
  } catch {
    // ignore
  }
  return animal;
}

export const animal: Animal = pickAnimal();

let enabled = new URLSearchParams(window.location.search).get('audio') === '1';
let ctx: AudioContext | null = null;
let last = 0;
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

/** Envelope: fast attack to `peak`, exponential decay to silence at `end`. */
function envelope(ac: AudioContext, t: number, end: number, peak: number) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  return g;
}

function wobble(ac: AudioContext, target: AudioParam, rate: number, depth: number, t: number, end: number) {
  const lfo = ac.createOscillator();
  const gain = ac.createGain();
  lfo.frequency.value = rate;
  gain.gain.value = depth;
  lfo.connect(gain).connect(target);
  lfo.start(t);
  lfo.stop(end);
}

/** Rubber-duck squeak: sawtooth jumps up then sags, nasal band-pass. */
function duck(ac: AudioContext, t: number) {
  const end = t + 0.2;
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(620, t);
  osc.frequency.exponentialRampToValueAtTime(1150, t + 0.03);
  osc.frequency.exponentialRampToValueAtTime(880, t + 0.12);
  osc.frequency.exponentialRampToValueAtTime(700, end);
  wobble(ac, osc.frequency, 38, 45, t, end);
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1500;
  band.Q.value = 3;
  osc.connect(band).connect(envelope(ac, t, end, 0.35)).connect(ac.destination);
  osc.start(t);
  osc.stop(end);
}

/** Meow: pitch rises then falls while the formant sweeps "ee" to "ow". */
function cat(ac: AudioContext, t: number) {
  const end = t + 0.45;
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(480, t);
  osc.frequency.exponentialRampToValueAtTime(820, t + 0.14);
  osc.frequency.exponentialRampToValueAtTime(430, end);
  wobble(ac, osc.frequency, 6, 12, t, end);
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 4;
  band.frequency.setValueAtTime(2400, t);
  band.frequency.exponentialRampToValueAtTime(900, end);
  osc.connect(band).connect(envelope(ac, t, end, 0.4)).connect(ac.destination);
  osc.start(t);
  osc.stop(end);
}

/** Ribbit: two short, buzzy, low croaks. */
function frog(ac: AudioContext, t: number) {
  for (const [start, f0] of [
    [0, 190],
    [0.13, 230],
  ] as const) {
    const s = t + start;
    const end = s + 0.09;
    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(f0, s);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.8, end);
    const low = ac.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 1100;
    const amp = envelope(ac, s, end, 0.35);
    wobble(ac, amp.gain, 28, 0.15, s, end); // the buzz
    osc.connect(low).connect(amp).connect(ac.destination);
    osc.start(s);
    osc.stop(end);
  }
}

/** Woof: a short drop in pitch with a breathy noise burst on top. */
function dog(ac: AudioContext, t: number) {
  const end = t + 0.18;
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(320, t);
  osc.frequency.exponentialRampToValueAtTime(140, end);
  const low = ac.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.setValueAtTime(1800, t);
  low.frequency.exponentialRampToValueAtTime(500, end);
  osc.connect(low).connect(envelope(ac, t, end, 0.5)).connect(ac.destination);
  osc.start(t);
  osc.stop(end);

  const len = Math.floor(ac.sampleRate * 0.08);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 900;
  band.Q.value = 1;
  noise.connect(band).connect(envelope(ac, t, t + 0.08, 0.25)).connect(ac.destination);
  noise.start(t);
}

const VOICES: Record<Animal, { play: (ac: AudioContext, t: number) => void; gapMs: number }> = {
  duck: { play: duck, gapMs: 180 },
  cat: { play: cat, gapMs: 420 },
  frog: { play: frog, gapMs: 260 },
  dog: { play: dog, gapMs: 200 },
};

/** Plays this session's animal once. */
export function playDropSound() {
  const ac = context();
  if (!ac) return;
  const voice = VOICES[animal];
  if (ac.state === 'running') voice.play(ac, ac.currentTime);
  else ac.resume().then(() => voice.play(ac, ac.currentTime), () => {});
}

// One sound per dropped frame during a run, spaced so they don't overlap.
onFrame(({ cls }) => {
  if (!enabled || !currentRun() || (cls !== 'dropped' && cls !== 'long')) return;
  const now = performance.now();
  if (now - last < VOICES[animal].gapMs) return;
  last = now;
  playDropSound();
});

// ?audio=1: unlock on the first gesture.
const unlock = () => {
  if (enabled) context();
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
};
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);

export const dropSound = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: () => enabled,
  toggle() {
    enabled = !enabled;
    if (enabled) playDropSound(); // a test sound, so you know it works
    listeners.forEach((l) => l());
  },
};
