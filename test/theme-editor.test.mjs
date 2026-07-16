// theme-editor.test.mjs — jsdom coverage for tools/theme.html.
// The module bridge is inert in jsdom, so the real engine-shaped bridge is injected below.
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
const html=readFileSync(join(here,'../tools/theme.html'),'utf8');
const theme=JSON.parse(readFileSync(join(here,'../data/theme.json'),'utf8'));
const knownIds=['needs-panel','skills-panel','quest-panel','time-bar','activity-chip','work-chip','quest-toasts','visa-chip','funds-chip','buy-button','wall-cut-button','phone-button','buy-ghost-controls','buy-selection-chips'];
let rawPut='';
const fetchMock=async(url,opts={})=>{
  if(opts.method==='PUT'){rawPut=opts.body;return{ok:true,status:200,json:async()=>({})};}
  return{ok:String(url).endsWith('/theme.json'),status:200,json:async()=>structuredClone(theme)};
};
const dom=new JSDOM(html,{url:'http://localhost:5173/tools/theme.html',runScripts:'dangerously',beforeParse(window){window.fetch=fetchMock;}});
const {window}=dom,doc=window.document;
await new Promise((resolve)=>setTimeout(resolve,40));
let failures=0,previewCalls=0;
function check(cond,msg){if(cond)console.log('  ok  '+msg);else{failures++;console.error('FAIL  '+msg);}}
function fire(el,type){el.dispatchEvent(new window.Event(type,{bubbles:true}));}

check(!!window.ThemeEditor,'plain script exposes window.ThemeEditor');
window.ThemeEditor.setThemeEngine((edited,previewDoc)=>{previewCalls++;previewDoc.documentElement.dataset.previewFamily=edited.fonts.family;},knownIds);
check(doc.querySelector('input[data-path="fonts.family"]').value===theme.fonts.family&&doc.querySelector('input[data-path="shapes.radiusPx"]').value==='10','renders font and shape fields');
check(doc.querySelectorAll('#colorFields input[type="color"]').length===Object.keys(theme.colors).length,'renders a color picker for every theme color');
check(doc.querySelectorAll('.component').length===4&&doc.querySelector('input[data-path="components.actionMenu.radiusPx"]').value==='999','renders all sparse component override cards');
check([...doc.querySelectorAll('#layoutElement option')].map((o)=>o.value).join('|')===knownIds.join('|'),'layout dropdown comes from engine-known HUD ids');
check(previewCalls===1&&doc.documentElement.dataset.previewFamily===theme.fonts.family,'engine bridge applies the loaded theme to the mock preview');

const family=doc.querySelector('input[data-path="fonts.family"]');family.value='Georgia, serif';fire(family,'input');
const panelBg=doc.querySelector('input[data-path="colors.panelBg"]');panelBg.value='#112233';fire(panelBg,'input');
const radius=doc.querySelector('input[data-path="shapes.radiusPx"]');radius.value='14';fire(radius,'input');
check(window.ThemeEditor.state.theme.fonts.family==='Georgia, serif'&&window.ThemeEditor.state.theme.colors.panelBg==='#112233'&&window.ThemeEditor.state.theme.shapes.radiusPx===14,'font, color, and shape edits round-trip');
check(previewCalls===4&&doc.documentElement.dataset.previewFamily==='Georgia, serif','every edit reapplies the live preview');

const panelShadow=doc.querySelector('input[data-path="components.panel.shadow"]');panelShadow.value='';fire(panelShadow,'input');
const panelFont=doc.querySelector('input[data-path="components.panel.fontFamily"]');panelFont.value='monospace';fire(panelFont,'input');
check(!('shadow' in window.ThemeEditor.state.theme.components.panel)&&window.ThemeEditor.state.theme.components.panel.fontFamily==='monospace','blank overrides are deleted while authored overrides remain sparse');

const layoutSelect=doc.getElementById('layoutElement');layoutSelect.value='funds-chip';fire(layoutSelect,'change');
doc.querySelector('#anchorPicker [data-anchor="bl"]').click();
const offsetX=doc.getElementById('offsetX');offsetX.value='23';fire(offsetX,'input');
const hidden=doc.getElementById('layoutHidden');hidden.checked=true;fire(hidden,'change');
check(JSON.stringify(window.ThemeEditor.state.theme.layout['funds-chip'])==='{"anchor":"bl","offsetX":23,"offsetY":128,"hidden":true}','layout anchor, offset, and hidden edits round-trip');

doc.getElementById('addAccordion').click();
check(window.ThemeEditor.state.theme.accordions.length===1&&doc.querySelectorAll('.accordion-row').length===1,'accordion CRUD adds and renders a group');
const accordionName=doc.querySelector('input[data-path="accordions.0.name"]');accordionName.value='Bottom HUD';fire(accordionName,'input');
const collapsed=doc.querySelector('input[data-path="accordions.0.collapsedByDefault"]');collapsed.checked=true;fire(collapsed,'change');
const assignment=doc.getElementById('layoutAccordion');assignment.value='Bottom HUD';fire(assignment,'change');
check(window.ThemeEditor.state.theme.layout['funds-chip'].accordion==='Bottom HUD'&&window.ThemeEditor.state.theme.accordions[0].collapsedByDefault===true,'accordion name, default state, and layout assignment round-trip');

doc.getElementById('save').click();await new Promise((resolve)=>setTimeout(resolve,20));
const saved=JSON.parse(rawPut);
check(saved.fonts.family==='Georgia, serif'&&saved.components.panel.fontFamily==='monospace'&&!('shadow' in saved.components.panel),'PUT payload preserves edits and sparse overrides');
check(saved.layout['funds-chip'].anchor==='bl'&&saved.layout['funds-chip'].accordion==='Bottom HUD'&&saved.accordions[0].collapsedByDefault===true,'PUT payload contains layout and accordion edits');
check(rawPut===JSON.stringify(window.ThemeEditor.state.theme,null,2),'save uses exact pretty whole-file JSON payload');

doc.querySelector('[data-action="remove-accordion"]').click();
check(window.ThemeEditor.state.theme.accordions.length===0&&!('accordion' in window.ThemeEditor.state.theme.layout['funds-chip']),'accordion delete clears group assignments');
if(failures){console.error(`\n${failures} failure(s)`);process.exit(1);}console.log('\nall theme editor tests passed');
