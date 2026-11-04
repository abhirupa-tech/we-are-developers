import { version as reactVersion } from 'react';

/** Which build is running. Only 'bench' results may be labelled benchmark. */
export type BuildKind = 'dev' | 'bench' | 'prod';

export const BUILD: BuildKind = import.meta.env.DEV ? 'dev' : import.meta.env.MODE === 'bench' ? 'bench' : 'prod';

/** <Profiler onRender> is a no-op in a plain production build. */
export const PROFILER_ACTIVE = BUILD !== 'prod';

export const REACT_VERSION = reactVersion;
export const APP_VERSION = '0.1.0';

const params = new URLSearchParams(window.location.search);

export const FLAGS = {
  /** ?hud=0 hides the HUD, for the HUD-overhead check (spec 5.1). */
  hud: params.get('hud') !== '0',
  /** ?strict=1 wraps the app in StrictMode. Dev only: it doubles renders. */
  strict: params.get('strict') === '1' && BUILD === 'dev',
  /** ?mode=compare starts in Compare mode. */
  compare: params.get('mode') === 'compare',
  /** ?presenter=1 starts in Presenter mode. */
  presenter: params.get('presenter') === '1',
  /** ?api=https://… switches to the HTTP replay source. */
  api: params.get('api') ?? (import.meta.env.VITE_REPLAY_API as string | undefined) ?? '',
};
