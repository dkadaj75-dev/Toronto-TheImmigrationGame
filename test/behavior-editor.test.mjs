// behavior-editor.test.mjs — jsdom coverage for tools/behavior.html.
// The module-script scorer bridge is intentionally inert in jsdom; inject a scorer through
// window.BehaviorEditor.setScorer() to cover the plain inline preview state/orchestration.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const html=readFileSync(join(here,'../tools/behavior.html'),'utf8');
const behavior={weights:{needDeficit:.1,distance:.5,personalityAffinity:1},decisionThreshold:2,needWeights:{energy:1.2,fun:.8},rules:[{id:'tired_bed',name:'Tired prefers bed',action:'sleep',assetId:'bed',conditions:{all:[{var:'personality.cleanliness',gte:7}]},scoreBonus:12,enabled:true}]};
const stats={needs:[{id:'energy',name:'Energy',default:70},{id:'fun',name:'Fun',default:60}],skills:[{id:'cooking',name:'Cooking',default:10,max:100}],personality:[{id:'cleanliness',name:'Cleanliness',default:5,max:10}]};
const assets={categories:['comfort','fun'],assets:[{id:'bed',name:'Bed',category:'comfort',interactions:['sleep']},{id:'tv',name:'TV',category:'fun',interactions:['watch_tv']}]};
const interactions={actions:[{id:'sleep',name:'Sleep',autonomyEligible:true,needGains:{energy:2}},{id:'watch_tv',name:'Watch TV',autonomyEligible:true,needGains:{fun:1}}]};
const tuning={map:{active:'condo'},economy:{startingFunds:500}};
const simstate={variables:[{id:'job',name:'Job',type:'string',default:null}]};
const quests={quests:[{id:'intro',name:'Introduction'}]};
const map={spawn:{pos:[0,0]},placedObjects:[{asset:'bed',pos:[2,0],rotDeg:0},{asset:'tv',pos:[1,0],rotDeg:0}]};
const rawPuts={};
const fixtures={'behavior.json':behavior,'stats.json':stats,'assets.json':assets,'interactions.json':interactions,'tuning.json':tuning,'simstate.json':simstate,'quests.json':quests,'maps/condo.json':map};
const fetchMock=async(url,opts={})=>{const path=String(url).replace('/api/data/','');if(opts.method==='PUT'){rawPuts[path]=opts.body;return{ok:true,status:200,json:async()=>({})};}const body=fixtures[path];return{ok:!!body,status:body?200:404,json:async()=>structuredClone(body)};};
const dom=new JSDOM(html,{url:'http://localhost:5173/tools/behavior.html',runScripts:'dangerously',beforeParse(window){window.fetch=fetchMock;}});
const {window}=dom,doc=window.document;
await new Promise((resolve)=>setTimeout(resolve,50));
let failures=0;
function check(cond,msg){if(cond)console.log('  ok  '+msg);else{failures++;console.error('FAIL  '+msg);}}
function fire(el,type){el.dispatchEvent(new window.Event(type,{bubbles:true}));}

check(!!window.BehaviorEditor,'plain script exposes window.BehaviorEditor');
check(doc.querySelector('input[data-path="weights.needDeficit"]').value==='0.1'&&doc.querySelector('input[data-path="decisionThreshold"]').value==='2','renders formula weights and decision threshold');
check(doc.querySelector('input[data-path="needWeights.energy"]').value==='1.2'&&doc.querySelectorAll('.rule').length===1,'renders per-need weights and rules');
check(doc.querySelector('input[data-path="preview.needs.energy"]').value==='70'&&doc.querySelector('input[data-path="preview.skills.cooking"]').value==='10'&&doc.querySelector('input[data-path="preview.personality.cleanliness"]').value==='5','hypothetical stats are seeded from defaults');
check([...doc.querySelectorAll('.cond-var option')].some((option)=>option.value==='personality.cleanliness'),'condition namespace includes personality dropdown paths');

const needWeight=doc.querySelector('input[data-path="needWeights.energy"]');needWeight.value='1.6';fire(needWeight,'input');
const threshold=doc.querySelector('input[data-path="decisionThreshold"]');threshold.value='4';fire(threshold,'input');
check(window.BehaviorEditor.state.behavior.needWeights.energy===1.6&&window.BehaviorEditor.state.behavior.decisionThreshold===4,'weight edits round-trip into behavior state');

doc.getElementById('addRule').click();
check(window.BehaviorEditor.state.behavior.rules.length===2&&doc.querySelectorAll('.rule').length===2,'rule CRUD adds and renders a rule');
const ruleIndex=1;
const action=doc.querySelector(`select[data-path="rules.${ruleIndex}.action"]`);action.value='watch_tv';fire(action,'change');
const category=doc.querySelector(`select[data-path="rules.${ruleIndex}.assetCategory"]`);category.value='fun';fire(category,'change');
const bonus=doc.querySelector(`input[data-path="rules.${ruleIndex}.scoreBonus"]`);bonus.value='9';fire(bonus,'input');
doc.querySelector(`.rule[data-rule-index="${ruleIndex}"] [data-action="add-condition"]`).click();
let varSelect=doc.querySelector(`.rule[data-rule-index="${ruleIndex}"] select[data-role="var"]`);varSelect.value='personality.cleanliness';fire(varSelect,'change');
let opSelect=doc.querySelector(`.rule[data-rule-index="${ruleIndex}"] select[data-role="op"]`);opSelect.value='lte';fire(opSelect,'change');
let value=doc.querySelector(`.rule[data-rule-index="${ruleIndex}"] [data-role="value"]`);value.value='3';fire(value,'input');
const added=window.BehaviorEditor.state.behavior.rules[ruleIndex];
check(added.action==='watch_tv'&&added.assetCategory==='fun'&&added.scoreBonus===9,'rule targets and score bonus round-trip');
check(JSON.stringify(added.conditions)==='{"all":[{"var":"personality.cleanliness","lte":3}]}','recursive condition builder produces condition JSON');

window.BehaviorEditor.setScorer((asset,action,ctx)=>action.id==='sleep'?10-ctx.distance:5-ctx.distance);
check(doc.querySelectorAll('#scoreRows tr').length===2&&doc.querySelector('#scoreRows tr td:nth-child(2)').textContent==='Bed','injected scorer ranks every placed-asset autonomy candidate');
const previewEnergy=doc.querySelector('input[data-path="preview.needs.energy"]');previewEnergy.value='15';fire(previewEnergy,'input');
check(window.BehaviorEditor.state.preview.needs.energy===15,'preview edits round-trip into hypothetical state');

doc.getElementById('save').click();await new Promise((resolve)=>setTimeout(resolve,20));
const saved=JSON.parse(rawPuts['behavior.json']);
check(saved.needWeights.energy===1.6&&saved.decisionThreshold===4&&saved.rules[1].conditions.all[0].var==='personality.cleanliness','PUT payload contains weight, rule, and condition edits');
check(rawPuts['behavior.json']===JSON.stringify(saved,null,2),'save uses exact pretty whole-file JSON');

doc.querySelector('.rule[data-rule-index="1"] [data-action="remove-rule"]').click();
check(window.BehaviorEditor.state.behavior.rules.length===1,'rule CRUD deletes a rule');
if(failures){console.error(`\n${failures} failure(s)`);process.exit(1);}console.log('\nall behavior editor tests passed');
