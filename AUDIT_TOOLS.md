# Tool audit (Codex, 2026-07-19) — STATUS after bugfix batch B13-17 (2026-07-19)

FIXED: all 25 BUG items — 1 (clipMap parses to object), 2 (flat tuning booleans = checkboxes),
3 (gte/lte hidden for string/quest vars + stored dead gates migrate on edit), 4-13 (every editor
delete now runs a cross-file dangling-reference scan — tools/refscan.js — and shows exactly which
files still reference the deleted id; in-tool reconciliation unchanged), 14/15 (social level
rename/delete follows interaction gates + visitTheirPlace.minLevel), 16 (job pay syncs level 0),
17 (placement counts scan ALL maps via /api/maps), 18-25 (path normalization on every path field:
assets icon/mesh/sound/pane, interactions sound, social NPC mesh, animations char/marker mesh,
map music; legacy "/public/..." values in assets.json healed on disk).
UX items 41-43 fixed with ROADMAP_HAPPY. Second pass (2026-07-19): UX 40/44/45/46 + NO-TOOL 59
fixed (see ROADMAP_NEXT). Remaining: OVERLAP 29-36, UX 47-50, NO-TOOL 54-58/60-61 — bigger
surfaces (new editor cards / consolidations), awaiting designer priorities.

## BUG

- [FIXED 2026-07-20: clip map edits parse to Record] tools/social.html:172 -- Clip map input writes a string, but runtime `game/npc.ts` requires `Record<string,string>|null`; any edit corrupts NPC animation schema.
- [FIXED 2026-07-20: flat booleans render as checkboxes] tools/tuning.html:256 -- Flat booleans are rendered as number inputs; editing `ambience.nightEnvironmentEnabled`/`sleepBlockingEnabled` writes numbers instead of booleans.
- [FIXED 2026-07-20: gte/lte hidden for non-numeric vars] tools/condition-builder.js:243 -- `gte`/`lte` are offered for string/quest-state values although the evaluator accepts them only for numbers; current dead gates exist at `data/quests.json:86` and `data/jobs.json:131`.
- [MITIGATED 2026-07-20: refscan.js warns after delete] tools/tuning.html:529 -- Need deletion scans only action gains/primaryNeed, leaving dangling refs in assets, behavior, quests, jobs/visas, happiness, social, rentals, and tuning.
- [MITIGATED 2026-07-20: refscan.js warns after delete] tools/tuning.html:540 -- Skill deletion scans only `skillGains`, leaving dangling duration modifiers/skillVar, accident modifiers, conditions, happiness, jobs/visas, and social refs.
- [MITIGATED 2026-07-20: refscan.js warns after delete] tools/tuning.html:443 -- Personality deletion checks only `garbage.cleanlinessVar`, leaving orphaned NPC personalities, compatibility weights, behavior conditions, and waste refs.
- [MITIGATED 2026-07-20: refscan.js warns after delete] tools/assets.html:1019 -- Asset deletion removes only `assets.json`; map placements, accident IDs, waste IDs, quest rewards, behavior rules, and social targetAsset refs remain dangling.
- [MITIGATED 2026-07-20: refscan.js warns after delete] tools/interactions.html:786 -- Action deletion reconciles only asset interaction lists; `behavior.rules[].action` and `npcs[].visitorActions` remain dangling.
- [MITIGATED 2026-07-20: refscan.js warns after delete] tools/quests.html:524 -- Variable deletion reconciles only quests; jobs, visas, rentals, behavior, happiness, tuning, and runtime-reserved variable consumers remain dangling.
- [MITIGATED 2026-07-20: refscan.js warns after delete] tools/quests.html:420 -- Quest deletion strips only other quest trees; job/visa/rental/behavior conditions referencing `quests.<id>.state` remain dangling.
- [MITIGATED 2026-07-20: refscan.js warns after delete] tools/career.html:487 -- Visa deletion clears only `jobs[].grantsVisa`; quest `grantVisa` rewards retain deleted status IDs.
- [FIXED 2026-07-20: rename follows gates + visitTheirPlace] tools/social.html:210 -- Renaming a relationship level updates only visit-duration keys, not interaction min/max gates or `visitTheirPlace.minLevel`.
- [FIXED 2026-07-20: delete clears gates + minLevel] tools/social.html:218 -- Deleting a relationship level leaves interaction gates and `visitTheirPlace.minLevel` pointing at a nonexistent level.
- [FIXED 2026-07-20: top-level pay syncs levels[0]] tools/career.html:384 -- Editing top-level job pay does not sync `levels[0].payPerShift`; phone income and actual level-0 shift pay can diverge.
- [FIXED 2026-07-20: counts scan every map via /api/maps] tools/assets.html:123 -- Placement counts/deletion warnings always inspect `maps/condo.json`, ignoring every other map and the active/home map.
- [FIXED 2026-07-20: icon paths normalize + data healed] tools/assets.html:409 -- Icon input has no public-path normalization; current `/public/icons/...` values (e.g. `data/assets.json:58`) resolve to nonexistent `/public/...` URLs.
- [FIXED 2026-07-20: sound paths normalize] tools/assets.html:607 -- Asset sound paths accept pasted Windows paths unchanged, violating the mandatory public-path convention.
- [FIXED 2026-07-20: mesh paths normalize] tools/assets.html:767 -- Asset mesh paths accept pasted Windows paths unchanged; preview/save preserve unfetchable filesystem paths.
- [FIXED 2026-07-20: pane mesh normalizes] tools/assets.html:988 -- Door pane-mesh paths are not normalized, unlike state-mesh paths in the same editor.
- [FIXED 2026-07-20: action sounds normalize] tools/interactions.html:499 -- Action sound paths are never normalized before save.
- [FIXED 2026-07-20: NPC mesh normalizes] tools/social.html:170 -- NPC mesh paths are never normalized; only portrait and interaction sound fields handle Windows paths.
- [FIXED 2026-07-20: mesh fields reduce Windows paths] tools/animations.html:491 -- Character mesh and marker mesh fields only prepend `/`; pasted Windows paths are saved verbatim-like instead of reduced under `public/`.
- [FIXED 2026-07-20: music entries normalize] tools/map.html:1258 -- Map music entries are split and saved without Windows/public-path normalization.

## OVERLAP

- [FIXED 2026-07-20: dead duplicate deleted, game/npc.ts is sole owner] game/social.ts:26 -- `NpcDef` is duplicated and conflicts with `game/npc.ts:18` (`clipMap` string vs map; missing `visitorActions`), directly misleading the Social Editor.
- [FIXED 2026-07-20: shared ConditionBuilder] tools/interactions.html:231 -- Interaction conditions reimplement the shared condition builder and have already drifted from its namespace/type behavior.
- [FIXED 2026-07-20: shared ConditionBuilder] tools/career.html:237 -- Career conditions reimplement `tools/condition-builder.js` instead of sharing it, duplicating operators, typing, and stale-ID logic.
- [FIXED 2026-07-20: shared ConditionBuilder] tools/behavior.html:48 -- Behavior conditions are a third private implementation; it supports personality/credit while the shared builder does not.
- [FIXED 2026-07-20: behavior flags removed, gains-only balancing view stays] tools/tuning.html:596 -- Action autonomy/seat/primaryNeed/gains duplicate Interaction Editor controls; Tuning writes explicit `seatAware:false` while Interaction Editor prunes false.
- [FIXED 2026-07-20: Finance Editor edits both files jointly, syncs names, warns on orphans] Bill identity/name is duplicated with `finance.json.bills`; neither editor enforces consistency between the two sources.
- [FIXED 2026-07-20: real classifyMeshPath bridged via window.AssetEditorEngine] tools/assets.html:238 -- Image-extension classification duplicates `game/sprites.ts` and is explicitly kept in sync manually, contrary to the import/reuse convention.
- [FIXED 2026-07-20: shared tools/pathnorm.js primary in all 8 tools, locals demoted to jsdom fallbacks] tools/social.html:99 -- Path normalization is independently reimplemented across Social, Theme, Finance, Map, Animation, and Tuning tools with incompatible failure behavior.

## UX

- [FIXED 2026-07-20: `list` kind renders string arrays as an editable comma line] tools/tuning.html:243 -- Generic tuning rendering cannot edit arrays; `calendar.dayNames` and `character.animationPaths` appear as invalid number controls.
- [FIXED 2026-07-19: happiness/creditScore added] tools/condition-builder.js:104 -- Shared Quest/Map condition UI omits valid evaluator namespaces `creditScore`, `happiness`, and `personality.*`.
- [FIXED 2026-07-19: happiness/creditScore added] tools/interactions.html:231 -- Interaction condition UI also omits valid `creditScore`, `happiness`, and `personality.*` namespaces.
- [FIXED 2026-07-19: happiness/creditScore added] tools/career.html:237 -- Career condition UI omits valid `creditScore`, `happiness`, and `personality.*`, despite job/visa gates using the same evaluator.
- [ALREADY SATISFIED (verified 2026-07-20): phone_text/call/invite are in the dropdown] tools/behavior.html:59 -- Action dropdown contains only `interactions.json` actions, so valid phone autonomy actions (`phone_text/call/invite`) render as unknown and cannot be newly selected.
- [ALREADY SATISFIED (verified 2026-07-20): personality/time/quest-state present; `happiness` is deliberately excluded — a happiness component cannot take happiness as input] tools/finance.html:53 -- Happiness variable picker omits valid personality, happiness, time, and quest-state resolver paths.
- [NOT APPLICABLE (verified 2026-07-20): `select` is listed; no `angry` state exists in game code; `lie_sleep` arrives via the action scan] tools/animations.html:123 -- Built-in runtime states omit code-driven `select`/`angry`; they disappear from the mapper if their clipMap leftovers are cleared.
- [FIXED 2026-07-20: display-name field on need/skill/trait cards (ids stay immutable — they are the reference key)] tools/tuning.html:338 -- Need/skill/personality names are display-only after creation; existing schema names can be changed only by hand.
- [FIXED 2026-07-20: `computed by` select of engine-backed formulas + multi-computed warning] tools/tuning.html:334 -- `NeedDef.computed` is not editable, so computed needs cannot be created or changed through tools.
- [FIXED 2026-07-20: Asset Editor categories card] tools/assets.html:374 -- Asset categories can only be selected from the existing array; there is no category add/rename/delete surface.
- [FIXED 2026-07-20: bill rows renamable/addable/removable in Finance Editor] tools/finance.html:128 -- Finance bill IDs/names are read-only headings, so formula rows cannot be added, removed, or renamed.

## NO-TOOL-FIELD

- [FIXED 2026-07-20: System Editor] data/save.json:2 -- `slots`, autosave slot/interval/events, and storage-key prefix have no editor surface.
- [FIXED 2026-07-20: System Editor] data/title.json:2 -- Logo, background/music, card/layout, menu, options, and credits have no editor surface.
- [FIXED 2026-07-20: System Editor] data/notifications.json:2 -- Tier timing/pause/OK rules and `stackCap` have no editor surface; Theme edits event icons only.
- [FIXED 2026-07-20: System Editor] data/notifications.json:16 -- Event tier, sound, action type/tab/label, and event CRUD have no editor surface.
- [FIXED 2026-07-20: Finance Editor] Bill IDs/names have no editor surface.
- [FIXED 2026-07-20: Social Editor visitorActions checkbox picker] data/npcs.json:20 -- `visitorActions` has no Social Editor control.
- [FIXED 2026-07-20: Tuning Editor `computed by` select] data/stats.json:74 -- Need `computed` values have no editor surface.
- [FIXED 2026-07-20: Asset Editor categories card] data/assets.json:3 -- Asset category-list entries have no editor surface.
