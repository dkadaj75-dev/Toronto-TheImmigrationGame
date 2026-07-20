# ROADMAP_HAPPY.md — Happiness as a systemic multiplier (batch 15)

> Planning + as-built doc (2026-07-19). Conventions: PROJECT_CONTEXT.md wins; AGENTS.md gates
> per slice; everything data-driven with tool UI; sim-time; side effects on completed actions only.

## 0. Designer request (verbatim intent)

> I want to use the happiness score for a variety of stuff: using it as a multiplier per typical
> action / needs of the autonomy. Apply it to certain actions, for example learning a skill: the
> happier, the more efficient at learning, with a cut-off score where the sim refuses to learn
> (with a notification explaining it), but that would apply to select (by me) actions, not all.
> Also the social: the happier the easier it is to build the relationship, and the opposite.
> For work: You can be fired from your job if you go too many times in a row not happy, also
> meaning that you loose your Visa status if it was not permanent (in the Career tool, this
> should be created). And more generally, I want to avoid hard-coded things and have freedom to
> modify assets, actions etc. more easily by adding states, animations, sounds, and also for the
> notifications (which should be centered by the way). Basically the tool constellation becomes
> the "engine" where I can continue create the game with less coding needs.

Also requested: full tool-constellation audit (bugs / overlap / UX) — running via Codex, results
land in AUDIT_TOOLS.md; fixes become their own batch after designer triage.

## Slices

- **H1 — happiness in the condition system.** EvalContext + resolveVar gain top-level `happiness`.
  Effect: EVERY existing condition surface (interaction conditions, behavior.json autonomy rules,
  quest conditions, notification-adjacent logic) can now gate/branch on happiness with zero new
  code — this is the generic "autonomy multiplier" lever: behavior rules can forbid/prefer
  actions by happiness band, designer-authored.
- **H2 — per-action learning efficiency + refusal.** Sparse `ActionDef.happinessMod:
  { skillEffAtMin?, skillEffAtMax?, refuseBelow? }` (Interaction Editor card). Skill gains
  multiply by lerp(skillEffAtMin→skillEffAtMax over happiness 0→100), defaults 1/1 = no-op.
  happiness < refuseBelow → action disabled in radial menu with reason + notification event
  `actionRefusedUnhappy` if ordered; autonomy skips it (H1 conditions unaffected — this is a
  separate designer-per-action switch).
- **H3 — social scaling.** Sparse `social.json happinessScaling: { atMin?, atMax? }` multiplier
  folded into the compatibility multiplier at every scaleGain seam (interactions, phone, visits)
  — happy scales positive gains up; the existing love/hate flip makes unhappiness cut losses
  deeper. Social Editor field.
- **H4 — unhappy-streak firing + visa loss.** Sparse `JobDef.firing: { minHappiness?,
  maxUnhappyShifts? }` (Career Editor card). Completed shift with happiness < minHappiness
  increments a persisted streak (save-migrated, default 0); streak > maxUnhappyShifts → fired:
  job cleared (job_lost path), notification, and if the current visa is NOT permanent
  (durationDays != null) it is revoked into its existing grace flow.
- **H5 — centered notifications.** theme.json layout `notification-stack` anchor → top-center
  (designer can move it any time in the Theme Editor).

## Status — ALL SHIPPED 2026-07-19

- **H1 DONE**: EvalContext.happiness + resolveVar('happiness') (quests.ts); main.ts feeds the live value. Every condition UI (shared condition-builder, Interaction/Career/Behavior editors) now offers Happiness + Credit score in its var picker (also fixes audit UX items 41-43). Career validation whitelist extended. Tests: quests suite.
- **H2 DONE**: ActionDef.happinessMod {skillEffAtMin, skillEffAtMax, refuseBelow} (Interaction Editor "Happiness coupling" card, sparse-pruned). happinessSkillFactor lerps 0..100 and multiplies skill gains in SimStats.applyGains (clamped >= 0); isRefusedByMood hides the action from the radial menu, order-time guard posts actionRefusedUnhappy notification, autonomy candidateAvailable veto skips it. Tests: happiness suite.
- **H3 DONE**: social.json happinessScaling {atMin, atMax} (Social Editor Compatibility card, sparse). happinessSocialFactor multiplies into the compatibility multiplier at BOTH runtime seams (getCompatibilityMultiplier: interactions+phone; visit compat) — the existing love/hate flip in scaleGain makes unhappiness cut losses deeper automatically. Tests: social suite.
- **H4 DONE**: JobDef.firing {minHappiness, maxUnhappyShifts} (Career Editor "Firing (happiness)" card, blank = never). WorkTracker.recordShiftMood on each completed shift: warning event (unhappyShift notification with streak/cap), then 'fired' (job cleared, firedUnhappy modal, non-permanent visa opens its own grace window via startGrace — visa's losable/graceDays config governs). unhappyStreak persisted in WorkSaveState (sparse; old saves restore 0). Tests: work suite (streak/reset/fire/serialize/warn-only).
- **H5 DONE**: notification stack anchor -> top-center (theme.json layout, still Theme-Editor movable). New notification events: actionRefusedUnhappy (card), unhappyShift (card), firedUnhappy (modal).

## Tool audit
Codex audit shipped separately: AUDIT_TOOLS.md (25 bugs / 8 overlaps / 11 UX / 8 tool-less data surfaces). Condition-picker gaps (items 41-43) fixed with H1; the rest await designer triage as their own batch.
