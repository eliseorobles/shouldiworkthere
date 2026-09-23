import {test,expect,type Page,type APIRequestContext,type Route} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {RATE_LIMITED_CALM,REAL_EXAMPLES,publicationRules,accountsRule,aggregatesRule,type CanvasResponse,type Interpretation,type DirectoryCompany} from '../web/api.ts';
import {checkPow,powSubject,searchPow,solvePow} from '../shared/pow.ts';
import {ADD_ERRORS,DOMAIN_MESSAGES,DOMAIN_ABUSIVE_MESSAGE,addErrorMessage} from '../web/listing.ts';
import {unlistedName,unlistedNotice} from '../worker/src/interpretation.ts';
import {policy} from '../shared/policy.ts';
import {CRISIS_COPY} from '../shared/safety.ts';

// Deterministic against the seeded local stack (node tools/dev.mjs) or PREVIEW_URL. Anything that would need hosted Jev
// is answered by a route stub built from a real controls-mode response, so no test depends on a model.
type Body={q:string;slug?:string|null;overrides:Record<string,unknown>;mode:string;consent?:boolean;countInterest?:boolean;[key:string]:unknown};
const SAMPLES=['northwind-labs','helios-semiconductor','meridian-retail'];
const composer=(page:Page)=>page.getByLabel('Ask about working somewhere');
const canvasView=(page:Page)=>page.locator('.canvas-view');
function canvasBodies(page:Page) {const bodies:Body[]=[];page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/canvas')bodies.push(r.postDataJSON() as Body);});return bodies;}
/*
 * The local stack allows each client 40 posts a minute, which one run of this file exceeds. Controls-mode canvas requests
 * (no question text) are deterministic, so each distinct request is answered by the real server once and its real reply
 * is replayed afterwards. A 429 waits out the limiter window and asks again. Nothing is invented: every replay is a
 * response the running server gave to that exact request.
 */
const replies=new Map<string,{status:number;headers:Record<string,string>;body:string}>();
const RATE_WINDOW=61000;
async function fromServer(key:string,ask:()=>Promise<{status:number;headers:Record<string,string>;body:string}>) {
 const hit=replies.get(key);if(hit)return hit;
 for(let attempt=0;;attempt++) {
  const reply=await ask();
  if(reply.status!==429||attempt>=2){if(reply.status<500&&reply.status!==429)replies.set(key,reply);return reply;}
  test.info().setTimeout(test.info().timeout+RATE_WINDOW);
  await new Promise(r=>setTimeout(r,RATE_WINDOW));
 }
}
async function replay(route:Route) {
 const request=route.request(),body=request.postDataJSON() as Body;
 if(request.method()!=='POST'||body.q||body.mode!=='controls'){await route.fallback();return;}
 try {
  const reply=await fromServer(`page:${request.postData()}`,async()=>{const r=await route.fetch();return {status:r.status(),headers:{'content-type':r.headers()['content-type']??'application/json','cache-control':'no-store'},body:await r.text()};});
  await route.fulfill({status:reply.status,headers:reply.headers,body:reply.body});
 } catch(error) {
  // A request the page abandoned (or a page that closed) while its reply was in flight has nobody to answer.
  if(!/closed|aborted|already handled/i.test(String(error)))throw error;
 }
}
// Live understanding is on by default (owner decision). Each test starts from an explicit off choice so it controls when
// Live begins; the default itself is covered by its own test below.
test.beforeEach(async({context})=>{await context.addInitScript(()=>{try{if(!sessionStorage.getItem('siwt-test-live-set')){localStorage.setItem('siwt-live','off');sessionStorage.setItem('siwt-test-live-set','1');}}catch{}});await context.route('**/api/canvas',replay);});
test('Live understanding is on by default, starts off under Global Privacy Control, and the visitor\'s choice is remembered',async({browser})=>{
 const fresh=await browser.newContext();const page=await fresh.newPage();
 await page.goto('/');const live=page.getByRole('switch',{name:'Live understanding'});
 await expect(live).toHaveAttribute('aria-checked','true');
 await expect(page.getByText(/Live understanding is on: when you pause/)).toBeVisible();
 // The default is not written anywhere; only the visitor's own switch is stored, as on or off.
 const stored=()=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])));
 expect(await stored()).toEqual({});
 await live.click();await expect(live).toHaveAttribute('aria-checked','false');
 expect(await stored()).toEqual({'siwt-live':'off'});
 await page.reload();await expect(page.getByRole('switch',{name:'Live understanding'})).toHaveAttribute('aria-checked','false');
 await fresh.close();
 const gpc=await browser.newContext();await gpc.addInitScript(()=>{Object.defineProperty(Navigator.prototype,'globalPrivacyControl',{get:()=>true});});
 const quiet=await gpc.newPage();await quiet.goto('/');
 await expect(quiet.getByRole('switch',{name:'Live understanding'})).toHaveAttribute('aria-checked','false');
 await gpc.close();
});
test.afterEach(async({context})=>{await context.unrouteAll({behavior:'ignoreErrors'});});
async function controls(request:APIRequestContext,slug='northwind-labs',overrides:Record<string,unknown>={}) {
 const data={q:'',slug,overrides:{company:slug,...overrides},mode:'controls'};
 const reply=await fromServer(`api:${JSON.stringify(data)}`,async()=>{const r=await request.post('/api/canvas',{data});return {status:r.status(),headers:r.headers(),body:await r.text()};});
 expect(reply.status).toBe(200);return JSON.parse(reply.body) as CanvasResponse;
}
/** A real discovery reply (no employer), the view a home-page question without an employer holds. */
async function discovery(request:APIRequestContext,overrides:Record<string,unknown>={}) {
 const data={q:'',slug:null,overrides:{view:'discovery',...overrides},mode:'controls'};
 const reply=await fromServer(`api:${JSON.stringify(data)}`,async()=>{const r=await request.post('/api/canvas',{data});return {status:r.status(),headers:r.headers(),body:await r.text()};});
 expect(reply.status).toBe(200);return JSON.parse(reply.body) as CanvasResponse;
}
const jev=(r:CanvasResponse,fields:Partial<Interpretation>={},extra:Partial<CanvasResponse>={}):CanvasResponse=>({...r,keepCanvas:false,...extra,interpretation:{...r.interpretation,source:'jev',provider:'workers-ai',model:'test-double',promptVersion:'intent-test',degraded:false,clarify:false,forks:[],suggestions:[],annotations:[],...fields}});
const dist=(value:string,confidence=.95)=>({value,confidence,probabilities:{[value]:confidence}});
async function ready(page:Page,path:string) {await page.goto(path);await expect(page.locator('#canvas-title')).toBeVisible();}

test.beforeAll(()=>mkdirSync('artifacts',{recursive:true}));

test('brand, self-hosted fonts and trust navigation load with no script or policy errors',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('/');await expect(page.getByRole('heading',{name:'Know the workplace. Keep your privacy.'})).toBeVisible();await expect(page).toHaveTitle(/Should I Work There/);
 await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.fonts.check('400 15px "Instrument Sans"'))).toBe(true);
 await page.screenshot({path:'artifacts/home-desktop.png',fullPage:true});
 await page.getByRole('link',{name:'The Covenant',exact:true}).click();await expect(page.getByRole('heading',{name:'Structure before promises.'})).toBeVisible();
 expect(errors).toEqual([]);expect(await page.locator('body').innerText()).not.toMatch(/kernel/i);
});

test('typing stays on this device until an explicit submit, and the semantic cursor recognises concepts locally',async({page})=>{
 const bodies=canvasBodies(page);await ready(page,'/c/northwind-labs');const before=bodies.length;
 await composer(page).fill('How have promotions changed at Northwind Labs since the 2025 restructuring?');
 await page.waitForTimeout(800);expect(bodies.length).toBe(before);
 await expect(page.locator('.recognised')).toContainText('Recognized on this device');
 await expect(page.locator('.recognised')).toContainText('Northwind Labs');
 await expect(page.locator('.cursor-mark.from-device').first()).toBeAttached();
 await expect(page.getByText('Your typing stays on this device until you press Enter.')).toBeVisible();
});

test('view switches, chip edits and question clicks never send an unsubmitted draft',async({page})=>{
 const bodies=canvasBodies(page);await ready(page,'/c/northwind-labs');
 await composer(page).fill('private draft about my manager');
 await page.getByRole('button',{name:'Over time',exact:true}).click();await expect(canvasView(page)).toContainText('Through time');
 const faq=page.locator('.faq-question').first();
 if(await faq.count()){await faq.click();await expect.poll(()=>bodies.length).toBeGreaterThan(2);}
 for(const body of bodies){expect(JSON.stringify(body)).not.toContain('private draft');expect(body.mode).toBe('controls');expect(body.countInterest).toBeUndefined();}
 await expect(composer(page)).toHaveValue('private draft about my manager');
});

test('Live understanding reads only after opt-in, and a slow stale reading cannot replace a newer one',async({page,request})=>{
 const start=await controls(request);let reads=0;
 await page.route('**/api/canvas',async route=>{
  const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  reads++;expect(body.mode).toBe('live');expect(body.consent).toBe(true);
  if(body.q.includes('slow'))await new Promise(r=>setTimeout(r,1200));
  const view=body.q.includes('hours')?'distribution':'timeline';
  await route.fulfill({json:jev({...start,view},{view:dist(view) as Interpretation['view'],topic:dist(view==='distribution'?'workload':'promotion') as Interpretation['topic']})});
 });
 await ready(page,'/c/northwind-labs');
 await composer(page).fill('promotion changes');await page.waitForTimeout(700);expect(reads).toBe(0);
 await page.getByRole('switch',{name:'Live understanding'}).click();await expect(canvasView(page)).toContainText('Through time');
 await composer(page).fill('slow promotion question');await page.waitForTimeout(550);
 await composer(page).fill('show weekly hours');await expect(canvasView(page)).toContainText('The full distribution');
 await page.waitForTimeout(1400);await expect(canvasView(page)).toContainText('The full distribution');
});

test('typing never cancels an explicit request such as the first load of a record',async({page})=>{
 await page.route('**/api/canvas',async route=>{await new Promise(r=>setTimeout(r,900));await route.fallback();});
 await page.goto('/c/northwind-labs');await composer(page).fill('typing while the record loads');
 await expect(page.locator('#canvas-title')).toBeVisible({timeout:10000});
 await expect(composer(page)).toHaveValue('typing while the record loads');
});

test('an ask keeps the last view in place, a tentative reading replaces it, and chips describe the view on screen',async({page,request})=>{
 const start=await controls(request);
 await page.route('**/api/canvas',async route=>{
  const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  if(body.q.includes('political'))await route.fulfill({json:jev(start,{clarify:true,route:'clarify',cohorts:{fn:'Engineering',seniority:null},forks:[{field:'topic',question:'Which meaning did you intend?',tier:'ask',options:[{id:'promotion',label:'Promotion politics',share:.54},{id:'culture',label:'Team culture',share:.46}]}]},{keepCanvas:true})});
  else await route.fulfill({json:jev({...start,view:'timeline'},{view:dist('timeline',.6) as Interpretation['view'],forks:[{field:'view',question:'Which view best answers this?',tier:'fork',options:[{id:'timeline',label:'Through time',share:.6},{id:'reader',label:'Original accounts',share:.4}]}]})});
 });
 await ready(page,'/c/northwind-labs');const heading=page.locator('#canvas-title'),before=await heading.innerText();
 await composer(page).fill('how political is engineering?');await composer(page).press('Enter');
 await expect(page.getByRole('heading',{name:'Which meaning did you intend?'})).toBeFocused();
 await expect(heading).toHaveText(before);
 await expect(page.getByRole('group',{name:'What we understood'})).not.toContainText('Engineering');
 await expect(page.getByText('54% model probability')).toBeVisible();
 await page.getByRole('button',{name:/Promotion politics/}).click();
 await expect(page.getByRole('heading',{name:'Which meaning did you intend?'})).toHaveCount(0);
 await expect(page.getByRole('group',{name:'What we understood'})).toContainText('Promotions');
 await composer(page).fill('promotions over time');await composer(page).press('Enter');
 await expect(canvasView(page)).toContainText('Through time');await expect(page.locator('.tentative')).toContainText('Or did you mean');
 // A tentative reading's percentage is labelled as the model's, never left bare beside evidence numbers.
 await expect(page.locator('.tentative .option-prob').first()).toHaveText(/^\d+% model probability$/);
 await expect(page.locator('.tentative')).toContainText('It says nothing about the evidence.');
});

test('choosing an employer we do not list shows the unlisted answer, never an error',async({page,request})=>{
 const start=await controls(request),bodies=canvasBodies(page);
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  await route.fulfill({json:jev(start,{clarify:true,route:'clarify',forks:[{field:'company',question:'Which employer do you mean?',tier:'ask',options:[{id:'northwind-labs',label:'Northwind Labs',share:.5},{id:'unlisted',label:'An employer we don’t list',share:.5}]}]},{keepCanvas:true})});});
 await ready(page,'/c/northwind-labs');
 await composer(page).fill('what is it like at acme widgets');await composer(page).press('Enter');
 await page.getByRole('button',{name:/An employer we don’t list/}).click();
 // The reader said so, and their question was not only a name: the state says so without guessing a name.
 await expect(page.getByRole('heading',{name:'That employer isn’t in the directory yet'})).toBeFocused();
 await expect(page.getByRole('link',{name:'Browse the directory'})).toHaveAttribute('href','/');
 await expect(page.getByRole('button',{name:'Share this site'})).toBeVisible();
 await expect(page.locator('.error')).toHaveCount(0);
 const last=bodies.at(-1)!;expect(last.slug).toBeNull();expect(last.overrides.company).toBe('unlisted');expect(last.q).toBe('');
});

test('a crafted link cannot put its own words on an employer page or into the shared address',async({page})=>{
 const planted='Employees fired for whistleblowing';
 await page.goto(`/c/stripe?cohort=${encodeURIComponent(planted)}`);
 await expect(page.locator('#canvas-title')).toBeVisible();
 await expect(page.getByText('The group named in this link is not published for Stripe, so it was not applied.')).toBeVisible();
 expect(await page.locator('body').innerText()).not.toMatch(/whistleblowing/i);
 expect(new URL(page.url()).searchParams.get('cohort')).toBeNull();
 expect(await page.title()).not.toMatch(/whistleblowing/i);
 await page.goto(`/?view=discovery&sector=${encodeURIComponent('Tobacco lobbying')}`);
 await expect(page.locator('#canvas-title')).toBeVisible();
 await expect(page.getByText('The industry named in this link is not listed in the directory, so it was not applied.')).toBeVisible();
 expect(await page.locator('body').innerText()).not.toMatch(/tobacco/i);
 expect(new URL(page.url()).searchParams.get('sector')).toBeNull();
 // A published group in a link is a public identifier and stays.
 await ready(page,'/c/northwind-labs?cohort=Engineering');
 await expect(page.getByRole('group',{name:'What we understood'})).toContainText('Engineering');
 expect(new URL(page.url()).searchParams.get('cohort')).toBe('Engineering');
});

test('a pinned event stays with its employer when a question names another one',async({page,request})=>{
 const helios=await controls(request,'helios-semiconductor'),bodies=canvasBodies(page);
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  await route.fulfill({json:jev(helios,{company:dist('helios-semiconductor') as Interpretation['company'],topic:dist('promotion') as Interpretation['topic']})});});
 await ready(page,'/c/northwind-labs?view=timeline&event=ev-nw-restructure-2025');
 await page.locator('[data-chip="event"]').click();await page.locator('.chip-option').nth(1).click();
 await expect(page.getByRole('button',{name:/Reset my edits/})).toBeVisible();
 await composer(page).fill('promotion at Helios Semiconductor');await composer(page).press('Enter');
 await expect(page.getByRole('heading',{level:1,name:'Helios Semiconductor'})).toBeVisible();
 const asked=bodies.filter(b=>b.q);expect(asked).toHaveLength(1);
 expect(asked[0]!.overrides.event).toBeUndefined();expect(asked[0]!.overrides.cohort).toBeUndefined();
 await expect(page.getByRole('heading',{name:'Which documented event?'})).toHaveCount(0);
 await expect(page.locator('[data-chip="event"]')).toHaveCount(0);
});

test('a Live reading never discards an explicit question that is still loading',async({page,request})=>{
 const start=await controls(request),asked:string[]=[];
 await page.route('**/api/canvas',async route=>{
  const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  asked.push(`${body.mode}:${body.q}`);
  if(body.mode==='submit'){await new Promise(r=>setTimeout(r,1500));await route.fulfill({json:jev({...start,view:'timeline'},{view:dist('timeline') as Interpretation['view']})});return;}
  await route.fulfill({json:jev({...start,view:'distribution'},{view:dist('distribution') as Interpretation['view'],topic:dist('workload') as Interpretation['topic']})});
 });
 await ready(page,'/c/northwind-labs');
 await page.getByRole('switch',{name:'Live understanding'}).click();
 await composer(page).fill('promotions over time');await composer(page).press('Enter');
 await composer(page).pressSequentially(' and hours',{delay:20});
 await expect.poll(()=>asked.some(a=>a.startsWith('live:')),{timeout:4000}).toBe(true);
 await expect(canvasView(page)).toContainText('Through time',{timeout:6000});
 await page.waitForTimeout(400);await expect(canvasView(page)).toContainText('Through time');
 expect(new URL(page.url()).searchParams.get('view')).toBe('timeline');
 await expect(page.getByText(/model provider may keep what it receives/)).toBeVisible();
});

test('interest is counted only for a fresh, explicitly submitted, opted-in question',async({page,request})=>{
 const start=await controls(request),sent:Body[]=[];
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;sent.push(body);if(!body.q){await route.fallback();return;}await route.fulfill({json:jev(start,{topic:dist('promotion') as Interpretation['topic']},{interestCounted:!!body.countInterest})});});
 await ready(page,'/c/northwind-labs');
 await composer(page).fill('are promotions fair?');await composer(page).press('Enter');await expect.poll(()=>sent.filter(b=>b.q).length).toBe(1);
 await page.getByLabel(/Count questions I type/).check();
 await composer(page).fill('are promotions fair here?');await composer(page).press('Enter');
 await expect(page.getByText(/^Counted once/)).toBeVisible();
 await composer(page).press('Enter');await expect.poll(()=>sent.filter(b=>b.q).length).toBe(3);
 await page.getByRole('button',{name:'Over time',exact:true}).click();await expect(canvasView(page)).toContainText('Through time');
 const counted=sent.filter(b=>b.countInterest);
 expect(counted).toHaveLength(1);expect(counted[0]!.q).toBe('are promotions fair here?');expect(counted[0]!.mode).toBe('submit');
 expect(sent.some(b=>'shareTopic' in b)).toBe(false);
});

test('back and forward restore each view without asking Jev again, and the URL never holds the question',async({page,request})=>{
 const start=await controls(request),asked:string[]=[];
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}asked.push(body.q);await route.fulfill({json:jev({...start,view:'timeline'},{view:dist('timeline') as Interpretation['view'],topic:dist('management') as Interpretation['topic']})});});
 await ready(page,'/c/northwind-labs');
 await composer(page).fill('how has trust in managers changed');await composer(page).press('Enter');
 await expect(canvasView(page)).toContainText('Through time');
 expect(page.url()).toContain('view=timeline');expect(page.url()).not.toMatch(/trust|managers|[?&]q=/);
 await page.getByRole('button',{name:'Accounts',exact:true}).click();await expect(canvasView(page)).toContainText('Original accounts');
 await page.goBack();await expect(canvasView(page)).toContainText('Through time');
 await expect(composer(page)).toHaveValue('how has trust in managers changed');
 await page.goBack();await expect(canvasView(page)).toContainText('Workplace record');
 await page.goForward();await expect(canvasView(page)).toContainText('Through time');
 expect(asked).toEqual(['how has trust in managers changed']);
 await expect(page.getByRole('navigation',{name:'Your path in this tab'})).toBeVisible();
});

test('session history keeps only the last question, on its own entry; the path names views and the reader’s words stay in memory',async({page,request})=>{
 const start=await controls(request);
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}await route.fulfill({json:jev(start)});});
 await ready(page,'/c/northwind-labs');
 const questions=['is there retaliation after reporting harassment here','how were layoffs handled here','what is on-call like here'];
 const saved=()=>page.evaluate(()=>JSON.stringify(history.state));
 for(const q of questions){await composer(page).fill(q);await composer(page).press('Enter');await expect.poll(saved).toContain(q);}
 let state=await saved();
 for(const q of questions.slice(0,2))expect(state,'an earlier question is not in the current entry').not.toContain(q);
 expect(JSON.parse(state).trail.map((s:{label:string})=>s.label).every((l:string)=>l==='Northwind Labs'),'the saved path names views only').toBe(true);
 // The visible path still shows the reader's words, from this page's memory.
 const path=page.getByRole('navigation',{name:'Your path in this tab'});
 for(const q of questions)await expect(path).toContainText(q);
 // An entry that was left holds no question; Back still shows it in the composer, from memory.
 await page.goBack();await expect(composer(page)).toHaveValue(questions[1]!);
 state=await saved();for(const q of questions)expect(state).not.toContain(q);
 await page.goBack();await expect(composer(page)).toHaveValue(questions[0]!);
 state=await saved();for(const q of questions)expect(state).not.toContain(q);
 await page.goForward();await page.goForward();await expect(composer(page)).toHaveValue(questions[2]!);
 // A restored tab (a reload) has only the last question and view labels.
 await page.reload();await expect(composer(page)).toHaveValue(questions[2]!);
 await expect(path).toBeVisible();for(const q of questions.slice(0,2))await expect(path).not.toContainText(q);
 // Following a link leaves the entry: it drops its question too.
 await page.getByRole('link',{name:'All employers'}).click();await expect(page).toHaveURL(/\/$/);
 await page.goBack();await expect(canvasView(page)).toBeVisible();
 expect(JSON.parse(await saved()).q).toBe('');
});

test('a crafted link cannot put its own words on a page as a criterion; a published criterion still applies and is shared',async({page})=>{
 const words=/zebra|quill/i;
 for(const path of ['/c/google?pref=zebra_quill:high','/c/northwind-labs?pref=zebra_quill:high','/c/google?view=discovery&pref=zebra_quill:high','/?view=discovery&pref=zebra_quill:high,promotions_clarity:high']) {
  await page.goto(path);await expect(page.locator('section.canvas')).toBeVisible();await page.waitForLoadState('networkidle');
  expect(await page.locator('main').innerText(),path).not.toMatch(words);
  expect(page.url(),path).not.toMatch(words);
 }
 await expect(page.locator('[data-chip="pref-promotions_clarity"]')).toContainText(/^Higher /);
 expect(new URL(page.url()).searchParams.get('pref')).toBe('promotions_clarity:high');
 await expect(page.locator('[data-chip^="pref-"]')).toHaveCount(1);
});

test('a question that is only a listed employer name navigates on the device, without hosted inference',async({page})=>{
 const bodies=canvasBodies(page);await page.goto('/');
 await composer(page).fill('Helios Semiconductor');await composer(page).press('Enter');
 await expect(page).toHaveURL(/\/c\/helios-semiconductor$/);
 await expect(page.getByRole('heading',{level:1,name:'Helios Semiconductor'})).toBeVisible();
 expect(bodies.length).toBeGreaterThan(0);expect(bodies.every(b=>b.q===''&&b.mode==='controls')).toBe(true);
});

test('sharing copies a typed-state link and never the question',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as unknown as {__copied:string[]};w.__copied=[];
  Object.defineProperty(navigator,'share',{value:undefined,configurable:true});
  Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{w.__copied.push(text);}},configurable:true});
 });
 await page.goto('/c/northwind-labs?view=compare&vs=helios-semiconductor');await expect(page.locator('.split')).toBeVisible();
 await composer(page).fill('my secret draft');
 await page.getByRole('button',{name:'Share this view'}).click();await expect(page.getByText('Link copied')).toBeVisible();
 const copied=await page.evaluate(()=>(window as unknown as {__copied:string[]}).__copied);
 expect(copied).toHaveLength(1);
 const url=new URL(copied[0]!);expect(url.pathname).toBe('/c/northwind-labs');expect(url.searchParams.get('view')).toBe('compare');expect(url.searchParams.get('vs')).toBe('helios-semiconductor');
 expect(copied[0]).not.toContain('secret');
});

test('fictional employers are labeled on every surface they appear',async({page})=>{
 for(const slug of SAMPLES) {
  await ready(page,`/c/${slug}`);
  await expect(page.locator('.record-tags')).toContainText('Fictional company');
  await expect(page.locator('.fiction-banner')).toContainText('fictional employer');
  await expect(canvasView(page).locator('.tag-fiction')).toBeVisible();
  const cards=page.locator('.metric-card');for(let i=0;i<await cards.count();i++)await expect(cards.nth(i).locator('.tag-fiction')).toBeVisible();
  const accounts=page.locator('.account');for(let i=0;i<await accounts.count();i++)await expect(accounts.nth(i).locator('.tag-fixture,.tag-fiction').first()).toBeVisible();
  expect(await page.title()).toContain('(fictional)');
  expect(await (await page.request.get(`/c/${slug}`)).text()).toMatch(/property="og:title" content="[^"]*\(fictional demonstration\)/);
 }
 await ready(page,'/c/northwind-labs');await page.locator('.metric-card').first().click();
 await expect(page.getByRole('dialog').locator('.tag-fiction')).toBeVisible();await page.keyboard.press('Escape');
 await ready(page,'/c/northwind-labs?view=compare&vs=helios-semiconductor');
 await expect(page.locator('.split-side .tag-fiction')).toHaveCount(2);
 await page.goto('/?view=discovery');
 const fictional=page.getByRole('region',{name:'Fictional demonstrations'});await expect(fictional).toBeVisible();
 const rows=fictional.locator('.discovery-card');for(let i=0;i<await rows.count();i++)await expect(rows.nth(i).locator('.tag-fiction')).toBeVisible();
 await expect(page.getByRole('region',{name:'Real employers'}).locator('.tag-fiction')).toHaveCount(0);
 await page.goto('/');
 const demos=page.locator('.employer.fictional');await expect(demos).toHaveCount(3);
 for(let i=0;i<3;i++)await expect(demos.nth(i).locator('.tag-fiction')).toBeVisible();
 await expect(page.locator('.employer:not(.fictional) .tag-fiction')).toHaveCount(0);
});

test('a real employer with nothing published states the publication rules from the config, an invite action and no counts',async({page})=>{
 const rules=publicationRules(await (await page.request.get('/api/config')).json());
 await page.goto('/c/stripe');
 const card=page.getByRole('region',{name:'Nothing about Stripe is published yet.'});
 await expect(card).toBeVisible();
 // The rule is the only heading: no competing answer headline above it.
 await expect(page.locator('main h2')).toHaveCount(1);
 await expect(page.locator('#canvas-title')).toHaveText('Nothing about Stripe is published yet.');
 // Written accounts in batches (TESTIMONY_BATCH_MIN) after screening and a random delay; aggregates need MIN_COHORT_N.
 await expect(card.getByText(accountsRule(rules),{exact:false})).toBeVisible();await expect(card.getByText(aggregatesRule(rules),{exact:false})).toBeVisible();
 await expect(card.getByRole('button',{name:'Invite coworkers'})).toBeVisible();
 await expect(card.getByRole('link',{name:'Contribute privately'})).toHaveAttribute('href','/submit?employer=stripe');
 const numbers=(await card.innerText()).match(/\d+/g)??[];
 expect(numbers.every(n=>[String(rules.batch),String(rules.cohort),String(policy.retention.approvedUnbatchedDays)].includes(n))).toBe(true);
 await expect(page.locator('.metric-card')).toHaveCount(0);await expect(page.locator('.record-tags')).toContainText('Real employer');
 await page.screenshot({path:'artifacts/real-empty.png',fullPage:true});
 // A filter that empties the view is not the same as nothing published: it offers to clear the filter instead.
 await ready(page,'/c/stripe?topic=promotion');
 await expect(page.getByRole('heading',{name:/is published yet/})).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Not enough evidence for this combination'})).toBeVisible();
 await page.getByRole('button',{name:'Show every topic'}).click();
 await expect(page.locator('#canvas-title')).toHaveText(/is published yet/);
});

test('every page carries the privacy, terms, accessibility and legal-requests links',async({page})=>{
 for(const path of ['/','/c/northwind-labs','/submit','/jury','/status','/privacy','/terms','/accessibility','/constitution','/moderation','/transparency','/legal-requests','/source','/finances']) {
  await page.goto(path);const legal=page.getByRole('navigation',{name:'Legal'});
  for(const label of ['Privacy','Terms','Accessibility','Legal requests'])await expect(legal.getByRole('link',{name:label,exact:true}),`${path} ${label}`).toBeVisible();
 }
});

test('at 390px wide nothing overflows horizontally, including an open question',async({page,request})=>{
 const start=await controls(request);
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}await route.fulfill({json:jev(start,{clarify:true,route:'clarify',forks:[{field:'company',question:'Which employer do you mean?',tier:'ask',options:[{id:'northwind-labs',label:'Northwind Labs',share:.5},{id:'helios-semiconductor',label:'Helios Semiconductor',share:.3},{id:'unlisted',label:'An employer we don’t list',share:.2}]}]},{keepCanvas:true})});});
 await page.setViewportSize({width:390,height:844});
 const overflow=()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
 for(const path of ['/','/c/northwind-labs','/c/northwind-labs?view=compare&vs=helios-semiconductor','/c/northwind-labs?view=timeline','/c/northwind-labs?view=reader','/c/northwind-labs?view=distribution&topic=workload','/c/stripe','/privacy','/constitution','/transparency']) {
  await page.goto(path);await page.waitForLoadState('networkidle');expect(await overflow(),path).toBeLessThanOrEqual(0);
 }
 await ready(page,'/c/northwind-labs');await composer(page).fill('what about the other one');await composer(page).press('Enter');
 await expect(page.getByRole('heading',{name:'Which employer do you mean?'})).toBeVisible();
 expect(await overflow()).toBeLessThanOrEqual(0);
 await page.screenshot({path:'artifacts/mobile-fork.png',fullPage:true});
});

test('dark mode follows the system, and the theme switch stores only an explicit choice',async({page})=>{
 await page.emulateMedia({colorScheme:'dark'});await page.goto('/');
 const background=()=>page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
 const stored=()=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])));
 // The only key before any theme choice is the disclosed Live understanding switch, which this suite's beforeEach sets
 // to 'off'. The theme switch must add nothing but its own explicit choice, and leave that key as it found it.
 const before=await stored();expect(before).toEqual({'siwt-live':'off'});
 expect(await background()).toBe('rgb(13, 18, 34)');
 await page.getByRole('button',{name:'Switch to light theme'}).click();
 expect(await background()).toBe('rgb(246, 248, 253)');expect(await stored()).toEqual({...before,'siwt-theme':'light'});
 await page.goto('/privacy');await page.getByRole('button',{name:'Switch to dark theme'}).waitFor();
 expect(await background()).toBe('rgb(246, 248, 253)');
 // Returning to the system's theme forgets the choice: storage is exactly what it was before the first click.
 await page.getByRole('button',{name:'Switch to dark theme'}).click();
 expect(await background()).toBe('rgb(13, 18, 34)');expect(await stored()).toEqual(before);
 expect(await page.evaluate(()=>localStorage.getItem('siwt-theme'))).toBeNull();
});

test('the evidence lens shows wording, sample size, period and release ids, and Escape returns focus to the number',async({page})=>{
 await ready(page,'/c/northwind-labs');const card=page.locator('.metric-card').first();
 await card.focus();await page.keyboard.press('Enter');
 const lens=page.getByRole('dialog');await expect(lens).toBeVisible();
 await expect(lens.getByText('Question asked')).toBeVisible();await expect(lens.getByRole('columnheader',{name:'Release'})).toBeVisible();
 await expect(lens.locator('tbody code').first()).toHaveText(/\S+/);
 // Fictional fixture numbers were written, not collected: the lens never says they came from questionnaire answers.
 await expect(lens.locator('.lens-facts')).toContainText('Illustrative');
 await expect(lens.getByText('These illustrative numbers were written as demonstration data, not collected from anyone.',{exact:false})).toBeVisible();
 await expect(lens.getByText('Numbers come from explicit questionnaire answers.',{exact:false})).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(lens).toBeHidden();await expect(card).toBeFocused();
});

test('the answer is assembled from published numbers, and each fact opens its evidence',async({page})=>{
 await ready(page,'/c/northwind-labs?view=compare&vs=helios-semiconductor');
 const facts=page.getByRole('list',{name:'Facts behind this answer'});
 test.skip(!(await facts.count()),'this server sends no answer yet');
 await facts.getByRole('button').first().click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
 await expect(page.locator('.canvas-foot')).toHaveText(/^No generated answers\./);
 // In the record view the metric cards are the facts, so the answer offers one way into the evidence instead of repeating them.
 await ready(page,'/c/northwind-labs');
 await expect(page.getByRole('list',{name:'Facts behind this answer'})).toHaveCount(0);
 await page.getByRole('button',{name:'Open the evidence behind this answer'}).click();await expect(page.getByRole('dialog')).toBeVisible();
});

test('crisis resources come from an on-device check and send nothing',async({page})=>{
 const bodies=canvasBodies(page);await page.goto('/');await page.waitForLoadState('networkidle');const before=bodies.length;
 await composer(page).fill('honestly I want to die after this reorg');
 const card=page.getByRole('region',{name:CRISIS_COPY.self_harm.heading});await expect(card).toBeVisible();
 await expect(card.getByRole('link',{name:'Call 988'})).toHaveAttribute('href','tel:988');
 await page.waitForTimeout(600);expect(bodies.length).toBe(before);
 await composer(page).fill('the deadline is killing me');await expect(card).toHaveCount(0);
});

test('one orchestrated morph between views, and none when reduced motion is requested',async({page})=>{
 await page.addInitScript(()=>{
  const w=window as unknown as {__morphs:number};w.__morphs=0;
  const d=document as Document&{startViewTransition?:(cb:()=>void)=>unknown};
  if(d.startViewTransition){const real=d.startViewTransition.bind(d);d.startViewTransition=(cb:()=>void)=>{w.__morphs++;return real(cb);};}
 });
 await ready(page,'/c/northwind-labs');
 const morphs=()=>page.evaluate(()=>(window as unknown as {__morphs:number}).__morphs),supported=await page.evaluate(()=>'startViewTransition'in document);
 const first=await morphs();
 await page.getByRole('button',{name:'Over time',exact:true}).click();await expect(canvasView(page)).toContainText('Through time');
 if(supported)expect(await morphs()).toBeGreaterThan(first);
 await page.emulateMedia({reducedMotion:'reduce'});const before=await morphs();
 await page.getByRole('button',{name:'Accounts',exact:true}).click();await expect(canvasView(page)).toContainText('Original accounts');
 expect(await morphs()).toBe(before);
});

test('canvas requests carry only the question, typed controls and mode, and the site sets no cookies',async({page})=>{
 const bodies=canvasBodies(page);
 await page.goto('/');await composer(page).fill('Northwind Labs');await composer(page).press('Enter');await expect(page).toHaveURL(/northwind-labs/);
 await page.getByRole('button',{name:'Distribution',exact:true}).click();await expect(canvasView(page)).toContainText('The full distribution');
 const keys=new Set(['q','slug','overrides','mode','consent','countInterest']),controlKeys=new Set(['company','compareTo','cohort','cohortFunction','cohortSeniority','scope','topic','view','layer','event','timeframe','industry','preferences','salaryDataRequired','page']);
 expect(bodies.length).toBeGreaterThan(1);
 for(const body of bodies) {
  for(const key of Object.keys(body))expect(keys.has(key),key).toBe(true);
  for(const key of Object.keys(body.overrides))expect(controlKeys.has(key),key).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/@|siwt-|capability|localStorage/);
 }
 expect(await page.context().cookies()).toEqual([]);
});

test('every published account offers a challenge under a published rule, with no special employer button',async({page})=>{
 await ready(page,'/c/northwind-labs?view=reader');
 const accounts=page.locator('.account'),count=await accounts.count();expect(count).toBeGreaterThan(0);
 for(let i=0;i<count;i++) {
  const account=accounts.nth(i);
  if(await account.locator('.account-withheld').count())continue;
  await expect(account.getByRole('button',{name:'Challenge under a published rule'})).toBeVisible();
 }
 await accounts.first().getByRole('button',{name:'Challenge under a published rule'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.getByRole('button',{name:/employer response|verified employer|claim this page/i})).toHaveCount(0);
});

test('the jury and status routes render inside the site frame',async({page})=>{
 for(const path of ['/jury','/status']) {
  await page.goto(path);await expect(page.locator('main#main, main').first()).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Main'})).toBeVisible();
 }
});

test('a needs-generation answer shows the evidence with the server’s notice once, and never a written answer',async({page,request})=>{
 const start=await controls(request),note='This product does not generate answers; here is the evidence we have.';
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  await route.fulfill({json:jev(start,{route:'needs_generation',notes:[note]},{notices:[note,...start.notices],answer:start.answer?{...start.answer,route:'needs_generation'}:null})});});
 await ready(page,'/c/northwind-labs');
 await composer(page).fill('should I take the offer from Northwind Labs?');await composer(page).press('Enter');
 await expect(page.getByText(note,{exact:true})).toHaveCount(1);
 await expect(page.getByText('This product does not generate answers. Here is the evidence it has.')).toHaveCount(0);
 await expect(page.locator('.metric-card').first()).toBeVisible();
});

test('support resources the server adds are shown with their own privacy line, also on a refusal, and never twice',async({page,request})=>{
 const start=await controls(request);let refuse=false;
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  if(refuse)await route.fulfill({status:422,json:{error:'Remove names or identifying details from the search before remote interpretation.',resources:{ignored:true}}});
  else await route.fulfill({json:jev(start,{},{resources:{'988':{links:[{label:'Call 988',href:'https://example.test/not-a-helpline'}]}}})});});
 await ready(page,'/c/northwind-labs');
 await composer(page).fill('what is the culture like on weekends');await composer(page).press('Enter');
 const card=page.getByRole('region',{name:CRISIS_COPY.self_harm.heading});
 await expect(card).toBeVisible();await expect(card).toContainText('added to the site’s answer to what you sent');
 await expect(card).not.toContainText(CRISIS_COPY.privacy);
 await expect(card.getByRole('link',{name:'Call 988'}),'links come from shared/safety.ts, never from the reply').toHaveAttribute('href','tel:988');
 await composer(page).fill('something else entirely');await expect(card).toHaveCount(0);
 refuse=true;await composer(page).fill('what about the weekend culture');await composer(page).press('Enter');
 await expect(page.locator('.error')).toBeVisible();await expect(card).toBeVisible();
 // Words the on-device check matches show only the on-device card, with its own privacy line.
 refuse=false;await composer(page).fill('honestly I want to die after this reorg');await composer(page).press('Enter');
 await expect(page.getByRole('region',{name:CRISIS_COPY.self_harm.heading})).toHaveCount(1);
 await expect(page.getByRole('region',{name:CRISIS_COPY.self_harm.heading})).toContainText(CRISIS_COPY.privacy);
});

test('an ambiguous word asks which meaning was intended, with model probabilities, on the home page and on a record',async({page,request})=>{
 const start=await controls(request);
 const meaning={field:'topic',question:'Which meaning did you intend?',tier:'ask' as const,kind:'meaning' as const,options:[{id:'promotion',label:'Promotion politics: who gets promoted and why',share:.46},{id:'culture',label:'Leadership and team culture',share:.34},{id:'management',label:'Manager politics: favoritism and reviews',share:.2}]};
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  await route.fulfill({json:jev(start,{clarify:true,route:'clarify',forks:[meaning]},{keepCanvas:true})});});
 for(const path of ['/','/c/northwind-labs']) {
  if(path==='/'){await page.goto('/');await expect(page.getByRole('heading',{name:'Know the workplace. Keep your privacy.'})).toBeVisible();}else await ready(page,path);
  await composer(page).fill('how political is engineering?');await composer(page).press('Enter');
  const heading=page.getByRole('heading',{name:'What did you mean?'});await expect(heading).toBeFocused();
  await expect(page.locator('.clarify')).toContainText('Your question can mean different things');
  for(const o of meaning.options)await expect(page.getByRole('button',{name:new RegExp(`${o.label.split(':')[0]}.*${Math.round(o.share*100)}% model probability`)})).toBeVisible();
  await expect(page.getByText('It says nothing about the evidence.')).toBeVisible();
 }
 await page.getByRole('button',{name:/Leadership and team culture/}).click();
 await expect(page.getByRole('heading',{name:'What did you mean?'})).toHaveCount(0);
 await expect(page.getByRole('group',{name:'What we understood'})).toContainText('Culture');
});

// Shapes the live server returned for "how political is engineering?". In round 3 the meaning fork came tentative ('fork')
// with a view question that asked, so the whole reply was held (keepCanvas) and only the view question showed. The
// polished server no longer asks a view question beside a meaning, but any other ask can still hold a reply that carries a
// tentative meaning, so the client must lead with the meaning whatever else the reply holds.
const POLITICAL={
 meaning:(shares:[number,number,number])=>({field:'topic',kind:'meaning' as const,question:'Which meaning did you intend?',tier:'fork' as const,options:[{id:'culture',label:'Leadership and team culture',share:shares[0]},{id:'management',label:'Manager politics: favoritism and reviews',share:shares[1]},{id:'promotion',label:'Promotion politics: who gets promoted and why',share:shares[2]}]}),
 view:(tier:'ask'|'fork',options:Array<[string,string,number]>)=>({field:'view',question:tier==='ask'?'What would you like to see?':'Which view best answers this?',tier,options:options.map(([id,label,share])=>({id,label,share}))}),
};
test('a held reply that hinges on an ambiguous word asks what was meant first, with probabilities, keeps the last view, and never asks a view question in its place',async({page,request})=>{
 const found=await discovery(request,{cohort:'Engineering'}),record=await controls(request),bodies=canvasBodies(page);
 const home=jev(found,{clarify:true,route:'discovery',cohorts:{fn:'Engineering',seniority:null},topic:dist('culture',.84) as Interpretation['topic'],forks:[POLITICAL.meaning([.84,.09,.07]),POLITICAL.view('ask',[['overview','Workplace record',.5],['discovery','Explore employers',.27],['reader','Original testimony',.1]])]},{keepCanvas:true});
 const onRecord=jev(record,{clarify:true,topic:dist('culture',.86) as Interpretation['topic'],forks:[POLITICAL.view('ask',[['overview','Workplace record',.6],['discovery','Explore employers',.14],['clusters','Recurring experiences',.11]]),POLITICAL.meaning([.86,.07,.07])]},{keepCanvas:true});
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  await route.fulfill({json:body.slug?onRecord:home});});
 const clarify=page.locator('section.clarify');
 const asksMeaning=async()=>{
  await expect(page.getByRole('heading',{name:'What did you mean?'})).toBeFocused();
  for(const [label,share] of [['Leadership and team culture',pct(0)],['Manager politics',pct(1)],['Promotion politics',pct(2)]] as const)await expect(clarify.getByRole('button',{name:new RegExp(`^${label}.*${share}% model probability$`)})).toBeVisible();
  // No generic view question, in its place or beside it, and no view that needs an employer.
  await expect(page.getByRole('heading',{name:/What would you like to see|Which view/})).toHaveCount(0);
  await expect(clarify.getByRole('button',{name:/Workplace record|Explore employers|Original testimony|Recurring experiences/})).toHaveCount(0);
  await expect(page.locator('.tentative')).toHaveCount(0);
  await expect(page.getByText('Clarification needed: What did you mean?')).toBeAttached();
 };
 let shares=[84,9,7];const pct=(k:number)=>shares[k]!;
 // Home: nothing was on screen, and nothing replaces it; the held view's own notices follow the choices.
 await page.goto('/');await expect(page.getByRole('heading',{name:'Know the workplace. Keep your privacy.'})).toBeVisible();
 await composer(page).fill('how political is engineering?');await composer(page).press('Enter');
 await asksMeaning();
 await expect(page.locator('section.canvas')).toHaveCount(0);expect(new URL(page.url()).pathname+new URL(page.url()).search).toBe('/');
 if(found.notices.length) {
  const order=await clarify.evaluate(el=>[...el.children].map(c=>c.classList.contains('clarify-fork')?'fork':c.classList.contains('clarify-after')?'after':c.tagName.toLowerCase()));
  expect(order.indexOf('after')).toBeGreaterThan(order.indexOf('fork'));
  await expect(clarify.locator('.clarify-after')).toContainText(found.notices[0]!);
 }
 // Choosing a meaning opens the held view for it, through the typed controls only.
 await clarify.getByRole('button',{name:/^Promotion politics/}).click();
 await expect(page.getByRole('heading',{name:'What did you mean?'})).toHaveCount(0);
 await expect(canvasView(page)).toContainText('Explore employers');
 await expect(page.getByRole('group',{name:'What we understood'})).toContainText('Promotions');
 const chose=bodies.at(-1)!;expect(chose.q).toBe('');expect(chose.mode).toBe('controls');expect(chose.overrides).toMatchObject({view:'discovery',topic:'promotion'});
 // A record: the last view stays in place, with the same question first.
 shares=[86,7,7];
 await ready(page,'/c/northwind-labs');const heading=await page.locator('#canvas-title').innerText(),url=page.url();
 await composer(page).fill('how political is engineering?');await composer(page).press('Enter');
 await asksMeaning();
 await expect(clarify).toContainText('Your last view stays in place until you pick.');
 await expect(page.locator('#canvas-title')).toHaveText(heading);expect(page.url()).toBe(url);
 await clarify.getByRole('button',{name:/^Leadership and team culture/}).click();
 await expect(page.getByRole('group',{name:'What we understood'})).toContainText('Culture');
 expect(bodies.at(-1)!.overrides).toMatchObject({company:'northwind-labs',topic:'culture'});
 await page.screenshot({path:'artifacts/meaning-fork.png',fullPage:true});
});

test('an applied tentative meaning is offered first among tentative readings, and a reading with nothing left to offer is not shown',async({page,request})=>{
 const start=await controls(request);
 // Not held: every fork is tentative, so the view is shown with the readings beside it.
 const lone={field:'company',question:'Which employer?',tier:'fork' as const,options:[{id:'northwind-labs',label:'Northwind Labs',share:.97}]};
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  await route.fulfill({json:jev(start,{topic:dist('culture',.86) as Interpretation['topic'],forks:[lone,POLITICAL.meaning([.86,.07,.07]),POLITICAL.view('fork',[['overview','Workplace record',.6],['discovery','Explore employers',.14],['clusters','Recurring experiences',.11]])]})});});
 await ready(page,'/c/northwind-labs');
 await composer(page).fill('how political is engineering?');await composer(page).press('Enter');
 const rows=page.locator('.tentative-row');
 await expect(rows.first()).toHaveClass(/is-meaning/);
 await expect(rows.first()).toContainText('Read as Leadership and team culture 86% model probability');
 await expect(rows.first().getByRole('button',{name:/Manager politics.*7% model probability/})).toBeVisible();
 await expect(rows).toHaveCount(2);await expect(rows.nth(1)).toContainText('Showing Workplace record');
 // The employer reading has no alternative left, so no "Or did you mean" follows it.
 await expect(page.locator('.tentative')).not.toContainText('Showing Northwind Labs');
 await expect(page.locator('section.clarify')).toHaveCount(0);
});

test('with no employer named, the home page offers the meanings and never a view that needs an employer',async({page,request})=>{
 // A home-page shape seen live before the server's polish, not held: discovery shown, a tentative view reading of
 // 'Workplace record' at 59%. The client does not rely on the server leaving such a reading out.
 const found=await discovery(request);
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  await route.fulfill({json:jev(found,{route:'discovery',topic:dist('culture',.83) as Interpretation['topic'],forks:[POLITICAL.meaning([.83,.1,.07]),POLITICAL.view('fork',[['overview','Workplace record',.59],['discovery','Explore employers',.22],['clusters','Recurring experiences',.07]])]})});});
 await page.goto('/');await expect(page.getByRole('heading',{name:'Know the workplace. Keep your privacy.'})).toBeVisible();
 await composer(page).fill('how political is engineering?');await composer(page).press('Enter');
 await expect(canvasView(page)).toContainText('Explore employers');
 const tentative=page.locator('.tentative');
 await expect(tentative.locator('.tentative-row')).toHaveCount(1);
 await expect(tentative).toContainText('Read as Leadership and team culture 83% model probability');
 await expect(tentative.getByRole('button',{name:/Promotion politics.*7% model probability/})).toBeVisible();
 await expect(page.getByRole('button',{name:/Workplace record|Recurring experiences/})).toHaveCount(0);
});

test('an event chosen by the single-documented-event rule is an editable chip labeled as inferred',async({page,request})=>{
 const timeline=await controls(request,'northwind-labs',{view:'timeline',event:'ev-nw-restructure-2025',timeframe:'after_event'});
 const event=timeline.evidence!.selectedEvent!;
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  await route.fulfill({json:jev(timeline,{event:dist(event.id) as Interpretation['event'],timeframe:'after_event',inferred:[{field:'event',value:event.id,label:event.label,reason:'single_documented_event'}]})});});
 await ready(page,'/c/northwind-labs');
 await composer(page).fill('how did promotions change after the restructuring?');await composer(page).press('Enter');
 const chip=page.locator('[data-chip="event"]');
 await expect(chip).toContainText('Inferred');await expect(chip).toContainText(event.label);
 await expect(chip).toContainText('only documented event of the kind your question names');
 await chip.click();await expect(page.getByRole('dialog',{name:/Change/})).toBeVisible();await page.keyboard.press('Escape');
 await expect(chip).toBeFocused();
});

test('each number in the group-and-company view opens its own release, group and provenance',async({page})=>{
 await ready(page,'/c/northwind-labs?view=cohort&cohort=Engineering');
 const table=page.locator('.cohort-table');await expect(table).toBeVisible();
 const cells=table.locator('button.cohort-cell');expect(await cells.count()).toBeGreaterThan(1);
 await expect(cells.first().locator('.tag-fixture')).toBeVisible();
 const row=table.locator('tbody tr').filter({has:page.locator('td:nth-child(2) button.cohort-cell')}).first();
 await row.locator('td:nth-child(3) button').click();
 const lens=page.getByRole('dialog');await expect(lens).toBeVisible();
 await expect(lens.getByRole('heading',{name:'This release'})).toBeVisible();
 await expect(lens.locator('.lens-facts')).toContainText('All contributors');
 const companyRelease=await lens.locator('tbody code').first().innerText();
 await page.keyboard.press('Escape');await expect(row.locator('td:nth-child(3) button')).toBeFocused();
 await row.locator('td:nth-child(2) button').click();
 await expect(lens.locator('.lens-facts')).toContainText('Engineering');
 expect(await lens.locator('tbody code').first().innerText()).not.toBe(companyRelease);
 await page.keyboard.press('Escape');
});

test('an employer the directory does not list gets its own state, named as typed, with what opening a record takes',async({page,request})=>{
 // Deterministic whatever the directory lists: the page gets the live directory without any Schwab entry, and each
 // question is answered in the shape the real server gives the unlisted route (its name read exactly as the server does).
 const listed=((await (await request.get('/api/directory')).json()) as {companies:Array<{slug:string;name:string}>}).companies.filter(c=>!/schwab/i.test(`${c.slug} ${c.name}`));
 const data={q:'',slug:null,overrides:{company:'unlisted'},mode:'controls'};
 const reply=await fromServer(`api:${JSON.stringify(data)}`,async()=>{const r=await request.post('/api/canvas',{data});return {status:r.status(),headers:r.headers(),body:await r.text()};});
 expect(reply.status).toBe(200);const base=JSON.parse(reply.body) as CanvasResponse;
 expect(base.interpretation.route).toBe('unlisted');expect(base.keepCanvas).toBe(true);expect(base.evidence).toBeNull();
 const asked:string[]=[];
 await page.route('**/api/directory',route=>route.fulfill({json:{companies:listed}}));
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}asked.push(body.q);
  const name=unlistedName(body.q,[]);
  await route.fulfill({json:jev(base,{route:'unlisted',clarify:true,company:null,unlistedEmployer:{name}} as Partial<Interpretation>,{keepCanvas:true,notices:[unlistedNotice(name,true)]})});});
 for(const [typed,shown] of [['charlesschwab','Charlesschwab'],['Charles Schwab','Charles Schwab'],['schwab','Schwab']] as const) {
  await page.goto('/');await expect(page.getByRole('heading',{name:'Know the workplace. Keep your privacy.'})).toBeVisible();
  await composer(page).fill(typed);await composer(page).press('Enter');
  const heading=page.getByRole('heading',{name:`${shown} isn’t in the directory yet`});
  await expect(heading).toBeVisible();await expect(heading).toBeFocused();
  await expect(page.getByText('Anyone can add an employer with the domain of its work email',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Share this site'})).toBeVisible();
  // Never an error, never fictional or other employers in its place, and the generic notice is not repeated.
  await expect(page.locator('.error')).toHaveCount(0);
  await expect(page.locator('.discovery-card, .metric-card, .examples')).toHaveCount(0);
  await expect(page.getByText(unlistedNotice(unlistedName(typed,[]),true))).toHaveCount(0);
  expect(new URL(page.url()).pathname+new URL(page.url()).search).toBe('/');
 }
 expect(asked).toEqual(['charlesschwab','Charles Schwab','schwab']);
 await page.getByRole('button',{name:'Browse the directory'}).click();
 await expect(page.getByRole('heading',{name:'Real employers'})).toBeFocused();
 await expect(page.getByRole('heading',{name:/isn’t in the directory yet/})).toHaveCount(0);
 await page.screenshot({path:'artifacts/unlisted.png',fullPage:true});
});

test('a Live reading over its own budget pauses Live quietly: no error, the last view stays, and Enter still searches',async({page,request})=>{
 const start=await controls(request),live:string[]=[],submits:Body[]=[];
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  if(body.mode==='live'){live.push(body.q);await route.fulfill({status:429,headers:{'retry-after':'60'},json:{error:'rate_limited',mode:'live',retryAfterSeconds:60}});return;}
  submits.push(body);await route.fulfill({json:jev({...start,view:'timeline'},{view:dist('timeline') as Interpretation['view']})});});
 await ready(page,'/c/northwind-labs');
 const heading=await page.locator('#canvas-title').innerText(),url=page.url();
 await page.getByRole('switch',{name:'Live understanding'}).click();
 await composer(page).fill('how are promotions decided');
 await expect(page.getByRole('status').filter({hasText:'Live understanding paused for a minute — press Enter to search.'})).toBeVisible();
 await expect(page.locator('.error')).toHaveCount(0);await expect(page.locator('.calm-note')).toHaveCount(0);
 await expect(page.locator('#canvas-title')).toHaveText(heading);expect(page.url()).toBe(url);
 await expect(page.getByRole('switch',{name:'Live understanding'})).toHaveAttribute('aria-checked','true');
 // While paused, typing sends nothing.
 await composer(page).fill('how are promotions decided these days');await page.waitForTimeout(1000);
 expect(live).toEqual(['how are promotions decided']);
 await composer(page).press('Enter');
 await expect(canvasView(page)).toContainText('Through time');
 expect(submits.map(b=>`${b.mode}:${b.q}`)).toEqual(['submit:how are promotions decided these days']);
 await expect(page.locator('.error')).toHaveCount(0);
 await page.screenshot({path:'artifacts/live-paused.png'});
});

test('new words cancel a Live reading still in flight at once, not when the next reading is sent',async({page,request})=>{
 const start=await controls(request),sent=new Map<string,number>(),aborted=new Map<string,number>();
 page.on('requestfailed',r=>{if(new URL(r.url()).pathname!=='/api/canvas')return;const b=r.postDataJSON() as Body;if(b.mode==='live')aborted.set(b.q,Date.now());});
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  sent.set(body.q,Date.now());
  const slow=body.q.includes('slow'),view=slow?'timeline':'distribution';
  if(slow)await new Promise(r=>setTimeout(r,1500));
  await route.fulfill({json:jev({...start,view},{view:dist(view) as Interpretation['view']})}).catch(()=>undefined);});
 await ready(page,'/c/northwind-labs');
 await page.getByRole('switch',{name:'Live understanding'}).click();
 await composer(page).fill('slow promotion question');
 await expect.poll(()=>sent.has('slow promotion question')).toBe(true);
 await composer(page).fill('weekly hours please');
 await expect.poll(()=>aborted.has('slow promotion question')).toBe(true);
 await expect(canvasView(page)).toContainText('The full distribution');
 expect(sent.get('weekly hours please')!-aborted.get('slow promotion question')!,'cancelled by the keystroke, a debounce before the next reading').toBeGreaterThan(250);
 await page.waitForTimeout(1600);await expect(canvasView(page)).toContainText('The full distribution');
});

test('an explicit question over the connection’s budget gets a calm note in place of an error, and the last view stays',async({page})=>{
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}await route.fulfill({status:429,json:{error:'rate_limited'}});});
 await ready(page,'/c/northwind-labs');const heading=await page.locator('#canvas-title').innerText();
 await composer(page).fill('how are promotions decided');await composer(page).press('Enter');
 await expect(page.locator('.calm-note')).toHaveText(RATE_LIMITED_CALM);
 await expect(page.locator('.error')).toHaveCount(0);await expect(page.locator('#canvas-title')).toHaveText(heading);
});

test('two group chips edit independently: changing or removing one keeps the other',async({page,request})=>{
 const both=await controls(request,'northwind-labs',{cohortFunction:'Engineering',cohortSeniority:'Senior individual contributor'});
 expect(both.interpretation.cohorts).toEqual({fn:'Engineering',seniority:'Senior individual contributor'});
 const bodies=canvasBodies(page);
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}await route.fulfill({json:jev(both)});});
 await ready(page,'/c/northwind-labs');
 await composer(page).fill('senior engineers and promotions');await composer(page).press('Enter');
 await expect(page.locator('[data-chip="cohort-0"]')).toContainText('Engineering');
 await expect(page.locator('[data-chip="cohort-1"]')).toContainText('Senior individual contributor');
 await page.locator('[data-chip="cohort-1"]').click();
 const editor=page.getByRole('dialog',{name:'Change Senior individual contributor'});await expect(editor).toBeVisible();
 await expect(editor.getByRole('button',{name:'Engineering',exact:true}),'the other chip’s group is not offered').toHaveCount(0);
 await editor.getByRole('button',{name:'Sales',exact:true}).click();
 await expect(page.locator('[data-chip="cohort-1"]')).toContainText('Sales');await expect(page.locator('[data-chip="cohort-0"]')).toContainText('Engineering');
 let last=bodies.at(-1)!;expect(last.q).toBe('');expect(last.overrides).toMatchObject({cohortFunction:'Engineering',cohortSeniority:'Sales'});expect(last.overrides.cohort).toBeUndefined();
 await page.getByRole('button',{name:'Remove Sales'}).click();
 await expect(page.locator('[data-chip="cohort"]')).toContainText('Engineering');await expect(page.locator('[data-chip^="cohort-"]')).toHaveCount(0);
 last=bodies.at(-1)!;expect(last.overrides).toMatchObject({cohortFunction:'Engineering',cohortSeniority:null});expect(last.overrides.cohort).toBeUndefined();
 expect(page.url()).not.toMatch(/cohortFunction|cohortSeniority|scope/);
});

test('employer-bound edits that travel with a question name the employer they were made on',async({page,request})=>{
 const start=await controls(request),bodies=canvasBodies(page);
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}await route.fulfill({json:jev(start)});});
 await ready(page,'/c/northwind-labs?view=timeline&event=ev-nw-restructure-2025');
 await page.locator('[data-chip="event"]').click();await page.locator('.chip-option').nth(1).click();
 await expect(page.getByRole('button',{name:/Reset my edits/})).toBeVisible();
 // Nothing on the device recognises another employer here, so the pinned event travels, naming its employer.
 await composer(page).fill('how did promotions change at the chip maker');await composer(page).press('Enter');
 await expect.poll(()=>bodies.filter(b=>b.q).length).toBe(1);
 const asked=bodies.find(b=>b.q)!;expect(asked.overrides.event).toBeTruthy();expect(asked.overrides.scope).toBe('northwind-labs');
 expect(page.url()).not.toContain('scope');
});

test('the accounts-mentioning count stays where the view’s own cards already show every fact',async({page,request})=>{
 const start=await controls(request);test.skip(!start.answer,'this server sends no answer yet');
 // A test double: the seeded fictional data has no topic that five or more published accounts mention.
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  await route.fulfill({json:jev(start,{topic:dist('promotion') as Interpretation['topic']},{answer:{...start.answer!,accountsMentioning:{topic:'promotion',count:7}}})});});
 await ready(page,'/c/northwind-labs');
 await composer(page).fill('are promotions fair');await composer(page).press('Enter');
 await expect(page.locator('.answer-accounts')).toHaveText('7 published accounts mention promotions.');
 await expect(page.getByRole('list',{name:'Facts behind this answer'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Open the evidence behind this answer'})).toBeVisible();
});

test('a real employer whose verification is not set up says so on its empty record, and offers no contribution',async({page,request})=>{
 const companies=((await (await request.get('/api/directory')).json()) as {companies:Array<{slug:string;kind:string}>}).companies;
 const keys=((await (await request.get('/api/proof/keys')).json()) as {keys:Array<{companySlug:string;verificationClass:string;purpose?:string}>}).keys;
 const unset=companies.find(c=>c.kind==='real'&&!keys.some(k=>k.companySlug===c.slug&&k.verificationClass==='mailbox'&&(k.purpose??'contribution')==='contribution'));
 test.skip(!unset,'every listed real employer has work-mailbox verification');
 await ready(page,`/c/${unset!.slug}`);
 const card=page.getByRole('region',{name:/is published yet\.$/});
 await expect(card.getByText('Verification for this employer isn’t set up yet',{exact:false})).toBeVisible();
 await expect(card.getByRole('link',{name:'Contribute privately'})).toHaveCount(0);
 await expect(card.getByRole('button',{name:'Invite coworkers'})).toBeVisible();
 // An employer with a work-mailbox key keeps the contribution link.
 await ready(page,'/c/stripe');
 await expect(page.getByRole('link',{name:'Contribute privately'})).toBeVisible();
});

test('with Live on (the default), crisis words show the on-device card and are never sent while typing',async({page})=>{
 const bodies=canvasBodies(page);await page.goto('/');await page.waitForLoadState('networkidle');
 await page.getByRole('switch',{name:'Live understanding'}).click();
 await expect(page.getByRole('switch',{name:'Live understanding'})).toHaveAttribute('aria-checked','true');
 const before=bodies.length;
 await composer(page).fill('honestly I want to die after this reorg');
 await expect(page.getByRole('region',{name:CRISIS_COPY.self_harm.heading})).toBeVisible();
 await page.waitForTimeout(1200);
 expect(bodies.slice(before),'nothing is sent while the words read as a crisis').toEqual([]);
 await expect(page).toHaveURL(/\/$/);
 // Other words are still read by Live understanding once the crisis words are gone.
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}await route.fulfill({json:await discovery(page.request)});});
 await composer(page).fill('which employers handle layoffs well');
 await expect.poll(()=>bodies.slice(before).map(b=>`${b.mode}:${b.q}`)).toEqual(['live:which employers handle layoffs well']);
});

test('with Live on, a listed name opens its record without hosted Jev, and Enter then Back returns to the page it was typed on',async({page})=>{
 const bodies=canvasBodies(page);await page.goto('/');await page.waitForLoadState('networkidle');
 await page.getByRole('switch',{name:'Live understanding'}).click();
 await composer(page).fill('Helios Semiconductor');
 await expect(page).toHaveURL(/\/c\/helios-semiconductor$/);
 await expect(page.getByRole('heading',{level:1,name:'Helios Semiconductor'})).toBeVisible();
 const length=await page.evaluate(()=>history.length);
 await composer(page).press('Enter');
 await expect.poll(()=>page.evaluate(()=>(history.state as {q?:string}|null)?.q)).toBe('Helios Semiconductor');
 expect(bodies.length).toBe(2);
 expect(bodies.every(b=>b.q===''&&b.mode==='controls'),'a bare listed name never reaches hosted Jev').toBe(true);
 // The Live reading was provisional and Enter settled it: one entry, so Back returns home.
 expect(await page.evaluate(()=>history.length)).toBe(length);
 await page.goBack();await expect(page).toHaveURL(/\/$/);
 await expect(page.getByRole('heading',{level:1,name:/Know the workplace/})).toBeVisible();
});

test('a Live reading followed by Enter is one step in the path and one entry in history',async({page,request})=>{
 const start=await controls(request),asked:string[]=[];
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  asked.push(`${body.mode}:${body.q}`);await route.fulfill({json:jev({...start,view:'timeline'},{view:dist('timeline') as Interpretation['view']})});});
 await ready(page,'/c/northwind-labs');
 await page.getByRole('switch',{name:'Live understanding'}).click();
 const question='how have promotions changed here';
 await composer(page).fill(question);await expect(canvasView(page)).toContainText('Through time');
 await composer(page).press('Enter');await expect.poll(()=>asked).toEqual([`live:${question}`,`submit:${question}`]);
 const path=page.getByRole('navigation',{name:'Your path in this tab'});
 await expect(path.getByRole('button')).toHaveCount(2);await expect(path.getByRole('button',{name:question})).toHaveCount(1);
 await page.goBack();await expect(canvasView(page)).toContainText('Workplace record');
 expect(new URL(page.url()).pathname).toBe('/c/northwind-labs');
});

test('the Group tab after another tab opens the group view with the group the reader chooses',async({page})=>{
 await ready(page,'/c/northwind-labs?topic=layoffs');
 await page.getByRole('button',{name:'Accounts',exact:true}).click();await expect(canvasView(page)).toContainText('Original accounts');
 await page.getByRole('button',{name:'Group',exact:true}).click();
 const ask=page.getByRole('heading',{name:'Which group should we compare with the whole company?'});
 await expect(ask.or(canvasView(page).filter({hasText:'Group and company'}))).toBeVisible();
 test.skip(!(await ask.isVisible()),'this server opens the group view without asking');
 await page.locator('.clarify').getByRole('button',{name:/^Engineering/}).first().click();
 await expect(canvasView(page)).toContainText('Group and company');
 await expect(page.getByRole('button',{name:'Group',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('[data-chip="cohort"]')).toContainText('Engineering');
 expect(new URL(page.url()).searchParams.get('view')).toBe('cohort');
});

test('removing a chip with the keyboard moves focus to a remaining control, never the page body',async({page})=>{
 await ready(page,'/c/northwind-labs?topic=layoffs');
 await page.getByRole('button',{name:'Remove Layoffs'}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('button',{name:'Remove Layoffs'})).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>document.activeElement?.tagName)).not.toBe('BODY');
 await expect(page.locator('.chips button[data-chip]').first()).toBeFocused();
});

test('an edited event chip names the event in the path, and a before/after choice the timeline does not apply says so',async({page})=>{
 await ready(page,'/c/northwind-labs?view=timeline&event=ev-nw-restructure-2025&time=before_event');
 await expect(page.locator('[data-chip="timeframe"]')).toContainText('Before the event (not applied in this view)');
 await expect(page.locator('.notice',{hasText:'“Before the event” is not applied'})).toBeVisible();
 await page.locator('[data-chip="event"]').click();
 await page.getByRole('dialog',{name:/Change/}).getByRole('button',{name:'2024 leadership change'}).click();
 await expect(page.locator('[data-chip="event"]')).toContainText('2024 leadership change');
 const path=page.getByRole('navigation',{name:'Your path in this tab'});
 await expect(path).toContainText('2024 leadership change');await expect(path).not.toContainText('ev-nw-');
 // Outside the timeline the choice filters the view, and the chip says nothing more.
 await page.getByRole('button',{name:'Record',exact:true}).click();await expect(canvasView(page)).toContainText('Workplace record');
 await expect(page.locator('[data-chip="timeframe"]')).toHaveText(/^Before the event, change/);
 await expect(page.locator('.notice',{hasText:'is not applied'})).toHaveCount(0);
});

test('an inferred event keeps its label and note through other changes, until the reader confirms or changes it',async({page,request})=>{
 const timeline=await controls(request,'northwind-labs',{view:'timeline',event:'ev-nw-restructure-2025',timeframe:'after_event'});
 const event=timeline.evidence!.selectedEvent!,note=`Applied the ${event.label}, the only documented restructuring for this employer. Change or remove it in the event chip.`;
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  await route.fulfill({json:jev(timeline,{event:dist(event.id) as Interpretation['event'],timeframe:'after_event',notes:[note],inferred:[{field:'event',value:event.id,label:event.label,reason:'single_documented_event'}]},{notices:[note,...timeline.notices]})});});
 await ready(page,'/c/northwind-labs');
 await composer(page).fill('what got worse since the restructuring?');await composer(page).press('Enter');
 const chip=page.locator('[data-chip="event"]');await expect(chip).toContainText('Inferred');
 await page.getByRole('button',{name:'Record',exact:true}).click();await expect(canvasView(page)).toContainText('Workplace record');
 await expect(chip).toContainText('Inferred');await expect(page.locator('.notice',{hasText:note})).toHaveCount(1);
 // Choosing the same event confirms it: it is the reader's choice now, no longer inferred.
 await chip.click();await page.getByRole('dialog',{name:/Change/}).getByRole('button',{name:event.label,exact:true}).click();
 await expect(chip).toContainText(event.label);await expect(chip).not.toContainText('Inferred');
});

test('Back while a question is still loading abandons it: its late reply never navigates away again',async({page,request})=>{
 const start=await controls(request);
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  await new Promise(r=>setTimeout(r,1500));await route.fulfill({json:jev({...start,view:'timeline'},{view:dist('timeline') as Interpretation['view']})}).catch(()=>undefined);});
 await ready(page,'/c/northwind-labs');
 await page.getByRole('button',{name:'Accounts',exact:true}).click();await expect(canvasView(page)).toContainText('Original accounts');
 await composer(page).fill('how have promotions changed');await composer(page).press('Enter');
 await page.goBack();await expect(canvasView(page)).toContainText('Workplace record');
 await page.waitForTimeout(2000);
 await expect(canvasView(page)).toContainText('Workplace record');
 expect(new URL(page.url()).search).toBe('');
});

test('an address naming an employer the directory does not list shows its not-found state without asking the server, and a question from there names no employer',async({page,request})=>{
 const bodies=canvasBodies(page),problems:string[]=[],failed:string[]=[];
 const slug='acmewidgets-not-listed',address=`/c/${slug}?view=timeline`;
 // The document itself may carry a 404 status (the server says the address names no employer); nothing else may fail.
 const own=(url:string)=>{try {return new URL(url).pathname===`/c/${slug}`;} catch {return false;}};
 page.on('console',m=>{if(m.type()==='error'&&!own(m.location().url))problems.push(`${m.text()} ${m.location().url}`);});page.on('pageerror',e=>problems.push(e.message));
 page.on('response',r=>{if(r.status()>=400&&r.request().resourceType()!=='document')failed.push(`${r.status()} ${r.url()}`);});
 const listed=((await (await request.get('/api/directory')).json()) as {companies:Array<{slug:string}>}).companies;
 expect(listed.length).toBeGreaterThan(0);expect(listed.some(c=>c.slug===slug)).toBe(false);
 await page.goto(address);
 await expect(page.getByRole('heading',{level:1,name:'Employer not found'})).toBeVisible();
 await expect(page).toHaveTitle('Employer not found — Should I Work There');
 const note=page.getByRole('region',{name:'Employer not found'});
 await expect(note).toContainText('That employer is not in the directory, so there is no record at this address.');
 await expect(note.getByRole('link',{name:'browse all employers'})).toHaveAttribute('href','/');
 await expect(page.getByRole('alert')).toHaveCount(0);
 await page.waitForLoadState('networkidle');
 expect(bodies,'the server is not asked about an address the directory does not list').toEqual([]);
 expect(failed,'no request fails').toEqual([]);expect(problems,'no error is logged').toEqual([]);
 // A question asked from here is asked across employers: the unlisted address is never sent as the employer.
 const start=await discovery(request);
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}await route.fulfill({json:jev(start)});});
 await composer(page).fill('where do engineers get promoted fastest?');await composer(page).press('Enter');
 await expect.poll(()=>bodies.length).toBe(1);
 expect(bodies[0]!.slug).toBeNull();
 // A listed employer's address still loads its record.
 await ready(page,'/c/northwind-labs');
 await expect(page.getByRole('heading',{level:1,name:'Northwind Labs'})).toBeVisible();
});

test('what the composer recognised is never cut off under the send button: its own line at 390px, wrapped lines beside the Live switch on a tablet, and no sideways scroll',async({page})=>{
 // 390px is a phone; 700px and 820px are tablets, where the strip sits beside the Live switch and used to be clipped
 // mid-word, and where the top bar used to push the page sideways.
 for(const width of [390,700,820]) {
  await page.setViewportSize({width,height:844});
  await ready(page,'/c/northwind-labs');
  await composer(page).fill('What got worse after the 2025 restructuring at Northwind Labs for promotions and workload?');
  const strip=page.locator('.recognised');
  await expect(strip.locator('.recognised-item').nth(3)).toBeVisible();
  await expect(strip.locator('.recognised-label')).toHaveText('Recognized on this device');
  const g=await page.evaluate(()=>{
   const rect=(e:Element)=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
   const strip=document.querySelector('.recognised')!,send=document.querySelector('.composer .send')!,live=document.querySelector('.composer .live-toggle')!;
   return {send:rect(send),live:rect(live),strip:{...rect(strip),clipped:strip.scrollWidth>strip.clientWidth+1},
    items:[...strip.querySelectorAll<HTMLElement>('.recognised-item')].map(i=>({...rect(i),text:i.firstChild?.textContent??'',title:i.getAttribute('title')??'',cut:i.scrollWidth>i.clientWidth+1}))};
  });
  expect(g.strip.clipped,`${width}px: nothing in the strip is cut off`).toBe(false);
  if(width===390)expect(g.strip.top,'the strip has its own line below the Live switch and the send button').toBeGreaterThanOrEqual(Math.max(g.send.bottom,g.live.bottom)-1);
  else expect(g.strip.right,`${width}px: the strip ends before the send button`).toBeLessThanOrEqual(g.send.left);
  for(const item of g.items) {
   const under=item.left<g.send.right&&item.right>g.send.left&&item.top<g.send.bottom&&item.bottom>g.send.top;
   expect(under,`${width}px: ${item.text} is under the send button`).toBe(false);
   expect(item.left,`${width}px: ${item.text} starts inside the strip`).toBeGreaterThanOrEqual(g.strip.left-1);
   expect(item.right,`${width}px: ${item.text} ends inside the strip`).toBeLessThanOrEqual(g.strip.right+1);
   expect(item.cut,`${width}px: ${item.text} is shown whole`).toBe(false);
   expect(item.title,'each concept names itself and its kind in its title').toMatch(new RegExp(`^${item.text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')} \\(.+\\)$`));
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth),`${width}px: the page does not scroll sideways`).toBeLessThanOrEqual(0);
  await page.locator('.composer').screenshot({path:`artifacts/composer-recognised-${width}.png`});
 }
});

// ---- Public launch (owner decisions of 2026-09-23) ----
/** The running server's config with some fields replaced, so a test states the launch switches it exercises. */
async function withConfig(page:Page,patch:(config:Record<string,unknown>)=>Record<string,unknown>) {
 await page.route('**/api/config',async route=>{const r=await route.fetch();await route.fulfill({json:patch(await r.json() as Record<string,unknown>)});});
}
const listing=(open:boolean,bits=14)=>(c:Record<string,unknown>)=>({...c,employerListing:{open,perClientPerDay:5,pow:{version:1,bits,windowMinutes:2,worker:'/pow-worker.js'}}});
const FICTIONAL=[{id:'c_northwind',slug:'northwind-labs',name:'Northwind Labs',kind:'sample'},{id:'c_helios',slug:'helios-semiconductor',name:'Helios Semiconductor',kind:'sample'},{id:'c_meridian',slug:'meridian-retail',name:'Meridian Retail',kind:'sample'}] as const;
/** The live directory with its fictional employers removed, or supplied, whatever the running stack's SAMPLE_EMPLOYERS says. */
async function directoryWith(page:Page,samples:boolean) {
 const real=((await (await page.request.get('/api/directory')).json()) as {companies:DirectoryCompany[]}).companies.filter(c=>c.kind==='real');
 const companies=samples?[...real,...FICTIONAL]:[...real,FICTIONAL[0]];
 await page.route('**/api/directory',route=>route.fulfill({json:{companies}}));
 return real;
}

test('with sample employers off (production), nothing fictional is listed, labeled or offered, and the examples name real employers',async({page})=>{
 await withConfig(page,c=>({...c,sampleEmployers:false,publication:{accountBatch:5,aggregateMinimum:25}}));
 // Even a sample employer that still reached the page (an older directory reply) is not listed while the switch is off.
 const real=await directoryWith(page,false);
 await page.goto('/');
 const expected=REAL_EXAMPLES.filter(e=>e.slugs.every(s=>real.some(c=>c.slug===s))).map(e=>e.text);
 expect(expected.length).toBeGreaterThan(0);
 await expect(page.locator('.examples .pill-button')).toHaveText(expected);
 await expect(page.getByRole('heading',{name:'Real employers'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Fictional demonstrations'})).toHaveCount(0);
 await expect(page.locator('.tag-fiction, .employer.fictional')).toHaveCount(0);
 expect(await page.locator('main').innerText()).not.toMatch(/fictional|Northwind/i);
 await expect(page.locator('.directory-head p').first()).toHaveText('Written accounts publish in batches of 5 per employer, after screening and a random delay. An empty record says nothing about the workplace.');
 // A real-employer example opens that employer's honest empty record, with the rules from the config.
 test.skip(!expected.includes('Charles Schwab'),'the directory does not list Charles Schwab');
 await page.locator('.examples .pill-button',{hasText:'Charles Schwab'}).click();
 await expect(page).toHaveURL(/\/c\/charles-schwab$/);
 await expect(page.locator('#canvas-title')).toHaveText('Nothing about Charles Schwab is published yet.');
 await expect(page.getByText('Written accounts publish in batches of 5 per employer, after screening and a random delay. Survey percentages and other aggregate numbers appear only once at least 25 people have answered.')).toBeVisible();
 expect(await page.locator('main').innerText()).not.toMatch(/fictional/i);
 await page.screenshot({path:'artifacts/launch-real-empty.png',fullPage:true});
 // The contribution page chooses no employer for the author, and lists no fictional example.
 await page.goto('/submit');
 const employer=page.getByLabel('Employer',{exact:true});
 await expect(employer).toHaveValue('');await expect(employer.locator('option',{hasText:'Choose the employer'})).toHaveCount(1);
 expect(await employer.locator('option').allInnerTexts()).not.toContainEqual(expect.stringMatching(/fictional|Northwind/i));
 await expect(page.getByText('Still needed: choosing the employer (step 1)',{exact:false})).toBeVisible();
 await expect(page.getByText('Written accounts publish in batches of 5 per employer, after screening and a random delay.',{exact:false})).toBeVisible();
 await expect(page.getByText(/batch of (at least )?25|minimum batch of 25/)).toHaveCount(0);
});

test('with sample employers on (local and tests), the fictional demonstrations stay and are labeled wherever they appear',async({page})=>{
 await withConfig(page,c=>({...c,sampleEmployers:true}));
 await directoryWith(page,true);
 await page.goto('/');
 await expect(page.locator('.examples .pill-button')).toHaveCount(3);
 for(const button of await page.locator('.examples .pill-button').all())await expect(button.locator('.tag-fiction')).toHaveText('Fictional');
 const demos=page.locator('.employer.fictional');await expect(demos).toHaveCount(3);
 for(const demo of await demos.all())await expect(demo.locator('.tag-fiction')).toBeVisible();
 await expect(page.getByRole('heading',{name:'Fictional demonstrations'})).toBeVisible();
 await expect(page.locator('.employer:not(.fictional) .tag-fiction')).toHaveCount(0);
});

test('adding an employer: checked on the device, a preview with the domain, a proof of work computed in a worker from this site, and the new listing in the directory',async({page})=>{
 const BITS=14;
 await withConfig(page,listing(true,BITS));
 const workers:string[]=[];page.on('worker',w=>workers.push(w.url()));
 // The worker script the site serves (shared/pow.ts), slowed a little so the calm note can be seen.
 await page.route('**/pow-worker.js',route=>route.fulfill({contentType:'text/javascript',body:`"use strict";const searchPow=${searchPow.toString()};\nself.onmessage=(event)=>{const {prefix,bits}=event.data;setTimeout(()=>{for(;;){const found=searchPow(prefix,bits,crypto.getRandomValues(new Uint32Array(1))[0],1<<24);if(found){self.postMessage({nonce:found.nonce,tries:found.tries});return;}}},700);};`}));
 const posted:Array<{name:string;domain:string;pow:{minute:number;nonce:string}}>=[];let verdict:string|null='unchecked';
 const replies:Array<{status:number;json:unknown}>=[
  {status:422,json:{error:'domain_no_mx'}},
  {status:201,json:{listed:true,attached:false,company:{slug:'acme-widgets',name:'Acme Widgets',origin:'community',domains:['acmewidgets.com']},verification:'ready'}},
 ];
 await page.route('**/api/employers',async route=>{
  const body=route.request().postDataJSON() as typeof posted[number];posted.push(body);
  verdict=await checkPow(body.pow,{origin:new URL(page.url()).origin,action:'add-employer',keyId:'',subject:await powSubject.domain(body.domain)},BITS);
  const next=replies.shift()!;await route.fulfill({status:next.status,json:next.json});
 });
 await page.goto('/');
 await page.getByRole('button',{name:'Add your employer'}).click();
 const name=page.getByLabel('Employer name'),domain=page.getByLabel('Work-email domain');
 await expect(name).toBeFocused();
 // A free-mail provider is refused on the device with the server's own rules: no proof of work, no request.
 await name.fill('Acme Widgets');await domain.fill('gmail.com');
 await page.getByRole('button',{name:'Add to the directory'}).click();
 await expect(page.getByRole('alert')).toContainText('That is a free email provider');
 // A domain already listed is named with its listing, also without a request.
 const listedDomain=((await (await page.request.get('/api/directory')).json()) as {companies:DirectoryCompany[]}).companies.find(c=>c.domains?.length);
 if(listedDomain){await domain.fill(listedDomain.domains![0]!);await page.getByRole('button',{name:'Add to the directory'}).click();await expect(page.getByRole('alert')).toContainText('is already listed');}
 expect(posted).toEqual([]);
 // A pasted address keeps only its domain, and the preview shows the listing as it will appear.
 await domain.fill('jane.doe@AcmeWidgets.com');
 await expect(page.getByText('Only the domain is used: acmewidgets.com. The rest of the address is not sent.')).toBeVisible();
 const preview=page.locator('.add-employer-preview');
 await expect(preview.locator('.employer-name')).toHaveText('Acme Widgets (acmewidgets.com)');await expect(preview.locator('.tag-community')).toHaveText('Added by the community');
 // The server's refusal is said in plain words.
 await page.getByRole('button',{name:'Add to the directory'}).click();
 await expect(page.getByText('A short calculation runs on this device first',{exact:false})).toBeVisible();
 await expect(page.getByRole('alert')).toContainText('That domain has no mail servers');
 await page.getByRole('button',{name:'Add to the directory'}).click();
 const done=page.getByRole('heading',{name:'Listed: Acme Widgets (acmewidgets.com)'});
 await expect(done).toBeVisible();await expect(done).toBeFocused();
 expect(posted).toHaveLength(2);
 for(const body of posted){expect(Object.keys(body).sort()).toEqual(['domain','name','pow']);expect(body.domain).toBe('acmewidgets.com');expect(body.name).toBe('Acme Widgets');expect(JSON.stringify(body)).not.toContain('jane');}
 expect(verdict,'the stamp verifies with the server’s own check').toBeNull();
 expect(workers.length).toBeGreaterThan(0);expect(workers.every(w=>new URL(w).pathname==='/pow-worker.js')).toBe(true);
 await expect(page.getByRole('link',{name:'Open its record'})).toHaveAttribute('href','/c/acme-widgets');
 await expect(page.getByRole('link',{name:'Contribute about it'})).toHaveAttribute('href','/submit?employer=acme-widgets');
 // The listing joins the directory at once, labeled and with its domain beside the name.
 const card=page.locator('a.employer.community',{hasText:'Acme Widgets'});
 await expect(card.locator('.employer-name')).toHaveText('Acme Widgets (acmewidgets.com)');await expect(card.locator('.tag-community')).toHaveText('Added by the community');
 await page.screenshot({path:'artifacts/add-employer.png',fullPage:true});
});

test('an employer the directory does not list can be added from its own state; with listing closed, no add action is offered',async({page,request})=>{
 const data={q:'',slug:null,overrides:{company:'unlisted'},mode:'controls'};
 const reply=await fromServer(`api:${JSON.stringify(data)}`,async()=>{const r=await request.post('/api/canvas',{data});return {status:r.status(),headers:r.headers(),body:await r.text()};});
 const base=JSON.parse(reply.body) as CanvasResponse;
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(!body.q){await route.fallback();return;}
  await route.fulfill({json:jev(base,{route:'unlisted',clarify:true,company:null,unlistedEmployer:{name:'Acme Widgets'}} as Partial<Interpretation>,{keepCanvas:true,notices:[unlistedNotice('Acme Widgets',true)]})});});
 let open=false;await withConfig(page,c=>listing(open)(c));
 await page.goto('/');await composer(page).fill('What is it like at Acme Widgets?');await composer(page).press('Enter');
 await expect(page.getByRole('heading',{name:'Acme Widgets isn’t in the directory yet'})).toBeVisible();
 await expect(page.getByRole('button',{name:/Add .* to the directory|Add your employer/})).toHaveCount(0);
 // With listing closed the state never claims that anyone can add it.
 await expect(page.getByText('Adding employers isn’t open on this site right now.',{exact:false})).toBeVisible();
 await expect(page.getByText('Anyone can add an employer',{exact:false})).toHaveCount(0);
 open=true;await page.goto('/');await composer(page).fill('What is it like at Acme Widgets?');await composer(page).press('Enter');
 await expect(page.getByText('Anyone can add an employer with the domain of its work email',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Add Acme Widgets to the directory'}).click();
 await expect(page.getByLabel('Employer name')).toHaveValue('Acme Widgets');await expect(page.getByLabel('Employer name')).toBeFocused();
 await expect(page.getByLabel('Work-email domain')).toHaveValue('');
});

/** A community listing that took a curated employer's name, with its own domain (decision 4 allows it; the client keeps the two apart). */
const TWIN={id:'cc-twin',slug:'google-google-jobs-io',name:'Google',kind:'real' as const,sector:null,origin:'community' as const,domains:['google-jobs.io']};

test('a community listing named like a curated employer never stands in for it, and always shows its domain and label',async({page})=>{
 const real=((await (await page.request.get('/api/directory')).json()) as {companies:DirectoryCompany[]}).companies;
 test.skip(!real.some(c=>c.slug==='google'),'the directory does not list Google');
 // The community twin is listed first, so nothing depends on the directory's order.
 await page.route('**/api/directory',route=>route.fulfill({json:{companies:[TWIN,...real]}}));
 await withConfig(page,listing(true,14));
 const posted:unknown[]=[],refusals:Array<{status:number;json:unknown}>=[];
 await page.route('**/api/employers',async route=>{posted.push(route.request().postDataJSON());await route.fulfill(refusals.shift()??{status:500,json:{error:'unexpected'}});});
 await page.goto('/');
 // On the home page the twin shows its domain and the community label; the curated employer keeps its name.
 await composer(page).fill('google');
 const twinCard=page.locator('a.employer.community',{hasText:'google-jobs.io'});
 await expect(twinCard.locator('.employer-name')).toHaveText('Google (google-jobs.io)');await expect(twinCard.locator('.tag-community')).toHaveText('Added by the community');
 await expect(page.locator('a.employer:not(.community) .employer-name',{hasText:/^Google$/})).toHaveCount(1);
 // The bare name is read on the device as the curated employer, and opens its record.
 await composer(page).fill('Google');
 await expect(page.locator('.recognised-item')).toHaveText(['Google (employer)']);
 await composer(page).press('Enter');
 await expect(page).toHaveURL(/\/c\/google$/);
 await expect(page.getByRole('heading',{level:1,name:'Google'})).toBeVisible();
 // The employer chip offers both, the twin named with its domain and label.
 await page.locator('[data-chip="company"]').click();
 const filter=page.getByLabel('Filter choices');if(await filter.count())await filter.fill('google');
 const choices=page.getByRole('dialog',{name:'Change Google'});
 await expect(choices.getByRole('button',{name:'Google (google-jobs.io), added by the community'})).toBeVisible();
 await expect(choices.getByRole('button',{name:'Google',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');
 // A third "Google" (legal-form words aside, as the server compares names) names the listings that hold the name and is
 // refused on this device, as the server refuses it: there is no confirmation that overrides it, and nothing is sent.
 await page.goto('/');
 await page.getByRole('button',{name:'Add your employer'}).click();
 await page.getByLabel('Employer name').fill('Google LLC');await page.getByLabel('Work-email domain').fill('google-mail-example.io');
 const note=page.locator('.add-employer-namesake');
 await expect(note).toContainText('Google (google.com) and Google (google-jobs.io), added by the community, are already listed under this name with their own domain. If you work there, open their records instead. A second listing under the same name can’t be added; if this is a different organization, use a name that tells the two apart.');
 await expect(page.locator('.add-employer').getByRole('checkbox')).toHaveCount(0);
 await page.getByRole('button',{name:'Add to the directory'}).click();
 const alert=page.getByRole('alert');
 await expect(alert).toContainText('Google (google.com) is already listed under this name, with its own domain, so a second listing under the same name was not added.');
 await expect(alert.getByRole('link',{name:'Open Google',exact:true})).toHaveAttribute('href','/c/google');
 expect(posted).toEqual([]);
 // The server's own refusals of a listing the device let through name their listing, and the page links to it: here one
 // newer than this page's directory, named with the domain the refusal gives.
 refusals.push({status:409,json:{error:'domain_belongs_to_listed',company:{slug:'acme-acme-io',name:'Acme',domain:'acme.io'}}});
 await page.getByLabel('Employer name').fill('Googlers Club');await page.getByLabel('Work-email domain').fill('acmeio-example.io');
 await expect(note).toHaveCount(0);
 await page.getByRole('button',{name:'Add to the directory'}).click();
 await expect(alert).toContainText('That domain carries the name of Acme (acme.io), an employer already in the directory, so it cannot be listed under another name. Nothing was added.');
 await expect(alert.getByRole('link',{name:'Open Acme (acme.io)'})).toHaveAttribute('href','/c/acme-acme-io');
 // A refusal naming the community twin shows its domain, never the curated employer's bare name.
 refusals.push({status:409,json:{error:'name_already_listed',company:{slug:TWIN.slug,name:'Google',domain:'google-jobs.io'}}});
 await page.getByLabel('Work-email domain').fill('googlersclub.io');
 await page.getByRole('button',{name:'Add to the directory'}).click();
 await expect(alert).toContainText('Google (google-jobs.io) is already listed under this name, with its own domain');
 await expect(alert.getByRole('link',{name:'Open Google (google-jobs.io)'})).toHaveAttribute('href',`/c/${TWIN.slug}`);
 expect(posted).toHaveLength(2);
});

test('the add form refuses on the device what the server’s rules refuse: a domain named after another listing, abusive words in a domain, another domain in the name',async({page})=>{
 const real=((await (await page.request.get('/api/directory')).json()) as {companies:DirectoryCompany[]}).companies;
 test.skip(!real.some(c=>c.slug==='charles-schwab'&&c.aliases?.some(a=>a.alias==='schwab')),'Charles Schwab is not listed with the alias schwab');
 await withConfig(page,listing(true,14));
 const posted:unknown[]=[];
 await page.route('**/api/employers',async route=>{posted.push(route.request().postDataJSON());await route.fulfill({status:500,json:{error:'unexpected'}});});
 await page.goto('/');
 await page.getByRole('button',{name:'Add your employer'}).click();
 const name=page.getByLabel('Employer name'),domain=page.getByLabel('Work-email domain'),add=page.getByRole('button',{name:'Add to the directory'}),alert=page.getByRole('alert');
 // schwab.net is named after Charles Schwab's curated alias, so the server lists it under no other name.
 await name.fill('Globex Holdings');await domain.fill('schwab.net');await add.click();
 await expect(alert).toContainText('That domain carries the name of Charles Schwab, an employer already in the directory, so it cannot be listed under another name. Nothing was added.');
 await expect(alert.getByRole('link',{name:'Open Charles Schwab'})).toHaveAttribute('href','/c/charles-schwab');
 // Words in the domain that accuse someone are refused with the domain named as the problem.
 await domain.fill('globex-is-a-scam.com');await add.click();
 await expect(page.locator('.add-employer-hint').filter({hasText:DOMAIN_ABUSIVE_MESSAGE})).toBeVisible();
 await expect(alert).toContainText(DOMAIN_ABUSIVE_MESSAGE);
 // A name that shows another domain than the one it is listed with.
 await name.fill('Globex (globex.com)');await domain.fill('globex-corp.io');await add.click();
 await expect(alert).toContainText('The name contains a web address other than globex-corp.io, the domain it would be listed with.');
 expect(posted,'nothing reached the server').toEqual([]);
});

test('a work-mailbox verified account names the domain its contributor verified with',async({page,request})=>{
 const base=await controls(request,'northwind-labs');
 test.skip(base.evidence!.testimony.length<2,'the seeded record has fewer than two accounts');
 const [first,second]=base.evidence!.testimony;
 const reply:CanvasResponse={...base,evidence:{...base.evidence!,testimony:[{...first!,verificationDomains:['meta.com','fb.com']},{...second!,verificationDomains:['stripe.com']},...base.evidence!.testimony.slice(2)]}};
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(body.q||body.overrides.company!=='northwind-labs'||Object.keys(body.overrides).length!==1){await route.fallback();return;}await route.fulfill({json:reply});});
 await ready(page,'/c/northwind-labs');
 const accounts=page.locator('.excerpts .account');
 await expect(accounts.nth(0).locator('.account-foot')).toContainText('Verified with a work mailbox at one of meta.com and fb.com');
 await expect(accounts.nth(1).locator('.account-foot')).toContainText('Verified with a work mailbox at stripe.com');
 await expect(page.getByText('(added by the community)',{exact:false})).toHaveCount(0);
 // A domain someone attached to one of our listings (the evidence's communityDomains) says so beside it; the others do not.
 await page.unroute('**/api/canvas');
 const attached:CanvasResponse={...reply,evidence:{...reply.evidence!,company:{...reply.evidence!.company,communityDomains:['fb.com']}}};
 await page.route('**/api/canvas',async route=>{const body=route.request().postDataJSON() as Body;if(body.q||body.overrides.company!=='northwind-labs'||Object.keys(body.overrides).length!==1){await route.fallback();return;}await route.fulfill({json:attached});});
 await ready(page,'/c/northwind-labs');
 await expect(accounts.nth(0).locator('.account-foot')).toContainText('Verified with a work mailbox at one of meta.com and fb.com (added by the community)');
 await expect(accounts.nth(0).locator('.account-foot')).not.toContainText('meta.com (added');
 // An account without the field claims no domain.
 await page.unroute('**/api/canvas');await ready(page,'/c/northwind-labs');
 await expect(page.getByText('Verified with a work mailbox at',{exact:false})).toHaveCount(0);
});

test('a curated employer without a verification domain offers to add one from its empty record; with listing closed nothing is offered',async({page})=>{
 const real=((await (await page.request.get('/api/directory')).json()) as {companies:DirectoryCompany[]}).companies;
 const keys=((await (await page.request.get('/api/proof/keys')).json()) as {keys:Array<{companySlug:string}>}).keys;
 test.skip(!real.some(c=>c.slug==='charles-schwab'&&!c.domains?.length)||keys.some(k=>k.companySlug==='charles-schwab'),'Charles Schwab is not listed without a domain');
 let open=true;await withConfig(page,c=>listing(open,14)(c));
 const posted:Array<{name:string;domain:string;pow:{minute:number;nonce:string}}>=[];let verdict:string|null='unchecked';
 await page.route('**/api/employers',async route=>{
  const body=route.request().postDataJSON() as typeof posted[number];posted.push(body);
  verdict=await checkPow(body.pow,{origin:new URL(page.url()).origin,action:'add-employer',keyId:'',subject:await powSubject.domain(body.domain)},14);
  // Only schwab.com is confirmed here; any other domain becomes its own community listing, as the server decides.
  await route.fulfill({status:201,json:body.domain==='schwab.com'?{listed:true,attached:true,company:{slug:'charles-schwab',name:'Charles Schwab',origin:'curated',domains:['schwab.com']},verification:'pending'}
   :{listed:true,attached:false,company:{slug:'charles-schwab-schwab-careers-net',name:'Charles Schwab',origin:'community',domains:[body.domain]},verification:'pending'}});
 });
 // From the home page, a domain that is not confirmed as the employer's is listed separately, and the result says why.
 await page.goto('/');
 await page.getByRole('button',{name:'Add your employer'}).click();
 await page.getByLabel('Employer name').fill('Charles Schwab');await page.getByLabel('Work-email domain').fill('schwab-careers.net');
 await page.getByRole('button',{name:'Add to the directory'}).click();
 await expect(page.getByRole('heading',{name:'Listed: Charles Schwab (schwab-careers.net)'})).toBeFocused();
 await expect(page.getByText('schwab-careers.net was not confirmed as Charles Schwab’s corporate email domain, so it was listed separately. It is listed as Charles Schwab (schwab-careers.net) and labeled “added by the community”.')).toBeVisible();
 posted.length=0;
 await ready(page,'/c/charles-schwab');
 const card=page.getByRole('region',{name:'Nothing about Charles Schwab is published yet.'});
 await expect(card.getByText('Verification for this employer isn’t set up yet, so contributions about it can’t be verified or submitted yet. Anyone can add its work-email domain.')).toBeVisible();
 await card.getByRole('button',{name:'Add its work-email domain'}).click();
 await expect(card.getByRole('heading',{name:'Add its work-email domain'})).toBeVisible();
 await expect(card.getByLabel('Employer name')).toHaveValue('Charles Schwab');
 await card.getByRole('textbox',{name:/^Work-email domain/}).fill('schwab.com');
 await expect(card.getByText('Charles Schwab is already listed, without a work-email domain. If schwab.com is confirmed as its corporate email domain, it is added to that listing; otherwise, if it passes the other checks, it is listed separately',{exact:false})).toBeVisible();
 await card.getByRole('button',{name:'Add to the directory'}).click();
 const done=card.getByRole('heading',{name:'schwab.com was added to Charles Schwab'});
 await expect(done).toBeFocused();
 expect(posted).toHaveLength(1);expect(posted[0]!.name).toBe('Charles Schwab');expect(verdict).toBeNull();
 // The record now names the domain, labeled as added by the community; verification is still not ready, and the page says
 // so rather than offering a contribution.
 await expect(page.locator('.record-tags .tag-domain')).toHaveText('schwab.com');
 await expect(page.locator('.record-tags .tag-community')).toHaveText('Domain added by the community');
 await expect(card.getByText('Verification with work mailboxes at schwab.com isn’t ready yet',{exact:false})).toBeVisible();
 await expect(card.getByRole('link',{name:'Contribute about it'})).toHaveAttribute('href','/submit?employer=charles-schwab');
 // Listing closed: the record neither offers nor mentions adding a domain.
 open=false;await ready(page,'/c/charles-schwab');
 await expect(page.getByRole('button',{name:'Add its work-email domain'})).toHaveCount(0);
 await expect(page.getByText('Anyone can add its work-email domain',{exact:false})).toHaveCount(0);
});

test('the real listing endpoint: a free-mail domain is refused by its rules through a real proof of work, and a listed domain names its listing (nothing is written)',async({page})=>{
 const config=await (await page.request.get('/api/config')).json() as {employerListing?:{open?:boolean;pow?:{bits?:number}}};
 test.skip(config.employerListing?.open!==true,'this stack does not take listings');
 const bits=config.employerListing!.pow?.bits??20;
 await page.goto('/');
 const origin=new URL(page.url()).origin;
 // Straight to the endpoint (the page would refuse this domain on the device): a stamp bound to this origin reaches the domain rules.
 const pow=await solvePow({origin,action:'add-employer',keyId:'',subject:await powSubject.domain('gmail.com')},{bits});
 const refused=await page.request.post('/api/employers',{data:{name:'Acme Widgets',domain:'gmail.com',pow},headers:{origin}});
 const body=await refused.json() as Record<string,unknown>;
 expect(refused.status()).toBe(422);expect(body.error).toBe('domain_free_mail');
 expect(addErrorMessage(body.error as string,body)).toBe(DOMAIN_MESSAGES.domain_free_mail);
 // Through the page, with a directory that does not show google.com (so the device lets it through): the real server
 // refuses it as already listed and names the listing, which the page links to.
 const real=((await (await page.request.get('/api/directory')).json()) as {companies:DirectoryCompany[]}).companies;
 test.skip(!real.some(c=>c.slug==='google'&&c.domains?.includes('google.com')),'google.com is not listed on this stack');
 await page.route('**/api/directory',route=>route.fulfill({json:{companies:real.map(({domains:_,...c})=>c)}}));
 const replies:number[]=[];page.on('response',r=>{if(new URL(r.url()).pathname==='/api/employers')replies.push(r.status());});
 await page.goto('/');
 await page.getByRole('button',{name:'Add your employer'}).click();
 await page.getByLabel('Employer name').fill('Alphabet Mail');await page.getByLabel('Work-email domain').fill('google.com');
 await page.getByRole('button',{name:'Add to the directory'}).click();
 const alert=page.getByRole('alert');
 await expect(alert).toContainText(ADD_ERRORS.domain_already_listed!,{timeout:20000});
 await expect(alert.getByRole('link',{name:'Open Google'})).toHaveAttribute('href','/c/google');
 expect(replies).toEqual([409]);
 // A name that means a listing with its own domain: the real server refuses it and names that listing.
 await page.getByLabel('Employer name').fill('Google LLC');await page.getByLabel('Work-email domain').fill('googlellc-example-listing.io');
 await page.getByRole('button',{name:'Add to the directory'}).click();
 await expect(alert).toContainText('Google (google.com) is already listed under this name, with its own domain, so a second listing under the same name was not added.',{timeout:20000});
 await expect(alert.getByRole('link',{name:'Open Google'})).toHaveAttribute('href','/c/google');
 // A domain named after a curated alias (schwab, for Charles Schwab), under another name. Without the aliases this page
 // cannot tell, so the real server decides; it refuses and names the listing.
 test.skip(!real.some(c=>c.slug==='charles-schwab'&&!c.domains?.length&&c.aliases?.some(a=>a.alias==='schwab')),'Charles Schwab is not listed with the alias schwab');
 await page.route('**/api/directory',route=>route.fulfill({json:{companies:real.map(({domains:_,aliases:__,...c})=>c)}}));
 await page.goto('/');
 await page.getByRole('button',{name:'Add your employer'}).click();
 await page.getByLabel('Employer name').fill('Globex Holdings');await page.getByLabel('Work-email domain').fill('schwab.net');
 await page.getByRole('button',{name:'Add to the directory'}).click();
 await expect(alert).toContainText('That domain carries the name of Charles Schwab, an employer already in the directory, so it cannot be listed under another name. Nothing was added.',{timeout:20000});
 await expect(alert.getByRole('link',{name:'Open Charles Schwab'})).toHaveAttribute('href','/c/charles-schwab');
 expect(replies).toEqual([409,409,409]);
 // Nothing was written: the directory lists neither name.
 const after=((await (await page.request.get('/api/directory')).json()) as {companies:DirectoryCompany[]}).companies;
 expect(after.filter(c=>/^(Globex Holdings|Google LLC)$/.test(c.name))).toEqual([]);
});
