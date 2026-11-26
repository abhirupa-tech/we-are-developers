// Fake audience for rehearsals: N phones that join a room, get a team, and
// run their team's method whenever the presenter starts a round.
// Usage: node scripts/audience.mjs <ws-base> <room> <phones> <seconds>
// e.g.   node scripts/audience.mjs wss://mockgpt-room.mockgpt-live.workers.dev rehearsal 50 600
const [BASE, ROOM, N, SECS] = [process.argv[2], process.argv[3], Number(process.argv[4] ?? 50), Number(process.argv[5] ?? 600)];
const STRATEGY = { dog: 'frameBatched', duck: 'memo', cat: 'setState' };
const DROP = { setState: 0.34, memo: 0.14, frameBatched: 0.03 }; // rough drop rates per method
const MS = { setState: 9, memo: 4, frameBatched: 5 };
const COMMITS = { setState: 120, memo: 120, frameBatched: 50 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (let i = 0; i < N; i++) {
  const ws = new WebSocket(`${BASE}/rooms/${ROOM}/ws`);
  let team = null;
  const hello = () => ws.send(JSON.stringify({ t: 'hello', id: `fake-${i}`, role: 'player', team, mobile: true, deviceMs: 25 + (i % 5) * 10 }));
  ws.onopen = hello;
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.t === 'welcome') team = m.team ?? team;
    if (m.t === 'rejoin') hello();
    if (m.t !== 'go' || !team) return;
    const strategy = STRATEGY[team];
    const slow = 0.6 + (i % 5) * 0.2; // some phones are slower than others
    await sleep(Math.random() * 600);
    const run = { runId: `fake-${i}-${m.id}`, strategy, cpu: m.cpu, round: m.id, frames: 0, dropped: 0, slow: 0, long: 0, worst: 16, commits: 0, renderMs: 0 };
    for (let s = 0; s < 6; s++) {
      const d = Math.round(60 * Math.min(0.9, DROP[strategy] * slow) * (0.7 + Math.random() * 0.6));
      run.frames += 60; run.dropped += d; run.slow += Math.round(d / 2); run.long += Math.round(d / 6);
      run.commits += COMMITS[strategy]; run.renderMs += COMMITS[strategy] * MS[strategy] * slow; run.worst = Math.max(run.worst, 16 + d * 3);
      ws.send(JSON.stringify({ t: 'live', run }));
      await sleep(1000);
    }
    ws.send(JSON.stringify({ t: 'final', run }));
  };
}
await sleep(SECS * 1000);
process.exit(0);
