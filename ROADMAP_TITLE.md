# ROADMAP_TITLE.md — Main title screen: New Game, Load, Options, hosting-ready

> Planning document (2026-07-18). **No code written yet.** Batch 14 track B. Depends on
> ROADMAP_SAVE.md (the Load Game screen consumes its V2 slot API — build SAVE V1–V2 first).
> Same rules as always: PROJECT_CONTEXT.md wins, AGENTS.md gates per slice, one commit per
> slice, everything data-driven with tool UI, theme system for ALL styling (B13-1 gave the
> Theme Editor per-element control — the title screen must be themable from day one, not
> retrofitted).

---

## 0. Designer request (verbatim intent)

> One for the main title screen, with the options for a new game, load a save, and general
> options (sound etc.). Keep in mind two things: this should be responsive on smartphones, and
> eventually the game will be hosted (Netlify, Github or specific server, whatever).

---

## 1. Big picture

Three concerns, deliberately separated:

1. **The screen itself** — a DOM overlay (not WebGL) shown BEFORE the world boots: New Game /
   Load Game / Options. DOM because: it must render instantly before assets load, it reuses
   the theme system (CSS custom properties), it's trivially responsive, and jsdom can test it.
   The existing loading screen (§7.x, data/loading.json) becomes the transition AFTER a title
   choice, not the first thing seen. Boot order becomes:
   `title (instant) → choice → loading screen (asset gate) → game`.
   New Game starts fresh (current behavior); Load restores via ROADMAP_SAVE; until SAVE V2
   exists, Load renders disabled with a "coming soon" tooltip (ship T1/T2 without waiting).
2. **Options** — general settings that are NOT sim tuning: master/music/UI-feedback volume
   (consumed by game/audio.ts), optionally language placeholder and credits. These are PLAYER
   preferences, not designer data: they persist in localStorage (`prefs` key, tiny bespoke
   store — NOT the save envelope, they apply across saves), with defaults + option definitions
   in `data/title.json` so the designer controls what's offered and its defaults.
3. **Hosting-readiness** — the game must run from a STATIC host (Netlify/GitHub Pages) with no
   dev server. Audit and fix the static path: `GET /data/*.json` works as static files, but the
   2s hot-reload polling, `PUT /api/data`, `/api/textures|fonts|icons|maps` are dev-server-only.
   Production build must: skip/degrade hot-reload polling gracefully, never call /api/* from the
   GAME (tools are dev-only and excluded from the deploy), keep the PWA/SW behavior correct on a
   real origin (network-only /data rule already exists — verify it against static hosting where
   /data files DO change on redeploys). No specific host is chosen yet ("whatever") — target
   "any static file host" and add a `netlify.toml` example; a Node host stays possible later.

Everything on the title screen is data-driven via `data/title.json`: menu entries (id, label,
enabled, order), background (image under public/, or the D4 exterior scene later — see §4),
music track, logo image/text, options definitions (id, type slider/toggle, min/max, default),
credits text. Styling via theme.json component keys (`components.titleScreen`, buttons reuse
the themed button styles) so the B13-1 Theme Editor gallery picks them up.

---

## 2. Slices

### T1 — Pure title core + config — ✅ SHIPPED (2026-07-18, with T2)
Menu model from data (entries, enabled/disabled resolution — Load's availability comes from a
`hasSaves` input, wired later), options model (definitions + current values), prefs store
read/write (localStorage adapter injected, jsdom-able), volume application contract with
game/audio.ts (master/music/feedback channels — audit audio.ts for existing channel volumes;
add per-channel gain if missing, THIN). `test/title.test.ts`: menu resolution, option
defaults/clamping, prefs round-trip, disabled-Load logic.
**Agent: Claude (Sonnet).** Small pure module, clear contracts.

### T2 — Title screen UI + boot-order rework — ✅ SHIPPED (2026-07-18)
> T1+T2 as-built (Codex): data/title.json (logo/background/music/menu/options/credits, sparse);
> game/title.ts pure core (resolveMenu w/ hasSaves gating, option clamping, PreferencesStore
> over injected storage at "condo-life-prefs", applyVolumes contract); game/title-screen.ts
> TitleScreen + EXPORTED OptionsPanel (G3 reuses it). Boot: title paints instantly (index.html
> markup + theme components.titleScreen keys, gallery-discovered) → New Game = existing loading
> gate; Load = newest valid slot → V3 restore (T3 replaces with the slot screen); Options =
> live master/music/feedback gains (thin audio channel gains added; UI feedback separate from
> world SFX) persisted to localStorage prefs. Title music = B13-4 autoplay pattern, stops on
> leave. ?dev/#dev bypass preserved. Coordinator-verified live: title renders, Load boots+
> restores in ~2s, ?dev skips, zero console errors. Suites: title, title-screen, theme(+editor),
> audio, loading, savestore, save-wiring; prod build green.
DOM overlay first paint before asset loading starts; New Game → existing boot path (loading
screen unchanged); Options → panel from T1 definitions, applying live (volume slider audible
immediately if music playing); background/logo/music from data/title.json (music obeys the
B13-4 autoplay-with-gesture-fallback pattern). RESPONSIVE: mobile-first layout, safe-area
insets, touch targets ≥44px, portrait AND landscape, tested at 375×812 + tablet + desktop
(resize_window verification). Themable via theme.json keys with defaults matching the game's
current look; Theme Editor gallery gains the title components automatically (B13-1 derives
from component keys). Boot-order change is the risky part: the loading screen's asset gate,
sim-time freeze, and audio unlock must still hold when entered from a menu choice instead of
page load. jsdom suite for the overlay (menu renders from data, options apply, New Game
dispatches boot) + boot check.
**Agent: Codex.** Boot-order surgery in main.ts + autoplay/gesture interaction — integration
risk, same reasoning as V3/S3.

### T3 — Load Game screen (after SAVE V2) — ✅ SHIPPED (2026-07-18, merged with SAVE V4 — see ROADMAP_SAVE V4 as-built)
Slot list from ROADMAP_SAVE V2 API (metadata cards: name, timestamp, funds, map, play time),
load → restore boot path (SAVE V3), delete/export/import per slot. This slice and SAVE V4 are
the same surface — whichever ships second implements/merges it (coordinate explicitly; do not
build two slot UIs). Confirm-discard dialog when loading while a run is active.
**Agent: Claude (Sonnet).**

### T4 — Static hosting readiness + deploy config
`npm run build` (Vite prod) audit: game makes ZERO /api/* calls in production (guard the
hot-reload poller + any api fetch behind a dev flag or 404-tolerant degrade), SW caching rules
verified against a static origin (fresh /data on redeploy, offline shell still works), tools
excluded from the deploy artifact, relative/base paths correct for subpath hosting (GitHub
Pages) via Vite `base` config, `netlify.toml` + a `docs/HOSTING.md` (build cmd, publish dir,
GitHub Pages alternative, custom-server note). Verify with `npx vite preview` (or a plain
static file server) + the full boot check — that IS the production simulation.
**Agent: Codex.** Build/SW/path edge cases are exactly where static deploys break.

### T5 — Designer pass (no agent)
Title background art, logo, music track, menu labels, option set + defaults, credits text,
theme styling of the title components in the Theme Editor.

---

## 3. Execution order & dependencies

```
T1 (Sonnet) ──► T2 (Codex) ──► T5 (designer can style/author)
                    │
SAVE V1–V2 ─────────┴──► T3 (Sonnet, merges with SAVE V4) 
T4 (Codex) — independent of T1–T3, can run any time; MUST rerun its audit after T2 (boot
order) and T3 (load path) land.
```

- T1/T2 do NOT wait for the save system (Load renders disabled until SAVE V2 exists).
- T4 is standalone but re-verify after the batch completes.

## 4. Open decisions (resolve before the slice that needs them)

1. **Title background (T2/T5):** recommendation — static image from data/title.json for this
   batch (instant paint, zero WebGL before boot); a live D4-exterior 3D backdrop is a nice
   later upgrade behind the same data key.
2. **Where Options lives in-game (T2):** the title's Options panel should also be reachable
   while playing (pause). Recommendation — same component, opened from a small HUD/pause
   entry; keep it in T2 if cheap, else defer to a follow-up.
3. **Skip-title in dev (T2):** recommendation — `?dev` query or dev-mode flag boots straight
   into the game (the designer's playtest loop must not gain a click).
4. **Subpath hosting (T4):** GitHub Pages serves under `/repo/`; Netlify at root.
   Recommendation — Vite `base: './'` relative build if it survives the SW; else document
   per-host base config in HOSTING.md.

## 5. Explicitly out of scope (this batch)

Accounts/cloud saves, leaderboards, multi-language localization (placeholder option only),
marketing/landing pages, host-specific CI/CD pipelines (docs only), in-game pause-menu redesign
beyond the Options entry point.
