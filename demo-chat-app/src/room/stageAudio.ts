import { ANIMALS, type Animal } from '../debug/dropSound';
import type { RoomSnapshot } from './protocol';

/**
 * Stage audio, for silent stages: the projector laptop is the one device
 * wired into everyone's headphones, so it plays the room's dropped frames
 * as animal noises. Each team has its own place in the stereo field (dogs
 * left, ducks centre, cats right), at most a few sounds a second per team,
 * louder when that team is dropping more.
 */
const PAN: Record<Animal, number> = { dog: -0.85, duck: 0, cat: 0.85 };
/** At most this many sounds per team per snapshot (snapshots arrive twice a second). */
const MAX_PER_TICK = 2;
/** Dropped frames per sound: 1 sound for the first drop, then one per this many. */
const DROPS_PER_SOUND = 12;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const clips = new Map<Animal, AudioBuffer>();
let enabled = false;
const prev: Partial<Record<Animal, number>> = {};
let prevRound: number | null = null;
const listeners = new Set<() => void>();

let ready: Promise<void> | null = null;

/** Creates the audio graph and loads the clips once; every caller waits for the same load. */
function init(): Promise<void> {
  if (ctx?.state === 'suspended') void ctx.resume();
  ready ??= load();
  return ready;
}

async function load() {
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  await Promise.all(
    ANIMALS.map(async (a) => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}sounds/${a}.mp3`);
        clips.set(a, await ctx!.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // missing clip: that team stays silent
      }
    }),
  );
}

function play(team: Animal, when: number, volume: number) {
  const clip = clips.get(team);
  if (!ctx || !master || !clip) return;
  const src = ctx.createBufferSource();
  src.buffer = clip;
  src.playbackRate.value = 0.94 + Math.random() * 0.12; // a crowd, not a loop
  const gain = ctx.createGain();
  gain.gain.value = volume;
  const pan = ctx.createStereoPanner();
  pan.pan.value = PAN[team];
  src.connect(gain).connect(pan).connect(master);
  src.start(when);
}

export const stageAudio = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  getSnapshot: () => enabled,
  /** Must be called from a click: browsers only start audio after a gesture. */
  async toggle() {
    enabled = !enabled;
    listeners.forEach((l) => l());
    if (enabled) await init();
  },
  /** Plays dog (left), duck (centre), cat (right): for a level check with the AV crew. */
  async test() {
    await init();
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    ANIMALS.forEach((a, i) => play(a, t + i * 0.9, 0.8));
  },
  /** Feed every room snapshot in; plays the drops since the previous one. */
  onSnapshot(snap: RoomSnapshot) {
    const round = snap.round?.id ?? null;
    if (round !== prevRound) {
      // New round: the per-round drop counters restart from zero.
      prevRound = round;
      for (const a of ANIMALS) prev[a] = 0;
    }
    for (const a of ANIMALS) {
      const dropped = snap.teams[a]?.dropped ?? 0;
      const delta = dropped - (prev[a] ?? dropped);
      prev[a] = dropped;
      if (!enabled || !ctx || ctx.state !== 'running' || delta <= 0) continue;
      const n = Math.min(MAX_PER_TICK, 1 + Math.floor(delta / DROPS_PER_SOUND));
      const volume = Math.min(1, 0.45 + delta / 60);
      for (let i = 0; i < n; i++) play(a, ctx.currentTime + 0.02 + i * 0.22 + Math.random() * 0.06, volume);
    }
  },
};
