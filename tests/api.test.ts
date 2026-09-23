import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testEnv,type TestD1} from './d1.ts';
import worker from '../worker/src/index.ts';
import {TRUST_PAGES,SPA_PATHS,SCHEDULED_STEPS,runScheduled,withResources,purgeDailyDigests,firstToday,FOREIGN_SCOPE_NOTE,LIVE_PAUSE_SECONDS,unavailablePage,isPageRoute,httpsRedirect,notFoundPage,wantsPage} from '../worker/src/app.ts';
import {LEGAL_NOTICE} from '../worker/src/legal.ts';
import {baseInterpretation,settleRoute,NEEDS_GENERATION_NOTE} from '../worker/src/interpretation.ts';
import {moderationStatus,moderationHousekeeping} from '../worker/src/moderation.ts';
import {housekeeping} from '../worker/src/submissions.ts';
import {communityHousekeeping} from '../worker/src/community.ts';
import {archiveTransparency} from '../worker/src/ledger.ts';
import {CRISIS_RESOURCES} from '../shared/safety.ts';
import {CONTACT,CONTACT_MAIL} from '../shared/brand.ts';
import {digest,quarter} from '../shared/proof.ts';
import type {Env,Interpretation} from '../worker/src/types.ts';

type Json=Record<string,any>;
const jev=(patch:Partial<Interpretation>={}):Interpretation=>({...baseInterpretation(),source:'jev',provider:'typesafe-api',model:'jev-test',...patch});
const confident=()=>jev({company:{value:'northwind-labs',confidence:.95,probabilities:{}},topic:{value:'promotion',confidence:.9,probabilities:{}},view:{value:'overview',confidence:.9,probabilities:{}}});
const zero={private_identity:0,contextual_identity:0,threat:0,doxxing:0,personal_attack:0,promotional:0,manipulation:0};
function stub(handlers:Record<string,(body:Json)=>Response|Promise<Response>>,calls:string[]=[],bodies:Json[]=[]) {
 return {fetch:async(url:string|Request,init?:RequestInit)=>{
  const path=new URL(typeof url==='string'?url:url.url).pathname,body=JSON.parse(String(init?.body??'{}')) as Json;calls.push(path);bodies.push(body);
  const h=handlers[path];return h?h(body):Response.json({error:'not_found'},{status:404});
 }} as unknown as Fetcher;
}
const request=(path:string,payload?:unknown,headers:Record<string,string>={})=>new Request(`http://localhost${path}`,payload===undefined?{}:{method:'POST',body:JSON.stringify(payload),headers:{'content-type':'application/json',...headers}});
const post=(env:Env,path:string,payload:unknown,headers:Record<string,string>={})=>worker.fetch(request(path,payload,headers),env);
const get=(env:Env,path:string)=>worker.fetch(request(path),env);
/** Every row of every table, so a test can prove a request stored nothing. */
function snapshot(db:TestD1) {
 const tables=(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as {name:string}[]).map(t=>t.name);
 return Object.fromEntries(tables.map(t=>[t,db.db.prepare(`SELECT * FROM "${t}"`).all()]));
}
function addAccount(db:TestD1,id:string,body:string,o:{company?:string;cohort?:string|null;layer?:string}={}) {
 db.prepare("INSERT INTO testimony(id,company_id,cohort_id,layer,body,period,event_id,verification_class,release_batch,published_at,withdrawn_at) VALUES(?,?,?,?,?,'2026-Q1',NULL,'Verified employment relationship with Northwind Labs at the time described','batch-2026-h1','2026-Q2',NULL)").bind(id,o.company??'co-northwind',o.cohort??null,o.layer??'experience',body).raw();
}
async function addHeld(intake:TestD1,capability:string) {
 const values:Json={id:`held-${capability}`,company_id:'co-northwind',company_slug:'northwind-labs',body:'My team discussed priorities openly and the workload was reasonable for the whole quarter.',layer:'experience',period:quarter(),answers_json:'{}',author_key_json:'{}',capability_hash:await digest(capability),content_hash:'h',verification_class:'demo',status:'held',eligible_at:'2020-01-01T00:00:00Z',publication_period:quarter(),revision:0,privacy_json:'[]',created_day:new Date().toISOString().slice(0,10),held_on:new Date().toISOString().slice(0,10),hold_reason:'jury'};
 intake.prepare(`INSERT INTO submissions(${Object.keys(values).join(',')}) VALUES(${Object.keys(values).map(()=>'?').join(',')})`).bind(...Object.values(values)).raw();
}

test('withdrawing an unknown capability answers 404 and removes nothing; a real withdrawal asks for a vector sweep',async()=>{
 const {env,publicDb,intake}=testEnv(),calls:string[]=[],waits:Promise<unknown>[]=[];
 env.INFERENCE=stub({'/sweep':()=>Response.json({removed:0})},calls);
 const ctx={waitUntil:(p:Promise<unknown>)=>{waits.push(p);},passThroughOnException(){}} as unknown as ExecutionContext;
 const before=snapshot(publicDb);
 const missing=await worker.fetch(request('/api/withdraw',{capability:'cap-nobody-has-this'}),env,ctx);
 assert.equal(missing.status,404);assert.deepEqual(await missing.json(),{withdrawn:false,error:'not_found'});
 assert.deepEqual(snapshot(publicDb),before);assert.equal(waits.length,0,'nothing to sweep when nothing was withdrawn');
 await addHeld(intake,'cap-held-1');
 const done=await worker.fetch(request('/api/withdraw',{capability:'cap-held-1'}),env,ctx);
 assert.equal(done.status,200);assert.equal((await done.json() as Json).withdrawn,true);
 await Promise.all(waits);assert.deepEqual(calls,['/sweep']);
 assert.equal((await post(env,'/api/withdraw',{capability:'cap-held-1',extra:true})).status,400,'strict body');
});

test('signed revise requests share the screening limiter; status requests never consume it',async()=>{
 const {env}=testEnv(),keys:string[]=[];
 env.INFER_LIMIT={limit:async({key})=>{keys.push(key);return {success:false};}};
 const revise=await post(env,'/api/author',{action:'revise',capability:'cap-x',revision:0,signature:'sig',body:'A revised account of the planning process that names nobody at all.',screeningConsent:true});
 assert.equal(revise.status,429);assert.deepEqual(await revise.json(),{error:'rate_limited'});
 const status=await post(env,'/api/author',{action:'status',capability:'cap-x'});
 assert.notEqual(status.status,429);assert.equal(keys.length,1,'status does not touch the limiter');
 const screen=await post(env,'/api/screen',{approvedText:'My team discussed priorities openly and the workload was reasonable for the whole quarter.',consent:true});
 assert.equal(screen.status,429);assert.equal(keys[1],keys[0],'revise and screening are one budget per client');
 assert.ok(keys.every(k=>/^[A-Za-z0-9_-]{43}$/.test(k)),'limiter keys are digests');
});

test('reader pages 1 to 24 page the same filters without re-interpretation, retrieval or ranking; other page values are rejected',async()=>{
 const {env,publicDb}=testEnv(),calls:string[]=[],limited:string[]=[];
 for(let k=0;k<45;k++)addAccount(publicDb,`page-${String(k).padStart(2,'0')}`,'The cafeteria menu rotated weekly and the coffee machine was usually working.');
 env.INFERENCE=stub({'/intent':()=>Response.json(confident()),'/retrieve':()=>Response.json({ids:[],available:false}),'/rank':b=>Response.json({scores:(b.ids as string[]).map(id=>({id,relevance:.5}))})},calls);
 const ask={q:'How are promotions?',slug:'northwind-labs'};
 const first=await (await post(env,'/api/canvas',{...ask,overrides:{view:'reader',topic:null}})).json() as Json;
 assert.deepEqual(calls,['/intent','/retrieve','/rank']);assert.equal(first.evidence.testimonyPaging.page,0);assert.equal(first.evidence.testimonyPaging.hasMore,true);
 calls.length=0;
 env.INFER_LIMIT={limit:async({key})=>{limited.push(key);return {success:true};}};
 // Even a submit-mode request with its question pages only the filters it sends: nothing is re-read from the question.
 const second=await (await post(env,'/api/canvas',{...ask,overrides:{view:'reader',topic:null,page:1}})).json() as Json;
 assert.deepEqual(calls,[],'no interpretation, retrieval or ranking beyond the first page');assert.deepEqual(limited,[],'paging spends no search budget');
 assert.equal(second.degraded,false);assert.equal(second.interpretation.source,'fallback');
 assert.equal(second.evidence.testimonyPaging.page,1);assert.equal(second.evidence.testimonyPaging.hasMore,false);
 const seen=new Set([...first.evidence.testimony,...second.evidence.testimony].map((t:Json)=>t.id));assert.equal(seen.size,first.evidence.testimonyPaging.matching);
 assert.equal(second.interpretation.route,'evidence');
 for(const page of [25,-1,1.5,'2',null])assert.equal((await post(env,'/api/canvas',{q:'',slug:'northwind-labs',mode:'controls',overrides:{page}})).status,400,String(page));
});

test('crisis language returns support resources to the asker only: nothing is stored, logged or forwarded',async()=>{
 const {env,publicDb,intake}=testEnv(),calls:string[]=[],bodies:Json[]=[];
 env.CRISIS_RESOURCES_ENABLED='true';
 env.INFERENCE=stub({'/intent':()=>Response.json(confident()),'/retrieve':()=>Response.json({ids:[],available:false}),'/rank':()=>Response.json({scores:[]}),'/screen':()=>Response.json({decision:{action:'clear',policyVersion:'0',rules:[],explanations:[]},signals:zero,model:'test'})},calls,bodies);
 const publicBefore=snapshot(publicDb),intakeBefore=snapshot(intake);
 const q='I keep thinking about ending my life. How are promotions at Northwind Labs?';
 const data=await (await post(env,'/api/canvas',{q,slug:'northwind-labs'})).json() as Json;
 assert.deepEqual(data.resources,CRISIS_RESOURCES);assert.ok(data.evidence,'the canvas still answers the question');
 assert.deepEqual(bodies[0],{query:q,currentSlug:'northwind-labs'},'the intent call carries nothing extra');
 for(const b of bodies)assert.ok(!/resources|crisis|self_harm|988/.test(JSON.stringify(b)));
 assert.deepEqual(snapshot(publicDb),publicBefore);assert.deepEqual(snapshot(intake),intakeBefore);
 for(const plain of ['How are promotions at Northwind Labs?','I am killing it at work but the deadline is killing me'])
  assert.equal('resources'in(await (await post(env,'/api/canvas',{q:plain,slug:'northwind-labs'})).json() as Json),false,plain);
 calls.length=0;
 const refused=await post(env,'/api/canvas',{q:'I want to end my life. Email me at jane.doe@example.com',slug:'northwind-labs'});
 assert.equal(refused.status,422);assert.deepEqual((await refused.json() as Json).resources,CRISIS_RESOURCES);assert.deepEqual(calls,[],'refused before any inference call');
 const screened=await (await post(env,'/api/screen',{approvedText:'Leadership ignored every concern we raised. Lately I have been thinking about ending my life.',consent:true})).json() as Json;
 assert.deepEqual(screened.resources,CRISIS_RESOURCES);assert.equal('selfHarmResources'in screened,false);
 const calm=await (await post(env,'/api/screen',{approvedText:'My team discussed priorities openly and the workload was reasonable for the whole quarter.',consent:true})).json() as Json;
 assert.equal('resources'in calm,false);
 assert.deepEqual(snapshot(publicDb),publicBefore);
});

test('a foreign event is refused by the evidence compiler and never broadened to the full history',async()=>{
 const {env}=testEnv();
 const data=await (await post(env,'/api/canvas',{q:'',slug:'northwind-labs',mode:'controls',overrides:{event:'ev-he-rto-2025',timeframe:'after_event'}})).json() as Json;
 assert.equal(data.evidence.timeStatus,'not_applied');assert.deepEqual(data.evidence.metrics,[],'nothing time-scoped is shown');
 assert.ok(data.notices.includes('The selected event is not documented for Northwind Labs, so it was not applied and no before/after results are shown.'));
 assert.ok(!data.notices.some((n:string)=>n.startsWith('That event is not documented')),'no duplicate notice');
 assert.equal(data.interpretation.event.value,'ev-he-rto-2025');assert.equal(data.interpretation.timeframe,'after_event');
 const fork=data.interpretation.forks.find((f:Json)=>f.field==='event');assert.ok(fork);assert.ok(fork.options.every((o:Json)=>o.id.startsWith('ev-nw-')));
 assert.equal(data.keepCanvas,true);assert.match(data.answer.headline,/^Before\/after results need a documented, dated event/);
 const timeline=await (await post(env,'/api/canvas',{q:'',slug:'northwind-labs',mode:'controls',overrides:{event:'ev-he-rto-2025',view:'timeline'}})).json() as Json;
 assert.ok(timeline.notices.includes('The selected event is not documented for Northwind Labs, so it was not applied.'));assert.equal(timeline.keepCanvas,false,'no before/after was requested, so nothing is asked');
});

test('comparison responses carry the comparison table and add its own notes exactly once',async()=>{
 const {env}=testEnv();
 const data=await (await post(env,'/api/canvas',{q:'',slug:'northwind-labs',mode:'controls',overrides:{view:'compare',compareTo:'helios-semiconductor',cohort:'Engineering'}})).json() as Json;
 assert.ok(data.comparisonTable.rows.length>0);assert.equal(data.comparisonTable.left.company.slug,'northwind-labs');assert.equal(data.comparisonTable.right.company.slug,'helios-semiconductor');
 assert.equal(new Set(data.notices).size,data.notices.length,'no notice repeats');
 assert.equal(data.notices.filter((n:string)=>n.startsWith('Groups are defined by each employer')).length,1);
 assert.ok(data.notices.some((n:string)=>n.startsWith('Helios Semiconductor: ')));
 assert.equal(data.interpretation.route,'comparison');assert.equal(data.answer.route,'comparison');
 const single=await (await post(env,'/api/canvas',{q:'',slug:'northwind-labs',mode:'controls'})).json() as Json;
 assert.equal('comparisonTable'in single,false);
});

test('one account scan per request: ranking candidates come from the same pool and the same chips as the page',async()=>{
 const {env,publicDb}=testEnv(),ranked:string[][]=[],scans:string[]=[];
 const prepare=publicDb.prepare.bind(publicDb);
 (publicDb as unknown as {prepare:(sql:string)=>unknown}).prepare=(sql:string)=>{if(sql.includes('FROM testimony t LEFT JOIN events e'))scans.push(sql);return prepare(sql);};
 env.INFERENCE=stub({'/intent':()=>Response.json(confident()),'/retrieve':()=>Response.json({ids:[],available:false}),'/rank':b=>{ranked.push(b.ids);return Response.json({scores:[]});}});
 const data=await (await post(env,'/api/canvas',{q:'Were sales quotas changed after the quarter?',slug:'northwind-labs',overrides:{cohort:'Sales',topic:null}})).json() as Json;
 assert.equal(scans.length,1,'accounts are read and scanned once');assert.deepEqual(ranked,[['t-003']]);
 assert.deepEqual(data.evidence.testimony.map((t:Json)=>t.id),['t-003']);
});

test('semantic candidates are used only when they pass the page filters; a retrieval failure falls back to lexical ranking',async()=>{
 const {env}=testEnv(),ranked:string[][]=[];let retrieveFails=false;
 env.INFERENCE=stub({'/intent':()=>Response.json(confident()),'/retrieve':()=>retrieveFails?Response.json({error:'x'},{status:503}):Response.json({ids:['t-004','t-007','ghost','t-006',42],available:true}),'/rank':b=>{ranked.push(b.ids);return Response.json({scores:[]});}});
 await post(env,'/api/canvas',{q:'Is leadership disconnected?',slug:'northwind-labs',overrides:{topic:null}});
 assert.deepEqual(ranked[0]!.slice(0,2),['t-004','t-006']);assert.ok(!ranked[0]!.some(id=>['t-007','ghost'].includes(id)),'another employer\'s or unknown ids never pass');
 retrieveFails=true;
 const fallback=await (await post(env,'/api/canvas',{q:'Is leadership disconnected?',slug:'northwind-labs',overrides:{topic:null}})).json() as Json;
 assert.ok(ranked[1]!.length>0);assert.ok(fallback.evidence.testimony.length>0);
});

test('legacy route values from an older inference worker are mapped, not degraded',async()=>{
 const {env}=testEnv();let reading:Json=confident();
 env.INFERENCE=stub({'/intent':()=>Response.json(reading),'/retrieve':()=>Response.json({ids:[]}),'/rank':()=>Response.json({scores:[]})});
 reading={...confident(),route:'company'};
 const company=await (await post(env,'/api/canvas',{q:'How are promotions?',slug:'northwind-labs'})).json() as Json;
 assert.equal(company.degraded,false);assert.equal(company.interpretation.route,'metric_view');assert.ok(company.evidence);
 reading={...confident(),route:'unsupported',clarify:true};
 const unsafe=await (await post(env,'/api/canvas',{q:'Where does my manager live?',slug:'northwind-labs'})).json() as Json;
 assert.equal(unsafe.interpretation.route,'cannot_safely_answer');assert.equal(unsafe.evidence,null);assert.equal(unsafe.answer,null);assert.equal(unsafe.keepCanvas,true);
 reading={...confident(),route:'shouting'};
 assert.equal((await (await post(env,'/api/canvas',{q:'How are promotions?',slug:'northwind-labs'})).json() as Json).degraded,true,'unknown values still fail closed');
});

test('trust, legal and app routes are wired with security headers; unknown paths fall through moderation to 404',async()=>{
 const {env}=testEnv();
 assert.ok(TRUST_PAGES.includes('terms')&&TRUST_PAGES.includes('accessibility'));assert.ok(SPA_PATHS.includes('/jury')&&SPA_PATHS.includes('/status'));
 for(const path of ['/terms','/accessibility','/privacy']) {
  const r=await get(env,path);assert.equal(r.status,200,path);assert.match(r.headers.get('content-type')??'',/text\/html/);assert.ok(r.headers.get('content-security-policy'));
 }
 for(const path of ['/jury','/status','/c/northwind-labs','/submit']) {
  const r=await get(env,path);assert.equal(r.status,200,path);assert.ok((await r.text()).includes('app-root'),path);
 }
 const wrong=await post(env,'/jury',{});assert.equal(wrong.status,405,'app routes are GET only');assert.equal(wrong.headers.get('allow'),'GET, HEAD');
 const manifest=await get(env,'/.well-known/siwt-release.json');
 assert.match(manifest.headers.get('content-type')??'',/json/);assert.ok(manifest.headers.get('content-security-policy'));
 if(manifest.status!==200){assert.equal(manifest.status,404);assert.deepEqual(await manifest.json(),{error:'no_release_manifest'});}
 const og=await get(env,'/og/unknown-image.png');assert.equal(og.status,404);assert.deepEqual(await og.json(),{error:'not_found'});
 const unknown=await get(env,'/api/does-not-exist');assert.equal(unknown.status,404);assert.deepEqual(await unknown.json(),{error:'not_found'});assert.ok(unknown.headers.get('strict-transport-security')===null||unknown.headers.get('strict-transport-security')!.startsWith('max-age='));
});

test('plain HTTP is redirected permanently to the same path and query over HTTPS, with HSTS, before anything is read; local and development stacks are not',async()=>{
 // Production journey (2026-09-23): http://shouldiworkthere.com/jury and a POST to http://…/api/canvas answered 200 over plaintext.
 const {env}=testEnv();const production={...env,ENVIRONMENT:'production'} as Env;
 let touched=0;const count=<T extends object>(target:T)=>new Proxy(target,{get:(t,p)=>{touched++;return Reflect.get(t,p);}});
 const watched={...production,DB:count(production.DB),INTAKE:count(production.INTAKE),INFERENCE:count(production.INFERENCE!)} as Env;
 const HSTS='max-age=63072000; includeSubDomains';
 for(const [method,path] of [['GET','/jury?x=1&y=2'],['GET','/'],['HEAD','/privacy'],['POST','/api/canvas'],['POST','/api/submit'],['GET','/api/config']] as const) {
  const r=await worker.fetch(new Request(`http://shouldiworkthere.com${path}`,{method,...(method==='POST'?{body:JSON.stringify({q:'how are promotions at Northwind Labs'}),headers:{'content-type':'application/json',origin:'http://shouldiworkthere.com'}}:{})}),watched);
  assert.equal(r.status,301,`${method} ${path}`);assert.equal(r.headers.get('location'),`https://shouldiworkthere.com${path}`,`${method} ${path}`);
  assert.equal(r.headers.get('strict-transport-security'),HSTS,'the redirect keeps HSTS');assert.equal(await r.text(),'','a redirect carries no body');
 }
 assert.equal(touched,0,'no database or inference call is made over plain HTTP');
 const secure=await worker.fetch(new Request('https://shouldiworkthere.com/privacy'),production);assert.equal(secure.status,200);assert.equal(secure.headers.get('strict-transport-security'),HSTS);
 // A local machine is plain HTTP by design; so is a development stack, which `wrangler dev` hands the custom-domain route's
 // host (http://shouldiworkthere.com/…) and whose redirects it rewrites back to localhost: redirecting there looped.
 for(const url of ['http://localhost/privacy','http://127.0.0.1:8788/privacy'])assert.equal((await worker.fetch(new Request(url),production)).status,200,url);
 const development={...env,ENVIRONMENT:'development'} as Env;
 const dev=await worker.fetch(new Request('http://shouldiworkthere.com/privacy'),development);assert.equal(dev.status,200);assert.equal(dev.headers.get('strict-transport-security'),null);
 assert.equal(httpsRedirect(new Request('http://verify.shouldiworkthere.com/keys?a=1'),production)?.headers.get('location'),'https://verify.shouldiworkthere.com/keys?a=1');
 assert.equal(httpsRedirect(new Request('https://shouldiworkthere.com/'),production),null);assert.equal(httpsRedirect(new Request('http://[::1]:8788/'),production),null);
});

test('an employer the directory does not list is a 404 document that still serves the app shell; an unknown page opened in a browser gets a small HTML 404, API callers JSON',async()=>{
 // Production journey (2026-09-23): /c/acmewidgets answered 200 (a soft 404), and /nope opened in a browser showed the raw
 // {"error":"not_found"} body.
 const {env}=testEnv();
 const browse=(path:string,init:RequestInit={})=>worker.fetch(new Request(`http://localhost${path}`,{...init,headers:{accept:'text/html,application/xhtml+xml,*/*;q=0.8',...init.headers as Record<string,string>}}),env);
 const unknown=await browse('/c/acmewidgets');
 assert.equal(unknown.status,404);assert.match(unknown.headers.get('content-type')??'',/text\/html/);assert.ok(unknown.headers.get('content-security-policy'));
 const shell=await unknown.text();assert.ok(shell.includes('app-root'),'the app shell still renders the honest "not in the directory" state');
 assert.match(shell,/<title>Employer not found — /);assert.doesNotMatch(shell,/<title>[^<]*know the workplace/,'never the generic home title');
 assert.equal((await get(env,'/c/acmewidgets')).status,404,'whatever the Accept header');
 assert.equal((await browse('/c/northwind-labs')).status,200);assert.equal((await browse('/c/northwind-labs?view=distribution')).status,200);
 const head=await browse('/c/acmewidgets',{method:'HEAD'});assert.equal(head.status,404);assert.equal(await head.text(),'');
 for(const path of ['/nope','/c/Not A Slug','/jury/extra','/c/northwind-labs/more']) {
  const r=await browse(path);assert.equal(r.status,404,path);assert.match(r.headers.get('content-type')??'',/text\/html/,path);assert.ok(r.headers.get('content-security-policy'),path);
  const page=await r.text();assert.match(page,/There is no page at this address\./,path);assert.ok(page.includes('<a href="/">Go to the home page</a>'),path);assert.match(page,/<meta name="robots" content="noindex">/,path);
  assert.ok(page.includes('/app.css?v='),'in the site\'s style');assert.doesNotMatch(page,/<script(?![^>]*src="\/theme\.js)/,'no inline script (CSP script-src \'self\')');
 }
 // API callers, files, archives and non-GET requests keep the JSON 404 they parse.
 for(const [path,method] of [['/api/nope','GET'],['/og/unknown-image.png','GET'],['/archives/nope','GET'],['/nope.json','GET'],['/.well-known/nope','GET'],['/nope','DELETE']] as const) {
  const r=await browse(path,{method});assert.equal(r.status,404,`${method} ${path}`);assert.deepEqual(await r.json(),{error:'not_found'},`${method} ${path}`);
 }
 assert.deepEqual(await (await get(env,'/nope')).json(),{error:'not_found'},'without Accept: text/html the caller gets JSON');
 assert.equal(wantsPage(new Request('http://x/nope',{headers:{accept:'text/html'}}),'/nope'),true);assert.equal(wantsPage(new Request('http://x/nope',{headers:{accept:'application/json'}}),'/nope'),false);
 const page=notFoundPage('build"1');assert.equal(page.status,404);assert.ok((await page.text()).includes('/app.css?v=build%221'),'the build id is URL-encoded');
});

test('a failing page route answers with a page, never a raw JSON body; a failed trust-page read is tried once more; API routes keep JSON',async()=>{
 // e2e (2026-09-22): GET /finances once returned 503 {"error":"request_failed"} as JSON in the browser, when a local D1
 // read failed with "internal error"; the next four requests succeeded.
 const {env,publicDb}=testEnv();let failures=0;
 const failing=(sql:string)=>failures>0&&(/financial_entries|FROM companies/.test(sql));
 env.DB={prepare:(sql:string)=>{
  const statement=publicDb.prepare(sql);
  if(!failing(sql))return statement;
  failures--;const fail=async()=>{throw new Error('D1_ERROR: internal error; reference = test');};
  return {...statement,bind:()=>({...statement,first:fail,all:fail,run:fail}),first:fail,all:fail,run:fail};
 },batch:(s:unknown)=>publicDb.batch(s as never),exec:(sql:string)=>publicDb.exec(sql)} as unknown as D1Database;
 failures=1;
 const retried=await get(env,'/finances');
 assert.equal(retried.status,200,'one transient read failure is retried');assert.match(await retried.text(),/Nothing to subscribe to\./);assert.equal(failures,0);
 failures=Infinity;
 for(const path of ['/finances']) {
  const r=await get(env,path),text=await r.text();
  assert.equal(r.status,503,path);assert.match(r.headers.get('content-type')??'',/^text\/html/,path);assert.equal(r.headers.get('retry-after'),'5');
  assert.ok(r.headers.get('content-security-policy'),'the page keeps every security header');
  assert.match(text,/<h1>This page could not be loaded\.<\/h1>/);assert.match(text,/<a href="\/finances">Try again<\/a>/);
  assert.ok(!/request_failed|internal error|D1_ERROR/.test(text),'the page names nothing about the failure');
 }
 // An API caller still gets the JSON error it parses.
 const api=await get(env,'/api/directory');assert.equal(api.status,503);assert.deepEqual(await api.json(),{error:'request_failed'});
 // The retry link is escaped, whatever path it repeats.
 const odd=await unavailablePage('/c/a"onmouseover=x').text();assert.ok(odd.includes('href="/c/a&quot;onmouseover=x"'));assert.ok(unavailablePage('/api/x').status===503);
 assert.ok((await unavailablePage('/api/x').text()).includes('<a href="/">Try again</a>'),'a non-page path is never repeated as a link');
 assert.ok(isPageRoute('/finances')&&isPageRoute('/c/stripe')&&isPageRoute('/')&&isPageRoute('/status')&&!isPageRoute('/api/canvas'));
});

test('/api/config reports moderation switches from the moderation module and legal contacts from one source',async()=>{
 const {env}=testEnv();
 const config=await (await get(env,'/api/config')).json() as Json,status=await moderationStatus(env);
 assert.deepEqual(config.moderation,status);assert.equal(config.juryEnabled,status.juryEnabled);
 assert.deepEqual(config.legal.contact,{...CONTACT});assert.equal(config.legal.contactReceivesMail,CONTACT_MAIL.routingEnabled&&CONTACT_MAIL.forwardingVerified,'mail is received only once routing is on and delivery was verified');
 assert.ok(Array.isArray(config.legal.links)&&config.legal.links.some((l:Json)=>l.href==='/terms'));
 // The operator comes from the legal module's one export, never restated here.
 assert.equal(config.legal.operator,LEGAL_NOTICE.operator);assert.ok(config.legal.operator.length>0);
});

test('the scheduled job completes publication housekeeping, moderation housekeeping and the archive',async()=>{
 const {env,publicDb}=testEnv(),puts:string[]=[];
 env.ARCHIVES={put:async(key:string)=>{puts.push(key);},get:async()=>null} as unknown as R2Bucket;
 const before=((await publicDb.prepare('SELECT COUNT(*) AS n FROM release_manifests').first()) as {n:number}).n;
 await worker.scheduled({} as ScheduledController,env);
 const after=((await publicDb.prepare('SELECT COUNT(*) AS n FROM release_manifests').first()) as {n:number}).n;
 assert.ok(after>before||puts.length>0,'the transparency archive step ran');
});

test('route settlement: unsafe and unlisted stay, needs_generation survives chip edits but not a chosen view, existing_faq only while unedited',()=>{
 const at=(route:string,view='overview')=>({route,view:{value:view,confidence:1,probabilities:{}}}) as Pick<Interpretation,'route'|'view'>;
 assert.equal(settleRoute(at('unsupported')),'cannot_safely_answer');assert.equal(settleRoute(at('cannot_safely_answer'),{view:true,any:true}),'cannot_safely_answer');
 assert.equal(settleRoute(at('unlisted'),{view:true}),'unlisted');
 assert.equal(settleRoute(at('company','reader')),'evidence');assert.equal(settleRoute(at('clarify','compare')),'comparison');
 assert.equal(settleRoute(at('needs_generation'),{any:true}),'needs_generation');assert.equal(settleRoute(at('needs_generation','timeline'),{view:true,any:true}),'timeline');
 assert.equal(settleRoute(at('existing_faq')),'existing_faq');assert.equal(settleRoute(at('existing_faq'),{any:true}),'metric_view');
 assert.equal(settleRoute(at('metric_view','cohort')),'cohort');
});

test('the canonical question is recomputed for what is shown after the reader edits it, including on later reader pages',async()=>{
 const {env}=testEnv();
 env.INFERENCE=stub({'/intent':()=>Response.json({...confident(),route:'existing_faq',canonicalQuestion:'q1:promotion:overview'}),'/retrieve':()=>Response.json({ids:[]}),'/rank':()=>Response.json({scores:[]})});
 const ask={q:'Are promotions fair at Northwind Labs?',slug:'northwind-labs'};
 const plain=await (await post(env,'/api/canvas',ask)).json() as Json;
 assert.equal(plain.interpretation.route,'existing_faq');assert.equal(plain.interpretation.canonicalQuestion,'q1:promotion:overview');assert.equal(plain.answer.route,'existing_faq');
 const edited=await (await post(env,'/api/canvas',{...ask,overrides:{topic:'management'}})).json() as Json;
 assert.equal(edited.interpretation.route,'metric_view');assert.equal(edited.interpretation.canonicalQuestion,'q1:management:overview');
 const paged=await (await post(env,'/api/canvas',{q:'',slug:'northwind-labs',mode:'controls',overrides:{company:'northwind-labs',topic:'promotion',view:'overview',page:1}})).json() as Json;
 assert.equal(paged.interpretation.canonicalQuestion,'q1:promotion:overview');assert.equal(paged.interpretation.route,'metric_view');
 const compared=await (await post(env,'/api/canvas',{...ask,overrides:{view:'compare',compareTo:'helios-semiconductor'}})).json() as Json;
 assert.equal(compared.interpretation.canonicalQuestion,null,'a comparison is not a standard single-employer question');
});

test('server-side crisis resources stay off until CRISIS_RESOURCES_ENABLED is set, and the screening flag never reaches the client',async()=>{
 const {env}=testEnv(),bodies:Json[]=[];
 env.INFERENCE=stub({'/intent':()=>Response.json(confident()),'/retrieve':()=>Response.json({ids:[]}),'/rank':()=>Response.json({scores:[]}),'/screen':()=>Response.json({decision:{action:'clear',policyVersion:'0',rules:[],explanations:[]},signals:zero,model:'test',selfHarmResources:true})},[],bodies);
 const q='I keep thinking about ending my life. How are promotions at Northwind Labs?';
 assert.equal('resources'in(await (await post(env,'/api/canvas',{q,slug:'northwind-labs'})).json() as Json),false,'the canvas adds nothing while off');
 const screened=await (await post(env,'/api/screen',{approvedText:'Leadership ignored every concern we raised. Lately I have been thinking about ending my life.',consent:true})).json() as Json;
 assert.equal('resources'in screened,false);assert.equal('selfHarmResources'in screened,false,'the flag is stripped even while off');
 assert.ok(!bodies.some(b=>'resources'in b||'selfHarmResources'in b));
 // The conversion applied to screen, submit and revise replies (submissions.ts decides whether the flag is passed on).
 const on={CRISIS_RESOURCES_ENABLED:'true'},calmText='The planning meetings were open.',crisisText='Lately I have been thinking about ending my life.';
 assert.deepEqual(withResources(on,{ok:true,selfHarmResources:true},calmText),{ok:true,resources:CRISIS_RESOURCES});
 assert.deepEqual(withResources(on,{ok:true,selfHarmResources:false},crisisText),{ok:true,resources:CRISIS_RESOURCES},'the lexicon still applies');
 assert.deepEqual(withResources(on,{ok:true,selfHarmResources:'yes'},calmText),{ok:true},'only a literal true counts');
 assert.deepEqual(withResources({},{ok:true,selfHarmResources:true},crisisText),{ok:true},'off: stripped, nothing added');
});

test('submit and revise replies carry support resources for crisis language, even when the request fails, and store nothing',async()=>{
 const {env,publicDb,intake}=testEnv(),keys:string[]=[];env.CRISIS_RESOURCES_ENABLED='true';
 const publicBefore=snapshot(publicDb),intakeBefore=snapshot(intake);
 const text='Leadership ignored every concern we raised for a year. Lately I have been thinking about ending my life.';
 const submitted=await post(env,'/api/submit',{body:text,company:'northwind-labs'});
 assert.ok(submitted.status>=400);const s=await submitted.json() as Json;assert.equal(typeof s.error,'string');assert.deepEqual(s.resources,CRISIS_RESOURCES);
 const calm=await (await post(env,'/api/submit',{body:'My team discussed priorities openly and the workload was reasonable.',company:'northwind-labs'})).json() as Json;
 assert.equal('resources'in calm,false);
 const revise={action:'revise',capability:'cap-nobody-has-this',revision:0,signature:'sig',body:text,screeningConsent:true};
 const failed=await post(env,'/api/author',revise);assert.ok(failed.status>=400);assert.deepEqual((await failed.json() as Json).resources,CRISIS_RESOURCES);
 env.INFER_LIMIT={limit:async({key})=>{keys.push(key);return {success:false};}};
 const limited=await post(env,'/api/author',revise);assert.equal(limited.status,429);
 assert.deepEqual(await limited.json(),{error:'rate_limited',resources:CRISIS_RESOURCES});
 const status=await (await post(env,'/api/author',{action:'status',capability:'cap-nobody-has-this'})).json() as Json;
 assert.equal('resources'in status,false,'only revised text is checked');
 assert.deepEqual(snapshot(publicDb),publicBefore);assert.deepEqual(snapshot(intake),intakeBefore);
});

test('discovery, unlisted and unsafe outcomes carry no canonical question, and the generation notice follows the route',async()=>{
 const {env}=testEnv();let reading:Json={...confident(),canonicalQuestion:'q1:promotion:overview'};
 env.INFERENCE=stub({'/intent':()=>Response.json(reading),'/retrieve':()=>Response.json({ids:[]}),'/rank':()=>Response.json({scores:[]})});
 const ask={q:'How are promotions at Northwind Labs?',slug:'northwind-labs'};
 const cleared=await (await post(env,'/api/canvas',{...ask,slug:null,overrides:{company:null}})).json() as Json;
 assert.equal(cleared.view,'discovery');assert.equal(cleared.interpretation.canonicalQuestion,null);
 const unlisted=await (await post(env,'/api/canvas',{...ask,overrides:{company:'unlisted'}})).json() as Json;
 assert.equal(unlisted.interpretation.route,'unlisted');assert.equal(unlisted.interpretation.canonicalQuestion,null);
 reading={...confident(),route:'cannot_safely_answer',canonicalQuestion:'q1:promotion:overview'};
 const unsafe=await (await post(env,'/api/canvas',ask)).json() as Json;
 assert.equal(unsafe.interpretation.canonicalQuestion,null);
 reading={...confident(),route:'needs_generation',notes:[NEEDS_GENERATION_NOTE]};
 const generation=await (await post(env,'/api/canvas',ask)).json() as Json;
 assert.equal(generation.notices.filter((n:string)=>n===NEEDS_GENERATION_NOTE).length,1);
 const viewed=await (await post(env,'/api/canvas',{...ask,overrides:{view:'reader'}})).json() as Json;
 assert.equal(viewed.interpretation.route,'evidence');assert.ok(!viewed.notices.includes(NEEDS_GENERATION_NOTE));assert.ok(!viewed.interpretation.notes.includes(NEEDS_GENERATION_NOTE));
});

test('a cohort question without a group asks before anything is ranked, and an employer without groups is told so',async()=>{
 const {env}=testEnv(),calls:string[]=[];
 env.INFERENCE=stub({'/intent':()=>Response.json({...confident(),view:{value:'cohort',confidence:.9,probabilities:{}},route:'cohort'}),'/retrieve':()=>Response.json({ids:[]}),'/rank':()=>Response.json({scores:[]})},calls);
 const data=await (await post(env,'/api/canvas',{q:'How do teams compare with the whole company at Northwind Labs?',slug:'northwind-labs'})).json() as Json;
 assert.deepEqual(calls,['/intent'],'no retrieval or ranking for an ask');assert.equal(data.keepCanvas,true);
 assert.deepEqual(data.interpretation.forks.find((f:Json)=>f.field==='cohort').options.map((o:Json)=>o.id).sort(),['Engineering','Sales','Senior individual contributor']);
 const stripe=await (await post(env,'/api/canvas',{q:'',slug:'stripe',mode:'controls',overrides:{view:'cohort'}})).json() as Json;
 assert.equal(stripe.keepCanvas,false);assert.ok(!stripe.interpretation.forks.some((f:Json)=>f.field==='cohort'));
 assert.ok(stripe.notices.includes('Stripe has no published groups, so there is nothing to compare with the whole company.'));
});

test('scheduled work runs publication housekeeping, moderation housekeeping, community listings and the archive, each even after an earlier failure',async()=>{
 assert.deepEqual(SCHEDULED_STEPS,[housekeeping,moderationHousekeeping,purgeDailyDigests,communityHousekeeping,archiveTransparency]);
 const {env}=testEnv(),ran:string[]=[];
 const step=(name:string,fail=false)=>async()=>{ran.push(name);if(fail)throw new Error(`${name} failed`);};
 await assert.rejects(runScheduled(env,[step('housekeeping',true),step('moderation',true),step('archive')]),/housekeeping failed/,'the first error is rethrown');
 assert.deepEqual(ran,['housekeeping','moderation','archive']);
 ran.length=0;await runScheduled(env,[step('housekeeping'),step('moderation'),step('archive')]);assert.deepEqual(ran,['housekeeping','moderation','archive']);
});

// ---------------------------------------------------------------------------------------------------------------
// Round 3: live-understanding budget (D11), per-day FAQ interest (D5), group chips, scoped chips and label echoes.
// ---------------------------------------------------------------------------------------------------------------
const canvasStub=(reading:()=>Interpretation,calls:string[]=[])=>stub({'/intent':()=>Response.json(reading()),'/retrieve':()=>Response.json({ids:[],available:false}),'/rank':b=>Response.json({scores:(b.ids as string[]).map(id=>({id,relevance:.5}))})},calls);

test('live understanding has its own budget: it never spends the global POST limit or the search budget, and over budget it pauses quietly',async()=>{
 const {env,publicDb}=testEnv(),calls:string[]=[],spent:Record<'ABUSE'|'INFER_LIMIT'|'LIVE_LIMIT',string[]>={ABUSE:[],INFER_LIMIT:[],LIVE_LIMIT:[]};
 let liveOk=true;
 const limiter=(name:keyof typeof spent,ok=()=>true)=>({limit:async({key}:{key:string})=>{spent[name].push(key);return {success:ok()};}});
 env.ABUSE=limiter('ABUSE');env.INFER_LIMIT=limiter('INFER_LIMIT');env.LIVE_LIMIT=limiter('LIVE_LIMIT',()=>liveOk);env.INFERENCE=canvasStub(confident,calls);
 const ip={'cf-connecting-ip':'203.0.113.40'},ask={q:'How are promotions?',slug:'northwind-labs'};
 const live=await post(env,'/api/canvas',{...ask,mode:'live',consent:true},ip);
 assert.equal(live.status,200);assert.ok(calls.includes('/intent'),'live requests are still interpreted');
 assert.deepEqual([spent.LIVE_LIMIT.length,spent.ABUSE.length,spent.INFER_LIMIT.length],[1,0,0],'a live request spends only the live budget');
 assert.equal((await post(env,'/api/canvas',ask,ip)).status,200);
 assert.deepEqual([spent.LIVE_LIMIT.length,spent.ABUSE.length,spent.INFER_LIMIT.length],[1,1,1],'an explicit search never spends the live budget');
 assert.notEqual(spent.LIVE_LIMIT[0],spent.ABUSE[0],'separate limiter keys');assert.ok([...spent.LIVE_LIMIT,...spent.ABUSE,...spent.INFER_LIMIT].every(k=>!k.includes('203.0.113.40')));
 // Over its budget a live request is answered with a pause hint; nothing is interpreted, stored or counted.
 liveOk=false;calls.length=0;env.CRISIS_RESOURCES_ENABLED='true';const before=snapshot(publicDb);
 const paused=await post(env,'/api/canvas',{...ask,mode:'live',consent:true,countInterest:true},ip);
 assert.equal(paused.status,429);assert.equal(paused.headers.get('retry-after'),String(LIVE_PAUSE_SECONDS));
 assert.deepEqual(await paused.json(),{error:'rate_limited',mode:'live',retryAfterSeconds:LIVE_PAUSE_SECONDS});
 assert.deepEqual(calls,[]);assert.deepEqual(snapshot(publicDb),before);
 const crisis=await (await post(env,'/api/canvas',{q:'Lately I have been thinking about ending my life.',mode:'live',consent:true},ip)).json() as Json;
 assert.deepEqual(crisis.resources,CRISIS_RESOURCES,'support resources still reach the asker while Live is paused');
 // Explicit searches and every other POST keep working on their own budgets.
 assert.equal((await post(env,'/api/canvas',ask,ip)).status,200);
 await post(env,'/api/withdraw',{capability:'cap-nobody'},ip);assert.equal(spent.ABUSE.length,3);
 // An explicit search over the global POST limit is refused calmly, and never spends the live budget.
 env.ABUSE=limiter('ABUSE',()=>false);const liveBefore=spent.LIVE_LIMIT.length;
 const busy=await post(env,'/api/canvas',ask,ip);assert.equal(busy.status,429);assert.deepEqual(await busy.json(),{error:'rate_limited'});
 assert.equal(spent.LIVE_LIMIT.length,liveBefore);
});

test('live calls are marked live all the way to the inference worker; its spent live budget pauses Live instead of degrading the canvas',async()=>{
 const {env}=testEnv(),bodies:Json[]=[],calls:string[]=[];let intentStatus=200;
 env.INFERENCE=stub({'/intent':()=>intentStatus===200?Response.json(confident()):Response.json({error:'daily_inference_budget_reached'},{status:intentStatus}),'/retrieve':()=>Response.json({ids:[],available:false}),'/rank':b=>Response.json({scores:(b.ids as string[]).map(id=>({id,relevance:.5}))})},calls,bodies);
 const ask={q:'How are promotions?',slug:'northwind-labs'};
 assert.equal((await post(env,'/api/canvas',{...ask,mode:'live',consent:true})).status,200);
 assert.deepEqual(calls,['/intent'],'Live reads the question but never retrieves or ranks accounts (RT-A5)');
 assert.ok(bodies.length>0&&bodies.every(b=>b.live===true),'every inference call a live request causes is charged to the live budget');
 calls.length=0;
 bodies.length=0;assert.equal((await post(env,'/api/canvas',ask)).status,200);
 assert.ok(calls.includes('/rank'),'a confident submitted question is ranked');
 assert.ok(bodies.length>0&&bodies.every(b=>!('live'in b)),'explicit searches are charged to the search budget');
 // The inference worker's daily live budget is spent: Live pauses quietly (same reply as its per-client limit).
 intentStatus=429;env.CRISIS_RESOURCES_ENABLED='true';
 const paused=await post(env,'/api/canvas',{...ask,mode:'live',consent:true});
 assert.equal(paused.status,429);assert.equal(paused.headers.get('retry-after'),String(LIVE_PAUSE_SECONDS));
 assert.deepEqual(await paused.json(),{error:'rate_limited',mode:'live',retryAfterSeconds:LIVE_PAUSE_SECONDS});
 const crisis=await (await post(env,'/api/canvas',{q:'Lately I have been thinking about ending my life.',mode:'live',consent:true})).json() as Json;
 assert.deepEqual(crisis.resources,CRISIS_RESOURCES,'support resources still reach the asker');
 // A spent search budget on an explicit search keeps the labeled degraded canvas, never the Live pause.
 const explicit=await post(env,'/api/canvas',ask);assert.equal(explicit.status,200);
 const degraded=await explicit.json() as Json;assert.equal(degraded.degraded,true);assert.equal('mode'in degraded,false);
 // Other inference failures while typing stay the labeled degraded canvas (a 503 is an outage, not a spent budget).
 intentStatus=503;const outage=await post(env,'/api/canvas',{...ask,mode:'live',consent:true});
 assert.equal(outage.status,200);assert.equal((await outage.json() as Json).degraded,true);
});

test('without a LIVE_LIMIT binding live requests fall back to the POST limit, and an explicit 429 still carries support resources',async()=>{
 const {env}=testEnv(),keys:string[]=[];let ok=true;
 env.ABUSE={limit:async({key})=>{keys.push(key);return {success:ok};}};delete env.LIVE_LIMIT;env.INFERENCE=canvasStub(confident);
 assert.equal((await post(env,'/api/canvas',{q:'How are promotions?',slug:'northwind-labs',mode:'live',consent:true})).status,200);
 assert.equal(keys.length,1,'an unbound live limiter never means no limit');
 ok=false;
 const live=await post(env,'/api/canvas',{q:'How are promotions?',slug:'northwind-labs',mode:'live',consent:true});
 assert.equal(live.status,429);assert.equal((await live.json() as Json).mode,'live','over the fallback limit, Live still pauses quietly');
 env.CRISIS_RESOURCES_ENABLED='true';
 const explicit=await post(env,'/api/canvas',{q:'Lately I have been thinking about ending my life.'});
 assert.equal(explicit.status,429);assert.deepEqual(await explicit.json(),{error:'rate_limited',resources:CRISIS_RESOURCES});
 const calm=await post(env,'/api/canvas',{q:'How are promotions?'});assert.deepEqual(await calm.json(),{error:'rate_limited'});
});

test('FAQ interest counts once per client, employer, question and UTC day; the record is a keyed digest and a day, and earlier days are deleted',async()=>{
 const {env,publicDb}=testEnv();env.RATE_LIMIT_SECRET='secret-for-daily-interest';env.INFERENCE=canvasStub(confident);
 const count=async()=>((await publicDb.prepare("SELECT COALESCE(SUM(count),0) AS n FROM faq_interest WHERE company_id='co-northwind'").first()) as {n:number}).n;
 const a={'cf-connecting-ip':'203.0.113.51'},b={'cf-connecting-ip':'203.0.113.52'},before=await count();
 const counted=async(q:string,ip:Record<string,string>)=>((await (await post(env,'/api/canvas',{q,slug:'northwind-labs',countInterest:true},ip)).json()) as Json).interestCounted;
 assert.equal(await counted('Are promotions fair?',a),true);
 assert.equal(await counted('Is promotion fair at this company?',a),false,'rewording the same typed question the same day never counts again');
 assert.equal(await counted('Are promotions fair?',b),true,'another client counts once');
 assert.equal(await count(),before+2);
 const rows=(await publicDb.prepare('SELECT * FROM interest_seen').all()).results as Json[];
 assert.equal(rows.length,2);
 for(const row of rows){assert.deepEqual(Object.keys(row).sort(),['day','digest']);assert.match(row.digest,/^[A-Za-z0-9_-]{43}$/);assert.equal(row.day,new Date().toISOString().slice(0,10));}
 assert.ok(!JSON.stringify(rows).match(/203\.0\.113|co-northwind|q1:|promotion/),'no address, employer or question in the clear');
 // The next UTC day counts again, and writing it removes the earlier day's records.
 const tomorrow=new Date(Date.now()+86400000),request=new Request('http://localhost/',{headers:a});
 assert.equal(await firstToday(env,request,'interest:co-northwind:q1:promotion:overview',tomorrow),true);
 assert.deepEqual(((await publicDb.prepare('SELECT day FROM interest_seen').all()).results as Json[]).map(r=>r.day),[tomorrow.toISOString().slice(0,10)]);
 assert.equal(await purgeDailyDigests(env,new Date(Date.now()+2*86400000)),1);assert.equal(((await publicDb.prepare('SELECT COUNT(*) AS n FROM interest_seen').first()) as Json).n,0);
 // Without RATE_LIMIT_SECRET nothing is stored and nothing is counted: an unkeyed digest of an address could be reversed.
 delete env.RATE_LIMIT_SECRET;const snap=snapshot(publicDb);
 assert.equal(await counted('Are promotions fair?',{'cf-connecting-ip':'203.0.113.53'}),false);assert.deepEqual(snapshot(publicDb),snap);
});

test('function and seniority group chips are separate, authoritative overrides; the single-group chip still works',async()=>{
 const {env}=testEnv();
 env.INFERENCE=canvasStub(()=>jev({...confident(),cohorts:{fn:'Engineering',seniority:'Senior individual contributor'},forks:[{field:'cohort',question:'Which group?',tier:'fork',options:[{id:'Sales',label:'Sales',share:.3}]}],suggestions:[{field:'cohort',value:'Sales',label:'Sales',confidence:.5}]}));
 const canvas=async(overrides:Json)=>(await (await post(env,'/api/canvas',{q:'Are promotions fair for senior engineers?',slug:'northwind-labs',overrides})).json()) as Json;
 const fnOnly=await canvas({cohortSeniority:null});
 assert.deepEqual(fnOnly.interpretation.cohorts,{fn:'Engineering',seniority:null},'removing the seniority chip keeps the function chip');
 assert.equal(fnOnly.evidence.cohortLabel,'Engineering');assert.equal(fnOnly.evidence.cohortStatus,'selected');
 assert.ok(!fnOnly.interpretation.forks.some((f:Json)=>f.field==='cohort'));assert.ok(!fnOnly.interpretation.suggestions.some((s:Json)=>s.field==='cohort'));
 const seniorityOnly=await canvas({cohortFunction:null});
 assert.deepEqual(seniorityOnly.interpretation.cohorts,{fn:null,seniority:'Senior individual contributor'});assert.equal(seniorityOnly.evidence.cohortLabel,'Senior individual contributor');
 const both=await canvas({cohortFunction:'Engineering',cohortSeniority:'Senior individual contributor'});
 assert.equal(both.evidence.cohortStatus,'unavailable','a combined group is not published: stated, never substituted');assert.equal(both.evidence.cohortLabel,'Engineering + Senior individual contributor');
 const legacy=await canvas({cohort:'Sales'});
 assert.deepEqual(legacy.interpretation.cohorts,{fn:'Sales',seniority:null});assert.equal(legacy.evidence.cohortLabel,'Sales');
 assert.equal((await post(env,'/api/canvas',{q:'x',slug:'northwind-labs',overrides:{cohortFunction:'x'.repeat(101)}})).status,400);
});

test('employer-dependent chips carry the employer they were chosen on and are ignored when the question resolves elsewhere',async()=>{
 const {env}=testEnv();let reading=()=>jev({...confident(),company:{value:'helios-semiconductor',confidence:.95,probabilities:{}}});
 env.INFERENCE=canvasStub(()=>reading());
 const chips={scope:'northwind-labs',cohortFunction:'Engineering',event:'ev-nw-restructure-2025',timeframe:'after_event',topic:'promotion'};
 const moved=await (await post(env,'/api/canvas',{q:'Are promotions fair at Helios Semiconductor?',slug:'northwind-labs',overrides:chips})).json() as Json;
 assert.equal(moved.evidence.company.slug,'helios-semiconductor');
 assert.equal(moved.interpretation.event,null);assert.equal(moved.interpretation.timeframe,'any');assert.deepEqual(moved.interpretation.cohorts,{fn:null,seniority:null});
 assert.equal(moved.interpretation.topic.value,'promotion','employer-independent chips still apply');assert.ok(moved.notices.includes(FOREIGN_SCOPE_NOTE));
 assert.notEqual(moved.evidence.timeStatus,'not_applied','a Northwind event is never offered to Helios');
 reading=confident;
 const kept=await (await post(env,'/api/canvas',{q:'Are promotions fair?',slug:'northwind-labs',overrides:chips})).json() as Json;
 assert.equal(kept.evidence.company.slug,'northwind-labs');assert.equal(kept.interpretation.event.value,'ev-nw-restructure-2025');assert.equal(kept.interpretation.timeframe,'after_event');
 assert.equal(kept.interpretation.cohorts.fn,'Engineering');assert.ok(!kept.notices.includes(FOREIGN_SCOPE_NOTE));
 // Without a scope the chips apply as before; a scope must be a slug.
 assert.equal(((await (await post(env,'/api/canvas',{q:'Are promotions fair?',slug:'northwind-labs',overrides:{event:'ev-nw-restructure-2025'}})).json()) as Json).interpretation.event.value,'ev-nw-restructure-2025');
 assert.equal((await post(env,'/api/canvas',{q:'x',slug:'northwind-labs',overrides:{scope:'Not A Slug'}})).status,400);
});

test('group and industry labels that nothing publishes are never repeated in the evidence, notices or answer',async()=>{
 const {env}=testEnv(),secret='Skunkworks Tiger Team';env.INFERENCE=canvasStub(confident);
 const shown=(r:Json)=>JSON.stringify({evidence:r.evidence,notices:r.notices,answer:r.answer,discovery:r.discovery,applied:r.applied,unsupported:r.unsupported,comparisonTable:r.comparisonTable});
 const company=await (await post(env,'/api/canvas',{q:'',slug:'northwind-labs',mode:'controls',overrides:{cohortFunction:secret}})).json() as Json;
 assert.equal(company.evidence.cohortStatus,'unavailable');assert.equal(company.evidence.cohortLabel,'the requested group');
 assert.ok(company.notices.includes('No privacy-approved release exists for the requested group. Choose a broader group to continue.'));
 assert.ok(!shown(company).includes(secret),'the caller\'s own text is never repeated back as a label');
 // A label another employer publishes may be named (Engineering is published at Northwind Labs, not at Helios).
 const helios=await (await post(env,'/api/canvas',{q:'',slug:'helios-semiconductor',mode:'controls',overrides:{cohortFunction:'Engineering'}})).json() as Json;
 assert.equal(helios.evidence.cohortLabel,'Engineering');
 const compared=await (await post(env,'/api/canvas',{q:'',slug:'northwind-labs',mode:'controls',overrides:{view:'compare',compareTo:'helios-semiconductor',cohortFunction:secret}})).json() as Json;
 assert.ok(!shown(compared).includes(secret));
 const discovery=await (await post(env,'/api/canvas',{q:'',mode:'controls',overrides:{view:'discovery',cohortFunction:secret}})).json() as Json;
 assert.ok(discovery.applied.includes('Group: the requested group'));assert.ok(!shown(discovery).includes(secret));
 const combined=await (await post(env,'/api/canvas',{q:'',mode:'controls',overrides:{view:'discovery',cohortFunction:secret,cohortSeniority:'Remote'}})).json() as Json;
 assert.ok(combined.unsupported.includes('Combined groups: the requested groups'));assert.ok(!shown(combined).includes(secret));
 const industry=await (await post(env,'/api/canvas',{q:'',mode:'controls',overrides:{view:'discovery',industry:'Clandestine Widgets'}})).json() as Json;
 assert.ok(industry.unsupported.includes('Industry: the requested industry'));assert.ok(!shown(industry).includes('Clandestine'));
});

test('package scripts follow the deploy order: migrations, inference, verifier, main (signed release), then the deployment watcher',async()=>{
 const {readFileSync}=await import('node:fs');
 const scripts=(JSON.parse(readFileSync('package.json','utf8')) as {scripts:Record<string,string>}).scripts;
 // D9: main binds inference, so inference (and the verifier) are live before main; migrations come first.
 const order=scripts['deploy:all']!.split('&&').map(s=>s.trim());
 assert.deepEqual(order,['npm run db:bookmarks','node tools/db.mjs remote','npm run deploy:inference','npm run deploy:verifier','npm run deploy:main','npm run verify:deployment']);
 // A rollback target is printed for every database before any migration runs (D1 Time Travel bookmarks; read-only).
 const bookmarks=scripts['db:bookmarks']!.split('&&').map(s=>s.trim());
 assert.deepEqual(bookmarks,['wrangler d1 time-travel info shouldiworkthere-public','wrangler d1 time-travel info shouldiworkthere-intake','wrangler d1 time-travel info shouldiworkthere-verifier --config issuer.wrangler.jsonc']);
 for(const [config,names] of [['wrangler.jsonc',['shouldiworkthere-public','shouldiworkthere-intake']],['issuer.wrangler.jsonc',['shouldiworkthere-verifier']]] as const)
  for(const name of names)assert.ok(readFileSync(config,'utf8').includes(`"database_name":"${name}"`)||readFileSync(config,'utf8').includes(`"database_name": "${name}"`),`${name} is a database ${config} binds`);
 assert.ok(!/restore/.test(scripts['db:bookmarks']!),'recording a bookmark never restores anything');
 assert.equal(scripts['deploy:inference'],'wrangler deploy --config inference.wrangler.jsonc');
 assert.equal(scripts['deploy:verifier'],'wrangler deploy --config issuer.wrangler.jsonc');
 assert.equal(scripts.deploy,'node tools/build.mjs && node tools/transparency.mjs && wrangler deploy','the main worker ships only with a freshly signed release manifest');
 assert.equal(scripts['deploy:main'],'npm run deploy');
 assert.equal(scripts.release,'node tools/build.mjs && node tools/transparency.mjs');
 assert.equal(scripts['verify:deployment'],'node tools/verify-deployment.mjs --state=.siwt-watch-state.json');
 assert.equal(scripts.og,'node tools/og.mjs');
 assert.ok(!Object.values(scripts).some(s=>/--accept-row-changes|--force/.test(s)),'no script accepts row-changing migrations or forces anything on its own');
});

test('the directory lists the added real employers with their curated aliases, and their records open empty and honest',async()=>{
 const {env}=testEnv();
 const {companies}=await (await get(env,'/api/directory')).json() as {companies:Json[]};
 const schwab=companies.find(c=>c.slug==='charles-schwab')!;
 assert.equal(schwab.kind,'real');assert.equal(schwab.name,'Charles Schwab');assert.equal(schwab.sector,'Financial services');
 assert.deepEqual(schwab.aliases.map((a:Json)=>[a.alias,a.cased]).sort(),[['charles schwab',false],['charlesschwab',false],['schwab',false]]);
 assert.deepEqual(companies.find(c=>c.slug==='target')!.aliases.find((a:Json)=>a.cased),{alias:'Target',cased:true});
 assert.equal('aliases'in companies.find(c=>c.slug==='northwind-labs')!,false,'the fictional samples keep name matching');
 // Verification domains are listed where configured (migration 0010); origin appears only on community listings.
 assert.ok(companies.every(c=>Object.keys(c).every(k=>['id','slug','name','kind','sector','aliases','domains','origin'].includes(k))),'name, slug, sector, aliases and domains only');
 assert.deepEqual(companies.find(c=>c.slug==='meta')!.domains,['meta.com','fb.com']);assert.equal('domains'in schwab,false,'no domain is invented');
 const page=await (await post(env,'/api/canvas',{q:'',slug:'charles-schwab',mode:'controls',overrides:{company:'charles-schwab'}})).json() as Json;
 assert.equal(page.evidence.company.slug,'charles-schwab');assert.deepEqual(page.evidence.metrics,[]);assert.deepEqual(page.evidence.testimony,[]);
 // The empty-record wording belongs to pages.ts; here the shell must answer 200 and name the employer.
 const shell=await get(env,'/c/charles-schwab');assert.equal(shell.status,200);assert.match(await shell.text(),/<title>Charles Schwab — /);
 // A database that has not applied 0009 yet still serves the directory, matched by names alone.
 (env.DB as unknown as {exec:(sql:string)=>void}).exec('DROP TABLE company_aliases');
 const older=await (await get(env,'/api/directory')).json() as {companies:Json[]};assert.equal('aliases'in older.companies.find(c=>c.slug==='charles-schwab')!,false);
});

// ---------------------------------------------------------------------------------------------------------------
// Round 3 hardening (red team): per-client keys by /64, daily shares, body limits, status codes, config pins and
// the copy of the degraded canvas.
// ---------------------------------------------------------------------------------------------------------------
import {clientAddress,requestClient} from '../worker/src/network.ts';
import {clientKey,withinDailyShare,CLIENT_DAILY,untilUtcMidnight,readCapped,BODY_MAX_BYTES,degradedNote,allowedMethods,POST_ROUTES} from '../worker/src/app.ts';

test('WS-03: an IPv6 client is its /64, so rotating addresses inside it shares every limit and every per-day record',async()=>{
 assert.equal(clientAddress('2001:db8:1:2::1'),clientAddress('2001:db8:1:2::ffff'));
 assert.equal(clientAddress('2001:db8:1:2::1'),'2001:db8:1:2::/64');
 assert.notEqual(clientAddress('2001:db8:1:3::1'),clientAddress('2001:db8:1:2::1'));
 assert.equal(clientAddress('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd'),'2001:db8:1:2::/64','leading zeros and full forms normalize');
 assert.equal(clientAddress('2001:DB8:1:2::1'),clientAddress('2001:db8:1:2::1'));
 assert.equal(clientAddress('::ffff:198.51.100.7'),'198.51.100.7','IPv4-mapped IPv6 is the IPv4 client');
 assert.equal(clientAddress('198.51.100.7'),'198.51.100.7');assert.notEqual(clientAddress('198.51.100.7'),clientAddress('198.51.100.8'));
 assert.equal(clientAddress(null),'local');assert.equal(clientAddress('not-an-address::x::y'),'not-an-address::x::y','an unparseable value is kept whole, never merged with others');
 const at=(ip:string)=>new Request('http://localhost/',{headers:{'cf-connecting-ip':ip}});
 assert.equal(requestClient(at('2001:db8:1:2::9')),'2001:db8:1:2::/64');
 for(const secret of [undefined,'rate-secret-0123456789']) {
  const env={RATE_LIMIT_SECRET:secret};
  assert.equal(await clientKey(env,at('2001:db8:1:2::1'),'post'),await clientKey(env,at('2001:db8:1:2::ffff'),'post'));
  assert.notEqual(await clientKey(env,at('2001:db8:1:3::1'),'post'),await clientKey(env,at('2001:db8:1:2::1'),'post'));
 }
 // The FAQ interest de-duplication (D5) counts a /64 once per question and day.
 const {env}=testEnv();env.RATE_LIMIT_SECRET='rate-secret-0123456789';
 assert.equal(await firstToday(env,at('2001:db8:1:2::1'),'interest:co-northwind:q'),true);
 assert.equal(await firstToday(env,at('2001:db8:1:2::abcd'),'interest:co-northwind:q'),false,'a rotated address in the same /64 is the same client');
 assert.equal(await firstToday(env,at('2001:db8:1:3::1'),'interest:co-northwind:q'),true);
});

test('WS-05: each client has a daily share of the search, Live and draft-check budgets, kept as a keyed digest and a count only',async()=>{
 const {env,intake,publicDb}=testEnv(),calls:string[]=[];env.RATE_LIMIT_SECRET='rate-secret-0123456789';env.CRISIS_RESOURCES_ENABLED='true';
 env.INFERENCE=stub({'/intent':()=>Response.json(confident()),'/rank':b=>Response.json({scores:(b.ids as string[]).map(id=>({id,relevance:.5}))}),'/retrieve':()=>Response.json({ids:[],available:false}),'/screen':()=>Response.json({signals:zero,model:'jev-test'})},calls);
 const ip={'cf-connecting-ip':'2001:db8:7:7::1'},rotated={'cf-connecting-ip':'2001:db8:7:7::2'},other={'cf-connecting-ip':'198.51.100.77'};
 const ask={q:'How are promotions?',slug:'northwind-labs'};
 const day=new Date().toISOString().slice(0,10);
 const fill=async(purpose:keyof typeof CLIENT_DAILY)=>{for(let k=0;k<CLIENT_DAILY[purpose];k++)assert.equal(await withinDailyShare(env,new Request('http://localhost/',{headers:ip}),purpose),true);};
 await fill('search');calls.length=0;
 const degraded=await (await post(env,'/api/canvas',ask,rotated)).json() as Json;
 assert.equal(degraded.degraded,true);assert.deepEqual(calls,[],'over its daily share a client’s question is not sent to Jev');
 assert.match(degraded.interpretation.notes[0],/^Jev has read as many questions from this connection today as one connection may; the count starts over at midnight UTC\./);
 assert.ok(!/Live/.test(degraded.interpretation.notes[0]));
 assert.equal(((await (await post(env,'/api/canvas',ask,other)).json()) as Json).degraded,false,'another client is unaffected');
 await fill('live');
 const paused=await post(env,'/api/canvas',{...ask,mode:'live',consent:true},rotated);
 assert.equal(paused.status,429);const pause=await paused.json() as Json;
 assert.equal(pause.mode,'live');assert.ok(pause.retryAfterSeconds>0&&pause.retryAfterSeconds<=86400);assert.equal(paused.headers.get('retry-after'),String(pause.retryAfterSeconds));
 await fill('precheck');
 const checked=await post(env,'/api/screen',{approvedText:'Lately I have been thinking about ending my life and the workload made it worse.',consent:true},rotated);
 assert.equal(checked.status,429);const refused=await checked.json() as Json;
 assert.equal(refused.limit,'daily');assert.deepEqual(refused.resources,CRISIS_RESOURCES,'support resources still reach the author');
 // Stored: day, a keyed digest and a count, in the intake database's daily table; nothing about the address.
 const rows=(await intake.prepare('SELECT * FROM daily_budgets').all()).results as Json[];
 assert.equal(rows.length,4,'three shares of one /64 and the other client’s one search');for(const row of rows){assert.deepEqual(Object.keys(row).sort(),['day','digest','used']);assert.equal(row.day,day);assert.match(row.digest,/^[A-Za-z0-9_-]{43}$/);}
 assert.deepEqual(rows.map(r=>r.used).sort((a,b)=>a-b),[1,CLIENT_DAILY.precheck,CLIENT_DAILY.live,CLIENT_DAILY.search].sort((a,b)=>a-b));
 assert.ok(!JSON.stringify([rows,(await publicDb.prepare('SELECT * FROM interest_seen').all()).results]).match(/2001|198\.51/));
 // Without RATE_LIMIT_SECRET nothing is stored and nothing is refused by it.
 const bare=testEnv();bare.env.INFERENCE=stub({'/intent':()=>Response.json(confident())});
 for(let k=0;k<CLIENT_DAILY.search+2;k++)assert.equal(await withinDailyShare(bare.env,new Request('http://localhost/',{headers:ip}),'search'),true);
 assert.equal(((await bare.intake.prepare('SELECT COUNT(*) AS n FROM daily_budgets').first()) as Json).n,0);
 // A development stack (every tab, test and tool is 127.0.0.1) keeps no daily shares either.
 const dev=testEnv();dev.env.RATE_LIMIT_SECRET='rate-secret-0123456789';dev.env.ENVIRONMENT='development';
 for(let k=0;k<CLIENT_DAILY.precheck+2;k++)assert.equal(await withinDailyShare(dev.env,new Request('http://localhost/',{headers:ip}),'precheck'),true);
 assert.equal(((await dev.intake.prepare('SELECT COUNT(*) AS n FROM daily_budgets').first()) as Json).n,0);
 assert.ok(untilUtcMidnight(new Date('2026-09-22T23:59:30Z'))===30&&untilUtcMidnight(new Date('2026-09-22T00:00:00Z'))===86400);
});

test('WS-06: a chunked body is cut off at the cap instead of being buffered whole, and a malformed canvas body still counts against the POST limit',async()=>{
 let pulled=0;
 const endless=new ReadableStream<Uint8Array>({pull(controller){pulled++;controller.enqueue(new Uint8Array(1024).fill(97));if(pulled>=4000)controller.close();}});
 const chunked=new Request('http://localhost/api/canvas',{method:'POST',body:endless,headers:{'content-type':'application/json'},duplex:'half'} as RequestInit);
 assert.equal(chunked.headers.get('content-length'),null);
 await assert.rejects(readCapped(chunked),/request_too_large/);
 assert.ok(pulled<BODY_MAX_BYTES/1024+8,`read ${pulled} KB of a 4000 KB upload`);
 const {env}=testEnv(),keys:string[]=[];
 env.ABUSE={limit:async({key})=>{keys.push(key);return {success:true};}};
 const bad=await worker.fetch(new Request('http://localhost/api/canvas',{method:'POST',body:'{bad',headers:{'content-type':'application/json'}}),env);
 assert.equal(bad.status,400);assert.deepEqual(await bad.json(),{error:'invalid_request'});assert.equal(keys.length,1,'the malformed body was counted');
 env.ABUSE={limit:async()=>({success:false})};
 const limited=await worker.fetch(new Request('http://localhost/api/canvas',{method:'POST',body:'{bad',headers:{'content-type':'application/json'}}),env);
 assert.equal(limited.status,429);
});

test('WS-08: client mistakes are 4xx, never outages; fixed-method routes answer 405 with an Allow header',async()=>{
 const {env}=testEnv();
 const raw=(path:string,body:string|undefined,method='POST')=>worker.fetch(new Request(`http://localhost${path}`,{method,...(body===undefined?{}:{body}),headers:{'content-type':'application/json'}}),env);
 for(const path of ['/api/canvas','/api/submit','/api/screen','/api/withdraw','/api/author','/api/employers']) {
  const r=await raw(path,'{bad');assert.equal(r.status,400,path);assert.deepEqual(await r.json(),{error:'invalid_request'});
 }
 const empty=await raw('/api/withdraw',undefined);assert.equal(empty.status,400);
 const big=await raw('/api/canvas',JSON.stringify({q:'a'.repeat(20000)}));assert.equal(big.status,413);assert.deepEqual(await big.json(),{error:'request_too_large'});
 for(const [path,method] of [['/api/config','DELETE'],['/api/directory','PUT'],['/privacy','POST'],['/moderation/current.json','POST'],['/c/northwind-labs','POST']] as const) {
  const r=await raw(path,method==='POST'?'{}':undefined,method);assert.equal(r.status,405,`${method} ${path}`);assert.equal(r.headers.get('allow'),'GET, HEAD');assert.ok(r.headers.get('content-security-policy'));
 }
 const getCanvas=await get(env,'/api/canvas');assert.equal(getCanvas.status,405);assert.equal(getCanvas.headers.get('allow'),'POST');
 assert.equal((await worker.fetch(new Request('http://localhost/api/config',{method:'HEAD'}),env)).status,200,'HEAD is a GET without a body');
 assert.equal(allowedMethods('/api/jury/case'),null,'moderation routes keep their own methods');
 assert.deepEqual(POST_ROUTES,['/api/canvas','/api/screen','/api/submit','/api/author','/api/withdraw','/api/employers','/api/directory/correct']);
 const getCorrection=await get(env,'/api/directory/correct');assert.equal(getCorrection.status,405);assert.equal(getCorrection.headers.get('allow'),'POST');
 const unauthorized=await raw('/api/directory/correct','{}');assert.equal(unauthorized.status,401,'a listing correction needs the operator token before anything is read');
 const getListing=await get(env,'/api/employers');assert.equal(getListing.status,405);assert.equal(getListing.headers.get('allow'),'POST');
});

test('WS-09: no preview or workers.dev hostname is enabled by the main or inference configuration',async()=>{
 const {readFileSync}=await import('node:fs');
 const jsonc=(file:string)=>JSON.parse(readFileSync(file,'utf8').replace(/^\s*\/\/.*$/gm,'')) as Json;
 const main=jsonc('wrangler.jsonc'),inf=jsonc('inference.wrangler.jsonc');
 assert.equal(main.preview_urls,false);assert.equal(inf.preview_urls,false);assert.equal(inf.workers_dev,false);
 assert.equal(inf.routes,undefined,'the inference worker has no public route; only the main worker’s service binding reaches it');
});

test('RT-ABUSE-09 and RT-A3: the degraded canvas says why the question was not read, and names Live only for Live',async()=>{
 const {env}=testEnv();let status=429;
 env.INFERENCE=stub({'/intent':()=>Response.json({error:status===429?'daily_inference_budget_reached':'inference_unavailable'},{status})});
 const ask={q:'how is the workload at northwind labs'};
 const spent=await (await post(env,'/api/canvas',{...ask,mode:'submit'})).json() as Json;
 assert.equal(spent.degraded,true);assert.match(spent.interpretation.notes[0],/^Jev’s daily limit for reading questions is used up; it starts over at midnight UTC\./);assert.ok(!/Live/.test(spent.interpretation.notes[0]));
 status=503;
 const down=await (await post(env,'/api/canvas',{...ask,mode:'submit'})).json() as Json;
 assert.match(down.interpretation.notes[0],/^Jev could not read this question right now\./);assert.ok(!/Live/.test(down.interpretation.notes[0]));
 const liveDown=await (await post(env,'/api/canvas',{...ask,mode:'live',consent:true})).json() as Json;
 assert.match(liveDown.interpretation.notes[0],/^Live understanding is unavailable right now\./);
 env.INFER_LIMIT={limit:async()=>({success:false})};
 const busy=await (await post(env,'/api/canvas',{...ask,mode:'submit'})).json() as Json;
 assert.match(busy.interpretation.notes[0],/^Understanding searches is paused briefly/);
 for(const reason of ['unavailable','budget','rate_limited','client_daily'] as const)assert.ok(!/Live/.test(degradedNote(reason,'submit',false)),reason);
 assert.match(degradedNote('unavailable','submit',true),/manual controls still work\.$/);assert.match(degradedNote('unavailable','submit',false),/as do exact company names\.$/);
});

test('every main-worker response is no-transform (no edge script injection) and withdraws Network Error Logging',async()=>{
 const {edgeHeaders}=await import('../worker/src/app.ts');
 assert.deepEqual(edgeHeaders(null),{'cache-control':'no-transform',nel:'{"max_age":0}'});
 assert.equal(edgeHeaders('no-store')['cache-control'],'no-store, no-transform');
 assert.equal(edgeHeaders('public,max-age=300, no-transform')['cache-control'],'public,max-age=300, no-transform');
 const {env}=testEnv();
 for(const path of ['/','/privacy','/app.js','/api/config','/nope']) {
  const response=await worker.fetch(new Request(`http://localhost${path}`,{headers:{accept:'text/html'}}),env);
  assert.match(response.headers.get('cache-control')??'',/\bno-transform\b/,path);
  assert.equal(response.headers.get('nel'),'{"max_age":0}',path);
 }
});
