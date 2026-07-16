// finance-editor.test.mjs — jsdom coverage for tools/finance.html.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const html=readFileSync(join(here,'finance.html'),'utf8');
const finance={rent:{base:100,perFloorTile:2,byPropertyType:{condo:20,basement:-10,townhouse:50,house:100,penthouse:250}},bills:[{id:'phone',name:'Phone',base:10,perAssetValue:.1}],overdueDays:3,tooLateDays:7,negativeGraceDays:2};
const assets={assets:[{id:'chair',buyPrice:100}]};
const tuning={map:{active:'condo'}};
const map={id:'condo',propertyType:'condo',gridSize:1,bounds:{w:2,h:2},floors:[{polygon:[[0,0],[2,0],[2,2],[0,2]]}],placedObjects:[{asset:'chair'}]};
let rawPut='';
const fetchMock=async(url,opts={})=>{const path=String(url).replace('/api/data/','');if(opts.method==='PUT'){rawPut=opts.body;return{ok:true,status:200,json:async()=>({})};}const body={'finance.json':finance,'assets.json':assets,'tuning.json':tuning,'maps/condo.json':map}[path];return{ok:!!body,status:body?200:404,json:async()=>structuredClone(body)};};
const dom=new JSDOM(html,{url:'http://localhost:5173/tools/finance.html',runScripts:'dangerously',beforeParse(window){window.fetch=fetchMock;}});
const {window}=dom,doc=window.document; await new Promise((resolve)=>setTimeout(resolve,50));
let failures=0;function check(cond,msg){if(cond)console.log('  ok  '+msg);else{failures++;console.error('FAIL  '+msg);}}function fire(el,type){el.dispatchEvent(new window.Event(type,{bubbles:true}));}

check(!!window.FinanceEditor,'plain script exposes window.FinanceEditor');
check(doc.querySelector('input[data-path="rent.base"]').value==='100' && doc.querySelectorAll('.bill').length===1,'renders rent and bill formula fields');
check(doc.querySelector('input[data-path="rent.byPropertyType.penthouse"]').value==='250','renders complete property-type table');
window.FinanceEditor.setCompute((f,ctx)=>({floorTileCount:4,totalAssetValue:100,rent:f.rent.base+f.rent.perFloorTile*4+f.rent.byPropertyType[ctx.map.propertyType],bills:f.bills.map((bill)=>({...bill,amount:bill.base+bill.perAssetValue*100}))}));
check(doc.querySelector('[data-preview-id="rent"]').textContent==='§128' && doc.querySelector('[data-preview-id="phone"]').textContent==='§20','live preview renders computed rent and bill numbers');
const base=doc.querySelector('input[data-path="rent.base"]');base.value='150';fire(base,'input');
const grace=doc.querySelector('input[data-path="negativeGraceDays"]');grace.value='5';fire(grace,'input');
check(window.FinanceEditor.state.finance.rent.base===150 && window.FinanceEditor.state.finance.negativeGraceDays===5,'edits round-trip into finance schema');
check(doc.querySelector('[data-preview-id="rent"]').textContent==='§178','live preview refreshes after an edit');
doc.getElementById('save').click();await new Promise((resolve)=>setTimeout(resolve,20));
const saved=JSON.parse(rawPut);check(saved.rent.base===150&&saved.negativeGraceDays===5,'save PUT contains edited values');
check(rawPut===JSON.stringify(saved,null,2),'save uses exact pretty whole-file JSON');
if(failures){console.error(`\n${failures} failure(s)`);process.exit(1);}console.log('\nall finance editor tests passed');
