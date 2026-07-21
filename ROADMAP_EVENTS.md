# ROADMAP_EVENTS.md — Event Manager (plan; E1-E3 SHIPPED 2026-07-20, see PROJECT_CONTEXT §7.56)

> New.txt request #6, 2026-07-20. The designer explicitly asked for a plan first: *"DO NOT CODE IT
> YET BUT THINK OF A PLAN AND IF IT MAKES SENSE COMPARED TO THE CURRENT CODE, I DON'T WANT TO BREAK
> THE GAME!!"* — so this file is analysis + proposal only.

## 0. The request

> I want an event manager: completing a quest, using an asset etc can trigger events… a leak, a
> fire, a phone call etc. becomes an event that can be called through different ways; we design an
> event (it will trigger a notification, have an impact on skills, needs, social, work, visa, etc.
> everything customizable in the event manager) and this event can be called by an interaction, an
> asset, a quest…

## 1. Verdict: yes, it fits — as a THIN LAYER, not a rewrite

It makes sense, but only in one specific shape. The engine already has every *effect* implemented
somewhere; what it lacks is a **shared vocabulary for naming a bundle of effects and firing it from
anywhere**. So the event manager should be a dispatcher over existing subsystems — it must not
reimplement needs, visas, spawning or notifications.

**What already exists (the effects an event would fire):**

| Effect | Already implemented in | Called from today |
| --- | --- | --- |
| Notification (modal/card/passive) | `NotificationCenter.post` | `postNotification` in main.ts, ~30 hardcoded call sites |
| Funds | `quests.funds` (single economy owner) | quest `RewardFunds`, work pay, bills |
| Quest variable | `RewardSetVar` | quest rewards only |
| Visa change | `VisaMachine.grantVisa/startGrace` | quest `RewardGrantVisa`, job loss, firing |
| Unlock catalog asset | `RewardUnlockAsset` | quest rewards only |
| Needs / skills delta | `SimStats.applyGains / refillNeed` | action completion, work return, visits |
| Relationship delta | `RelationshipState.set` + `scaleGain` | social interactions, phone, visits |
| Spawn a transient (fire, puddle) | `AccidentRegistry.spawn` | accident risk rolls only |
| Asset state change | `AssetStateRegistry.setState` | actions (`setsState`, turn_on/off) |
| Sound | `audio.play/startLoop` | actions, assets, notifications |

**The actual problem:** the *triggers* are hardcoded one-to-one against those effects. A fire can
only start from an accident roll; a notification can only fire where someone wrote
`postNotification(...)`. There is no way for the designer to say "when the sim finishes *Fix the
sink*, spawn a puddle, ding a notification, and drop hygiene."

So the event manager's real job is **many-to-many wiring**, which is genuinely missing. That is
worth building.

## 2. Where it must NOT go

- **Not a replacement for quest rewards.** `Reward` already works and is authored in the Quest
  Editor. Events should *add* a `{ type: 'event', id }` reward, leaving the existing four alone.
- **Not a new effect engine.** Every effect maps to an existing subsystem call. If an effect needs
  new gameplay code, that code belongs in its subsystem, not in the event runtime.
- **Not a scheduler (yet).** Time-based events ("every Monday") multiply the risk surface. Phase 1
  fires only from explicit triggers; a schedule trigger can come later once the effect vocabulary
  has proven itself.
- **Not retroactive.** Existing hardcoded call sites keep working untouched. Migration is opt-in,
  one call site at a time, each with its own test — never a big-bang replacement.

## 3. Proposed design

### 3.1 Data — `data/events.json`

```jsonc
{
  "events": [
    {
      "id": "sink_leak",
      "name": "Sink leak",
      "conditions": { "all": [ { "var": "skills.handiness", "lte": 3 } ] },   // optional gate, shared evaluator
      "chancePercent": 100,                                                     // optional roll
      "effects": [
        { "type": "notification", "event": "sinkLeak", "title": "The sink is leaking!" },
        { "type": "spawnTransient", "asset": "water_puddle", "at": "target" },
        { "type": "needDelta", "need": "hygiene", "amount": -10 },
        { "type": "assetState", "state": "broken", "at": "target" }
      ]
    }
  ]
}
```

Effect union (phase 1) — deliberately only effects whose subsystem call already exists:
`notification`, `funds`, `setVar`, `grantVisa`, `unlockAsset`, `needDelta`, `skillDelta`,
`relationshipDelta`, `spawnTransient`, `assetState`, `sound`.

`at` resolves a target: `"target"` (the asset that fired it), `"sim"`, or an explicit asset id —
this is what lets one event definition work from an interaction, an asset, or a quest.

### 3.2 Triggers (sparse fields on things that already exist)

| Source | New sparse field | Fires when |
| --- | --- | --- |
| Interaction | `ActionDef.emitsEvent?: string` | the action COMPLETES (side_effect_rule) |
| Asset state | `AssetStateDef.onEnter?: string` | an instance enters that state |
| Quest | `Reward = { type: 'event', id }` | quest completes |
| Accident | `AccidentRisk.emitsEvent?: string` | an accident instance spawns |
| Phone/social | `InteractionDef.emitsEvent?: string` | a social interaction completes |

Every one is an additive optional field: absent = today's behaviour exactly.

### 3.3 Runtime — `game/events.ts` (pure) + one applier in `main.ts`

Mirrors the split that already works for doors/accidents/quests/stateviz:

- **Pure** (`game/events.ts`, headless-testable): `resolveEvent(def, ctx)` evaluates the optional
  `conditions` through the *existing* quest evaluator and the optional `chancePercent` roll, then
  returns a **typed, ordered effect list** — it performs nothing itself.
- **Thin applier** (main.ts, ~one `switch`): maps each resolved effect to the subsystem call that
  already implements it. This is the only new wiring, and it is the single place where an event can
  touch the world.

Because the pure half returns data, the whole thing is unit-testable without three.js, and a
malformed event degrades to "no effects" instead of throwing (same never-throw precedent as
`resolveVar`).

### 3.4 Tool — Event Editor

New `tools/events.html` (nav tab "Events"), plus small additions to existing tools: an "emits
event" dropdown in the Interaction Editor, the Asset Editor state card, and the Quest Editor's
reward list. The dropdown is fed from events.json so an event id is never free-typed.

## 4. Risk assessment (the designer's real question)

| Risk | Mitigation |
| --- | --- |
| Breaking existing gameplay | Nothing is rewired in phase 1. Every trigger field is sparse and absent from current data, so the game behaves identically until the designer authors an event. |
| Double-firing (event + hardcoded path) | Migration is per-call-site: a hardcoded call is only removed in the same commit that authors its replacement event, with a test proving one fire. |
| Infinite loops (event → state → event) | The applier carries a depth counter and refuses to recurse past a small cap, logging the chain — same "never throw, degrade" rule as elsewhere. |
| Save compatibility | Events are stateless definitions. Only `onceOnly` bookkeeping (if added) needs saving, and it follows the existing sparse-restore precedent. |
| Effects drifting from subsystems | Effects are a closed union; each maps to exactly one existing call. Adding an effect type is a deliberate code change, not a data accident. |

## 5. Suggested build order (each independently shippable + testable)

1. **E1 — DONE** — pure `game/events.ts` + `data/events.json` schema + effect union, no triggers wired.
   Tests only. Zero gameplay change.
2. **E2 — DONE** — the applier in main.ts + `ActionDef.emitsEvent` (one trigger). Proves the whole path
   with the designer's own leak example.
3. **E3 — DONE** — Event Editor tool + the "emits event" dropdowns.
4. **E4** — remaining triggers (asset state, quest reward, accident, social).
5. **E5** — opt-in migration of existing hardcoded notification call sites, a few at a time.

## 6. Open questions for the designer

1. Should an event be able to fire **another** event (composition)? Powerful, but the loop risk
   above; recommend yes with the depth cap.
2. Should events support a **cooldown / once-only** flag (a leak shouldn't re-fire every second)?
   Recommend yes — it needs a small save-state addition.
3. For `spawnTransient`, should the puddle appear at the **asset** or at the **sim**? Recommend
   authoring it per effect (`at`), which the design above already allows.
4. The plumbing **leak risk** from New.txt request #4 — should that be a plain accident (today's
   system) or authored as an event? Recommend accident first, then let it *emit* an event, so both
   systems keep one job each.
