import {z} from 'zod';
import {CLIENT_BUILD_ID,CLIENT_JS,SOURCE_FILES} from '../generated/client-assets.ts';
import {appShell,shellMeta,stylesheet,favicon,trustPage,themeScriptResponse,escapeHtml,footerHtml} from './pages.ts';
import {getDirectory,getCompanyBySlug,getCompanyEvents,getCompanyCohorts,buildEvidence,discover,rankCandidates,loadAccountPool,compareMetrics,answerFor,RANK_CANDIDATES_MAX} from './evidence.ts';
import {baseInterpretation,annotate,nameMatches,isSentinel,unlistedNotice,unlistedNotices,candidatesComplete,settleRoute,holdMeaningForAsk,SALARY_NOTE,NEEDS_GENERATION_NOTE,ROUTE_IDS,VIEW_ROUTE} from './interpretation.ts';
import {publicIssuerKeys} from './credentials.ts';
import {submit,withdraw,authorAction,screenApprovedText,housekeeping} from './submissions.ts';
import {moderationRoutes,moderationHousekeeping,moderationStatus} from './moderation.ts';
import {releaseManifestResponse} from './release.ts';
import {ogImageResponse} from './og.ts';
import {policy,policyDocument,canonicalJson} from '../../shared/policy.ts';
import {faqCatalog,specFromInterpretation,specId} from '../../shared/faq.ts';
import {scanText,identifies} from '../../shared/privacy.ts';
import {detectCrisis,CRISIS_RESOURCES} from '../../shared/safety.ts';
import {digest,encode,quarter} from '../../shared/proof.ts';
import {archiveTransparency,publicStats,appendFinance,appendLegal} from './ledger.ts';
import type {Env,Interpretation,EvidencePayload,ComparisonTable,RouteId} from './types.ts';
import {BRAND,CONTACT,CONTACT_MAIL,LEGAL_LINKS} from '../../shared/brand.ts';
import {LEGAL_NOTICE} from './legal.ts';
import {requestClient,CALLER_HEADER} from './network.ts';
import {addEmployer,communityHousekeeping,correctListing,correctionLog,verifierLinkState,listingOpen,LISTINGS_PER_CLIENT_PER_DAY,LISTINGS_PER_NETWORK_PER_DAY} from './community.ts';
import {samplesEnabled,testimonyBatchMin,aggregateMinimum} from './flags.ts';
import {powBits,powWorkerSource,POW_VERSION,POW_WINDOW_MINUTES} from '../../shared/pow.ts';

export const CANVAS_TIMEOUTS={intent:7500,retrieve:1500,rank:3000,total:10000};
/** Reader pages beyond the first; the evidence compiler serves PAGE_ACCOUNTS accounts per page. */
export const MAX_READER_PAGE=24;
/** A live-understanding request over its own budget: the client pauses Live for this long and keeps the last view. */
export const LIVE_PAUSE_SECONDS=60;
const views=['overview','compare','timeline','distribution','cohort','clusters','reader','discovery'] as const;
const topics=['promotion','management','compensation','workload','layoffs','location_policy','culture','other'] as const;
const timeframes=['any','last_year','before_event','after_event'] as const;
/**
 * Reader overrides. `cohort` is the single-group chip (it sets the function slot and clears seniority); `cohortFunction`
 * and `cohortSeniority` are independent, authoritative chips for each slot. `scope` names the employer the
 * employer-dependent overrides (event, groups, before/after) were chosen on; they are ignored when the question resolves
 * to another employer.
 */
const overridesSchema=z.object({company:z.string().max(90).nullable(),compareTo:z.string().max(90).nullable(),cohort:z.string().max(100).nullable(),cohortFunction:z.string().max(100).nullable(),cohortSeniority:z.string().max(100).nullable(),scope:z.string().regex(/^[a-z0-9-]{1,90}$/).nullable(),topic:z.enum(topics).nullable(),view:z.enum(views).nullable(),layer:z.enum(['experience','claim','opinion']).nullable(),event:z.string().max(100).nullable(),timeframe:z.enum(timeframes).nullable(),industry:z.string().max(90).nullable(),preferences:z.record(z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),z.enum(['high','low','any'])).refine(p=>Object.keys(p).length<=12).nullable(),salaryDataRequired:z.literal(false),page:z.number().int().min(0).max(MAX_READER_PAGE)}).partial().strict();
type Overrides=z.infer<typeof overridesSchema>;
/** Override keys that answer a fork or suggestion field (a group chip answers the 'cohort' field whichever slot it sets). */
const FIELD_KEYS:Readonly<Record<string,readonly (keyof Overrides)[]>>={cohort:['cohort','cohortFunction','cohortSeniority']};
/** Overrides that only mean something for the employer they were chosen on. */
const EMPLOYER_KEYS=['event','cohort','cohortFunction','cohortSeniority'] as const;
export const FOREIGN_SCOPE_NOTE='Group, event and before/after choices made for another employer were not applied here.';
const canvasSchema=z.object({q:z.string().max(600).default(''),slug:z.string().max(90).nullable().optional(),overrides:overridesSchema.default({}),mode:z.enum(['submit','live','controls']).default('submit'),consent:z.boolean().default(false),shareTopic:z.boolean().default(false),countInterest:z.boolean().default(false)}).strict();
// Legacy route values from an older inference worker are accepted and mapped by settleRoute, so a rolling deploy never degrades the canvas.
const interpretationShape=z.looseObject({source:z.literal('jev'),provider:z.enum(['workers-ai','typesafe-api']),model:z.string(),promptVersion:z.string(),degraded:z.literal(false),view:z.looseObject({value:z.enum(views)}),topic:z.looseObject({value:z.enum(topics)}),cohorts:z.looseObject({fn:z.string().nullable(),seniority:z.string().nullable()}),timeframe:z.enum(timeframes),forks:z.array(z.looseObject({field:z.string(),question:z.string(),options:z.array(z.looseObject({id:z.string(),label:z.string(),share:z.number()}))})),suggestions:z.array(z.looseObject({field:z.string(),value:z.string()})),annotations:z.array(z.unknown()),notes:z.array(z.string()),focus:z.array(z.enum(topics)),route:z.enum(['unlisted','company','clarify','unsupported',...ROUTE_IDS]),clarify:z.boolean()});
/**
 * Support resources for crisis language in the asker's own text. Deterministic (shared/safety.ts), computed per request
 * and returned only to that asker: nothing about the match is stored, logged or forwarded. Off unless
 * CRISIS_RESOURCES_ENABLED is 'true', because the privacy policy must disclose this server-side check before it runs.
 */
const crisisEnabled=(env:Pick<Env,'CRISIS_RESOURCES_ENABLED'>)=>env.CRISIS_RESOURCES_ENABLED==='true';
const crisisFor=(env:Pick<Env,'CRISIS_RESOURCES_ENABLED'>,text:unknown)=>crisisEnabled(env)&&typeof text==='string'&&detectCrisis(text)?{resources:CRISIS_RESOURCES}:{};
/** Strips the inference worker's selfHarmResources flag from a reply; it only ever adds support resources, never a policy signal. */
export function withResources<T extends object>(env:Pick<Env,'CRISIS_RESOURCES_ENABLED'>,result:T,text:unknown) {
 const {selfHarmResources,...rest}=result as T&{selfHarmResources?:unknown};
 return {...rest,...(crisisEnabled(env)&&selfHarmResources===true?{resources:CRISIS_RESOURCES}:crisisFor(env,text))};
}
const PUBLIC_ERRORS=['credential_employer_mismatch','credential_expired','invalid_signature','unknown_issuer_key','invalid_survey_answer'];
/** Client mistakes are 4xx (a malformed or oversized body is never reported as an outage, WS-08); only real failures are 503. */
function failure(error:unknown):{body:{error:string};status:number} {
 if(error instanceof z.ZodError)return {body:{error:'invalid_request'},status:400};
 const message=error instanceof Error?error.message:'';
 if(message===INVALID_JSON)return {body:{error:'invalid_request'},status:400};
 if(message===TOO_LARGE)return {body:{error:TOO_LARGE},status:413};
 return PUBLIC_ERRORS.includes(message)?{body:{error:message},status:400}:{body:{error:'request_failed'},status:503};
}
const verifierOrigin=(env:Pick<Env,'VERIFIER_ORIGIN'>)=>env.VERIFIER_ORIGIN??'https://verify.shouldiworkthere.com';
/** connect-src names only the configured verifier; plaintext localhost origins exist only in development. */
/**
 * Headers that keep Cloudflare's edge from changing what we serve. `no-transform` stops the proxy from modifying
 * responses, which is what injects the Web Analytics beacon, email obfuscation or Rocket Loader into HTML; the privacy
 * policy promises no third-party scripts, so this holds even if a zone setting is switched on. A Network Error Logging
 * policy with max_age 0 tells browsers to drop any error-reporting policy for this origin.
 */
export function edgeHeaders(cacheControl:string|null):Record<string,string> {
 const cc=cacheControl?.trim();
 return {'cache-control':!cc?'no-transform':/\bno-transform\b/.test(cc)?cc:`${cc}, no-transform`,nel:'{"max_age":0}'};
}
export function securityHeaders(env:Pick<Env,'ENVIRONMENT'|'VERIFIER_ORIGIN'>):Record<string,string> {
 const development=env.ENVIRONMENT==='development';let verifier:string|null=null;
 try {const url=new URL(verifierOrigin(env));if(url.protocol==='https:'||(development&&url.protocol==='http:'))verifier=url.origin;} catch {}
 const connect=[...new Set(["'self'",...(verifier?[verifier]:[]),...(development?['http://localhost:8790','http://127.0.0.1:8790']:[])])].join(' ');
 return {'content-security-policy':`default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:; connect-src ${connect}; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,'x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','permissions-policy':'geolocation=(), camera=(), microphone=(), payment=()','cross-origin-opener-policy':'same-origin',...(development?{}:{'strict-transport-security':'max-age=63072000; includeSubDomains'})};
}
const json=(body:unknown,status=200,headers:Record<string,string>={})=>Response.json(body,{status,headers:{'cache-control':'no-store',...headers}});
const html=(body:string,status=200)=>new Response(body,{status,headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store'}});
/** The operator's bearer token (ADMIN_TOKEN), compared as digests; false when it is unset or missing. */
async function operator(request:Request,env:Pick<Env,'ADMIN_TOKEN'>):Promise<boolean> {
 const supplied=request.headers.get('authorization')?.replace(/^Bearer /,'');
 return !!env.ADMIN_TOKEN&&!!supplied&&await digest(supplied)===await digest(env.ADMIN_TOKEN);
}
/** Largest request body read, in bytes. */
export const BODY_MAX_BYTES=16000;
const INVALID_JSON='invalid_json',TOO_LARGE='request_too_large';
/**
 * Reads at most BODY_MAX_BYTES of the body, streaming: a chunked upload (no Content-Length) is cancelled as soon as it
 * passes the cap instead of being buffered whole first (WS-06).
 */
export async function readCapped(request:Request,max=BODY_MAX_BYTES):Promise<string> {
 if(Number(request.headers.get('content-length')??0)>max)throw new Error(TOO_LARGE);
 if(!request.body)return '';
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 for(;;) {
  const {done,value}=await reader.read();if(done)break;
  size+=value.byteLength;
  if(size>max){await reader.cancel().catch(()=>{});throw new Error(TOO_LARGE);}
  chunks.push(value);
 }
 const all=new Uint8Array(size);let at=0;for(const c of chunks){all.set(c,at);at+=c.byteLength;}
 return new TextDecoder().decode(all);
}
async function body(request:Request):Promise<unknown> {
 const raw=await readCapped(request);
 try {return JSON.parse(raw) as unknown;} catch {throw new Error(INVALID_JSON);}
}
async function within<T>(work:Promise<T>,ms:number):Promise<T> {
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('inference_timeout')),Math.max(0,ms));})]);}
 finally {clearTimeout(timer);}
}
/** A 429 from the inference worker: its daily budget for that purpose is spent (for live calls, the live budget). */
const BUDGET_SPENT='inference_budget_spent';
async function inference<T>(env:Env,path:string,input:unknown,timeoutMs:number):Promise<T> {
 if(!env.INFERENCE||timeoutMs<250)throw new Error('inference_unavailable');
 const response=await within(env.INFERENCE.fetch(`https://inference${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(timeoutMs)}),timeoutMs);
 if(!response.ok)throw new Error(response.status===429?BUDGET_SPENT:'inference_unavailable');return await within(response.json() as Promise<T>,timeoutMs);
}
/** Live understanding over a budget (its per-client limiter or the inference worker's daily live budget): the client pauses Live quietly for LIVE_PAUSE_SECONDS and keeps the last view. Support resources still reach the asker. */
const livePaused=(env:Env,q:unknown,seconds=LIVE_PAUSE_SECONDS)=>json({error:'rate_limited',mode:'live',retryAfterSeconds:seconds,...crisisFor(env,q)},429,{'retry-after':String(seconds)});
async function hmac(secret:string,message:string) {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message))));
}
/**
 * Rate-limit keys are a daily digest of the client (network.ts: an IPv6 address counts as its /64), keyed with
 * RATE_LIMIT_SECRET when configured (an unkeyed digest of an IPv4 address can be enumerated); keys go only to the limiter
 * and are never stored.
 */
export async function clientKey(env:Pick<Env,'RATE_LIMIT_SECRET'>,request:Request,scope:string) {
 const message=`siwt-limit-v1:${scope}:${new Date().toISOString().slice(0,10)}:${requestClient(request)}`;
 return env.RATE_LIMIT_SECRET?hmac(env.RATE_LIMIT_SECRET,message):digest(message);
}
/**
 * Per-day de-duplication: true only the first time today (UTC) this client acts in `scope`. The stored row is
 * HMAC(RATE_LIMIT_SECRET, utcDay ‖ scope ‖ digest of the client: the address, or its /64 for IPv6) plus the day, nothing
 * else, so rotating addresses inside one /64 never counts again (WS-03); rows of earlier days are
 * deleted here and by the scheduled job. Without RATE_LIMIT_SECRET nothing is stored and the answer is false (an unkeyed
 * digest of an address could be reversed), so whatever it gates is simply not counted.
 */
export async function firstToday(env:Pick<Env,'DB'|'RATE_LIMIT_SECRET'>,request:Request,scope:string,now=new Date()):Promise<boolean> {
 if(!env.RATE_LIMIT_SECRET)return false;
 const day=now.toISOString().slice(0,10);
 const address=await digest(`siwt-address-v1:${requestClient(request)}`);
 const seen=await hmac(env.RATE_LIMIT_SECRET,`siwt-daily-v1\n${day}\n${scope}\n${address}`);
 await env.DB.prepare('DELETE FROM interest_seen WHERE day<?').bind(day).run();
 return (await env.DB.prepare('INSERT OR IGNORE INTO interest_seen(digest,day) VALUES(?,?)').bind(seen,day).run()).meta.changes===1;
}
/**
 * Per-client daily shares of the inference worker's daily budgets (WS-05), so one client cannot spend what every reader
 * shares: explicit searches 150 of the 45,000 search calls, Live 200 of the 45,000 live calls, anonymous draft checks 20 of
 * the 2,500 screening calls they may use (an author checking repairs needs several). Search and Live were raised from 60
 * and 40 with the larger budgets of owner decision 6: Live reads the question at each pause in typing (450 ms), so one
 * engaged reader used 40 in a few sessions and Live then paused until midnight; each share is still under half a percent
 * of its budget. Kept only with RATE_LIMIT_SECRET, in the intake database's daily_budgets table:
 * HMAC(secret, UTC day, purpose, digest of the client) and a count, deleted after the day by the scheduled job. Without
 * the secret nothing is stored and only the per-minute limits apply; a storage failure never refuses anyone. A development
 * stack (ENVIRONMENT=development) has one client, 127.0.0.1, for every tab, test and tool, so it keeps no daily shares:
 * the production shares are not tuned to that, and that one address would otherwise spend them for everyone at once.
 */
export const CLIENT_DAILY={search:150,live:200,precheck:20} as const;
export async function withinDailyShare(env:Pick<Env,'INTAKE'|'RATE_LIMIT_SECRET'|'ENVIRONMENT'>,request:Request,purpose:keyof typeof CLIENT_DAILY,now=new Date()):Promise<boolean> {
 if(!env.RATE_LIMIT_SECRET||env.ENVIRONMENT==='development')return true;
 const day=now.toISOString().slice(0,10);
 try {
  const key=await hmac(env.RATE_LIMIT_SECRET,`siwt-quota-v1\n${day}\n${purpose}\n${await digest(`siwt-address-v1:${requestClient(request)}`)}`);
  return !!await env.INTAKE.prepare('INSERT INTO daily_budgets(day,digest,used) VALUES(?,?,1) ON CONFLICT(day,digest) DO UPDATE SET used=used+1 WHERE used<? RETURNING used').bind(day,key,CLIENT_DAILY[purpose]).first();
 } catch {return true;}
}
/** Seconds until the next UTC midnight, when every daily share and budget starts over. */
export const untilUtcMidnight=(now=new Date())=>Math.max(1,Math.ceil((Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)-now.getTime())/1000));
/** Scheduled: deletes every per-day digest of an earlier UTC day. */
export async function purgeDailyDigests(env:Pick<Env,'DB'>,now=new Date()):Promise<number> {
 return (await env.DB.prepare('DELETE FROM interest_seen WHERE day<?').bind(now.toISOString().slice(0,10)).run()).meta.changes??0;
}
const chosen=<T extends string>(value:T)=>({value,confidence:1,probabilities:{}});
const clean=(value:string|null|undefined)=>isSentinel(value)?null:value!;
const NO_EVENT_NOTE='Choose a documented event to apply a before/after filter. No period filter is applied yet.';
/**
 * Why a question was not read: 'unavailable' (the inference worker failed or timed out), 'budget' (its daily budget is
 * spent), 'rate_limited' (this client's per-minute limit) or 'client_daily' (this client's daily share). The note names
 * Live understanding only for a Live request (RT-ABUSE-09, RT-A3).
 */
export type DegradedReason='unavailable'|'budget'|'rate_limited'|'client_daily';
export function degradedNote(reason:DegradedReason,mode:'submit'|'live'|'controls',onCompanyPage:boolean):string {
 const lead=reason==='rate_limited'?'Understanding searches is paused briefly because many searches arrived from this connection.'
  :reason==='client_daily'?'Jev has read as many questions from this connection today as one connection may; the count starts over at midnight UTC.'
  :reason==='budget'?(mode==='live'?'Live understanding has used its daily limit.':'Jev’s daily limit for reading questions is used up; it starts over at midnight UTC.')
  :mode==='live'?'Live understanding is unavailable right now.':'Jev could not read this question right now.';
 return `${lead} Nothing was inferred from your question; your last view stays in place and manual controls still work${onCompanyPage?'':', as do exact company names'}.`;
}
function degradedInterpretation(query:string,directory:Array<{slug:string;name:string}>,onCompanyPage:boolean,reason:DegradedReason,mode:'submit'|'live'|'controls'):Interpretation {
 const i={...baseInterpretation(),degraded:true,clarify:true};
 i.notes=[degradedNote(reason,mode,onCompanyPage)];
 if(!onCompanyPage) {
  const named=nameMatches(query,directory);
  i.company=named[0]?{value:named[0].slug,confidence:0,probabilities:{}}:null;
  i.compareTo=named[1]?{value:named[1].slug,confidence:0,probabilities:{}}:null;
  if(i.compareTo)i.view={value:'compare',confidence:0,probabilities:{}};
 }
 return i;
}
async function canvas(env:Env,input:unknown,request:Request) {
 const started=Date.now(),data=canvasSchema.parse(input),crisis=crisisFor(env,data.q);
 if(data.mode==='live'&&!data.consent)return json({error:'live_consent_required',...crisis},400);
 if(scanText(data.q).some(identifies))return json({error:'Remove names or identifying details from the search before remote interpretation.',...crisis},422);
 const directory=await getDirectory(env);
 const current=data.slug?directory.find(c=>c.slug===data.slug)??null:null;
 if(data.slug&&!current)return json({error:'unknown_company'},404);
 let i=baseInterpretation();
 // Later reader pages page the filters the reader already has (sent as overrides); they never re-interpret the question,
 // which would spend search budget and could page a different reading than page 0.
 const paging=(data.overrides.page??0)>0;
 // Live understanding pays with its own budgets end to end: the per-client LIVE_LIMIT at the door, and the inference
 // worker's daily live budget (every /intent, /retrieve and /rank call it causes is marked live). Explicit submits pay
 // with INFER_LIMIT and the daily search budget, so typing can never use up the searches a reader sends with Enter.
 const live=data.mode==='live',liveMark=live?{live:true}:{};
 if(data.q.trim()&&data.mode!=='controls'&&!paging) {
  if(!live&&env.INFER_LIMIT&&!(await env.INFER_LIMIT.limit({key:await clientKey(env,request,'infer')})).success)i=degradedInterpretation(data.q,directory,!!current,'rate_limited',data.mode);
  // This client's daily share of the budget (WS-05): Live pauses until the day ends (the client re-checks at most every
  // ten minutes); an explicit search gets the labeled degraded canvas, which says why.
  else if(!await withinDailyShare(env,request,live?'live':'search')) {
   if(live)return livePaused(env,data.q,untilUtcMidnight());
   i=degradedInterpretation(data.q,directory,!!current,'client_daily',data.mode);
  }
  // While the fictional employers are hidden, Jev is never offered them as options (owner decision 1).
  else try {const raw=await inference<unknown>(env,'/intent',{query:data.q,currentSlug:current?.slug??null,...liveMark,...(samplesEnabled(env)?{}:{includeSamples:false})},CANVAS_TIMEOUTS.intent);interpretationShape.parse(raw);i=raw as Interpretation;}
  catch(error) {
   const spent=error instanceof Error&&error.message===BUDGET_SPENT;
   // A spent live budget pauses Live quietly (never an error banner, never the degraded canvas while typing).
   if(live&&spent)return livePaused(env,data.q);
   i=degradedInterpretation(data.q,directory,!!current,spent?'budget':'unavailable',data.mode);
  }
 }
 const o:Overrides={...data.overrides},notes:string[]=[];
 if('company'in o) {
  const name=i.unlistedEmployer?.name??null,notices=unlistedNotices(name);i.notes=i.notes.filter(n=>!notices.includes(n));
  // The reader said the employer is one we do not list: nothing is shown in its place, never the current page.
  if(o.company==='unlisted'){i.company=null;i.route='unlisted';i.unlistedEmployer={name};i.notes.push(unlistedNotice(name,candidatesComplete(directory)));}
  else {const v=clean(o.company);i.company=v?chosen(v):null;i.unlistedEmployer=null;if(i.route==='unlisted')i.route=VIEW_ROUTE[i.view.value];}
 }
 // Employer-dependent chips chosen on another employer (the question now resolves elsewhere) are ignored, never applied
 // to an employer they were not chosen for; that employer's own reading of the question stands.
 if(o.scope&&o.scope!==(i.company?.value??current?.slug??null)) {
  const dropped=EMPLOYER_KEYS.filter(k=>k in o),timed=o.timeframe==='before_event'||o.timeframe==='after_event';
  for(const k of dropped)delete o[k];
  if(timed)delete o.timeframe;
  if(dropped.length||timed)notes.push(FOREIGN_SCOPE_NOTE);
 }
 if('compareTo'in o){const v=clean(o.compareTo);i.compareTo=v?chosen(v):null;}
 if('topic'in o){const t=o.topic??'other';i.topic=chosen(t);i.focus=t==='other'?[]:[t];}
 if('view'in o)i.view=chosen(o.view??'overview');
 if('layer'in o)i.layer=o.layer??null;
 if('event'in o){const v=clean(o.event);i.event=v?chosen(v):null;}
 if('timeframe'in o)i.timeframe=o.timeframe??'any';
 if('cohort'in o)i.cohorts={fn:clean(o.cohort),seniority:null};
 // Each group slot is its own chip: removing one never removes the other.
 if('cohortFunction'in o)i.cohorts={...i.cohorts,fn:clean(o.cohortFunction)};
 if('cohortSeniority'in o)i.cohorts={...i.cohorts,seniority:clean(o.cohortSeniority)};
 if('industry'in o)i.industry=clean(o.industry);
 if('preferences'in o)i.preferences=o.preferences?Object.fromEntries(Object.entries({...i.preferences,...o.preferences}).filter(([,d])=>d!=='any')):{};
 if('salaryDataRequired'in o){i.salaryDataRequired=false;i.notes=i.notes.filter(n=>n!==SALARY_NOTE);}
 const overridden=(field:string)=>{const base=field.split('.')[0]!;return (FIELD_KEYS[base]??[base]).some(k=>Object.hasOwn(o,k));};
 // An inferred value the reader edited is theirs now, no longer inferred.
 if(i.inferred)i.inferred=i.inferred.filter(x=>!overridden(x.field));
 i.forks=i.forks.filter(f=>!overridden(f.field));i.suggestions=i.suggestions.filter(s=>!overridden(s.field));
 if((i.timeframe==='before_event'||i.timeframe==='after_event')&&!i.event){i.timeframe='any';notes.push(NO_EVENT_NOTE);}
 // Forks without a tier come from older inference replies and are treated as asks.
 const asks=()=>i.forks.some(f=>f.tier!=='fork');
 i.route=settleRoute(i,{view:'view'in o,any:Object.keys(o).some(k=>k!=='page')});
 // The notice belongs to the needs_generation route only: once the reader picks a view, the page is that view.
 i.notes=i.notes.filter(n=>n!==NEEDS_GENERATION_NOTE);if(i.route==='needs_generation')i.notes.push(NEEDS_GENERATION_NOTE);
 // Degraded mode holds the canvas unless an exact company name (or the reader's own choice) gives it something to show.
 // A meaning fork stays the primary clarification (D8d) when this canvas adds an ask of its own (an event, a group).
 const settle=()=>{holdMeaningForAsk(i);i.clarify=asks()||(i.degraded&&!i.company)||i.route==='cannot_safely_answer'||i.route==='unlisted';};
 const respond=(payload:Record<string,unknown>,context:{events?:Array<{id:string;label:string}>;cohorts?:string[]}={})=>{
  settle();i.annotations=data.q.trim()?annotate(data.q,i,{directory,...context}):[];
  // Search preferences only rank employers in discovery; elsewhere a preference suggestion would change nothing (RT-A4).
  if(i.route!=='discovery')i.suggestions=i.suggestions.filter(s=>s.field!=='preferences');
  return json({interpretation:i,...payload,degraded:i.degraded,keepCanvas:i.clarify,...crisis});
 };
 settle();
 // None of these outcomes shows a single-employer view, so there is no canonical question for it.
 if(i.route==='cannot_safely_answer'){i.canonicalQuestion=null;return respond({evidence:null,view:'overview',compareEvidence:null,notices:['This site inspects workplace evidence. It cannot identify private people or answer unrelated requests.'],discovery:[],rephrasings:faqCatalog.slice(0,3).map(f=>f.question),answer:null});}
 if(i.route==='unlisted'){i.canonicalQuestion=null;return respond({evidence:null,view:'overview',compareEvidence:null,notices:[...i.notes,...notes],discovery:[],answer:null});}
 const slug=i.company?.value??current?.slug??null;
 if(!slug||i.view.value==='discovery') {
  i.canonicalQuestion=null;
  if(i.route!=='needs_generation')i.route='discovery';
  const found=await discover(env,i,directory);
  return respond({evidence:null,view:'discovery',compareEvidence:null,notices:[...i.notes,...notes,...found.notices],discovery:found.rows,applied:found.applied,unsupported:found.unsupported,directory,answer:answerFor({route:i.route as RouteId,view:'discovery',discovery:found})});
 }
 const company=directory.find(c=>c.slug===slug);
 if(!company)return json({error:'unknown_company'},404);
 // A foreign or undocumented event stays on the interpretation: the evidence compiler refuses it, says so and shows nothing
 // time-scoped for a before/after request, rather than broadening to the full history.
 const companyEvents=i.event||notes.includes(NO_EVENT_NOTE)?await getCompanyEvents(env,company.id):[];
 const scoped=i.timeframe==='before_event'||i.timeframe==='after_event',foreign=!!i.event&&!companyEvents.some(e=>e.id===i.event!.value);
 if((notes.includes(NO_EVENT_NOTE)||(foreign&&scoped))&&companyEvents.length&&!i.forks.some(f=>f.field==='event'))i.forks.push({field:'event',question:'Which documented event?',tier:'ask',options:companyEvents.slice(0,6).map(e=>({id:e.id,label:e.label,share:0}))});
 // The cohort view without a group asks before anything is ranked, so an ask never spends search budget.
 if(i.view.value==='cohort'&&!i.cohorts.fn&&!i.cohorts.seniority&&!i.forks.some(f=>f.field==='cohort')) {
  const groups=(await getCompanyCohorts(env,company.id)).filter(c=>c.dimension!=='all');
  if(groups.length)i.forks.push({field:'cohort',question:'Which group should we compare with the whole company?',tier:'ask',options:groups.slice(0,6).map(g=>({id:g.label,label:g.label,share:0}))});
 }
 settle();
 const page=o.page??0,confident=i.source==='jev'&&!i.degraded&&!i.clarify&&!i.forks.length;
 // Ranked accounts are pinned only on the first reader page; later pages are plain paging over the same filters. Only a
 // submitted question is ranked: Live understanding reads the question and never ranks accounts (RT-A5), so typing
 // spends one live call per reading and published accounts are sent to Jev only for a question the reader submitted.
 const rankable=!!data.q.trim()&&confident&&page===0&&!live;
 // The single-group chip pins the group label; per-slot chips are already applied to i.cohorts, which the compiler reads.
 const chips={...('cohort'in o&&!('cohortFunction'in o)&&!('cohortSeniority'in o)?{cohortLabelOverride:clean(o.cohort)}:{}),...('layer'in o?{layerOverride:o.layer??null}:{}),...('topic'in o?{topicFilter:o.topic??null}:{})};
 const pool=await loadAccountPool(env,company);
 let rankIds:string[]=[],rankFailed=false;
 if(rankable)try {
  const retrieved=await retrieval(env,data.q,company.id,started,live);
  rankIds=(await rankCandidates(env,company.id,i,data.q,{pool,...chips,retrieved})).slice(0,RANK_CANDIDATES_MAX);
 } catch {rankFailed=true;}
 const options={slug,interpretation:i,...chips};
 const evidence=await buildEvidence(env,{...options,accountPool:pool,testimonyPage:page,...(rankIds.length?{pinTestimonyIds:rankIds}:{})});if(!evidence)return json({error:'unknown_company'},404);
 if(rankIds.length&&evidence.testimony.length)try {
  const rank=await inference<{scores?:unknown}>(env,'/rank',{query:data.q,ids:rankIds,...liveMark},Math.min(CANVAS_TIMEOUTS.rank,CANVAS_TIMEOUTS.total-(Date.now()-started)));
  if(!Array.isArray(rank.scores))throw new Error('inference_unavailable');
  const scores=new Map((rank.scores as Array<{id?:unknown;relevance?:unknown}>).filter((s):s is {id:string;relevance:number}=>typeof s.id==='string'&&rankIds.includes(s.id)&&typeof s.relevance==='number'&&s.relevance>=0&&s.relevance<=1).map(s=>[s.id,s.relevance]));
  evidence.testimony=evidence.testimony.map(t=>scores.has(t.id)?{...t,relevance:scores.get(t.id)!}:t).sort((a,b)=>(b.relevance??-1)-(a.relevance??-1));
 } catch {rankFailed=true;}
 if(rankFailed)evidence.notices.push('Semantic source ranking is unavailable; original published accounts remain visible.');
 let compareEvidence:EvidencePayload|null=null;
 if(i.view.value==='compare'&&i.compareTo&&i.compareTo.value!==slug)compareEvidence=await buildEvidence(env,{...options,slug:i.compareTo.value});
 if(i.view.value==='compare'&&!compareEvidence)notes.push('Choose a second company to compare.');
 const other=compareEvidence,withheld=other?.suppressed.length??0;
 const compareNotices=other?[...other.notices.map(n=>`${other.company.name}: ${n}`),...(withheld?[`${other.company.name}: ${withheld} ${withheld===1?'result is':'results are'} withheld to protect small groups.`]:[])]:[];
 const comparisonTable:ComparisonTable|null=other?compareMetrics(evidence,other):null;
 // The table's own notes (group definitions, different questionnaires, fictional/real mix) are added once.
 const tableNotices=comparisonTable?comparisonTable.notices.filter(n=>!compareNotices.includes(n)):[];
 // The canonical question is the typed spec of what is shown, recomputed after the reader's edits (never model-chosen text).
 settle();
 const spec=i.route==='needs_generation'?null:specFromInterpretation(i,{cohorts:evidence.facets?.map(f=>f.label)??[],events:evidence.events.map(e=>e.id)});
 i.canonicalQuestion=spec?specId(spec):null;
 if(i.route==='existing_faq'&&!spec)i.route=VIEW_ROUTE[i.view.value];
 let interestCounted=false;
 if(data.countInterest&&data.mode==='submit'&&confident&&page===0&&spec) {
  // Counted at most once per client, employer, question and UTC day (rewording within the day never counts again).
  // Best effort: a limiter or write failure never fails the reader's canvas.
  try {
   const id=specId(spec),scope=`interest:${evidence.company.id}:${id}`;
   if((!env.INTEREST||(await env.INTEREST.limit({key:await clientKey(env,request,scope)})).success)&&await firstToday(env,request,scope)) {
    await env.DB.prepare('INSERT INTO faq_interest(company_id,canonical_id,period,count) VALUES(?,?,?,1) ON CONFLICT(company_id,canonical_id,period) DO UPDATE SET count=count+1').bind(evidence.company.id,id,quarter()).run();
    interestCounted=true;
   }
  } catch {interestCounted=false;}
 }
 // The headline answers the question's own topic (typed state), so a question and its shared link read alike (RT-A1).
 const answer=answerFor({route:i.route as RouteId,view:i.view.value,evidence,comparison:comparisonTable,topic:i.topic.value});
 return respond({evidence,view:i.view.value,compareEvidence,...(comparisonTable?{comparisonTable}:{}),notices:[...i.notes,...notes,...evidence.notices,...compareNotices,...tableNotices],discovery:[],interestCounted,answer},{events:evidence.events,cohorts:evidence.facets?.map(f=>f.label)??[]});
}
/** Optional semantic candidates from the inference worker (published text only); any failure or absence falls back to lexical retrieval. */
async function retrieval(env:Env,query:string,companyId:string,started:number,live=false):Promise<string[]> {
 try {
  const found=await inference<{ids?:unknown}>(env,'/retrieve',{query,companyId,...(live?{live:true}:{})},Math.min(CANVAS_TIMEOUTS.retrieve,CANVAS_TIMEOUTS.total-(Date.now()-started)));
  return Array.isArray(found.ids)?found.ids.filter((id):id is string=>typeof id==='string'&&/^[A-Za-z0-9_:-]{1,100}$/.test(id)).slice(0,24):[];
 } catch {return [];}
}

export const TRUST_PAGES=['constitution','privacy','terms','accessibility','moderation','transparency','legal-requests','source','finances'];
export const SPA_PATHS=['/submit','/contribute','/jury','/status'];
/** Routes a person opens in a browser: they answer with a page, never a JSON body, even when they fail. */
export const isPageRoute=(path:string)=>path==='/'||path.startsWith('/c/')||SPA_PATHS.includes(path)||TRUST_PAGES.includes(path.slice(1));
/**
 * A page route that failed: a plain page with the site's stylesheet, status 503 and Retry-After, never the raw
 * {"error":"request_failed"} body an API caller gets (seen once on /finances when a D1 read failed locally). It names
 * nothing about the failure.
 */
export function unavailablePage(path:string,buildId=CLIENT_BUILD_ID):Response {
 const again=isPageRoute(path)?path:'/';
 const body=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>Page unavailable — ${BRAND}</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/app.css?v=${encodeURIComponent(buildId)}"><script src="/theme.js?v=${encodeURIComponent(buildId)}"></script></head><body><div class="frame"><main class="page trust-document" id="main"><h1>This page could not be loaded.</h1><p>Something went wrong on our side while building it. Nothing you did caused this. Try again in a moment.</p><p><a href="${escapeHtml(again)}">Try again</a> · <a href="/">Go to the home page</a></p></main></div></body></html>`;
 return new Response(body,{status:503,headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','retry-after':'5'}});
}
/**
 * A mistyped address opened in a browser: a small page in the site's style with a way home, status 404, never the raw
 * {"error":"not_found"} body an API caller gets.
 */
export function notFoundPage(buildId=CLIENT_BUILD_ID):Response {
 const body=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>Page not found — ${BRAND}</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/app.css?v=${encodeURIComponent(buildId)}"><script src="/theme.js?v=${encodeURIComponent(buildId)}"></script></head><body><div class="frame"><main class="page trust-document" id="main"><h1>There is no page at this address.</h1><p>The address may be mistyped, or the page may have moved.</p><p><a href="/">Go to the home page</a> to search employers or open the directory.</p></main>${footerHtml}</div></body></html>`;
 return new Response(body,{status:404,headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store'}});
}
/**
 * Whether an unknown path gets the HTML 404 page: a GET from a browser (Accept names text/html) for something that is not
 * an API route, an archive, an image or another file. Everything else keeps the JSON 404 its caller parses.
 */
export function wantsPage(request:Request,path:string):boolean {
 return request.method==='GET'&&/\btext\/html\b/i.test(request.headers.get('accept')??'')&&!/^\/(?:api|archives|og|\.well-known)(?:\/|$)/.test(path)&&!/\.[A-Za-z0-9]{1,12}$/.test(path);
}
const notFound=(request:Request,path:string)=>wantsPage(request,path)?notFoundPage():json({error:'not_found'},404);
const SLUG=/^[a-z0-9][a-z0-9-]{0,89}$/;
/** Plain HTTP is served only on a developer's own machine. */
const LOCAL_HOSTS=new Set(['localhost','127.0.0.1','[::1]']);
/**
 * Every plain-HTTP request from anywhere but a local development host is redirected, permanently, to the same path and
 * query over HTTPS, before anything is read or answered: no page, search, contribution or credential is served in
 * cleartext. (HSTS is added with the other security headers; browsers heed it only once they arrive over HTTPS.)
 * A development stack (ENVIRONMENT=development, as every .dev.vars file sets) is never redirected: `wrangler dev` hands
 * the worker the custom-domain route's host (http://shouldiworkthere.com/…) rather than localhost, and rewrites the
 * Location back to localhost, so a redirect there loops. Production sets ENVIRONMENT=production, and
 * tools/verify-deployment.mjs fails a deployment whose plain HTTP is not redirected.
 */
export function httpsRedirect(request:Request,env:Pick<Env,'ENVIRONMENT'>):Response|null {
 const url=new URL(request.url);
 if(url.protocol!=='http:'||LOCAL_HOSTS.has(url.hostname)||env.ENVIRONMENT==='development')return null;
 url.protocol='https:';
 return new Response(null,{status:301,headers:{location:url.href,'cache-control':'public, max-age=86400'}});
}
/**
 * Trust pages only read (the transparency page's stats snapshot is an idempotent upsert), so a render that fails is tried
 * once more before the reader gets the unavailable page: a D1 read can fail transiently ("internal error"), and the next
 * requests to the same page succeeded.
 */
export async function renderTrustPage(render:()=>Promise<string>):Promise<string> {
 try {return await render();} catch {return await render();}
}
/** Routes this module answers with a fixed method: anything else gets 405 with an Allow header, never a page (WS-08). */
export const POST_ROUTES=['/api/canvas','/api/screen','/api/submit','/api/author','/api/withdraw','/api/employers','/api/directory/correct'];
const GET_ROUTES=['/theme.js','/app.js','/app.css','/pow-worker.js','/favicon.svg','/manifest.webmanifest','/sw.js','/robots.txt','/moderation/current.json','/.well-known/siwt-release.json','/api/config','/api/proof/keys','/api/directory','/api/source','/api/transparency','/',...SPA_PATHS,...TRUST_PAGES.map(p=>`/${p}`)];
export function allowedMethods(path:string):string|null {
 if(POST_ROUTES.includes(path))return 'POST';
 if(GET_ROUTES.includes(path)||/^\/moderation\/v\d{1,4}\.\d{1,4}\.\d{1,4}\.json$/.test(path)||path.startsWith('/og/')||path.startsWith('/archives/')||path.startsWith('/c/'))return 'GET, HEAD';
 return null;
}
/**
 * The inference binding as every module sees it: each call carries INFERENCE_CALLER_SECRET when one is configured, and
 * `extra` fields are added to the body of calls to `path` (the anonymous draft check marks its /screen calls precheck).
 */
function bound(binding:Fetcher,headers:Record<string,string>,path?:string,extra?:Record<string,unknown>):Fetcher {
 const call=(input:RequestInfo|URL,init?:RequestInit)=>{
  // A Request passed without init is re-issued with the headers added; otherwise the body is never read or re-wrapped.
  if(input instanceof Request&&!init){const merged=new Headers(input.headers);for(const [k,v] of Object.entries(headers))merged.set(k,v);return binding.fetch(new Request(input,{headers:merged}));}
  const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
  const merged=new Headers(init?.headers);for(const [k,v] of Object.entries(headers))merged.set(k,v);
  if(path&&extra&&new URL(url).pathname===path&&typeof init?.body==='string') {
   let parsed:unknown;try {parsed=JSON.parse(init.body);} catch {parsed=null;}
   if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return binding.fetch(url,{...init,headers:merged,body:JSON.stringify({...parsed,...extra})});
  }
  return binding.fetch(url,{...init,headers:merged});
 };
 return {fetch:call,connect:binding.connect?.bind(binding)} as unknown as Fetcher;
}
export function withCaller(env:Env):Env {
 return env.INFERENCE&&env.INFERENCE_CALLER_SECRET?{...env,INFERENCE:bound(env.INFERENCE,{[CALLER_HEADER]:env.INFERENCE_CALLER_SECRET})}:env;
}
/** Anonymous draft checks are charged to the pre-check share of the screening budget, never to what submissions need. */
const asPrecheck=(env:Env):Env=>env.INFERENCE?{...env,INFERENCE:bound(env.INFERENCE,{},'/screen',{precheck:true})}:env;
/** After a withdrawal, the inference worker deletes vectors of accounts that are no longer published (a no-op without the optional index). */
function sweepAfterWithdrawal(env:Env,ctx?:Pick<ExecutionContext,'waitUntil'>) {
 ctx?.waitUntil(inference(env,'/sweep',{},3000).then(()=>undefined,()=>undefined));
}
async function handle(request:Request,env:Env,path:string,ctx?:Pick<ExecutionContext,'waitUntil'>):Promise<Response> {
  try {
   if(request.method==='POST') {
    const origin=request.headers.get('origin');
    if(origin && origin!==new URL(request.url).origin)return json({error:'origin_not_allowed'},403);
    // Canvas requests are limited in their route, where live understanding has its own budget.
    if(path!=='/api/canvas'&&env.ABUSE && !(await env.ABUSE.limit({key:await clientKey(env,request,'post')})).success)return json({error:'rate_limited'},429);
   }
   const allow=allowedMethods(path);
   if(allow&&!allow.split(', ').includes(request.method))return json({error:'method_not_allowed'},405,{allow});
   let response:Response;
   if(path==='/theme.js')response=themeScriptResponse();
   else if(path==='/app.js')response=new Response(CLIENT_JS,{headers:{'content-type':'application/javascript','cache-control':'public,max-age=300'}});
   // The proof-of-work search runs in a same-origin Web Worker (the CSP allows only 'self' workers): shared/pow.ts.
   else if(path==='/pow-worker.js')response=new Response(powWorkerSource(),{headers:{'content-type':'text/javascript','cache-control':'public,max-age=300'}});
   else if(path==='/app.css')response=new Response(stylesheet(),{headers:{'content-type':'text/css','cache-control':'public,max-age=300'}});
   else if(path==='/favicon.svg')response=new Response(favicon(),{headers:{'content-type':'image/svg+xml'}});
   else if(path==='/manifest.webmanifest')response=json({name:BRAND,short_name:'Should I Work There',start_url:'/',display:'standalone',background_color:'#f5f7fc',theme_color:'#f5f7fc',icons:[{src:'/favicon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]});
   else if(path==='/sw.js')response=new Response("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));",{headers:{'content-type':'application/javascript','cache-control':'no-store'}});
   else if(path==='/robots.txt')response=new Response('User-agent: *\nDisallow: /api/\n',{headers:{'content-type':'text/plain'}});
   else if(path==='/moderation/current.json')response=new Response(null,{status:302,headers:{location:`/moderation/v${policy.version}.json`,'cache-control':'no-store'}});
   else if(/^\/moderation\/v\d{1,4}\.\d{1,4}\.\d{1,4}\.json$/.test(path)) {
    const document=await policyDocument(path.slice('/moderation/v'.length,-'.json'.length));
    response=document?new Response(canonicalJson(document.policy),{headers:{'content-type':'application/json','cache-control':'public,max-age=3600','x-policy-digest':document.digest}}):json({error:'not_found'},404);
   }
   else if(path==='/.well-known/siwt-release.json')response=releaseManifestResponse();
   else if(path.startsWith('/og/')) {
    // An employer's image is served only while the employer is visible: a hidden fictional employer's is not found.
    const slug=/^\/og\/c-([a-z0-9][a-z0-9-]{0,89})\.jpg$/.exec(path)?.[1];
    response=(slug&&!await getCompanyBySlug(env,slug)?null:ogImageResponse(path))??json({error:'not_found'},404);
   }
   else if(path==='/api/config') {
    // The UI must boot even if the moderation status read fails; then every moderation feature is reported off.
    const [moderation,link]=await Promise.all([moderationStatus(env).catch(()=>null),listingOpen(env)?verifierLinkState(env):Promise.resolve(null)]);
    // Mail reaches the operator only once routing is on AND delivery was verified end to end (shared/brand.ts).
    // sampleEmployers: whether fictional employers are shown. publication: written accounts publish in batches of
    // accountBatch per employer; questionnaire figures need aggregateMinimum. employerListing: POST /api/employers, whose
    // proof of work (shared/pow.ts) is bound to pow.origin, pow.action, pow.keyId and powSubject.domain(domain); attempts
    // per client (perClientPerDay) and per wider network, an IPv4 /24 or IPv6 /48 (perNetworkPerDay), each UTC day. It is
    // reported closed while the verifier refused the shared secret at the last scheduled check, when nothing could register.
    response=json({verifierOrigin:verifierOrigin(env),realPublicationEnabled:env.REAL_PUBLICATION_ENABLED==='true',policyVersion:policy.version,minimumCohort:aggregateMinimum(env),sampleEmployers:samplesEnabled(env),publication:{accountBatch:testimonyBatchMin(env),aggregateMinimum:aggregateMinimum(env)},employerListing:{open:listingOpen(env)&&link?.state!=='refused',perClientPerDay:LISTINGS_PER_CLIENT_PER_DAY,perNetworkPerDay:LISTINGS_PER_NETWORK_PER_DAY,pow:{version:POW_VERSION,bits:powBits(env.POW_BITS),windowMinutes:POW_WINDOW_MINUTES,worker:'/pow-worker.js',origin:new URL(request.url).origin,action:'add-employer',keyId:''}},juryEnabled:moderation?.juryEnabled??false,moderation,legal:{operator:LEGAL_NOTICE.operator,contact:{...CONTACT},contactReceivesMail:CONTACT_MAIL.routingEnabled&&CONTACT_MAIL.forwardingVerified,links:LEGAL_LINKS}});
   }
   else if(path==='/api/proof/keys')response=json({keys:await publicIssuerKeys(env)});
   else if(path==='/api/directory')response=json({companies:await getDirectory(env)});
   else if(path==='/api/source')response=json({license:'MIT for original Should I Work There code; dependency licenses apply',files:SOURCE_FILES});
   // listingCorrections: the public listing correction log (community.ts correctionLog): kind, reason, quarter and a digest
   // of the listing. verifierLink: whether the verifier accepted the shared secret at the last scheduled check, and that
   // UTC day (null before the first check); tools/verify-deployment.mjs fails on 'refused'.
   else if(path==='/api/transparency')response=json({stats:await publicStats(env),policy:policy.version,archives:(await env.DB.prepare('SELECT id,digest,previous_digest FROM release_manifests ORDER BY created_at DESC LIMIT 12').all()).results,listingCorrections:await correctionLog(env),verifierLink:await verifierLinkState(env)});
   else if(path.startsWith('/archives/')) {
    const name=path.slice('/archives/'.length);
    if(!/^transparency-\d{4}-\d{2}-\d{2}\.json$/.test(name))return json({error:'not_found'},404);
    const file=await env.ARCHIVES?.get(name);response=file?new Response(file.body,{headers:{'content-type':'application/json'}}):json({error:'not_found'},404);
   }
   else if(path==='/api/canvas'&&request.method==='POST') {
    // Live understanding (mode 'live') has its own, more generous budget and never spends the global POST limit or the
    // search budget; everything else here counts against the global POST limit as before. A live request over its budget
    // gets a 429 the client answers by pausing Live quietly and keeping the last view. Without a LIVE_LIMIT binding (an
    // older config or another environment) live requests fall back to the global POST limit, never to no limit at all.
    // A malformed or oversized body still counts against the global POST limit before it is refused (WS-06).
    let input:{mode?:unknown;q?:unknown}|null;
    try {input=await body(request) as {mode?:unknown;q?:unknown}|null;}
    catch(error) {
     if(env.ABUSE&&!(await env.ABUSE.limit({key:await clientKey(env,request,'post')})).success)return json({error:'rate_limited'},429);
     throw error;
    }
    const live=input?.mode==='live';
    const limiter=live?env.LIVE_LIMIT??env.ABUSE:env.ABUSE,scope=live&&env.LIVE_LIMIT?'live':'post';
    if(limiter&&!(await limiter.limit({key:await clientKey(env,request,scope)})).success)
     return live?livePaused(env,input?.q):json({error:'rate_limited',...crisisFor(env,input?.q)},429);
    response=await canvas(env,input,request);
   }
   else if(path==='/api/screen'&&request.method==='POST') {
    const data=z.object({approvedText:z.string().min(40).max(4000),consent:z.literal(true)}).strict().parse(await body(request));
    const crisis=crisisFor(env,data.approvedText);
    if(scanText(data.approvedText).some(f=>f.severity==='high'))return json({error:'remove_identifying_details',...crisis},422);
    if(env.INFER_LIMIT&&!(await env.INFER_LIMIT.limit({key:await clientKey(env,request,'screen')})).success)return json({error:'rate_limited',...crisis},429);
    // An anonymous check needs no credential, so it has its own daily share per client and is charged only to the
    // pre-check share of the screening budget: it can never leave submissions without screening (RT-ABUSE-02).
    if(!await withinDailyShare(env,request,'precheck')){const seconds=untilUtcMidnight();return json({error:'rate_limited',limit:'daily',retryAfterSeconds:seconds,...crisis},429,{'retry-after':String(seconds)});}
    // Jev's self_harm answer only adds support resources to this reply; it is never a policy signal and never stored.
    response=json(withResources(env,await screenApprovedText(asPrecheck(env),data.approvedText),data.approvedText));
   }
   else if(path==='/api/submit'&&request.method==='POST') {
    const input=await body(request) as {body?:unknown};
    // Support resources reach the author even when the submission itself fails.
    try {const result=await submit(env,input);response=json(withResources(env,result,input?.body),result.accepted?200:422);}
    catch(error) {const f=failure(error);return json({...f.body,...crisisFor(env,input?.body)},f.status);}
   }
   else if(path==='/api/author'&&request.method==='POST') {
    const data=await body(request) as {action?:unknown;body?:unknown};
    const revised=data?.action==='revise'?data.body:undefined;
    // Each revise is screened by hosted Jev, so it shares the screening limiter; single-use signed requests are enforced by submissions.ts.
    if(data?.action==='revise'&&env.INFER_LIMIT&&!(await env.INFER_LIMIT.limit({key:await clientKey(env,request,'screen')})).success)return json({error:'rate_limited',...crisisFor(env,revised)},429);
    try {
     const result=await authorAction(env,data);
     if(data?.action==='withdraw'&&result.ok)sweepAfterWithdrawal(env,ctx);
     response=json(withResources(env,result,revised),result.ok?200:400);
    } catch(error) {const f=failure(error);return json({...f.body,...crisisFor(env,revised)},f.status);}
   }
   else if(path==='/api/employers'&&request.method==='POST')response=await addEmployer(env,await body(request),request);
   // A listing correction a person reviewed under the terms ("Correcting a listing"): the operator's token only. It changes
   // a directory entry and its community keys, never an account (community.ts correctListing).
   else if(path==='/api/directory/correct'&&request.method==='POST') {
    if(!await operator(request,env))return json({error:'unauthorized'},401);
    const result=await correctListing(env,await body(request));response=json(result.body,result.status);
   }
   else if(path==='/api/withdraw'&&request.method==='POST') {
    const data=z.object({capability:z.string().max(100)}).strict().parse(await body(request));
    const result=await withdraw(env,data.capability);
    if(result.withdrawn)sweepAfterWithdrawal(env,ctx);
    response=json(result,result.withdrawn?200:404);
   }
   else if(path.startsWith('/api/admin/') || path.startsWith('/api/verify/'))response=json({error:'This legacy endpoint is retired. There is no unilateral moderator API.'},410);
   else if(path.startsWith('/api/ledger/')&&request.method==='POST') {
    if(!await operator(request,env))return json({error:'unauthorized'},401);
    response=path==='/api/ledger/finance'?json(await appendFinance(env,await body(request))):path==='/api/ledger/legal'?json(await appendLegal(env,await body(request))):json({error:'not_found'},404);
   }
   else if(TRUST_PAGES.includes(path.slice(1)))response=html(await renderTrustPage(()=>trustPage(path.slice(1),env,CLIENT_BUILD_ID)));
   else if(request.method==='GET'&&(path==='/'||path.startsWith('/c/')||SPA_PATHS.includes(path))) {
    // An employer the directory does not list is a 404 document, while the app shell still renders its honest "not in the
    // directory" state; an address that cannot be a slug at all gets the plain not-found page.
    const slug=path.startsWith('/c/')?path.slice(3):null;
    if(slug!==null&&!SLUG.test(slug))return notFound(request,path);
    const unknown=slug!==null&&!await getCompanyBySlug(env,slug),meta=await shellMeta(env,path,new URL(request.url).searchParams);
    response=html(appShell({title:`${BRAND} — know the workplace, protect the person`,description:'Workplace evidence you can inspect. Free access, no employer privileges, privacy-first contributions.',buildId:CLIENT_BUILD_ID,initialPath:path,meta:unknown?{...meta,title:`Employer not found — ${BRAND}`,description:'That employer is not in the directory.'}:meta}),unknown?404:200);
   }
   else response=await moderationRoutes(request,env,path)??notFound(request,path);
   return response;
  } catch(error) {
   const f=failure(error);
   // A person opening a page gets a page; API callers keep the JSON error.
   if(f.status>=500&&request.method==='GET'&&isPageRoute(path))return unavailablePage(path);
   return json(f.body,f.status);
  }
}
/** Scheduled work, in order. Each step runs even if an earlier one fails, so a moderation error never skips publication housekeeping or the archive; the first error is rethrown. */
export const SCHEDULED_STEPS:ReadonlyArray<(env:Env)=>Promise<unknown>>=[housekeeping,moderationHousekeeping,purgeDailyDigests,communityHousekeeping,archiveTransparency];
export async function runScheduled(env:Env,steps:ReadonlyArray<(env:Env)=>Promise<unknown>>=SCHEDULED_STEPS) {
 let first:unknown=null,failed=false;
 for(const step of steps)try {await step(env);} catch(error) {if(!failed){first=error;failed=true;}}
 if(failed)throw first;
}

export default {
 async fetch(original:Request,rawEnv:Env,ctx?:ExecutionContext):Promise<Response> {
  const env=withCaller(rawEnv);
  const head=original.method==='HEAD';const request=head?new Request(original,{method:'GET'}):original;
  const path=new URL(request.url).pathname.replace(/\/+$/,'')||'/';
  let response=httpsRedirect(request,env)??await handle(request,env,path,ctx);
  // Responses from other modules may carry immutable headers; security headers are applied to every response regardless.
  try {response.headers.set('x-content-type-options','nosniff');} catch {response=new Response(response.body,response);}
  for(const [name,value] of Object.entries(securityHeaders(env)))response.headers.set(name,value);
  for(const [name,value] of Object.entries(edgeHeaders(response.headers.get('cache-control'))))response.headers.set(name,value);
  return head?new Response(null,{status:response.status,headers:response.headers}):response;
 },
 async scheduled(_event:ScheduledController,env:Env) {await runScheduled(withCaller(env));},
};
