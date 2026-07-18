// theme-editor.test.mjs — jsdom coverage for B13-1's Theme Editor.
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { transformSync } from 'esbuild';

const here=dirname(fileURLToPath(import.meta.url));
const html=readFileSync(join(here,'../tools/theme.html'),'utf8');
const theme=JSON.parse(readFileSync(join(here,'../data/theme.json'),'utf8'));
const themeEngineSource=readFileSync(join(here,'../game/theme.ts'),'utf8');
const themeEngineJs=transformSync(themeEngineSource,{loader:'ts',format:'esm',target:'es2020'}).code;
const {applyTheme}=await import(`data:text/javascript;base64,${Buffer.from(themeEngineJs).toString('base64')}`);
const knownIds=['needs-panel','skills-panel','quest-panel','time-bar','activity-chip','work-chip','quest-toasts','visa-chip','funds-chip','buy-button','wall-cut-button','phone-button','buy-ghost-controls','buy-selection-chips'];
let rawPut='';
const fetchMock=async(url,opts={})=>{
  if(opts.method==='PUT'){rawPut=opts.body;return{ok:true,status:200,json:async()=>({})};}
  if(String(url)==='/api/fonts')return{ok:true,status:200,json:async()=>['fonts/Test Font.woff2','fonts/Local.otf']};
  if(String(url)==='/api/icons')return{ok:true,status:200,json:async()=>['icons/needs.svg','icons/skills.svg','icons/custom.png']};
  return{ok:String(url).endsWith('/theme.json'),status:200,json:async()=>structuredClone(theme)};
};
const dom=new JSDOM(html,{url:'http://localhost:5173/tools/theme.html',runScripts:'dangerously',beforeParse(window){window.fetch=fetchMock;}});
const {window}=dom,doc=window.document;
await new Promise((resolve)=>setTimeout(resolve,50));
let failures=0,previewCalls=0;
function check(cond,msg){if(cond)console.log('  ok  '+msg);else{failures++;console.error('FAIL  '+msg);}}
function fire(el,type){el.dispatchEvent(new window.Event(type,{bubbles:true}));}

check(doc.querySelectorAll('#colorFields [data-path]').length>0,'Colors renders fields against the real on-disk theme');
check(doc.querySelectorAll('#shapeFields [data-path]').length>0,'Shapes renders fields against the real on-disk theme');
check(doc.querySelectorAll('#componentFields .component [data-path]').length>0,'Element gallery renders fields against the real on-disk theme');

const T=window.ThemeEditor;
check(!!T,'plain script exposes ThemeEditor');
T.setThemeEngine((edited,previewDoc)=>{previewCalls++;applyTheme(edited,previewDoc);previewDoc.documentElement.dataset.previewFamily=edited.fonts.family;},knownIds);
check(doc.querySelectorAll('.component').length===Object.keys(theme.components).length,'gallery derives one card per theme component key');
check(doc.querySelector('[data-component="phoneShell"] .specimen-phone')&&doc.querySelector('[data-component="actionMenu"] [data-path$="centerRadiusPx"]'),'gallery includes isolated phone and radial specimens with relevant sparse fields');
check([...doc.querySelectorAll('#fontOptions option')].map((x)=>x.value).includes('/fonts/Test Font.woff2'),'font listing populates its dropdown');
check([...doc.querySelectorAll('#iconOptions option')].map((x)=>x.value).includes('/icons/custom.png'),'icon listing populates its dropdown');
check(T.normalizeSourcePath('D:\\WebCreation\\condo-life-web\\public\\icons\\new.png')==='/icons/new.png'&&T.normalizeSourcePath('fonts/local.woff2')==='/fonts/local.woff2','Windows and relative public paths normalize to served URLs');

const family=doc.querySelector('[data-path="fonts.family"]');family.value='Test Family';fire(family,'input');
doc.getElementById('addFontFace').click();
const lastFace=T.state.theme.fonts.faces.length-1;
const faceSource=doc.querySelector(`[data-path="fonts.faces.${lastFace}.src"]`);faceSource.value='C:\\repo\\public\\fonts\\Test Font.woff2';fire(faceSource,'blur');
check(T.state.theme.fonts.family==='Test Family'&&T.state.theme.fonts.faces[lastFace].src==='/fonts/Test Font.woff2','font face entries and normalized source paths round-trip');

const panelShadow=doc.querySelector('[data-path="components.panel.shadow"]');panelShadow.value='';fire(panelShadow,'input');
const radialRadius=doc.querySelector('[data-path="components.actionMenu.centerRadiusPx"]');radialRadius.value='132';fire(radialRadius,'input');
check(!('shadow' in T.state.theme.components.panel)&&T.state.theme.components.actionMenu.centerRadiusPx===132,'gallery edits stay sparse and radial metrics round-trip');

const shellBackground=doc.querySelector('[data-path="components.phoneShell.background"]');shellBackground.value='#334455';fire(shellBackground,'input');
const shellRadius=doc.querySelector('[data-path="components.phoneShell.radiusPx"]');shellRadius.value='41';fire(shellRadius,'input');
check(T.state.theme.components.phoneShell.background==='#334455'&&T.state.theme.components.phoneShell.radiusPx===41,'component color and shape fields update the draft');
check(doc.documentElement.style.getPropertyValue('--theme-phone-shell-bg')==='#334455'&&doc.documentElement.style.getPropertyValue('--theme-phone-shell-radius')==='41px','real applyTheme restyles the component specimen variables');
const cardBackground=doc.querySelector('[data-path="components.card.background"]');cardBackground.value='#445566';fire(cardBackground,'input');cardBackground.value='';fire(cardBackground,'input');
check(!('background' in T.state.theme.components.card)&&doc.documentElement.style.getPropertyValue('--theme-card-bg')==='','clearing a sparse override removes its stale preview variable');

const legacyWarn=doc.querySelector('[data-path="colors.warn"] input[type="text"]')||doc.querySelector('[data-path="colors.warn"]');
legacyWarn.value='#aabbcc';fire(legacyWarn,'input');
const legacyPanel=doc.querySelector('[data-path="colors.panelBg"]');legacyPanel.value='#223344';fire(legacyPanel,'input');
const legacyRadius=doc.querySelector('[data-path="shapes.radiusPx"]');legacyRadius.value='15';fire(legacyRadius,'input');
check(T.state.theme.colors.warn==='#aabbcc'&&T.state.theme.colors.panelBg==='#223344'&&T.state.theme.shapes.radiusPx===15,'legacy Colors and Shapes cards still update the draft');
check(doc.documentElement.style.getPropertyValue('--theme-warn')==='#aabbcc'&&doc.documentElement.style.getPropertyValue('--theme-radius')==='15px','legacy color and shape edits re-apply to the preview');

const dragged=T.dragLayout({anchor:'tl',offsetX:8,offsetY:8},{x:500,y:260},{width:120,height:50},{width:640,height:360});
check(JSON.stringify(dragged)==='{"anchor":"br","offsetX":12,"offsetY":42}','drag math converts pointer delta to nearest anchor and offsets');
const centered=T.layoutFromTopLeft(270,20,{width:100,height:40},{width:640,height:360});
check(centered.anchor==='tc'&&centered.offsetX===0&&centered.offsetY===20,'drag helper resolves centered top anchors');

const layoutSelect=doc.getElementById('layoutElement');layoutSelect.value='funds-chip';fire(layoutSelect,'change');
doc.querySelector('#anchorPicker [data-anchor="bl"]').click();const offsetX=doc.getElementById('offsetX');offsetX.value='23';fire(offsetX,'input');
check(T.state.theme.layout['funds-chip'].anchor==='bl'&&T.state.theme.layout['funds-chip'].offsetX===23,'layout card still round-trips beside drag editing');

const needsIcon=doc.querySelector('[data-path="accordions.0.icon"]');needsIcon.value='D:\\repo\\public\\icons\\custom.png';fire(needsIcon,'blur');
const showText=doc.querySelector('[data-path="accordions.0.showText"]');showText.checked=true;fire(showText,'change');
check(T.state.theme.accordions[0].icon==='/icons/custom.png'&&T.state.theme.accordions[0].showText===true&&T.state.theme.accordions[0].collapsedByDefault===true,'accordion icon, text toggle, and collapsed default round-trip');

doc.getElementById('save').click();await new Promise((resolve)=>setTimeout(resolve,20));
const saved=JSON.parse(rawPut);
check(saved.fonts.faces[lastFace].src==='/fonts/Test Font.woff2'&&saved.components.actionMenu.centerRadiusPx===132,'PUT payload contains font and radial edits');
check(saved.components.phoneShell.background==='#334455'&&saved.components.phoneShell.radiusPx===41&&saved.colors.warn==='#aabbcc'&&saved.colors.panelBg==='#223344'&&saved.shapes.radiusPx===15,'PUT payload carries component and legacy card edits');
check(saved.layout['funds-chip'].anchor==='bl'&&saved.accordions[0].icon==='/icons/custom.png','PUT payload contains layout and accordion edits');
check(rawPut===JSON.stringify(T.state.theme,null,2),'save uses exact pretty whole-file JSON payload');
check(previewCalls>4&&doc.documentElement.dataset.previewFamily==='Test Family','edits live-apply through the engine bridge');

async function bootWith(themeData,{brokenListings=false}={}){
  const messages=[];
  const virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',(error)=>messages.push(String(error)));
  virtualConsole.on('error',(...parts)=>messages.push(parts.map(String).join(' ')));
  virtualConsole.on('warn',(...parts)=>messages.push(parts.map(String).join(' ')));
  const localFetch=async(url)=>{
    if(String(url).endsWith('/theme.json'))return{ok:true,status:200,json:async()=>structuredClone(themeData)};
    if(brokenListings)return{ok:true,status:200,json:async()=>{throw new SyntaxError('Unexpected token < in JSON');}};
    return{ok:true,status:200,json:async()=>[]};
  };
  const isolated=new JSDOM(html,{url:'http://localhost:5173/tools/theme.html',runScripts:'dangerously',virtualConsole,beforeParse(win){win.fetch=localFetch;}});
  await new Promise((resolve)=>setTimeout(resolve,50));
  return{doc:isolated.window.document,editor:isolated.window.ThemeEditor,messages};
}

const fallbackBoot=await bootWith(theme,{brokenListings:true});
check(fallbackBoot.doc.querySelectorAll('#fontFields [data-path]').length>0&&fallbackBoot.doc.querySelectorAll('#colorFields [data-path]').length>0&&fallbackBoot.doc.querySelectorAll('#shapeFields [data-path]').length>0&&fallbackBoot.doc.querySelectorAll('#componentFields .component').length>0,'HTTP-200 HTML/non-JSON font and icon listings cannot blank editor cards');
check(fallbackBoot.doc.getElementById('status').textContent==='Loaded'&&fallbackBoot.editor.state.fonts.length===0&&fallbackBoot.editor.state.icons.length===0,'malformed optional listings degrade to empty asset choices without failing theme load');
check(fallbackBoot.messages.some((message)=>message.includes('listing unavailable'))&&!fallbackBoot.messages.some((message)=>message.includes('Uncaught')),'optional listing parse failures are warned without an uncaught render exception');

const malformedTheme=structuredClone(theme);
malformedTheme.components.brokenComponent='designer typo';
malformedTheme.extraDesignerSection={kept:true};
const isolatedBoot=await bootWith(malformedTheme);
const validComponentCount=Object.keys(theme.components).length;
check(isolatedBoot.doc.querySelectorAll('#componentFields .component').length===validComponentCount+1&&isolatedBoot.doc.querySelectorAll('#componentFields .component [data-path]').length>0,'an extended theme and valid component cards still render beside a malformed component key');
check(isolatedBoot.doc.querySelector('[data-component="brokenComponent"] .render-error')?.textContent.includes('must be an object'),'a malformed component reports its error inside its own card');
check(isolatedBoot.doc.querySelectorAll('#colorFields [data-path]').length>0&&isolatedBoot.doc.querySelectorAll('#shapeFields [data-path]').length>0,'a malformed component cannot blank Colors or Shapes');

const sparseBoot=await bootWith({components:{panel:{}},layout:{}});
check(sparseBoot.doc.querySelectorAll('#colorFields [data-path]').length===Object.keys({panelBg:1,panelFg:1,accent:1,warn:1,error:1,buttonBg:1,buttonFg:1,outline:1}).length&&sparseBoot.doc.querySelectorAll('#shapeFields [data-path]').length===3&&sparseBoot.doc.querySelector('[data-component="panel"] [data-path]'),'missing optional theme sections are created sparsely and every core card renders');

if(failures){console.error(`\n${failures} failure(s)`);process.exit(1);}console.log('\nall theme editor tests passed');
