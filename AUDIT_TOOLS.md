## BUG

- tools/social.html:172 -- Clip map input writes a string, but runtime `game/npc.ts` requires `Record<string,string>|null`; any edit corrupts NPC animation schema.
- tools/tuning.html:256 -- Flat booleans are rendered as number inputs; editing `ambience.nightEnvironmentEnabled`/`sleepBlockingEnabled` writes numbers instead of booleans.
- tools/condition-builder.js:243 -- `gte`/`lte` are offered for string/quest-state values although the evaluator accepts them only for numbers; current dead gates exist at `data/quests.json:86` and `data/jobs.json:131`.
- tools/tuning.html:529 -- Need deletion scans only action gains/primaryNeed, leaving dangling refs in assets, behavior, quests, jobs/visas, happiness, social, rentals, and tuning.
- tools/tuning.html:540 -- Skill deletion scans only `skillGains`, leaving dangling duration modifiers/skillVar, accident modifiers, conditions, happiness, jobs/visas, and social refs.
- tools/tuning.html:443 -- Personality deletion checks only `garbage.cleanlinessVar`, leaving orphaned NPC personalities, compatibility weights, behavior conditions, and waste refs.
- tools/assets.html:1019 -- Asset deletion removes only `assets.json`; map placements, accident IDs, waste IDs, quest rewards, behavior rules, and social targetAsset refs remain dangling.
- tools/interactions.html:786 -- Action deletion reconciles only asset interaction lists; `behavior.rules[].action` and `npcs[].visitorActions` remain dangling.
- tools/quests.html:524 -- Variable deletion reconciles only quests; jobs, visas, rentals, behavior, happiness, tuning, and runtime-reserved variable consumers remain dangling.
- tools/quests.html:420 -- Quest deletion strips only other quest trees; job/visa/rental/behavior conditions referencing `quests.<id>.state` remain dangling.
- tools/career.html:487 -- Visa deletion clears only `jobs[].grantsVisa`; quest `grantVisa` rewards retain deleted status IDs.
- tools/social.html:210 -- Renaming a relationship level updates only visit-duration keys, not interaction min/max gates or `visitTheirPlace.minLevel`.
- tools/social.html:218 -- Deleting a relationship level leaves interaction gates and `visitTheirPlace.minLevel` pointing at a nonexistent level.
- tools/career.html:384 -- Editing top-level job pay does not sync `levels[0].payPerShift`; phone income and actual level-0 shift pay can diverge.
- tools/assets.html:123 -- Placement counts/deletion warnings always inspect `maps/condo.json`, ignoring every other map and the active/home map.
- tools/assets.html:409 -- Icon input has no public-path normalization; current `/public/icons/...` values (e.g. `data/assets.json:58`) resolve to nonexistent `/public/...` URLs.
- tools/assets.html:607 -- Asset sound paths accept pasted Windows paths unchanged, violating the mandatory public-path convention.
- tools/assets.html:767 -- Asset mesh paths accept pasted Windows paths unchanged; preview/save preserve unfetchable filesystem paths.
- tools/assets.html:988 -- Door pane-mesh paths are not normalized, unlike state-mesh paths in the same editor.
- tools/interactions.html:499 -- Action sound paths are never normalized before save.
- tools/social.html:170 -- NPC mesh paths are never normalized; only portrait and interaction sound fields handle Windows paths.
- tools/animations.html:491 -- Character mesh and marker mesh fields only prepend `/`; pasted Windows paths are saved verbatim-like instead of reduced under `public/`.
- tools/map.html:1258 -- Map music entries are split and saved without Windows/public-path normalization.

## OVERLAP

- game/social.ts:26 -- `NpcDef` is duplicated and conflicts with `game/npc.ts:18` (`clipMap` string vs map; missing `visitorActions`), directly misleading the Social Editor.
- tools/interactions.html:231 -- Interaction conditions reimplement the shared condition builder and have already drifted from its namespace/type behavior.
- tools/career.html:237 -- Career conditions reimplement `tools/condition-builder.js` instead of sharing it, duplicating operators, typing, and stale-ID logic.
- tools/behavior.html:48 -- Behavior conditions are a third private implementation; it supports personality/credit while the shared builder does not.
- tools/tuning.html:596 -- Action autonomy/seat/primaryNeed/gains duplicate Interaction Editor controls; Tuning writes explicit `seatAware:false` while Interaction Editor prunes false.
- data/bills.json:2 -- Bill identity/name is duplicated with `finance.json.bills`; neither editor enforces consistency between the two sources.
- tools/assets.html:238 -- Image-extension classification duplicates `game/sprites.ts` and is explicitly kept in sync manually, contrary to the import/reuse convention.
- tools/social.html:99 -- Path normalization is independently reimplemented across Social, Theme, Finance, Map, Animation, and Tuning tools with incompatible failure behavior.

## UX

- tools/tuning.html:243 -- Generic tuning rendering cannot edit arrays; `calendar.dayNames` and `character.animationPaths` appear as invalid number controls.
- tools/condition-builder.js:104 -- Shared Quest/Map condition UI omits valid evaluator namespaces `creditScore`, `happiness`, and `personality.*`.
- tools/interactions.html:231 -- Interaction condition UI also omits valid `creditScore`, `happiness`, and `personality.*` namespaces.
- tools/career.html:237 -- Career condition UI omits valid `creditScore`, `happiness`, and `personality.*`, despite job/visa gates using the same evaluator.
- tools/behavior.html:59 -- Action dropdown contains only `interactions.json` actions, so valid phone autonomy actions (`phone_text/call/invite`) render as unknown and cannot be newly selected.
- tools/finance.html:53 -- Happiness variable picker omits valid personality, happiness, time, and quest-state resolver paths.
- tools/animations.html:123 -- Built-in runtime states omit code-driven `select`/`angry`; they disappear from the mapper if their clipMap leftovers are cleared.
- tools/tuning.html:338 -- Need/skill/personality names are display-only after creation; existing schema names can be changed only by hand.
- tools/tuning.html:334 -- `NeedDef.computed` is not editable, so computed needs cannot be created or changed through tools.
- tools/assets.html:374 -- Asset categories can only be selected from the existing array; there is no category add/rename/delete surface.
- tools/finance.html:128 -- Finance bill IDs/names are read-only headings, so formula rows cannot be added, removed, or renamed.

## NO-TOOL-FIELD

- data/save.json:2 -- `slots`, autosave slot/interval/events, and storage-key prefix have no editor surface.
- data/title.json:2 -- Logo, background/music, card/layout, menu, options, and credits have no editor surface.
- data/notifications.json:2 -- Tier timing/pause/OK rules and `stackCap` have no editor surface; Theme edits event icons only.
- data/notifications.json:16 -- Event tier, sound, action type/tab/label, and event CRUD have no editor surface.
- data/bills.json:2 -- Bill IDs/names have no editor surface.
- data/npcs.json:20 -- `visitorActions` has no Social Editor control.
- data/stats.json:74 -- Need `computed` values have no editor surface.
- data/assets.json:3 -- Asset category-list entries have no editor surface.
