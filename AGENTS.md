# AGENTS.md — Codex handover for Condo Life (Web Edition)

> **handoff.json** in the repo root is the machine-readable index of everything (docs, data schema, tools, verification gates, state, next steps) — read it first when starting cold.

> **Invoking Codex**: use `codex exec --sandbox workspace-write "<prompt>" < /dev/null`. The old `--full-auto` flag is DEPRECATED and makes Codex hang waiting on stdin (silent stall, writes nothing) — always pass `--sandbox workspace-write` and redirect stdin from /dev/null. Don't pipe the output through `tail` if you need to see errors.

You (Codex) are taking over as the coding agent for this repo when the designer's Claude usage is exhausted. The designer (Septentrion / user) is NOT a programmer — they drive everything through the browser tool suite and plain-language requests.

## Read these before ANY task
1. **PROJECT_CONTEXT.md** — the canonical, living design + as-built doc. §5 = working conventions. Numbered §7.x sections describe every shipped system. **Where it disagrees with anything else, it wins.** Update it (short as-built notes) whenever you change behavior/schema.
2. **ROADMAP_NEXT.md** — the designer's request batches. Items get marked DONE with a one-line note when shipped. New designer requests should be appended here first (verbatim intent, then your design reading), then built.

## Project shape
- Vite + three.js + TypeScript. `npm run dev` = `node server.js` on port 5173 (serves the game, the tools, and a `GET/PUT /api/data/<path>` JSON API the tools save through; the game hot-reload-polls `/data/*.json` every 2s).
- **Everything is data-driven**: `data/*.json` (assets, interactions, stats incl. personality, tuning, quests, simstate, visas, jobs, maps/*) edited through `tools/*.html` (Asset/Interaction/Tuning/Map/Animation/Quest/Career editors + shared `tools/nav.js` tab strip). Rule: *if the designer might want to change it, it's a JSON field with a tool UI, not code.* No magic numbers — tunables go in `data/tuning.json`.
- Game modules in `game/*.ts` follow a strict split: **pure, headless-testable logic** (no DOM/three.js) + a thin three.js/UI layer. Precedents: doors.ts, accidents.ts, sprites.ts, marker.ts, quests.ts, visas.ts, work.ts, phone.ts, garbage.ts, buymode.ts.
- Tools architecture: editor logic in a **plain inline script** exposed as `window.<Tool>` (jsdom-testable); three.js/game-module imports only in a separate `type="module"` script. Tools import game logic (never reimplement). Saves PUT whole files with `JSON.stringify(data, null, 2)`.

## Mandatory verification for every change
- `npx tsc --noEmit --strict --target es2020 --moduleResolution bundler --module esnext --skipLibCheck game/*.ts` — must be clean if you touched game/*.ts.
- Test suites: `node test/<name>.test.mjs` and `node tools/<name>.test.mjs` (jsdom tool suites); `npx tsx test/<name>.test.ts` (pure-logic suites, run ONE file at a time). Run every suite your change could affect + write new coverage for new pure logic. Known quirk: `test/meshfit.test.mjs` only passes under `npx tsx`, not plain `node` (documented, ignore).
- Dev server: if 5173 is up, USE it (never kill the designer's server); confirm the game boots with zero new console errors after game-side changes.
- **Do not `git commit` unless the designer asks.** If asked: one commit per slice, imperative subject, body explaining behavior. IMPORTANT: the designer constantly playtests and edits data through the tools — if `git status` shows `data/*.json` changes you didn't make, commit them SEPARATELY as "Designer data edits via tools" before committing your code, never mixed in and NEVER reverted.

## Current state (2026-07-15 night)
Everything through ROADMAP_NEXT batch 3 is shipped: full needs/skills/personality sim, autonomy, quests, doors/windows/exterior door, accidents (fire spread/destruction) + transients, garbage/tidying, buy/sell mode, PWA/mobile, audio, camera rotate, sprite/GIF visuals, overhead marker, censor, progress bars, duration system with modifiers, interaction conditions, and the core loop: **visas (state machine, game over) + phone/jobs + going to work + Career Editor** (PROJECT_CONTEXT §7.20).

## Known next steps / open items
- **Save system** — the natural next big slice. Every runtime system already exposes `serialize()`/`restore()` (QuestRunner, AccidentRegistry, BuyOverlay, VisaState, work/skips, garbage fill). Needs: a save/load surface (e.g. localStorage or `data/save/` via the API — data/save/*.json is gitignored), wiring all restores at boot.
- Balance Dashboard (nice-to-have from PROJECT_CONTEXT §1 table).
- Designer will delete the placed `phone` asset once the smartphone HUD icon fully replaces it.
- The stove may still carry a testing `baseChancePercent: 100` fire risk — designer resets it when done testing.
- Quests granting upgrade visas still need authoring by the designer (Quest Editor → grantVisa reward exists).

## Hard-earned pitfalls
- Designer pastes Windows file paths into tools — always normalize to URLs under `public/` (see Animation Mapper's `normalizeSourcePath` precedent).
- Map-editor test fixtures must DERIVE coordinates from live map data, never hardcode (broke 3 times).
- Action side effects (cleanup, waste, accident rolls) fire ONLY on completed actions (`stopAction(completed)`) — never on cancels.
- Sim-time (`sdt`) drives all gameplay animation/timers (pause/speed must affect them); real-time only for pure cosmetics.
- jsdom tests can't run module scripts or WebGL — keep logic testable in the inline script / pure modules.
