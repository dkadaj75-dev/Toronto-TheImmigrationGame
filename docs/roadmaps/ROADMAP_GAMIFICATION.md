# ROADMAP_GAMIFICATION.md — Reward loop: notification tiers, pause semantics, system menu, happiness states

> Planning document (2026-07-18). **No code written yet.** Batch 14 track C (alongside
> ROADMAP_SAVE.md and ROADMAP_TITLE.md — G4's Save/Quit entries consume those; everything else
> is independent and can build first). Same rules as always: PROJECT_CONTEXT.md wins, AGENTS.md
> gates per slice, one commit per slice, everything data-driven with tool UI, sim-time `sdt`,
> side effects on completed actions only, all styling through theme.json (B13-1 element gallery
> picks new component keys up automatically).

---

## 0. Designer request (verbatim intent)

> I want to play on the reward loop of the player and make it interact properly: for example,
> when we get a quest, or we finish it, the time is paused and we have to click on "OK", like
> right now it makes a sound etc. When we have important notifications, this appears in the same
> way, refer to the screenshot for example [Sims 4 notification card: icon, rich text, "Just
> now"/"5 minutes ago" timestamp, X dismiss, optional action button "Show Festival Info"]. But
> some notifications like just going to work should not require any input from the player and
> will not pause the game + they will disappear by themselves. When using the smartphone, the
> game pauses (and resumes at the previously chosen speed). We will also need to have access to
> options like "quit game, save, options". And last: happiness: I do not want the "Happy" number
> to appear with the needs, actually I don't want the player to see the actual number but rather
> a state, for example: 90-100: Extremely happy, 80-90 happy, 20-30: Sad etc. and each state
> will be shown by text and/or by icons (tunable), see other screenshot [Sims 4 portrait with
> mood icon + "HAPPY" label].

---

## 1. Big picture

Four systems, one design center: **the game talks to the player through a single notification
pipeline with importance TIERS**, instead of today's scattered toasts (quest toast, feedback
floats, move-in toast, call-fallback toast...).

### Notification tiers (`data/notifications.json`)

| Tier | Pauses? | Dismiss | Example |
|---|---|---|---|
| `modal` | YES — hard pause, resume at previous speed on OK | OK button (click/tap required) | quest received, quest completed, game-over-adjacent warnings |
| `card` | no | X button OR auto-expire (both; timeout tunable) | visitor arrived, promotion, bill charged — the Sims-style card stack from the screenshot: icon, text, relative timestamp ("Just now", "5 minutes ago"), optional ACTION button (opens a phone tab / quest log etc.) |
| `passive` | no | auto-expire only, no input | "off to work", autonomy chatter |

- Every EVENT SOURCE maps to a tier + icon + sound + optional action in
  `data/notifications.json` — the designer reclassifies any event without code (e.g. promote
  "bill overdue" from card to modal). Unknown/unmapped events default to `passive`.
- Sounds ride the existing tuning.audio UI/feedback sound system (quest sounds already exist —
  keep them, route through the pipeline).
- Relative timestamps run on SIM time (a card from 3 in-game hours ago says so; frozen while
  paused) — decide precisely in G1 (see §4.2).
- The stack is capped (tunable), oldest passive/card entries collapse into a history drawer
  (nice-to-have — see §4.3).

### Pause semantics (one owner)

Today speed lives in the HUD speed control (pause/1x/2x/3x + work auto-speed override). A new
tiny pure `game/interruptions.ts` owns "who paused the game and what speed do we return to":
a stack of pause reasons (modal notification, phone open, system menu open, buy mode already
freezes via its own path — audit and fold if trivial). Opening the phone pushes a pause reason;
closing pops it and restores the PREVIOUS chosen speed (not hardcoded 1x). Two overlapping
reasons (phone open + modal arrives) must nest correctly — pure stack, trivially testable.

### System menu

A small in-game menu (gear/burger button + Esc): **Resume / Save / Options / Quit to title**.
Save and Quit-to-title wire to ROADMAP_SAVE / ROADMAP_TITLE when those land; until then they
render disabled ("coming with the save system") so this batch doesn't block on them. Options
reuses TITLE T1's options component if it exists, else ships the volume sliders here first and
TITLE reuses THIS (coordinate — one component, whoever builds second reuses).
Opening it pushes a pause reason.

### Happiness states

The raw 0–100 happiness number disappears from the HUD. `data/happiness.json` gains a
`states` array: `{ id, atLeast, label, icon }` (same inclusive-threshold pattern as social
relationship levels — reuse the resolution helper shape). HUD shows the state as icon, text,
or both — a `display` knob (`"icon" | "text" | "both"`) plus per-state icon paths (public/
drop-in, /api/icons dropdown in the editor). The number stays available in the Finance
Editor's happiness card and debug — hidden from the PLAYER only. Autonomy/promotion math is
untouched (they read the numeric value as today).

---

## 2. Slices

### G1 — Pure notification + interruption core — ✅ SHIPPED (2026-07-18)
> As-built (Codex): NotificationCenter (post/dismiss/acknowledgeModal/expireTick/relativeAge;
> modal FIFO one-visible, capped card/passive stack, unmapped→passive, action payload
> passthrough, REAL-time cosmetic expiry/ages — documented sim-time exemption; transient, not
> serialized). PauseStack (push/pop tokens, nested, restores the PLAYER-chosen speed exactly
> once, double-pop safe, pausedBy). data/notifications.json seeds 47 events (modals: quest
> received/started/completed, move-in, starvation warning; cards: visitors, work/job/promotion,
> visa, bills, rental, save failures; passive: departures, social chatter, refusals, save/load
> success). Auto-speed contract: pause always wins; tuning.work.autoSpeed applies only with an
> empty stack; only the player HUD speed is remembered. 12 checks + quests regression green.
Notification model (tier resolution from data, queue/stack with cap, sim-time relative
timestamps, auto-expire clocks, action payloads), pause-reason stack (push/pop/nested, previous
speed restore, work-auto-speed interaction — auditing how tuning.work.autoSpeed override
composes is part of the slice). `data/notifications.json` schema + seed mapping of every
existing toast/sound event. Suites: `test/notifications.test.ts`, `test/interruptions.test.ts`
(nesting, restore-to-2x, modal-while-phone-open, expiry on sim time never real time).
**Agent: Claude (Opus).** The tier/pause semantics are the batch's design core.

### G2 — Notification UI + migration of existing events — ✅ SHIPPED (2026-07-18, with G3)
Card stack (screenshot layout: icon, rich text, timestamp, X, optional action button), modal
overlay with OK (hard pause via G1), passive fade. Themable (`components.notificationCard`,
`notificationModal` keys — B13-1 gallery picks them up), smartphone-responsive (stack becomes
full-width top sheet on narrow viewports), touch targets ≥44px. MIGRATE every existing toast
call site (quest toasts, move-in, call-fallback, feedback floats stay separate — they're
world-space) through the pipeline; delete the old one-off toast paths when empty.
**Agent: Codex.** Many call sites + overlay/z-order/pause integration risk.

### G3 — Phone pause + system menu — ✅ SHIPPED (2026-07-18)
> G2+G3 as-built (Codex): notification card stack (icon/body/real-time age/X/action buttons
> routing to phone tabs/quest panel; passives fade control-free; mobile full-width top sheet)
> + FIFO modal overlay w/ OK owning a PauseStack token; components.notificationCard/-Modal
> theme keys (gallery-discovered); showQuestToast DELETED — every event migrated to seeded
> NotificationCenter ids (quests, move-in, visitors/social, work/jobs/promotion, visas, bills,
> rentals, sleep/starvation warnings, save/load/autosave); world-space money/skill floats
> unchanged. ONE PauseStack composes modal/phone/system-menu/buy-mode tokens; pause outranks
> work auto-speed; player speed captured at first push, restored after last pop. System menu:
> #system-menu-button gear + desktop Esc → Resume / Save (opens phone Save tab) / Options
> (reuses title OptionsPanel, live volumes) / Quit to title (confirm + location.reload —
> chosen because start() has no full teardown API; in-page return would risk duplicate
> runtimes). Coordinator-verified live: gear menu shows all four entries; phone-open pause
> held across menu open/Resume and closing the phone restored 1× (correct token nesting);
> zero console errors. Suites: notifications 8, interruptions 5, new notification-ui,
> phone-hud nesting + frozen countdown, theme 91.
Phone open/close pushes/pops a pause reason (restores chosen speed; the Kijiji countdown and
cooldown labels must render correctly while paused — they read sim time, which is frozen: fine,
assert it). System menu button + Esc: Resume / Save(disabled until SAVE) / Options(shared
component per §1) / Quit-to-title(disabled until TITLE). Menu open = pause reason.
**Agent: Claude (Sonnet).** Thin over G1; the shared-options coordination is the only care.

### G4 — Happiness states — ✅ SHIPPED (2026-07-18)
> As-built (Codex): data/happiness.json states (7 seeded bands, Extremely happy 90 → Miserable
> 0) + stateDisplay icon|text|both (default both); pure happinessStateFor (inclusive atLeast,
> highest wins, order-independent) in game/happiness.ts; player HUD number/bar REPLACED by the
> themed state (sparse states = nothing shown, number still hidden); numeric math for
> autonomy/work/promotions/quests untouched; Finance Editor happiness card gains state CRUD w/
> reorder, /api/icons suggestions (graceful degradation), path normalization, real-resolver
> live preview; placeholder happy/neutral/sad SVGs under public/icons. Coordinator-verified
> live: number gone, "Unhappy" + icon rendering at happiness 48, zero console errors.
`data/happiness.json` states array + display knob; pure `happinessStateFor(value, states)`
(inclusive thresholds, highest wins — mirror social levelFor); HUD swap (number removed from
needs area, state icon/text rendered per display knob, themable); Finance Editor happiness
card gains the states CRUD (add/remove/threshold/label/icon dropdown) + live "value → state"
preview through the real resolver. Default states seeded from the designer's example
(90–100 Extremely happy, 80–90 Happy, ..., 20–30 Sad, ...) — the designer finalizes in G5.
**Agent: Claude (Sonnet).** Small, fully precedented (levels + editor card + HUD).

### G5 — Designer pass (no agent)
Classify all events into tiers, author card icons + per-state happiness icons, finalize state
ranges/labels, tune expiry times/stack cap, sounds per tier, theme the cards/modal in the
element gallery.

---

## 3. Execution order & dependencies

```
G1 (Opus) ──► G2 (Codex) ──► G5 (designer)
   └────────► G3 (Sonnet)  [G3 also fine after G1, parallel with G2 — shared file risk is
                            ui.ts; if building in parallel, G3 waits for G2's ui.ts merge]
G4 (Sonnet) — independent, any time.
SAVE/TITLE: G3's Save/Quit entries activate when those batches land (disabled until then).
```

## 4. Open decisions (resolve before the slice that needs them)

1. **Modal queueing (G1):** two modals at once (quest completed during another OK screen)?
   Recommendation — strict FIFO, one at a time, time stays paused across the whole run.
2. **Timestamp clock (G1):** sim-time relative stamps ("2 hours ago" in game hours) vs
   real-time like The Sims. Recommendation — real time for familiarity (the screenshot's
   "5 minutes ago"), stored per-notification as real epoch; purely cosmetic so the sim-time
   rule isn't violated. Confirm with designer.
3. **Notification history drawer (G2):** keep dismissed cards reviewable? Recommendation —
   defer; ship the capped stack only, revisit after playtest.
4. **Esc key on mobile (G3):** no Esc on phones — the gear button is the only entry.
   Non-decision, just noting the requirement.
5. **Happiness state count (G4):** free-form designer-defined count (like relationship
   levels), no fixed number. Seed ~7 bands.

## 5. Explicitly out of scope (this batch)

Achievements/trophies, XP/meta-progression, daily rewards, notification push outside the tab
(real PWA push), NPC mood states (player sim only), rich notification inbox with filtering.
