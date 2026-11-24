// Fake audience for rehearsals: N devices that join a room and follow the presenter.
// Usage: node scripts/audience.mjs <ws-base> <room> <devices> <seconds>
// e.g.   node scripts/audience.mjs wss://mockgpt-room.example.workers.dev rehearsal 50 600
const [BASE, ROOM, N, SECS] = [process.argv[2], process.argv[3], Number(process.argv[4]), Number(process.argv[5])];
const ANIMALS = ['dog', 'cat', 'rooster', 'duck'];
const DROP = { setState: 0.35, buffered: 0.12, frameBatched: 0.02 };
const MS = { setState: 9, buffered: 14, frameBatched: 15 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < N; i++) {
  const ws = new WebSocket(`${BASE}/rooms/${ROOM}/ws`);
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', id: `sim-${i}`, role: 'player', animal: ANIMALS[(i * 7) % 4], mobile: true, deviceMs: 30 }));
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data); if (m.t !== 'go') return;
    await sleep(Math.random() * 600);
    const run = { runId: `sim-${i}-${Date.now()}`, strategy: m.strategy, cpu: m.cpu, frames: 0, dropped: 0, slow: 0, long: 0, worst: 16, commits: 0, renderMs: 0 };
    for (let s = 0; s < 6; s++) {
      const d = Math.round(60 * DROP[m.strategy] * (0.5 + Math.random()));
      const c = m.strategy === 'setState' ? 120 : m.strategy === 'buffered' ? 20 : 50;
      run.frames += 60; run.dropped += d; run.slow += Math.round(d / 2); run.long += Math.round(d / 6); run.commits += c; run.renderMs += c * MS[m.strategy]; run.worst = Math.max(run.worst, 16 + d * 3);
      ws.send(JSON.stringify({ t: 'live', run })); ws.send(JSON.stringify({ t: 'sound', n: Math.min(d, 4) }));
      await sleep(1000);
    }
    ws.send(JSON.stringify({ t: 'final', run }));
  };
}
await sleep(SECS * 1000); process.exit(0);
