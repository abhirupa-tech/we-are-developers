import { currentRun, onFrame } from '../metrics/monitor';

/**
 * Drop sound: an animal noise for every dropped frame during a run.
 *
 * Every page load picks one animal at random: duck, cat, frog or dog. A
 * refresh rolls again. Nobody chooses it.
 *
 * Sounds are real recordings from Wikimedia Commons (public/sounds; credits
 * in CREDITS.md there). Synthesised voices cover the moment before a file
 * has loaded, or a failed load; they render offline too (`renderVoice`).
 * Browsers only allow audio after a user gesture: the Audio button is one;
 * with ?audio=1 the sound starts on the first click or key press.
 */
export type Animal = 'duck' | 'cat' | 'frog' | 'dog';

const ANIMALS: Animal[] = ['duck', 'cat', 'frog', 'dog'];
export const ANIMAL_EMOJI: Record<Animal, string> = { duck: '🦆', cat: '🐱', frog: '🐸', dog: '🐶' };

export const animal: Animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];

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
    const amp = envelope(ac, s, end, 0.14);
    wobble(ac, amp.gain, 28, 0.06, s, end); // the buzz
    osc.connect(low).connect(amp).connect(ac.destination);
    osc.start(s);
    osc.stop(end);
  }
}

/** Soft-clipping curve: adds the rasp and growl of a real bark. */
function growlCurve(amount: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  return curve;
}

/** One bark: "wuh-OOF". A raspy voiced burst, mouth opening then closing. */
function bark(ac: AudioContext, t: number, f0: number, peak: number) {
  const end = t + 0.19;

  // Voice: two detuned sawtooths, pitch jumps up then drops (the "OOF").
  const voice = ac.createGain();
  voice.gain.value = 0.6;
  for (const detune of [-12, 14]) {
    const osc = ac.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(f0 * 0.75, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 1.25, t + 0.03);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.6, end);
    osc.connect(voice);
    osc.start(t);
    osc.stop(end);
  }

  // Breath: noise under the voice, strongest at the onset.
  const len = Math.floor(ac.sampleRate * 0.19);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = buf;
  const breath = ac.createGain();
  breath.gain.setValueAtTime(0.5, t);
  breath.gain.exponentialRampToValueAtTime(0.12, t + 0.08);
  noise.connect(breath);
  noise.start(t);

  // Rasp: the mix is overdriven, then amplitude-wobbled like vocal fry.
  const drive = ac.createWaveShaper();
  drive.curve = growlCurve(4);
  voice.connect(drive);
  breath.connect(drive);
  const fry = ac.createGain();
  fry.gain.value = 0.8;
  drive.connect(fry);
  wobble(ac, fry.gain, 62, 0.25, t, end);

  // Mouth: low-pass opens fast (the "w"), then closes; a chest formant.
  const mouth = ac.createBiquadFilter();
  mouth.type = 'lowpass';
  mouth.Q.value = 2;
  mouth.frequency.setValueAtTime(500, t);
  mouth.frequency.exponentialRampToValueAtTime(2600, t + 0.025);
  mouth.frequency.exponentialRampToValueAtTime(700, end);
  const chest = ac.createBiquadFilter();
  chest.type = 'peaking';
  chest.frequency.value = 900;
  chest.Q.value = 1.5;
  chest.gain.value = 8;

  const amp = ac.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  amp.gain.setValueAtTime(peak, t + 0.05);
  amp.gain.exponentialRampToValueAtTime(0.0001, end);

  fry.connect(mouth).connect(chest).connect(amp).connect(ac.destination);
}

/** Woof woof: two barks, the second a touch lower and softer. */
function dog(ac: AudioContext, t: number) {
  bark(ac, t, 420, 0.1);
  bark(ac, t + 0.24, 380, 0.08);
}

const VOICES: Record<Animal, { play: (ac: AudioContext, t: number) => void; gapMs: number }> = {
  duck: { play: duck, gapMs: 180 },
  cat: { play: cat, gapMs: 420 },
  frog: { play: frog, gapMs: 260 },
  dog: { play: dog, gapMs: 480 },
};

/** Renders one animal into an offline buffer, for previews and tests. */
export async function renderVoice(name: Animal, sampleRate = 44100): Promise<AudioBuffer> {
  const off = new OfflineAudioContext(1, Math.ceil(sampleRate * 0.7), sampleRate);
  VOICES[name].play(off as unknown as AudioContext, 0.02);
  return off.startRendering();
}

/** Plays this page's animal once. */
// Real recordings (public/sounds, credits in public/sounds/CREDITS.md),
// decoded once into an AudioBuffer so each play is instant. The synthesised
// voices above are the fallback while a file loads, or if it fails.
const recordings = new Map<Animal, AudioBuffer | null>();
let loading: Promise<void> | null = null;

function loadRecording(ac: AudioContext) {
  loading ??= fetch(`${import.meta.env.BASE_URL}sounds/${animal}.mp3`)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((data) => ac.decodeAudioData(data))
    .then((buffer) => {
      recordings.set(animal, buffer);
    })
    .catch(() => {
      recordings.set(animal, null);
    });
}

function play(ac: AudioContext) {
  const buffer = recordings.get(animal);
  if (buffer) {
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    src.buffer = buffer;
    gain.gain.value = 0.8;
    src.connect(gain).connect(ac.destination);
    src.start();
  } else {
    VOICES[animal].play(ac, ac.currentTime);
  }
}

/** Plays this page's animal once. */
export function playDropSound() {
  const ac = context();
  if (!ac) return;
  loadRecording(ac);
  if (ac.state === 'running') play(ac);
  else ac.resume().then(() => play(ac), () => {});
}

/** Spacing between sounds: the recording's length, or the synth voice's. */
function gapMs() {
  const buffer = recordings.get(animal);
  return buffer ? buffer.duration * 1000 : VOICES[animal].gapMs;
}

// One sound per dropped frame during a run, spaced so they don't overlap.
onFrame(({ cls }) => {
  if (!enabled || !currentRun() || (cls !== 'dropped' && cls !== 'long')) return;
  const now = performance.now();
  if (now - last < gapMs()) return;
  last = now;
  playDropSound();
});

// ?audio=1: unlock on the first gesture.
const unlock = () => {
  const ac = enabled ? context() : null;
  if (ac) loadRecording(ac);
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
      // A test sound, so you know it works: wait for the recording first.
      const ac = context();
      if (ac) {
        loadRecording(ac);
        void loading?.then(playDropSound);
      }
    }
    listeners.forEach((l) => l());
  },
};
