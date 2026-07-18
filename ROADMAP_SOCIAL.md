# ROADMAP_SOCIAL.md — Social system: NPCs, relationships, visits, phone contact

> Planning document (2026-07-16). **No code written yet.** The batch AFTER ROADMAP_APT.md's
> apartment work (build order: APT first, SOCIAL second — the visit/move flows reuse APT's
> exterior-door and map machinery, and NPCs arriving at rented apartments need R4 shipped).
> Same rules as always: PROJECT_CONTEXT.md wins, AGENTS.md gates per slice, one commit per
> slice, everything data-driven with a tool UI, sim-time `sdt` for all gameplay timers,
> side effects on completed actions only.

---

## 0. Designer request (verbatim intent)

> Create social interactions: other Sims NOT controlled by the player but with a mesh, a
> personality trait etc. Depending on personality traits there will be a match or not with our
> Sim; they can hate or love each other depending on their ongoing relationship, like in The
> Sims (relationship status, social interactions that are contextual / bound to relationship
> level etc.). We can call Sims home with the phone — the NPC comes over and the player
> interacts with it; the player Sim can also do this autonomously. Sometimes we can go to their
> place — to keep it simple the Sim disappears for a few hours, with needs and relationship
> status more or less filled depending on the relationship and compatibility. Each interaction
> can fulfill needs, generally the social need. NPCs are autonomous while visiting, but we can
> ask them to leave (through an interaction) at any moment. This whole social thing should be a
> separate tool page to avoid saturating the other tools, including sim-to-sim interactions.
> We can also "Text" or "Call" other Sims from the phone to fill the social need (slower) and
> improve (or not) the relationship.

---

## 1. Big picture

Five layers, built bottom-up:

1. **Data + pure core** — NPC defs, compatibility formula, relationship scores/levels, social
   interaction defs. All new JSON, all tool-editable, pure headless logic first.
2. **Social Editor** — its own tool page (`tools/social.html`), per the explicit request.
3. **NPC runtime** — a visiting NPC in the world: rigged mesh, locomotion, autonomy, leave.
4. **Player-facing surfaces** — contextual sim-to-sim radial menu, phone Contacts tab
   (invite / text / call), go-visit-them flow.
5. **Designer authoring** — the actual NPCs, portraits, interaction sets.

Persistence: relationships and visit state follow the established runtime pattern —
`serialize()/restore()` exposed from day one, in-memory until the save system lands (same as
quests/visas/finance today). Reload resets relationships for now; the designer has already
accepted this trade-off game-wide.

New need dependency: a `social` need in `data/stats.json` (designer adds via Tuning Editor —
needs are already data-driven; verify decay/autonomy pick it up with zero code, which is the
whole point of the needs system).

---

## 2. Data model (new files)

### `data/npcs.json`
```jsonc
{ "npcs": [{
  "id": "amara",
  "name": "Amara",
  "portrait": "npcs/amara.png",        // under public/, drop-in like icons
  "mesh": "/models/character.glb",     // DEFAULT: reuse the player rig (tintable); per-NPC GLB optional
  "tint": "#d9a066",                   // cheap visual differentiation when sharing the rig
  "clipMap": null,                     // optional override; absent = tuning.character.clipMap
  "personality": { "cleanliness": 7, "sociability": 9 },  // SAME trait vocabulary as stats.json
  "availableHours": { "from": 10, "to": 22 },  // when invites/texts/calls can land
  "visitDurationHours": 3,             // how long they stay when invited
  "arrivalDelayMinutes": 30            // sim-time between accepted invite and door arrival
}]}
```

### `data/social.json`
```jsonc
{
  "relationship": {
    "min": -100, "max": 100, "start": 0,
    "decayPerDay": 0.5,                 // slow drift toward 0; 0 disables
    "levels": [                         // Sims-style named statuses, designer-editable
      { "id": "enemy",        "atLeast": -100 },
      { "id": "disliked",     "atLeast": -40 },
      { "id": "acquaintance", "atLeast": 0 },
      { "id": "friend",       "atLeast": 30 },
      { "id": "good_friend",  "atLeast": 60 },
      { "id": "beloved",      "atLeast": 85 }
    ]
  },
  "compatibility": {
    // per-trait weight: score = 1 - Σ w_t * |traitA - traitB| / range   (clamped, tunable shape)
    "traitWeights": { "cleanliness": 0.5, "sociability": 1.0 },
    "minMultiplier": 0.25, "maxMultiplier": 1.75   // scales relationship gains/losses
  },
  "interactions": [                     // sim-to-sim actions — SOCIAL vocabulary, not ActionDef reuse-by-force:
    {                                   // shares shape with ActionDef where it fits (animation, duration, needGains)
      "id": "chat", "name": "Chat",
      "animation": "stand_talk",        // both participants; per-role override optional later
      "durationSeconds": 20,
      "needGains": { "social": 3 },     // player sim; NPC internal meter gets a mirrored gain
      "relationshipGain": 4,            // BEFORE compatibility multiplier
      "requiresLevelAtLeast": "acquaintance",   // contextual gating by level id
      "requiresLevelAtMost": null,
      "autonomyEligible": true,
      "censor": false
    },
    { "id": "argue", "relationshipGain": -6, "requiresLevelAtMost": "acquaintance" /* ... */ },
    { "id": "ask_to_leave", "special": "endVisit", "requiresLevelAtLeast": null /* always shown on a visitor */ }
  ],
  "phone": {
    "text": { "durationSeconds": 10, "needGains": { "social": 1 },  "relationshipGain": 1, "cooldownMinutes": 60 },
    "call": { "durationSeconds": 45, "needGains": { "social": 2.5 }, "relationshipGain": 2, "cooldownMinutes": 120 }
  },
  "visitTheirPlace": {
    "awayHours": 4,                     // sim hidden, like going to work (work-system precedent)
    "needsRestored": { "social": 60, "fun": 30 },   // scaled by relationship level + compatibility
    "relationshipGain": 8,              // also compatibility-scaled
    "minLevel": "friend"                // can't invite yourself below this
  }
}
```

Notes:
- **Compatibility is symmetric and static** (traits don't change); **relationship is the mutable
  ongoing score**. Gains apply as `relationshipGain * compatibilityMultiplier` — a great match
  drifts toward love with the same actions that leave a bad match stuck, and negative
  interactions cut deeper between incompatible sims. Love/hate emerges from data, no special
  cases.
- Relationship values live per NPC id in a runtime `RelationshipState` (serialize/restore).
- `ask_to_leave` is data like everything else, flagged `special: "endVisit"` so the engine knows
  its side effect; shown at any relationship level.

---

## 3. Slices

### S1 — Pure social core (`game/social.ts`) + schema types — ✅ SHIPPED (2026-07-18)
> As-built: game/social.ts + data/npcs.json + data/social.json + test/social.test.ts (82
> assertions). Deviations from §2: `compatibility.traitRange` added to social.json (formula
> denominator, no magic numbers); trait ids are the real stats.json ones (cleanliness,
> intelligence — the doc's `sociability` doesn't exist); negative relationshipGain uses the
> mid-band reflected multiplier `(min+max)−mult` so incompatible pairs cut deeper. §6 decisions
> adopted as recommended (decay ON 0.5/day; one visitor; no romance mechanics). PROJECT_CONTEXT §7.42.
Compatibility formula, relationship container (get/apply/decay/level resolution), interaction
gating (`levelAllows(interaction, level)`), phone gain math with cooldowns, visit-their-place
outcome computation (needs/relationship deltas from level + compatibility). Fully headless,
`test/social.test.ts` covering: symmetric compatibility, multiplier clamps, level thresholds
(inclusive edges), gating by min/max level, decay over sim-days, cooldown windows, negative
gains cutting deeper on bad matches.
**Agent: Claude (Opus).** Formula/API design quality here determines every later slice.

### S2 — Social Editor (`tools/social.html`) — the dedicated tool page — ✅ SHIPPED (2026-07-18)
> As-built: tools/social.html (window.SocialTool inline + module script injecting REAL
> game/social.ts fns via setSocial — Behavior Editor precedent), 6 cards exactly per spec;
> trait/need lists fetched from stats.json, level-gate dropdowns fed by the levels list,
> Windows-path normalization, warn-on-blank animation. tools/social-editor.test.mjs (37 checks);
> nav.js + toolnav test extended to 12 tools. Player personality read from stats.json defaults
> (same source as game/stats.ts seeding). PROJECT_CONTEXT §7.43.
Per the explicit request, everything social lives on its OWN page (added to tools/nav.js):
- NPC CRUD: name, portrait, mesh/tint/clipMap, personality sliders (trait list imported from
  stats.json — never duplicated), availability, visit durations.
- Relationship levels editor (add/rename/threshold), decay, compatibility weights.
- Sim-to-sim interaction CRUD with level gates, gains, animation (warn-on-blank precedent),
  censor flag, autonomy eligibility.
- Phone text/call and visit-their-place tuning cards.
- **Live preview card:** pick an NPC → shows compatibility vs the player personality
  (stats.json), the resulting multiplier, and which interactions are available at each
  relationship level (uses the REAL game/social.ts functions — Behavior Editor precedent).
jsdom suite `tools/social-editor.test.mjs` (CRUD round-trips, whole-file PUT, gating preview).
**Agent: Claude (Opus).** Big tool page, but every pattern (inline script + module preview,
condition-ish gating UI, live preview via real functions) has a shipped precedent.

### S3 — NPC runtime: the visitor (`game/npc.ts` + thin layer) — ✅ SHIPPED (2026-07-18)
> As-built (Codex): game/npc.ts pure lifecycle `idle→pending→entering→visiting→leaving→idle` +
> thin runtime (tinted shared rig, own AnimController + SimAgent, exterior-door in/out).
> Whitelist lives on the NPC def (`visitorActions` in data/npcs.json), enforced via optional
> whitelist param in game/autonomy.ts scoring. Single normalized social/leave meter. Unreachable
> exterior door converts the invite to a phoneGain("call") outcome + feedback, occupancy cleared
> (decision 5). APIs — S4: endVisit/engage/setAutonomyPaused/visitorObject/visitorAgent;
> S5: invite/canInvite/state; serialize/restore. test/npc.test.ts (25 assertions).
> PROJECT_CONTEXT §7.44.
- Spawn a visiting NPC: rigged character via `loadRiggedCharacter` (own mesh or tinted shared
  rig), own `AnimController`, own `SimAgent` for locomotion (it is deliberately the same agent
  class — nav, arrival, pose logic all reused; NO parallel implementation).
- Visit lifecycle: invite accepted → `arrivalDelayMinutes` (sim-time) → NPC walks in through the
  exterior door (doors system precedent) → autonomous period → leaves after
  `visitDurationHours`, when asked (`endVisit`), or at `availableHours.to`.
- Visitor autonomy: reuse the behavior/autonomy scorer with a visitor whitelist (sit, watch TV,
  social interactions toward the player; no cooking/showering/bed by default — data-driven
  whitelist on the NPC or in social.json, NOT hardcoded).
- NPC "needs": a single internal social/leave-inclination meter, not the full needs stack
  (keep-it-simple per the designer; full NPC needs is explicitly out of scope).
- One visitor at a time (see §6 decisions).
**Agent: Codex.** Second animated agent in the world touching nav, doors, autonomy, animation —
the highest-complexity slice of this batch.

### S4 — Sim-to-sim contextual interactions
- Tapping the visiting NPC opens the radial menu (contextmenu precedent) listing social.json
  interactions filtered by CURRENT relationship level (S1 gating) — contextual exactly like
  The Sims.
- Execution: player sim walks to the NPC (SimAgent orderAction with the NPC as target), both
  face each other, both play the interaction animation for `durationSeconds` (sim-time), needs +
  relationship apply ON COMPLETION only (side-effect rule); cancels/interrupts change nothing.
  NPC autonomy pauses while engaged.
- Player-sim autonomy: social interactions with `autonomyEligible: true` join the behavior
  scoring when a visitor is present (social need deficit drives it) — this is the "the sim can
  also be autonomous with that" requirement, and it composes with S5's autonomous invite.
**Agent: Codex.** Two-agent choreography (mutual facing, paused autonomy, interruption safety)
is regression-prone in exactly the ways this repo's seat history demonstrated.

### S5 — Phone: Contacts tab (invite / text / call)
- New phone tab "Contacts": NPC list with portrait, name, relationship status label + score bar.
- **Invite home:** available inside NPC hours, starts S3's lifecycle; disabled while a visit or
  pending arrival exists.
- **Text / Call:** timed phone actions (progress bar precedent), slower social fill and small
  compatibility-scaled relationship delta per social.json.phone, with cooldowns; usable anytime
  the NPC is available, no visit required.
- Autonomy hook: low social + no visitor → the sim may autonomously text/call or invite
  (behavior.json rule with scoreBonus, data-driven, designer can disable).
**Agent: Claude (Opus).** Phone-tab and progress/feedback precedents are strong (jobs,
bills, Kijiji R3 will have just shipped a third example).

### S6 — Going to their place
- Contacts tab action (gated by `visitTheirPlace.minLevel`): sim walks out the exterior door and
  is hidden for `awayHours` — direct reuse of the going-to-work machinery (hide + time handling)
  with a different outcome application: needs + relationship restored per social.json, scaled by
  relationship level and compatibility (computed in S1, applied on return = completion).
  Interrupting/cancelling before departure applies nothing.
**Agent: Claude (Sonnet).** Deliberately thin: work-system clone with S1-computed outcomes;
spec is fully mechanical by the time S1/S5 exist.

### S7 — Designer authoring pass (no agent)
NPCs (portraits under `public/npcs/`, traits, availability), relationship level names, the
actual interaction set (chat/joke/compliment/argue/insult/ask-to-leave...), phone/visit tuning,
a `social` need added to stats.json with its decay + autonomy flag, behavior.json rules for
autonomous texting/inviting.

---

## 4. Execution order & dependencies

```
S1 (Opus) ──► S2 (Opus) ──► S7 (designer, can start authoring)
   └────────► S3 (Codex) ──► S4 (Codex) ──► S5 (Opus) ──► S6 (Sonnet)
```
- S1 blocks everything; S2 and S3 can then run in parallel (disjoint files: tool page vs
  game runtime).
- S4 needs S3's visitor; S5 needs S3 (invite) + S1 (phone math); S6 needs S1 + S5's tab.
- **This whole batch starts only after ROADMAP_APT.md ships** (exterior-door flows must be
  stable; the map switch changes what "home" means for arrivals).
- Coordinator (main session) verifies, updates docs, and commits after every slice — agents
  never touch PROJECT_CONTEXT/ROADMAP*/handoff or commit, same as batch 10/11 workflow.

## 5. Agent assignment summary

| Slice | Task | Agent | Why |
|---|---|---|---|
| S1 | Pure social core (compatibility/relationship/gating) | Claude Opus | Formula + API design quality gates the batch |
| S2 | Social Editor tool page | Claude Opus | Large tool, all precedented patterns |
| S3 | NPC visitor runtime | **Codex** | Second nav/anim agent in the world — highest risk |
| S4 | Sim-to-sim contextual interactions | **Codex** | Two-agent choreography + interruption safety |
| S5 | Phone Contacts (invite/text/call) + autonomy hook | Claude Opus | Phone/progress precedents |
| S6 | Visit-their-place away flow | Claude Sonnet | Mechanical work-system clone once S1/S5 exist |
| S7 | NPCs, portraits, interaction set, social need | Designer | Authoring |

## 6. Open decisions (resolve before the slice that needs them)

1. **Concurrent visitors (S3):** recommendation — exactly ONE visitor at a time for this batch;
   the data model (per-NPC relationship map) already supports more later.
2. **NPC visuals (S3/S7):** recommendation — shared player rig + per-NPC tint as the shipped
   default (zero new asset work, animations guaranteed to retarget); per-NPC GLB supported but
   designer-provided later.
3. **Romance/censor depth:** relationship levels are pure data, so "beloved" costs nothing —
   recommendation: no dedicated romance MECHANICS (jealousy, partners moving in) this batch;
   flirty interactions are just data entries with high level gates + censor flag if desired.
4. **Relationship decay (S1):** recommendation — ship ON at a gentle default (0.5/day) since
   "ongoing relationship" implies maintenance; designer can zero it in the Social Editor.
5. **NPC-visit failure states:** what happens if the exterior door is unreachable (fire, funds
   seized)? Recommendation — invite silently converts to a phone Call outcome + toast, never a
   stuck NPC; codified in S3's tests.

## 7. Explicitly out of scope (this batch)

- Full NPC needs simulation, NPC homes as real maps (their place is an away-timer, per the
  designer), NPC-to-NPC relationships, more than one simultaneous visitor, romance mechanics
  beyond data-defined interactions, the save system (serialize/restore exposed, wired later).
