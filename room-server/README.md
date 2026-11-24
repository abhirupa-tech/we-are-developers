# MockGPT live room

A tiny Cloudflare Worker that lets a whole audience run the MockGPT demo
together. Every phone reports its frame stats; the room screen adds them up
live; the presenter can start a round on every phone at once.

Runs on the **Cloudflare Workers Free plan** (no credit card): one Durable
Object per room (SQLite storage backend) holds the room and pushes a snapshot
to every connected screen twice a second.

## URLs

| Who | URL |
| --- | --- |
| Audience (the QR code) | `https://abhirupa-tech.github.io/we-are-developers/?room=<room>&audio=1` |
| Projector (view only) | `…/we-are-developers/?view=room&room=<room>` |
| Presenter (controls) | `…/we-are-developers/?view=room&room=<room>&key=<secret>` |

The first screen that opens a room with a `key` claims it; only that key can
start, stop or reset rounds. Pick a room name and key nobody can guess.

Room screen keys: **C** toggles the presenter controls, **F** fullscreen.

## Endpoints

- `GET /rooms/<room>`: live snapshot (JSON)
- `GET /rooms/<room>.csv`: per-device results, one row per device and strategy
- `GET /rooms/<room>/ws`: WebSocket for devices and screens

## What is collected

Per device, anonymous: a random id per page load, its animal, whether it's a
touch device, the device-speed reading, and per run: frames, dropped, slow and
long frames, worst frame, commits and total render time, plus how many animal
noises it made. No names, accounts or IP addresses are stored.

## Develop and deploy

```bash
npm install
npm run dev                                       # local server on :8787
npm run audience -- ws://127.0.0.1:8787 test 50 120   # fake audience
npx wrangler deploy                               # needs CLOUDFLARE_API_TOKEN
```

Point the demo app at a server with `VITE_ROOM_SERVER` at build time, or
`&server=<url>` in the page URL for testing.

## Deployed

`https://mockgpt-room.mockgpt-live.workers.dev` (Workers Free plan). The
GitHub Pages build points at it through `VITE_ROOM_SERVER` in
`.github/workflows/pages.yml`.
