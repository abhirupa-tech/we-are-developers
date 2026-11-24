import { currentRun, onFrame } from '../metrics/monitor';

/**
 * Drop sound: a cartoony animal noise for every dropped frame during a run.
 *
 * Every page load picks one animal at random: dog, cat or duck. A refresh
 * rolls again. Nobody chooses it. In a live room the server assigns it
 * instead (balanced teams), through setAnimal().
 *
 * The clips live in public/sounds (credits in CREDITS.md there). Each is
 * fetched and decoded once into an AudioBuffer, so playing it is instant.
 * Browsers only allow audio after a user gesture: the Audio button is one;
 * with ?audio=1 the sound starts on the first click or key press.
 */
export type Animal = 'dog' | 'cat' | 'duck';

export const ANIMALS: Animal[] = ['dog', 'duck', 'cat'];
export const ANIMAL_EMOJI: Record<Animal, string> = { dog: '🐶', cat: '🐱', duck: '🦆' };

let animal: Animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
const animalListeners = new Set<() => void>();

export const getAnimal = () => animal;
export function subscribeAnimal(listener: () => void) {
  animalListeners.add(listener);
  return () => {
    animalListeners.delete(listener);
  };
}
/** Switch this page's animal (the live room assigns teams). Reloads the clip. */
export function setAnimal(next: Animal) {
  if (next === animal || !ANIMALS.includes(next)) return;
  animal = next;
  clip = null;
  loading = null;
  if (ctx) void load(ctx);
  animalListeners.forEach((l) => l());
}

let enabled = new URLSearchParams(window.location.search).get('audio') === '1';
let ctx: AudioContext | null = null;
let clip: AudioBuffer | null = null;
let loading: Promise<void> | null = null;
let last = 0;
const listeners = new Set<() => void>();
const soundListeners = new Set<() => void>();

/** Called for every dropped-frame sound played (not the test sound). */
export function onDropSound(listener: () => void) {
  soundListeners.add(listener);
  return () => {
    soundListeners.delete(listener);
  };
}

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

function load(ac: AudioContext): Promise<void> {
  loading ??= fetch(`${import.meta.env.BASE_URL}sounds/${animal}.mp3`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`sound ${r.status}`))))
    .then((data) => ac.decodeAudioData(data))
    .then((buffer) => {
      clip = buffer;
    })
    .catch(() => {
      // No clip, no sound: the visual signals still work.
    });
  return loading;
}

function play(ac: AudioContext) {
  if (!clip) return;
  const src = ac.createBufferSource();
  const gain = ac.createGain();
  src.buffer = clip;
  gain.gain.value = 0.7;
  src.connect(gain).connect(ac.destination);
  src.start();
}

/** Plays this page's animal once. */
export function playDropSound() {
  const ac = context();
  if (!ac) return;
  void load(ac);
  if (ac.state === 'running') play(ac);
  else ac.resume().then(() => play(ac), () => {});
}

// One sound per dropped frame during a run, spaced by the clip's length so
// they never overlap.
onFrame(({ cls }) => {
  if (!enabled || !clip || !currentRun() || (cls !== 'dropped' && cls !== 'long')) return;
  const now = performance.now();
  if (now - last < clip.duration * 1000) return;
  last = now;
  playDropSound();
  soundListeners.forEach((l) => l());
});

// ?audio=1: unlock and load on the first gesture.
const unlock = () => {
  const ac = enabled ? context() : null;
  if (ac) void load(ac);
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
    if (enabled) {
      // A test sound, so you know it works.
      const ac = context();
      if (ac) void load(ac).then(playDropSound);
    }
    listeners.forEach((l) => l());
  },
};
