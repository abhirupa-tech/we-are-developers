import { version as reactVersion } from 'react';

/** Which build is running. Only 'bench' results may be labelled benchmark. */
export type BuildKind = 'dev' | 'bench' | 'prod';

export const BUILD: BuildKind = import.meta.env.DEV ? 'dev' : import.meta.env.MODE === 'bench' ? 'bench' : 'prod';

/** <Profiler onRender> is a no-op in a plain production build. */
export const PROFILER_ACTIVE = BUILD !== 'prod';

export const REACT_VERSION = reactVersion;

/** Phone layout (matches the 640px breakpoint in styles.css): recordings only, no Gemini tabs. */
export const IS_PHONE = window.matchMedia('(max-width: 640px)').matches;
export const APP_VERSION = '0.1.0';

const params = new URLSearchParams(window.location.search);

export const FLAGS = {
  /** ?hud=0 hides the HUD, for the HUD-overhead check (spec 5.1). */
  hud: params.get('hud') !== '0',
  /** ?strict=1 wraps the app in StrictMode. Dev only: it doubles renders. */
  strict: params.get('strict') === '1' && BUILD === 'dev',
  /** ?mode=compare starts in Compare mode. */
  compare: params.get('mode') === 'compare',
  /** ?mode=live starts in Live mode (a real Gemini chat). */
  live: params.get('mode') === 'live',
  /** ?mode=a2ui starts in A2UI mode (Gemini answering with interactive UI). */
  a2ui: params.get('mode') === 'a2ui',
  /** ?strategy=setState|memo|frameBatched picks the strategy. */
  strategy: params.get('strategy') ?? '',
  /** ?recording=demo-3k picks the pre-recorded answer. */
  recording: params.get('recording') ?? '',
  /** ?rate=5 sets the replay speed. */
  rate: Number(params.get('rate')) || 0,
  /** ?cpu=4 sets the simulated CPU throttle. */
  cpu: Number(params.get('cpu')) || 1,
  /** ?presenter=1 starts in Presenter mode. */
  presenter: params.get('presenter') === '1',
  /** ?api=https://… switches to the HTTP replay source. */
  api: params.get('api') ?? (import.meta.env.VITE_REPLAY_API as string | undefined) ?? '',
};

/** Live mode. The key comes from .env.local (see .env.example), never from source. */
export const GEMINI = {
  apiKey: (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? '',
  model: (import.meta.env.VITE_GEMINI_MODEL as string | undefined) ?? 'gemini-3.5-flash',
};
