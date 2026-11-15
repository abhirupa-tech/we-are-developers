import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Two targets:
 * - dev (`npm run dev`): readable errors, ?strict=1 available.
 * - bench (`npm run build`, mode "bench"): production React with the
 *   profiling build of react-dom aliased in, because <Profiler onRender> is a
 *   no-op in the standard production bundle. Verified for react-dom 19.2.8:
 *   `react-dom/profiling` exports createRoot.
 */
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: mode === 'bench' ? { alias: { 'react-dom/client': 'react-dom/profiling' } } : {},
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
