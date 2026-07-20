# Condo Life — Web Edition

A Sims-like life simulation for smartphone browsers. three.js game + browser-based designer tool constellation. See `docs/roadmaps/WEB_GAME_ROADMAP.md` for the full plan; the Unreal 5.8 prototype is the design reference.

## Run

```bash
npm install
npm run dev      # → http://localhost:5173
```

`npm run dev` starts `server.js`: Vite middleware for the game/tools **plus** the data API (`GET/PUT /api/data/<file>.json`) that the designer tools use to save. Edit any file in `data/` while the game is open — it hot-reloads within ~2 s.

To test on your phone: run the server, then open `http://<your-pc-ip>:5173` on the phone (same Wi-Fi).

## Layout

- `data/` — the databases. Single source of truth for **every** gameplay number (design pillar: no magic numbers).
- `game/` — three.js game (TypeScript, no framework).
- `tools/` — editor constellation, added from Phase 2.
- `public/models/` — GLB furniture + character (starter pack pending; procedural stand-ins render meanwhile).

## Phase 0 status

- [x] Repo scaffold: Vite + three.js + TypeScript + `server.js` with save endpoints
- [x] `stats.json` / `interactions.json` / `assets.json` / `tuning.json` / `maps/condo.json` schemas
- [x] Game shell: data loading, condo render (floors/walls/doors/objects), sim stand-in at spawn, touch pan/pinch camera with tuning-driven clamps, dev clock, data hot-reload
- [ ] **Verify data values against `CLAUDE.md`** — asset prices/env scores, decay rates, gain rates, autonomy cooldown are PLACEHOLDER (marked in-file)
- [ ] Import starter furniture GLB pack + rigged character (open decision #5: lock art style)
- [ ] Open decision #6: confirm project home (`D:\WebCreation\condo-life` suggested)

TypeScript chosen per open decision #3.
