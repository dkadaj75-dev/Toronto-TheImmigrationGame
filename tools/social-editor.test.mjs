// social-editor.test.mjs — jsdom coverage for tools/social.html (ROADMAP_SOCIAL.md §3 S2).
// Run: node tools/social-editor.test.mjs
//
// Same harness style as tools/finance-editor.test.mjs: mount the page under jsdom with a mocked
// fetch, exercise the PLAIN inline-script logic exposed as window.SocialTool, and assert CRUD
// round-trips + the whole-file PUT payload shape. The live-preview logic is covered by injecting a
// stub into setSocial() (the module <script> that imports game/social.ts never runs under jsdom —
// exactly the behavior.html/setScorer precedent).
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'social.html'), 'utf8');

const npcs = { npcs: [
  { id:'amara', name:'Amara', portrait:'npcs/amara.png', mesh:'/models/character.glb', tint:'#d9a066', clipMap:null,
    personality:{ cleanliness:7, intelligence:6 }, availableHours:{from:10,to:22}, visitDurationHours:3, arrivalDelayMinutes:30,
    visitorActions:['watch_tv','ghost_action'] },
]};
const social = {
  relationship:{ min:-100, max:100, start:0, decayPerDay:0.5, levels:[
    { id:'enemy', atLeast:-100 }, { id:'acquaintance', atLeast:0 }, { id:'friend', atLeast:30 },
  ]},
  compatibility:{ traitWeights:{ cleanliness:0.5, intelligence:1.0 }, traitRange:10, minMultiplier:0.25, maxMultiplier:1.75 },
  interactions:[
    { id:'chat', name:'Chat', animation:'stand_talk', durationSeconds:20, needGains:{social:3}, relationshipGain:4, requiresLevelAtLeast:'acquaintance', requiresLevelAtMost:null, autonomyEligible:true, censor:false },
    { id:'ask_to_leave', name:'Ask to Leave', animation:'stand_talk', durationSeconds:8, needGains:{}, relationshipGain:0, special:'endVisit', requiresLevelAtLeast:null, requiresLevelAtMost:null, autonomyEligible:false, censor:false },
  ],
  phone:{ text:{ durationSeconds:10, needGains:{social:1}, relationshipGain:1, cooldownMinutes:60 }, call:{ durationSeconds:45, needGains:{social:2.5}, relationshipGain:2, cooldownMinutes:120 } },
  visitTheirPlace:{ awayHours:4, needsRestored:{social:60, fun:30}, relationshipGain:8, minLevel:'friend' },
};
const stats = {
  needs:[{id:'social', name:'Social'}, {id:'fun', name:'Fun'}],
  skills:[{id:'cooking', name:'Cooking'}],
  personality:[{id:'cleanliness', name:'Cleanliness', default:5, max:10}, {id:'intelligence', name:'Intelligence', default:5, max:10}],
};
const interactions = { actions:[
  { id:'watch_tv', name:'Watch TV', autonomyEligible:true },
  { id:'nap', name:'Nap', autonomyEligible:true },
  { id:'extinguish', name:'Extinguish', autonomyEligible:false },
] };
const assets = { categories:['beds','seating'], assets:[
  { id:'bed', name:'Double Bed', category:'beds' }, { id:'sofa', name:'Sofa', category:'seating' },
] };

const rawPuts = {};
const fetchMock = async (url, opts={}) => {
  const path = String(url).replace('/api/data/','');
  if (opts.method === 'PUT') { rawPuts[path] = opts.body; return { ok:true, status:200, json:async()=>({}) }; }
  const body = { 'npcs.json':npcs, 'social.json':social, 'stats.json':stats, 'assets.json':assets, 'interactions.json':interactions }[path];
  return { ok:!!body, status:body?200:404, json:async()=>structuredClone(body) };
};

const dom = new JSDOM(html, { url:'http://localhost:5173/tools/social.html', runScripts:'dangerously', beforeParse(window){ window.fetch = fetchMock; } });
const { window } = dom, doc = window.document;
await new Promise((resolve)=>setTimeout(resolve, 50));

let failures = 0;
function check(cond, msg){ if(cond) console.log('  ok  '+msg); else { failures++; console.error('FAIL  '+msg); } }
function fire(el, type){ el.dispatchEvent(new window.Event(type, { bubbles:true })); }
const T = window.SocialTool;

// ---- boot / render ------------------------------------------------------------------------------
check(!!T, 'plain script exposes window.SocialTool');
check(doc.querySelectorAll('#npcs .entity').length===1, 'renders one NPC card');
check(doc.querySelectorAll('#npcs .slider-row input[type=range]').length===2, 'personality sliders built from fetched stats.json trait list (2)');
check(doc.querySelectorAll('#levels .level-row').length===3, 'renders the three relationship levels');
check(doc.querySelectorAll('#traitWeights input').length===2, 'compatibility weights use the same fetched trait list');
check(doc.querySelectorAll('#interactions .entity').length===2, 'renders two interactions');

// ---- level-gate dropdown consistency: options are fed by the levels list + a null option ---------
{
  const atLeast = doc.querySelectorAll('#interactions .entity')[0].querySelectorAll('select')[1];
  const opts = [...atLeast.options].map((o)=>o.value);
  check(opts[0]==='' && opts.slice(1).join(',')==='enemy,acquaintance,friend', 'level ≥ dropdown = blank + every level id in order');
  const visitMin = doc.querySelector('#visitFields select');
  const vopts = [...visitMin.options].map((o)=>o.value);
  check(vopts[0]==='' && vopts.includes('friend'), 'visit minLevel dropdown is fed by the levels list + null option');
}

// ---- NPC CRUD round-trip ------------------------------------------------------------------------
doc.getElementById('addNpc').click();
check(T.state.npcs.npcs.length===2 && T.state.npcs.npcs[1].id==='npc2', 'add NPC appends with a unique id + seeded personality');
check(Object.keys(T.state.npcs.npcs[1].personality).length===2, 'new NPC personality seeded from the trait list');
// rename NPC 0 via its Name field (2nd text input in the grid: ID then Name)
{
  const grid0 = doc.querySelectorAll('#npcs .entity')[0];
  const texts = grid0.querySelectorAll('.grid input[type=text]');
  const nameField = texts[1];
  nameField.value = 'Amara Renamed'; fire(nameField, 'input');
  check(T.state.npcs.npcs[0].name==='Amara Renamed', 'NPC name edit round-trips into npcs schema');
  const slider = grid0.querySelector('input[type=range]');
  slider.value = '9'; fire(slider, 'input');
  check(T.state.npcs.npcs[0].personality.cleanliness===9, 'personality slider edit round-trips');
}
// delete the added NPC
doc.querySelectorAll('#npcs [data-action="remove-npc"]')[1].click();
check(T.state.npcs.npcs.length===1, 'delete NPC removes it from the list');

// ---- path normalization -------------------------------------------------------------------------
check(T.normalizeSourcePath('C:\\Users\\me\\project\\public\\npcs\\bob.png')==='/npcs/bob.png', 'Windows path with public/ segment normalizes to a public URL');
check(T.normalizeSourcePath('D:\\stuff\\amara.png')==='/stuff/amara.png', 'Windows path without public/ drops the drive letter');
check(T.normalizeSourcePath('npcs/amara.png')==='/npcs/amara.png', 'bare relative path gets a leading slash');
check(T.normalizeSourcePath('')==='' , 'blank path stays blank');
{
  const portrait = doc.querySelectorAll('#npcs .entity')[0].querySelectorAll('.grid input[type=text]')[2];
  portrait.value = 'C:\\game\\public\\npcs\\amara.png'; fire(portrait, 'input'); fire(portrait, 'blur');
  check(T.state.npcs.npcs[0].portrait==='/npcs/amara.png', 'pasted Windows portrait path normalized on blur');
}

// ---- sparse visit-duration curve ---------------------------------------------------------------
{
  const enemyMultiplier = doc.querySelectorAll('#levels .level-row')[0].querySelectorAll('input[type=number]')[1];
  check(enemyMultiplier.value==='', 'missing visit multiplier renders sparse/blank (x1)');
  enemyMultiplier.value='0.25'; fire(enemyMultiplier,'input');
  check(T.state.social.visitDuration.byLevel.enemy===0.25, 'visit multiplier round-trips by relationship level');
}

// ---- level CRUD + reorder -----------------------------------------------------------------------
doc.getElementById('addLevel').click();
check(T.state.social.relationship.levels.length===4 && T.state.social.relationship.levels[3].id==='level4', 'add level appends unique id');
{
  const before = T.state.social.relationship.levels.map((l)=>l.id).join(',');
  doc.querySelectorAll('#levels [data-action="level-up"]')[3].click();
  const after = T.state.social.relationship.levels.map((l)=>l.id).join(',');
  check(before!==after && T.state.social.relationship.levels[2].id==='level4', 'level ↑ reorders the levels array');
}
doc.querySelectorAll('#levels [data-action="remove-level"]')[2].click();
check(T.state.social.relationship.levels.length===3, 'remove level deletes it');

// ---- interaction CRUD + warn-on-blank animation -------------------------------------------------
doc.getElementById('addInteraction').click();
check(T.state.social.interactions.length===3 && T.state.social.interactions[2].id==='interaction3', 'add interaction appends unique id');
{
  const card = doc.querySelectorAll('#interactions .entity')[2];
  const warn = card.querySelector('[data-role="anim-warn"]');
  check(warn && warn.style.display==='', 'new interaction with blank animation shows the warn line');
  const anim = card.querySelector('.grid input[type=text][placeholder="stand_talk"]');
  anim.value = 'wave'; fire(anim, 'input');
  check(warn.style.display==='none', 'setting an animation hides the warn line');
  check(T.state.social.interactions[2].animation==='wave', 'animation edit round-trips');
  // level gate select → maps blank to null
  const targetPicker = card.querySelectorAll('.grid select')[0];
  check([...targetPicker.options].some((o)=>o.value==='beds') && [...targetPicker.options].some((o)=>o.value==='bed'), 'target picker is fetched from asset categories + ids');
  targetPicker.value='bed'; fire(targetPicker,'change');
  const playerAnimation = card.querySelector('input[placeholder="blank = base animation"]');
  const npcAnimation = card.querySelectorAll('input[placeholder="blank = base animation"]')[1];
  const sound = card.querySelector('input[placeholder="/sounds/social.wav"]');
  playerAnimation.value='lie_player'; fire(playerAnimation,'input');
  npcAnimation.value='lie_npc'; fire(npcAnimation,'input');
  sound.value='C:\\game\\public\\sounds\\cuddle.wav'; fire(sound,'input'); fire(sound,'blur');
  check(T.state.social.interactions[2].targetAsset==='bed' && T.state.social.interactions[2].playerAnimation==='lie_player' && T.state.social.interactions[2].npcAnimation==='lie_npc' && T.state.social.interactions[2].sound==='/sounds/cuddle.wav', 'paired target, role animations, and normalized sound CRUD round-trip');
  const atLeast = card.querySelectorAll('.grid select')[1];
  atLeast.value = 'friend'; fire(atLeast, 'change');
  check(T.state.social.interactions[2].requiresLevelAtLeast==='friend', 'requiresLevelAtLeast picks a level id');
  atLeast.value = ''; fire(atLeast, 'change');
  check(T.state.social.interactions[2].requiresLevelAtLeast===null, 'blank level gate stores null');
  // need gain
  const needInput = card.querySelectorAll('.need-row input')[0];
  needInput.value = '5'; fire(needInput, 'input');
  check(T.state.social.interactions[2].needGains.social===5, 'need gain edit round-trips');
}
doc.querySelectorAll('#interactions [data-action="remove-interaction"]')[2].click();
check(T.state.social.interactions.length===2, 'remove interaction deletes it');

// Keep one paired interaction through the save round-trip.
{
  const card = doc.querySelectorAll('#interactions .entity')[0];
  const selects = card.querySelectorAll('.grid select'); selects[0].value='beds'; fire(selects[0],'change');
  const roles = card.querySelectorAll('input[placeholder="blank = base animation"]');
  roles[0].value='player_talk'; fire(roles[0],'input'); roles[1].value='npc_talk'; fire(roles[1],'input');
  const sound = card.querySelector('input[placeholder="/sounds/social.wav"]'); sound.value='/sounds/chat.wav'; fire(sound,'input');
}

// ---- live preview via injected real functions ---------------------------------------------------
T.setSocial({
  compatibility:(a,b,data)=>{ // tiny deterministic stub mirroring the real signature
    let ws=0, wd=0; for(const t of Object.keys(data.compatibility.traitWeights)){ const w=data.compatibility.traitWeights[t]; if(!(w>0)||typeof a[t]!=='number'||typeof b[t]!=='number')continue; ws+=w; wd+=w*Math.abs(a[t]-b[t])/data.compatibility.traitRange; }
    const score = ws===0?1:1-wd/ws; const m=data.compatibility.minMultiplier+score*(data.compatibility.maxMultiplier-data.compatibility.minMultiplier); return { score, multiplier:m };
  },
  levelAllows:(it, levelId, data)=>{ const idx=data.relationship.levels.findIndex((l)=>l.id===levelId); const lo=it.requiresLevelAtLeast?data.relationship.levels.findIndex((l)=>l.id===it.requiresLevelAtLeast):-1; if(lo>=0&&idx<lo)return false; const hi=it.requiresLevelAtMost?data.relationship.levels.findIndex((l)=>l.id===it.requiresLevelAtMost):-1; if(hi>=0&&idx>hi)return false; return true; },
  levelFor:()=>null,
});
check(doc.querySelectorAll('#previewCompat .compat-line').length===2, 'preview shows compatibility score + multiplier via injected real functions');
check(doc.querySelectorAll('#previewLevels .lvl-block').length===3, 'preview lists interactions for each relationship level');
{
  // chat requires >= acquaintance, so the enemy (index 0) block must NOT list it, but acquaintance must.
  const blocks = [...doc.querySelectorAll('#previewLevels .lvl-block')];
  const enemyBlock = blocks.find((b)=>b.dataset.level==='enemy');
  const acqBlock = blocks.find((b)=>b.dataset.level==='acquaintance');
  check(!enemyBlock.querySelector('.lvl-acts').textContent.includes('Chat'), 'gated interaction hidden at a level below its requirement');
  check(acqBlock.querySelector('.lvl-acts').textContent.includes('Chat'), 'gated interaction shown once the level requirement is met');
}

// ---- whole-file PUT payload shape (both files, 2-space JSON) -------------------------------------
doc.getElementById('save').click();
await new Promise((resolve)=>setTimeout(resolve, 20));
check(rawPuts['npcs.json'] && rawPuts['social.json'], 'save PUTs both edited files');
const savedNpcs = JSON.parse(rawPuts['npcs.json']), savedSocial = JSON.parse(rawPuts['social.json']);
check(savedNpcs.npcs[0].name==='Amara Renamed' && savedNpcs.npcs[0].portrait==='/npcs/amara.png', 'npcs.json PUT carries the edited values');
check(savedSocial.interactions.length===2 && savedSocial.relationship.levels.length===3, 'social.json PUT carries the edited collections');
check(savedSocial.visitDuration.byLevel.enemy===0.25 && savedSocial.interactions[0].targetAsset==='beds' && savedSocial.interactions[0].playerAnimation==='player_talk' && savedSocial.interactions[0].npcAnimation==='npc_talk' && savedSocial.interactions[0].sound==='/sounds/chat.wav', 'new sparse social fields survive whole-file save round-trip');
check(rawPuts['npcs.json']===JSON.stringify(savedNpcs,null,2) && rawPuts['social.json']===JSON.stringify(savedSocial,null,2), 'both saves use exact 2-space pretty whole-file JSON');

// --- AUDIT no-tool 59: per-NPC visitorActions picker
{
  const box = (id) => doc.querySelector(`input[data-path="npc.amara.visitorActions.${id}"]`);
  check(!!box('watch_tv') && box('watch_tv').checked, 'authored visitorAction renders checked');
  check(!!box('nap') && !box('nap').checked, 'other autonomy-eligible actions render unchecked');
  check(!box('extinguish'), 'non-autonomy-eligible actions are not offered');
  const stale = doc.querySelector('[data-stale="ghost_action"]');
  check(!!stale, 'an authored id that no longer resolves is kept and flagged, never silently dropped');

  box('nap').checked = true; box('nap').dispatchEvent(new window.Event('change', { bubbles:true }));
  const live = () => window.SocialTool.state.npcs.npcs[0].visitorActions;
  check(live().includes('nap') && live().includes('watch_tv'), 'checking an action appends it');
  box('watch_tv').checked = false; box('watch_tv').dispatchEvent(new window.Event('change', { bubbles:true }));
  check(!live().includes('watch_tv') && live().includes('nap'), 'unchecking removes only that action');
}

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall social editor tests passed');
