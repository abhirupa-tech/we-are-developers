/**
 * Device speed reading: time a fixed CPU loop. Lower is faster. Lets runs be
 * compared across machines and DevTools CPU-throttle settings (which a page
 * can't set itself). Median of five passes to shave off noise.
 */
export function calibrateDevice(): number {
  const passes: number[] = [];
  let sink = 0;
  for (let pass = 0; pass < 5; pass++) {
    const t0 = performance.now();
    for (let i = 1; i < 400_000; i++) sink += Math.sqrt(i) * Math.sin(i);
    passes.push(performance.now() - t0);
  }
  // Keep the result observable so the loop can't be optimised away.
  if (sink === Number.POSITIVE_INFINITY) console.log(sink);
  passes.sort((a, b) => a - b);
  return Math.round(passes[2] * 10) / 10;
}
