import type {Env,EvidencePayload,Interpretation,LayerId,MetricView,MetricSeriesPoint,SuppressionNote,TopicId,Provenance,TestimonyReading,ReadingDimension,TestimonyItem,CorroborationCluster,EventComparisonRow,FaqEntry,ComparisonCell,ComparisonTable,DiscoveryRow,DiscoveryValue,DiscoveryResult,DistributionBand,CompanyRef,AccountReading,CohortComparisonRow,EvidenceAnswer,RouteId,ViewId} from './types.ts';
import {starterSpecs,specId,specWording,specFromStoredId,relatedSpecs,specOverrides,type QuestionSpec} from '../../shared/faq.ts';
import {scanText,identifies} from '../../shared/privacy.ts';
import {visibleCompanySql} from './flags.ts';
/**
 * aliases: the curated ways of naming the employer (company_aliases); absent for employers matched by their name alone.
 * origin 'community': listed by a visitor, shown with its domain beside the name and labeled as added by the community
 * (absent for curated listings). domains: the work-mailbox domains verification accepts, primary first (absent when none).
 * communityDomains: those of `domains` that a visitor supplied (POST /api/employers), in the same order; on a curated
 * listing this is a domain attached to it, which the page labels as added by the community too (absent when none).
 */
export interface DirectoryEntry {id:string;slug:string;name:string;kind:'sample'|'real';sector?:string;aliases?:Array<{alias:string;cased:boolean}>;origin?:'community';domains?:string[];communityDomains?:string[];}
/**
 * Attaches each employer's curated aliases (public directory data, migration 0009). A database without the table yet (an
 * older schema during a rolling deploy) simply has none, so matching falls back to names.
 */
export async function withAliases<T extends {id?:string}>(db:D1Database,rows:T[]):Promise<Array<T&{aliases?:Array<{alias:string;cased:boolean}>}>> {
 let aliases:Array<{company_id:string;alias:string;cased:number}>=[];
 try {aliases=(await db.prepare('SELECT company_id,alias,cased FROM company_aliases ORDER BY company_id,alias').all<{company_id:string;alias:string;cased:number}>()).results;} catch {return rows;}
 const by=new Map<string,Array<{alias:string;cased:boolean}>>();
 for(const a of aliases)by.set(a.company_id,[...(by.get(a.company_id)??[]),{alias:a.alias,cased:a.cased===1}]);
 return rows.map(r=>{const own=r.id?by.get(r.id):undefined;return own?.length?{...r,aliases:own}:r;});
}
/**
 * Verification domains per employer (employer_domains, migration 0010), primary first. A database without the table yet
 * (an older schema during a rolling deploy) has none.
 */
type DomainRow={company_id:string;domain:string;source:string};
/** Verification domains per employer with where each came from ('curated' or 'community'), primary first. */
async function employerDomainRows(db:D1Database,companyId?:string):Promise<Map<string,Array<{domain:string;community:boolean}>>> {
 let rows:DomainRow[]=[];
 try {rows=(await (companyId?db.prepare('SELECT company_id,domain,source FROM employer_domains WHERE company_id=? ORDER BY position,domain').bind(companyId):db.prepare('SELECT company_id,domain,source FROM employer_domains ORDER BY company_id,position,domain')).all<DomainRow>()).results;} catch {return new Map();}
 const by=new Map<string,Array<{domain:string;community:boolean}>>();
 for(const r of rows)by.set(r.company_id,[...(by.get(r.company_id)??[]),{domain:r.domain,community:r.source==='community'}]);
 return by;
}
export async function employerDomains(db:D1Database,companyId?:string):Promise<Map<string,string[]>> {
 return new Map([...(await employerDomainRows(db,companyId))].map(([id,list])=>[id,list.map(d=>d.domain)]));
}
type CompanyRow={id:string;slug:string;name:string;kind:'sample'|'real';sector?:string|null;origin?:string|null};
/**
 * A companies row as the directory shows it: sector only when set, origin only for community listings, domains only when
 * configured, and communityDomains only when a visitor supplied one of them.
 */
function entry(row:CompanyRow,domains:Map<string,Array<{domain:string;community:boolean}>>,withSector:boolean):DirectoryEntry {
 const {origin,sector,...rest}=row,own=domains.get(row.id)??[],community=own.filter(d=>d.community).map(d=>d.domain);
 return {...rest,...(withSector?{sector:sector as string}:{}),...(origin==='community'?{origin:'community' as const}:{}),...(own.length?{domains:own.map(d=>d.domain)}:{}),...(community.length?{communityDomains:community}:{})};
}
/** Every employer a visitor may see: fictional sample employers only while SAMPLE_EMPLOYERS is 'on' (owner decision 1). */
export async function getDirectory(env:Pick<Env,'DB'|'SAMPLE_EMPLOYERS'>):Promise<DirectoryEntry[]> {
 const [rows,domains]=await Promise.all([env.DB.prepare(`SELECT id,slug,name,kind,sector,origin FROM companies WHERE ${visibleCompanySql(env)} ORDER BY CASE kind WHEN 'real' THEN 0 ELSE 1 END,name`).all<CompanyRow>(),employerDomainRows(env.DB)]);
 return withAliases(env.DB,rows.results.map(r=>entry(r,domains,true)));
}
/** One employer a visitor may see, or null (a hidden fictional employer is as absent as an unknown one). */
export async function getCompanyBySlug(env:Pick<Env,'DB'|'SAMPLE_EMPLOYERS'>,slug:string):Promise<DirectoryEntry|null> {
 const row=await env.DB.prepare(`SELECT id,slug,name,kind,origin FROM companies WHERE slug=? AND ${visibleCompanySql(env)}`).bind(slug).first<CompanyRow>();
 return row?entry(row,await employerDomainRows(env.DB,row.id),false):null;
}
export async function getCompanyEvents(env:Pick<Env,'DB'>,id:string) {return (await env.DB.prepare('SELECT id,slug,label,kind,occurred_on AS occurredOn,disclosure FROM events WHERE company_id=? ORDER BY occurred_on').bind(id).all<EvidencePayload['events'][number]>()).results;}
export async function getCompanyCohorts(env:Pick<Env,'DB'>,id:string) {return (await env.DB.prepare('SELECT id,label,dimension,parent_id AS parentId FROM cohorts WHERE company_id=? AND public=1').bind(id).all<{id:string;label:string;dimension:string;parentId:string|null}>()).results;}
export interface SuppressibleCell {id:string;metric_id:string;metric_key:string;label:string;period:string;n:number;}
export function suppressCells<T extends SuppressibleCell>(rows:T[],threshold:number) {
 const suppressedIds=new Set<string>(); const notes:SuppressionNote[]=[]; const groups=new Map<string,T[]>();
 for(const row of rows) {const key=`${row.metric_id}:${row.period}`;groups.set(key,[...(groups.get(key)??[]),row]);}
 for(const group of groups.values()) if(group.some(r=>r.n<threshold)) for(const row of group) {
  suppressedIds.add(row.id);notes.push({metricKey:row.metric_key,metricLabel:row.label,period:row.period,reason:row.n<threshold?'cohort_below_minimum':'complementary_suppression'});
 }
 return {suppressedIds,notes};
}
export function periodBounds(period:string):[number,number] {
 const m=/^(20\d{2})(?:-Q([1-4]))?$/.exec(period);if(!m)return [NaN,NaN];
 const year=Number(m[1]),q=m[2]?Number(m[2]):null;
 return [Date.UTC(year,q?(q-1)*3:0,1),Date.UTC(q?year:year+1,q?q*3:0,1)-1];
}
type EventRow=EvidencePayload['events'][number];
type CohortRow={id:string;label:string;dimension:string;parentId:string|null};
/**
 * Before/after pairs for a documented event. The before period must end before the event and after the
 * previous documented event; the after period must start after the event and before the next one. Other
 * documented events that still fall inside the window are listed so a change is never attributed to one
 * event alone. Distribution metrics never produce deltas.
 */
export function eventComparison(metrics:MetricView[],date:string,others:readonly {id:string;label:string;occurredOn:string|null}[]=[]):EventComparisonRow[] {
 const at=Date.parse(date);
 const dated=others.map(e=>({id:e.id,label:e.label,occurredOn:e.occurredOn,t:Date.parse(e.occurredOn??'')})).filter(e=>Number.isFinite(e.t));
 const prev=Math.max(-Infinity,...dated.filter(e=>e.t<at).map(e=>e.t)),next=Math.min(Infinity,...dated.filter(e=>e.t>at).map(e=>e.t));
 return metrics.flatMap(m=>{
  if(m.responseType==='distribution')return [];
  const points=m.series.filter(p=>p.value!==null);
  const before=points.filter(p=>{const end=periodBounds(p.period)[1];return end<at&&end>prev;}).at(-1);
  const after=points.find(p=>{const start=periodBounds(p.period)[0];return start>at&&start<next;});
  if(!before||!after)return [];
  const from=periodBounds(before.period)[0],to=periodBounds(after.period)[1];
  return [{key:m.key,label:m.label,unit:m.unit,before,after,window:{from:before.period,to:after.period},alsoInWindow:dated.filter(e=>e.t>=from&&e.t<=to).map(({id,label,occurredOn})=>({id,label,occurredOn}))}];
 });
}
/** Each topic's measures, most direct first: the first published one of the question's topic heads the page and the answer. */
export const topicMetrics:Record<string,string[]>={promotion:['promotions_clarity','promotion_wait_years'],management:['manager_trust','bad_news_upward','perf_review_fairness'],compensation:['comp_vs_market','compensation'],workload:['workload_hours','workload'],layoffs:['layoffs_handled','exec_trust','return_intent'],culture:['exec_trust','return_intent','manager_return'],location_policy:[]};
const METRIC_TOPIC:Record<string,TopicId>={promotions_clarity:'promotion',promotion_wait_years:'promotion',manager_trust:'management',bad_news_upward:'management',perf_review_fairness:'management',manager_return:'management',comp_vs_market:'compensation',compensation:'compensation',workload_hours:'workload',workload:'workload',layoffs_handled:'layoffs',exec_trust:'culture',return_intent:'culture'};
const TOPIC_IDS:readonly TopicId[]=['promotion','management','compensation','workload','layoffs','location_policy','culture','other'];
const LAYERS:readonly LayerId[]=['experience','claim','opinion'];
const TOPIC_NAMES:Record<TopicId,string>={promotion:'promotions',management:'management',compensation:'compensation',workload:'workload',layoffs:'layoffs and restructuring',location_policy:'remote and office policy',culture:'culture and leadership',other:'all topics'};
const concept=(key:string)=>key.replace(/^survey_/,'');
const minCohortN=(env:Pick<Env,'MIN_COHORT_N'>)=>Math.max(25,Number(env.MIN_COHORT_N)||25);
const minClusterN=(env:Pick<Env,'MIN_CLUSTER_N'>)=>Math.max(2,Number(env.MIN_CLUSTER_N)||5);

// Published accounts: descriptive reading, topics, provenance and render-time privacy defenses.
const DIMENSIONS:readonly ReadingDimension[]=['direct_manager','executive_management','promotion_clarity','performance_fairness','workload','compensation'];
const MENTIONS=['layoff','reorg','compensation','hours','promotion','retaliation','harassment','discrimination'];
const SPECIFICITY=['general','some_detail','specific'] as const;
export const READING_MIN_CONFIDENCE=.6;
const probability=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?Math.min(1,Math.max(0,v)):0;
type StoredAnswer={type?:unknown;choice?:unknown;confidence?:unknown;noul?:unknown;score?:unknown;probabilities?:unknown};
/** Maps a stored analysis to the public reading. Only descriptive keys are read; risk signals and anything else are dropped. */
export function readingFrom(raw:unknown,model:string,promptVersion:string):TestimonyReading|undefined {
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return undefined;
 const a=raw as Record<string,StoredAnswer|undefined>;
 const dimensions=Object.fromEntries(DIMENSIONS.map(key=>{
  const v=a[key],confidence=probability(v?.confidence),choice=String(v?.choice);
  return [key,{value:v?.type==='choice'&&confidence>=READING_MIN_CONFIDENCE&&['positive','negative','mixed','unknown'].includes(choice)?choice:'unknown',confidence:Math.round(confidence*100)/100}];
 })) as TestimonyReading['dimensions'];
 const mentions=MENTIONS.filter(m=>{const v=a[`mentions_${m}`];return v?.type==='noul'&&probability(v.noul)>=READING_MIN_CONFIDENCE;});
 const s=a.specificity;let specificity:TestimonyReading['specificity']=null;
 if(s?.type==='score'&&probability(s.confidence)>=READING_MIN_CONFIDENCE) {
  const ranked=s.probabilities&&typeof s.probabilities==='object'?Object.entries(s.probabilities as Record<string,unknown>).map(([k,p])=>[Number(k),probability(p)] as const).filter(([k])=>Number.isInteger(k)&&k>=0&&k<SPECIFICITY.length).sort((x,y)=>y[1]-x[1]):[];
  const level=ranked[0]?.[0]??(typeof s.score==='number'&&Number.isFinite(s.score)?Math.min(2,Math.max(0,Math.round(s.score))):null);
  specificity=level===null?null:SPECIFICITY[level]??null;
 }
 return {dimensions,mentions,specificity,model,promptVersion};
}
const TOPIC_PATTERNS:[TopicId,RegExp][]=[['promotion',/promot|advancement|career progression|leveling/i],['management',/\bmanag|supervisor|\bboss\b|performance review/i],['compensation',/\bpay\b|\bpaid\b|salar|compensation|bonus|equity|commission|\bwages?\b/i],['workload',/\bhours\b|workload|on-call|overtime|weekend|burnout|staffing|schedul|\bbreaks?\b|work-life|work life/i],['layoffs',/layoff|laid off|let go|reduction in force|restructur|severance|buyout|reorg/i],['location_policy',/remote|relocat|\boffice\b|on-site|onsite|hybrid|commute/i],['culture',/leadership|executive|culture|\btrust\b|disconnected|morale/i]];
const MENTION_TOPIC:Record<string,TopicId>={layoff:'layoffs',reorg:'layoffs',compensation:'compensation',hours:'workload',promotion:'promotion',retaliation:'culture',harassment:'culture',discrimination:'culture'};
const DIMENSION_TOPIC:Record<ReadingDimension,TopicId>={direct_manager:'management',performance_fairness:'management',promotion_clarity:'promotion',executive_management:'culture',workload:'workload',compensation:'compensation'};
/** Deterministic topic tags: public wording and topic labels, plus confident descriptive readings. */
export function accountTopics(body:string,labels:readonly string[],reading?:TestimonyReading):TopicId[] {
 const text=`${body}\n${labels.join('\n')}`,out=new Set<TopicId>(TOPIC_PATTERNS.filter(([,p])=>p.test(text)).map(([t])=>t));
 for(const m of reading?.mentions??[]){const t=MENTION_TOPIC[m];if(t)out.add(t);}
 if(reading)for(const key of DIMENSIONS)if(reading.dimensions[key].value!=='unknown')out.add(DIMENSION_TOPIC[key]);
 return [...out].sort();
}
/** Publication stamps are served at quarter precision only. */
export function reportingQuarter(stamp:string|null|undefined):string {
 const s=String(stamp??'');if(/^20\d{2}-Q[1-4]$/.test(s))return s;
 const m=/^(\d{4})-(\d{2})/.exec(s),month=Number(m?.[2]);
 return m&&month>=1&&month<=12?`${m[1]}-Q${Math.floor((month-1)/3)+1}`:'';
}
export const WITHHELD_BODY='[Withheld: contains a direct identifier]';
export const SANDBOX_LABEL='Sandbox contribution — not employment-verified';
export const LEGACY_CREDENTIAL_LABEL='Earlier demonstration credential — not employment-verified';
export const UNRECORDED_LABEL='Verification not recorded — not employment-verified';
export const MAILBOX_LABEL='Work mailbox verified; relationship self-reported';
export const FIXTURE_TESTIMONY_LABEL='Illustrative testimony',FIXTURE_METHOD_LABEL='Illustrative fixture; not employee responses';
// Defense in depth for rows published before intake screening existed: identifying text is never served or sent to inference.
// A note addressed to the checks is held at intake but is not an identifier, so it never withholds a published account.
export const hasDirectIdentifier=(body:string)=>scanText(body).some(identifies);
// Provenance is recognised positively: only seeded rows on fictional employers are fixtures, and anything unrecognised is
// never presented as employment-verified. Stored class strings are mapped to fixed labels because legacy ones carry claim ids.
const SEED_CLASS=/^Verified employment relationship with [^,;]+ at the time described$/,SEED_BATCH=/^batch-20\d{2}-h[12]$/;
/** Public migration 0004 replaces stored kernel-era class strings (which carried claim ids) with exactly this value. */
export const LEGACY_CREDENTIAL_CLASS='Earlier demonstration credential; not employment-verified';
const isSandbox=(v:string|null|undefined)=>/sandbox|not employment-verified/i.test(v??'');
export function classifyTestimony(kind:CompanyRef['kind'],verificationClass:string,releaseBatch:string):{provenance:Provenance;label:string} {
 if(kind==='sample'&&SEED_CLASS.test(verificationClass)&&SEED_BATCH.test(releaseBatch))return {provenance:'fixture',label:FIXTURE_TESTIMONY_LABEL};
 if(kind==='real'&&/^Work mailbox verified\b/.test(verificationClass))return {provenance:'credentialed',label:MAILBOX_LABEL};
 if(verificationClass===LEGACY_CREDENTIAL_CLASS||/single use credential/i.test(verificationClass))return {provenance:'sandbox',label:LEGACY_CREDENTIAL_LABEL};
 return isSandbox(verificationClass)?{provenance:'sandbox',label:SANDBOX_LABEL}:{provenance:'unverified',label:UNRECORDED_LABEL};
}
export function classifyRelease(kind:CompanyRef['kind'],r:{id:string;release_method:string|null;release_batch:string}):{provenance:Provenance;method:string} {
 if(r.id.startsWith('aggregate:')) {
  const cls=r.id.split(':')[3];
  if(cls==='demo')return {provenance:'sandbox',method:r.release_method?`${SANDBOX_LABEL}. ${r.release_method}`:SANDBOX_LABEL};
  if(cls==='mailbox'&&kind==='real'&&r.release_method&&!isSandbox(r.release_method))return {provenance:'credentialed',method:r.release_method};
 }
 else if(kind==='sample'&&r.release_method===null&&SEED_BATCH.test(r.release_batch))return {provenance:'fixture',method:FIXTURE_METHOD_LABEL};
 return {provenance:'unverified',method:UNRECORDED_LABEL};
}
/** analysisHeld: the account's release group is still being analysed, so nothing derived from its analysis is served (RT-LINK-01). */
export interface Account {id:string;layer:LayerId;body:string;period:string|null;cohort_id:string|null;event_id:string|null;verification_class:string;release_batch:string;published_at:string;event_label:string|null;reading?:TestimonyReading;labels:{topic:string;stance:string;salience:number}[];topicIds:TopicId[];withheld:boolean;analysisHeld:boolean;provenance:Provenance;verificationLabel:string;}
/** Published, non-withdrawn accounts of one employer. Load once per request and share between rankCandidates and buildEvidence; never cache across requests, so a withdrawal takes effect immediately. */
export interface AccountPool {readonly companyId:string;readonly kind:CompanyRef['kind'];readonly accounts:readonly Account[];/** More than MAX_ACCOUNTS exist; only the newest were loaded. */readonly truncated:boolean;}
export const MAX_ACCOUNTS=1000,PAGE_ACCOUNTS=40;
/**
 * RT-LINK-01. Accounts are analysed one at a time after they are published, so readings that appeared as each analysis
 * landed would show the order in which accounts were analysed, and through it (were that order ever to follow submission
 * order) which author wrote which account. A release group is the accounts of one employer published in one quarter for
 * one period and verification class (the public release_batch is the publication quarter). Everything derived from an
 * account's analysis (its reading, the model-reading tallies, reading-based topic tags, pair judgments and semantic
 * retrieval) is held for the whole group until every account in it that can be analysed has been, or until the quarter
 * it was released in has ended, whichever comes first, so the group's readings appear together. Accounts withheld for a
 * direct identifier are never analysed and never hold a group; seeded and legacy rows (no quarter stamp) are not held.
 */
export const releaseGroupKey=(a:{period:string|null;verification_class:string;release_batch:string})=>JSON.stringify([a.period??null,a.verification_class,a.release_batch]);
export async function heldReleaseGroups(env:Pick<Env,'DB'>,companyId:string,now=new Date()):Promise<Set<string>> {
 const current=reportingQuarter(now.toISOString()),open="t.company_id=? AND t.withdrawn_at IS NULL AND a.testimony_id IS NULL AND t.release_batch GLOB '20[0-9][0-9]-Q[1-4]' AND t.release_batch>=?";
 const [groups,rows]=await Promise.all([
  env.DB.prepare(`SELECT t.period,t.verification_class,t.release_batch,COUNT(*) AS pending FROM testimony t LEFT JOIN evidence_analysis a ON a.testimony_id=t.id WHERE ${open} GROUP BY t.period,t.verification_class,t.release_batch`).bind(companyId,current).all<{period:string|null;verification_class:string;release_batch:string;pending:number}>(),
  env.DB.prepare(`SELECT t.period,t.verification_class,t.release_batch,t.body FROM testimony t LEFT JOIN evidence_analysis a ON a.testimony_id=t.id WHERE ${open} LIMIT ${MAX_ACCOUNTS}`).bind(companyId,current).all<{period:string|null;verification_class:string;release_batch:string;body:string}>(),
 ]);
 // A group whose only unanalysed accounts are withheld ones is complete; any other unanalysed account (or one not scanned
 // here, past the limit) holds it.
 const withheld=new Map<string,number>();
 for(const r of rows.results)if(hasDirectIdentifier(r.body)){const key=releaseGroupKey(r);withheld.set(key,(withheld.get(key)??0)+1);}
 return new Set(groups.results.map(g=>({key:releaseGroupKey(g),pending:Number(g.pending)})).filter(g=>g.pending>(withheld.get(g.key)??0)).map(g=>g.key));
}
export async function loadAccountPool(env:Pick<Env,'DB'>,company:{id:string;kind:CompanyRef['kind']},now=new Date()):Promise<AccountPool> {
 const held=await heldReleaseGroups(env,company.id,now);
 const [records,labels]=await Promise.all([
  env.DB.prepare(`SELECT t.id,t.layer,t.body,t.period,t.cohort_id,t.event_id,t.verification_class,t.release_batch,t.published_at,e.label AS event_label,a.analysis_json,a.model AS analysis_model,a.prompt_version AS analysis_prompt FROM testimony t LEFT JOIN events e ON e.id=t.event_id LEFT JOIN evidence_analysis a ON a.testimony_id=t.id WHERE t.company_id=? AND t.withdrawn_at IS NULL ORDER BY t.published_at DESC,t.id LIMIT ${MAX_ACCOUNTS+1}`).bind(company.id).all<Omit<Account,'reading'|'labels'|'topicIds'|'withheld'|'provenance'|'verificationLabel'>&{analysis_json:string|null;analysis_model:string|null;analysis_prompt:string|null}>(),
  env.DB.prepare('SELECT tt.testimony_id,tt.topic,tt.stance,tt.salience FROM testimony_topics tt JOIN testimony t ON t.id=tt.testimony_id WHERE t.company_id=? AND t.withdrawn_at IS NULL ORDER BY tt.salience DESC,tt.topic').bind(company.id).all<{testimony_id:string;topic:string;stance:string;salience:number}>(),
 ]);
 const byId=new Map<string,Account['labels']>();for(const l of labels.results)byId.set(l.testimony_id,[...(byId.get(l.testimony_id)??[]),{topic:l.topic,stance:l.stance,salience:l.salience}]);
 // Newest reporting quarter first, then by id: order within a quarter must not reveal publication sequence.
 const accounts=records.results.slice(0,MAX_ACCOUNTS).map(({analysis_json,analysis_model,analysis_prompt,...r})=>{
  const {provenance,label}=classifyTestimony(company.kind,r.verification_class,r.release_batch),analysisHeld=held.has(releaseGroupKey(r));
  // Withheld text contributes nothing derived from it (reading, labels, topic tags), so filters cannot probe it.
  if(hasDirectIdentifier(r.body))return {...r,labels:[],topicIds:[],withheld:true,analysisHeld,provenance,verificationLabel:label};
  let parsed:unknown;try{parsed=analysis_json&&!analysisHeld?JSON.parse(analysis_json):undefined;}catch{parsed=undefined;}
  const reading=readingFrom(parsed,analysis_model??'',analysis_prompt??''),own=byId.get(r.id)??[];
  return {...r,...(reading?{reading}:{}),labels:own,topicIds:accountTopics(r.body,own.map(l=>l.topic),reading),withheld:false,analysisHeld,provenance,verificationLabel:label};
 }).sort((a,b)=>reportingQuarter(b.published_at).localeCompare(reportingQuarter(a.published_at))||a.id.localeCompare(b.id));
 return {companyId:company.id,kind:company.kind,accounts,truncated:records.results.length>MAX_ACCOUNTS};
}
const poolFor=(env:Pick<Env,'DB'>,company:{id:string;kind:CompanyRef['kind']},pool?:AccountPool,now?:Date)=>pool&&pool.companyId===company.id&&pool.kind===company.kind?Promise.resolve(pool):loadAccountPool(env,company,now);
/** Pair judgments are analysis output too: none involving an account of a held release group is used (RT-LINK-01). */
const visiblePairs=(pairs:readonly PairJudgment[],accounts:readonly Account[])=>{const held=new Set(accounts.filter(a=>a.analysisHeld).map(a=>a.id));return held.size?pairs.filter(p=>!held.has(p.left_id)&&!held.has(p.right_id)):[...pairs];};
function toItem(a:Account):TestimonyItem {
 const base={id:a.id,layer:a.layer,period:a.period,eventLabel:a.event_label,verificationClass:a.verificationLabel,provenance:a.provenance,publishedAt:reportingQuarter(a.published_at)};
 return a.withheld?{...base,body:WITHHELD_BODY,topics:[],topicIds:[],withheld:true}:{...base,body:a.body,topics:a.labels,topicIds:a.topicIds,...(a.reading?{reading:a.reading}:{})};
}

// Corroboration: a cluster is a clique of distinct sources; copies merge into one source.
export interface PairJudgment {left_id:string;right_id:string;same_event:number;copied:number;}
export const SAME_EVENT_MIN=.85,COPY_MIN=.5,INDEPENDENT_MAX=.2;
/** Search budgets: each clique search gets its own budget, bounded overall so a dense adversarial graph cannot exhaust CPU. */
export const CLIQUE_STEPS_PER_SEARCH=10000,CLIQUE_STEPS_TOTAL=100000;
function largestClique(nodes:readonly string[],adj:Map<string,Set<string>>,budget:{steps:number;exhausted:boolean}):string[] {
 let best:string[]=[];
 const near=(v:string)=>adj.get(v)??new Set<string>();
 const expand=(r:string[],p:string[],x:string[]):void=>{
  if(budget.steps<=0){budget.exhausted=true;return;}
  budget.steps--;
  if(r.length+p.length<=best.length)return;
  if(!p.length){if(!x.length)best=r;return;}
  const pivot=[...p,...x].reduce((a,b)=>near(b).size>near(a).size?b:a);
  for(const v of p.filter(v=>!near(pivot).has(v))){expand([...r,v],p.filter(u=>near(v).has(u)),x.filter(u=>near(v).has(u)));p=p.filter(u=>u!==v);x=[...x,v];}
 };
 expand([],[...nodes],[]);return best;
}
/** Nodes that can still belong to a clique of `size`: repeatedly drop nodes with fewer than size-1 neighbours left. */
function core(nodes:readonly string[],adj:Map<string,Set<string>>,size:number):string[] {
 let left=new Set(nodes),changed=true;
 while(changed){changed=false;for(const v of [...left]){let degree=0;for(const u of adj.get(v)??[])if(left.has(u))degree++;if(degree<size-1){left.delete(v);changed=true;}}}
 return [...left].sort();
}
/**
 * Returns disjoint clusters as lists of sources (each source = member ids, representative first).
 * Accounts judged copies (copied >= COPY_MIN) are one source. Two sources are linked only when every judged
 * pair between them describes the same event (same_event >= SAME_EVENT_MIN) and is independently worded
 * (copied < INDEPENDENT_MAX); a cluster requires every pair of its sources to be linked.
 * `complete` is false when a search stopped on its budget: every returned cluster is still a true clique,
 * but some potential clusters may not have been evaluated.
 */
export function corroborate(ids:readonly string[],pairs:readonly PairJudgment[],minSources:number):string[][][] {return corroborateDetailed(ids,pairs,minSources).clusters;}
export function corroborateDetailed(ids:readonly string[],pairs:readonly PairJudgment[],minSources:number):{clusters:string[][][];complete:boolean} {
 const pool=new Set(ids),parent=new Map([...pool].map(id=>[id,id]));
 const root=(id:string)=>{let r=id;while(parent.get(r)!==r)r=parent.get(r)!;return r;};
 const edges=pairs.filter(p=>p.left_id!==p.right_id&&pool.has(p.left_id)&&pool.has(p.right_id));
 for(const p of edges)if(p.copied>=COPY_MIN){const [a,b]=[root(p.left_id),root(p.right_id)].sort() as [string,string];if(a!==b)parent.set(b,a);}
 const sources=new Map<string,string[]>();for(const id of [...pool].sort())sources.set(root(id),[...(sources.get(root(id))??[]),id]);
 const link=new Map<string,boolean>();
 for(const p of edges){const [a,b]=[root(p.left_id),root(p.right_id)].sort() as [string,string];if(a===b)continue;const key=`${a}\n${b}`;link.set(key,(link.get(key)??true)&&p.same_event>=SAME_EVENT_MIN&&p.copied<INDEPENDENT_MAX);}
 const adj=new Map<string,Set<string>>();
 for(const [key,ok] of link)if(ok){const [a,b]=key.split('\n') as [string,string];adj.set(a,(adj.get(a)??new Set()).add(b));adj.set(b,(adj.get(b)??new Set()).add(a));}
 const clusters:string[][][]=[],minimum=Math.max(2,minSources);let remaining=core([...adj.keys()],adj,minimum),total=CLIQUE_STEPS_TOTAL,complete=true;
 while(remaining.length>=minimum) {
  if(total<=0){complete=false;break;}
  const budget={steps:Math.min(CLIQUE_STEPS_PER_SEARCH,total),exhausted:false},start=budget.steps;
  const clique=largestClique(remaining,adj,budget);total-=start-budget.steps;
  if(budget.exhausted)complete=false;
  if(clique.length<minimum)break;
  clusters.push(clique.map(r=>sources.get(r)!));remaining=core(remaining.filter(r=>!clique.includes(r)),adj,minimum);
 }
 return {clusters,complete};
}
async function loadPairs(env:Pick<Env,'DB'>,companyId:string) {
 return (await env.DB.prepare('SELECT p.left_id,p.right_id,p.same_event,p.copied FROM evidence_pairs p JOIN testimony l ON l.id=p.left_id JOIN testimony r ON r.id=p.right_id WHERE l.company_id=? AND r.company_id=? AND l.withdrawn_at IS NULL AND r.withdrawn_at IS NULL ORDER BY p.left_id,p.right_id').bind(companyId,companyId).all<PairJudgment>()).results;
}
function clusterPayload(sources:string[][],byId:Map<string,Account>,kind:CompanyRef['kind']):CorroborationCluster {
 const members=sources.flatMap(s=>s.map(id=>({a:byId.get(id)!,duplicateOf:id===s[0]?null:s[0]!})));
 const kinds=new Set(members.map(m=>m.a.provenance)),provenance=kinds.size===1?[...kinds][0]!:'mixed';
 const noun={fixture:'illustrative',sandbox:'sandbox (not employment-verified)',credentialed:'credentialed',unverified:'not employment-verified',mixed:'mixed-provenance'}[provenance];
 const periods=members.map(m=>m.a.period).filter((p):p is string=>!!p).sort();
 const shared=new Map<string,number>();for(const s of sources)for(const t of new Set(s.flatMap(id=>byId.get(id)!.labels.map(l=>l.topic))))shared.set(t,(shared.get(t)??0)+1);
 return {clusterKey:members[0]!.a.id,summary:`Potentially related ${noun} accounts`,reporterCount:sources.length,duplicates:members.length-sources.length,firstReport:periods[0]??'Period not reported',lastReport:periods.at(-1)??'Period not reported',topics:[...shared].filter(([,n])=>n>=2).map(([t])=>t).sort(),sourceIds:members.map(m=>m.a.id),isSample:kind==='sample',provenance,members:members.map(({a,duplicateOf})=>({id:a.id,body:a.body,period:a.period,layer:a.layer,provenance:a.provenance,duplicateOf}))};
}

// Metric releases.
type Row=SuppressibleCell & {company_id:string;question:string;response_type:MetricView['responseType'];unit:string;direction:MetricView['direction'];method_note:string;verification_method:string;release_method:string|null;exclusions:string|null;cohort_id:string|null;cohort_label:string|null;value:number;ci_low:number|null;ci_high:number|null;event_id:string|null;release_batch:string;};
const RELEASES=`SELECT r.id,r.company_id,r.metric_id,d.key AS metric_key,d.label,d.question,d.response_type,d.unit,d.direction,d.method_note,COALESCE(r.verification_method,d.verification_method) AS verification_method,r.verification_method AS release_method,d.exclusions,r.cohort_id,c.label AS cohort_label,r.period,r.value,r.n,r.ci_low,r.ci_high,r.event_id,r.release_batch FROM metric_releases r JOIN metric_definitions d ON d.id=r.metric_id LEFT JOIN cohorts c ON c.id=r.cohort_id`;
async function loadBands(env:Pick<Env,'DB'>,where:string,binds:unknown[]) {
 const rows=(await env.DB.prepare(`SELECT b.release_id,b.band,b.share FROM distribution_bands b JOIN metric_releases r ON r.id=b.release_id JOIN metric_definitions d ON d.id=r.metric_id WHERE d.response_type='distribution' AND ${where} ORDER BY b.release_id,b.sort_order`).bind(...binds).all<{release_id:string;band:string;share:number}>()).results;
 const out=new Map<string,DistributionBand[]>();for(const r of rows)out.set(r.release_id,[...(out.get(r.release_id)??[]),{band:r.band,share:r.share}]);return out;
}
// A distribution's stored value is a placeholder unless its definition documents it as a median (weekly hours);
// an allowlisted key, a median method note and a positive value are all required before it is shown or thresholded.
const MEDIAN_KEYS=new Set(['workload_hours']);
export const medianOf=(r:{response_type:string;metric_key:string;method_note:string;value:number})=>r.response_type==='distribution'&&MEDIAN_KEYS.has(r.metric_key)&&/\bmedian\b/i.test(r.method_note)&&Number.isFinite(r.value)&&r.value>0?r.value:null;
function metricViews(rows:Row[],bands:Map<string,DistributionBand[]>,kind:CompanyRef['kind'],cohortLabel:string):MetricView[] {
 return [...new Set(rows.map(r=>r.metric_key))].map(key=>{
  const group=rows.filter(r=>r.metric_key===key),first=group[0]!,last=group.at(-1)!,dist=first.response_type==='distribution';
  const series:MetricSeriesPoint[]=group.map(r=>({period:r.period,value:dist?null:r.value,n:r.n,ciLow:dist?null:r.ci_low,ciHigh:dist?null:r.ci_high,eventId:r.event_id,releaseId:r.id,releaseBatch:r.release_batch,...(dist?{bands:bands.get(r.id)??[],median:medianOf(r)}:{})}));
  const latest=series.at(-1)!,prev=dist?undefined:series.at(-2),{provenance,method}=classifyRelease(kind,last);
  return {key,label:first.label,question:first.question,unit:first.unit,direction:first.direction,responseType:first.response_type,methodNote:first.method_note,verificationMethod:method,provenance,topic:METRIC_TOPIC[concept(key)]??null,exclusions:first.exclusions,cohortLabel,series,latest,delta:prev&&latest.value!==null&&prev.value!==null?latest.value-prev.value:null,deltaPeriod:prev?.period??null};
 });
}

/** Stand-ins for a group or industry label that nothing publishes: such text is never repeated back. */
export const REQUESTED_GROUP='the requested group',REQUESTED_GROUPS='the requested groups',REQUESTED_INDUSTRY='the requested industry';
/** The requested labels as they may be repeated: verbatim only when every one is a published group label. */
export function groupLabel(requested:readonly string[],published:ReadonlySet<string>):string {
 return requested.every(l=>published.has(l))?requested.join(' + '):requested.length>1?REQUESTED_GROUPS:REQUESTED_GROUP;
}
/** Which of these labels some employer publishes as a group (the whole-company group excluded). */
export async function publishedGroupLabels(env:Pick<Env,'DB'|'SAMPLE_EMPLOYERS'>,labels:readonly string[]):Promise<Set<string>> {
 if(!labels.length)return new Set();
 // Only employers a visitor may see count: a hidden fictional employer's group label is never repeated back.
 return new Set((await env.DB.prepare(`SELECT DISTINCT label FROM cohorts WHERE public=1 AND dimension<>'all' AND label IN (${labels.map(()=>'?').join(',')}) AND company_id IN (SELECT id FROM companies WHERE ${visibleCompanySql(env)})`).bind(...labels).all<{label:string}>()).results.map(r=>r.label));
}
// Requested scope, shared by the evidence compiler and candidate retrieval so both apply the same filters.
interface Scope {requested:string[];selected?:CohortRow;all?:CohortRow;unavailable:boolean;broad:boolean;label:string;layer:LayerId|null;topic:TopicId|null;requestedEvent:string|null;event:EventRow|null;scoped:boolean;blocked:boolean;timed:boolean;inWindow:(period:string|null)=>boolean;}
/** Page filters that chips can override. rankCandidates takes the same ones so candidates match the page. */
export interface ScopeOverrides {cohortLabelOverride?:string|null;layerOverride?:LayerId|null;topicFilter?:string|null;}
function resolveScope(i:Interpretation,cohorts:CohortRow[],events:EventRow[],o:ScopeOverrides,now:Date):Scope {
 const requested=o.cohortLabelOverride!==undefined?(o.cohortLabelOverride?[o.cohortLabelOverride]:[]):[i.cohorts.fn,i.cohorts.seniority].filter((v):v is string=>!!v);
 const all=cohorts.find(c=>c.dimension==='all'),selected=requested.length===1?cohorts.find(c=>c.label===requested[0]):undefined;
 const unavailable=requested.length>1||(requested.length===1&&!selected),broad=requested.length===0||selected?.dimension==='all';
 // Only published group labels are ever repeated; anything else a caller sends is "the requested group". Labels this
 // employer does not publish are checked against every employer by buildEvidence (groupLabel).
 const unavailableLabel=groupLabel(requested,new Set(cohorts.map(c=>c.label)));
 const rawLayer=o.layerOverride!==undefined?o.layerOverride:i.layer,rawTopic=o.topicFilter!==undefined?(o.topicFilter??'other'):i.topic.value;
 const requestedEvent=i.event?.value??null,event=requestedEvent?events.find(e=>e.id===requestedEvent)??null:null;
 const scoped=i.timeframe==='before_event'||i.timeframe==='after_event',timeline=i.view.value==='timeline';
 const blocked=scoped&&!event?.occurredOn&&!timeline,at=event?.occurredOn?Date.parse(event.occurredOn):NaN,lastYear=now.getUTCFullYear()-1;
 const timed=i.timeframe==='last_year'||(scoped&&!timeline&&!blocked);
 const inWindow=(period:string|null)=>{
  if(blocked)return false;
  const [start,end]=periodBounds(period??'');
  if(i.timeframe==='last_year')return new Date(start).getUTCFullYear()===lastYear;
  if(scoped&&!timeline)return i.timeframe==='after_event'?start>at:end<at;
  return true;
 };
 return {requested,selected,all,unavailable,broad,label:unavailable?unavailableLabel:selected?.label??'All contributors',layer:LAYERS.includes(rawLayer as LayerId)?rawLayer as LayerId:null,topic:TOPIC_IDS.includes(rawTopic as TopicId)&&rawTopic!=='other'?rawTopic as TopicId:null,requestedEvent,event,scoped,blocked,timed,inWindow};
}
const inScope=(accounts:readonly Account[],s:Scope)=>s.unavailable?[]:accounts.filter(a=>(s.broad||a.cohort_id===s.selected?.id)&&(!s.layer||a.layer===s.layer)&&s.inWindow(a.period));

export interface BuildOptions extends ScopeOverrides {
 slug:string;interpretation:Interpretation;allowCohortFallback?:boolean;
 /** Ids from rankCandidates; kept on page 0 when they pass the filters. */pinTestimonyIds?:readonly string[];
 /** The request's account pool (loadAccountPool), so accounts are read and scanned once per request. */accountPool?:AccountPool;
 /** Zero-based reader page over accounts matching the filters. */testimonyPage?:number;
 /** Clock for last_year and the FAQ interest window; defaults to the current time. */now?:Date;
}
export async function buildEvidence(env:Env,options:BuildOptions):Promise<EvidencePayload|null> {
 const company=await getCompanyBySlug(env,options.slug);if(!company)return null;
 const [events,cohorts]=await Promise.all([getCompanyEvents(env,company.id),getCompanyCohorts(env,company.id)]);
 const i=options.interpretation,notes:string[]=[],now=options.now??new Date(),s=resolveScope(i,cohorts,events,options,now);
 if(s.unavailable&&(s.label===REQUESTED_GROUP||s.label===REQUESTED_GROUPS))s.label=groupLabel(s.requested,await publishedGroupLabels(env,s.requested));
 if(s.unavailable)notes.push(`No privacy-approved release exists for ${s.label}. Choose a broader group to continue.`);
 if(s.requestedEvent&&!s.event)notes.push(`The selected event is not documented for ${company.name}, so it was not applied${s.scoped?' and no before/after results are shown':''}.`);
 else if(s.scoped&&!s.event)notes.push(`Before/after results need one of ${company.name}'s documented events. Nothing was substituted.`);
 else if(s.scoped&&!s.event?.occurredOn)notes.push(`${s.event!.label} has no documented date, so before/after results are not shown.`);
 const rows=(await env.DB.prepare(`${RELEASES} WHERE r.company_id=? ORDER BY d.sort_order,r.period`).bind(company.id).all<Row>()).results;
 const suppression=suppressCells(rows,minCohortN(env)),published=rows.filter(r=>!suppression.suppressedIds.has(r.id));
 const [bands,pool,allPairs]=await Promise.all([loadBands(env,'r.company_id=?',[company.id]),poolFor(env,company,options.accountPool,now),loadPairs(env,company.id)]);
 const accounts=pool.accounts,pairs=visiblePairs(allPairs,accounts);
 if(pool.truncated)notes.push(`Only the newest ${MAX_ACCOUNTS} accounts for ${company.name} are searched, shown and checked for clusters.`);
 const groupRows=s.unavailable?[]:published.filter(r=>s.broad?(r.cohort_id===null||r.cohort_id===s.all?.id):r.cohort_id===s.selected?.id);
 const visible=groupRows.filter(r=>s.inWindow(r.period));
 if(s.requested.length&&!s.unavailable&&!groupRows.length)notes.push('This cohort has no publishable cells. Company-wide evidence has not been substituted.');
 else if(s.timed&&groupRows.length&&!visible.length)notes.push('No published results for this group fall inside the selected period. Results from other periods were not substituted.');
 const metrics=metricViews(visible,bands,company.kind,s.label).sort(byPriority(priorityOf(i,options.topicFilter!==undefined?s.topic:undefined)));
 const eligible=inScope(accounts,s),matching=s.topic?eligible.filter(a=>a.topicIds.includes(s.topic!)):eligible;
 // Account counts below MIN_ACCOUNT_COUNT are never stated, here as in answers.
 if(s.topic&&matching.length<eligible.length)notes.push(`Showing ${matching.length>=MIN_ACCOUNT_COUNT?`the ${matching.length} of ${eligible.length}`:'only'} accounts related to ${TOPIC_NAMES[s.topic]}. Remove the topic to read every account.`);
 const page=Math.max(0,Math.floor(Number(options.testimonyPage)||0)),from=page*PAGE_ACCOUNTS,pinned=new Set(page===0?options.pinTestimonyIds??[]:[]);
 // A work-mailbox verified account names the employer's verification domains (the mailbox was at one of them).
 const domains=company.domains;
 const testimony=matching.filter((a,index)=>(index>=from&&index<from+PAGE_ACCOUNTS)||pinned.has(a.id)).map(toItem).map(t=>t.provenance==='credentialed'&&domains?.length?{...t,verificationDomains:domains}:t);
 const withheld=testimony.filter(t=>t.withheld).length;
 if(withheld)notes.push(`${withheld} account${withheld===1?' is':'s are'} withheld from display because ${withheld===1?'it contains':'they contain'} a direct identifier.`);
 const byId=new Map(accounts.map(a=>[a.id,a]));
 const found=corroborateDetailed(matching.filter(a=>!a.withheld).map(a=>a.id),pairs,minClusterN(env)),clusters=found.clusters.map(c=>clusterPayload(c,byId,company.kind));
 if(!found.complete)notes.push('Some potential clusters could not be fully evaluated within the time limit. Every cluster shown meets the rule, but the list may be incomplete.');
 // Evidence Lens: accounts and clusters related to each metric by topic, drawn from the accounts the page's filters
 // (group, layer, time and topic chip) select, so every related id can be reached by paging the reader.
 const shown=new Set(testimony.map(t=>t.id));
 for(const m of metrics)if(m.topic&&m.topic!=='other'){const topic=m.topic;m.related={testimonyIds:relatedAccounts(matching,topic,shown),clusterKeys:clusters.filter(c=>clusterAbout(c,byId,topic)).map(c=>c.clusterKey)};}
 const accountReadings=readingsOf(matching);
 const accountsMentioning=s.topic&&matching.length>=MIN_ACCOUNT_COUNT?{topic:s.topic,count:matching.length}:null;
 let cohortComparison:CohortComparisonRow[]|undefined;
 if(i.view.value==='cohort') {
  cohortComparison=cohortRows(rows,published,suppression.suppressedIds,s,company.kind);
  if(!cohorts.some(c=>c.dimension!=='all'))notes.push(noGroupsNote(company.name));
  else if(!s.requested.length||(s.broad&&!s.unavailable))notes.push('Choose one of this employer\'s published groups to compare it with the whole company.');
 }
 // A topic names its own distribution (pay or weekly hours) and never borrows the other. With no topic chosen, the
 // distribution view shows a published distribution rather than an empty headline: weekly hours first (the one the FAQ
 // spec of a topic-less distribution names), then pay.
 const patterns=s.topic==='compensation'?[/comp/]:s.topic==='workload'?[/hours|workload/]:!s.topic&&i.view.value==='distribution'?[/hours|workload/,/comp/]:[];
 const distributionFor=(pattern:RegExp)=>visible.filter(r=>r.response_type==='distribution'&&pattern.test(r.metric_key)&&(bands.get(r.id)?.length??0)>0).sort((a,b)=>b.period.localeCompare(a.period)||a.metric_key.localeCompare(b.metric_key))[0];
 const distributionRow=patterns.map(distributionFor).find(r=>r!==undefined);
 const distribution=distributionRow?{metricKey:distributionRow.metric_key,label:distributionRow.label,unit:distributionRow.unit,period:distributionRow.period,median:medianOf(distributionRow),n:distributionRow.n,releaseId:distributionRow.id,bands:bands.get(distributionRow.id)!}:null;
 if(i.view.value==='distribution'&&!distribution)notes.push(s.topic==='compensation'||s.topic==='workload'?`No published ${TOPIC_NAMES[s.topic]} distribution exists for this group and period.`:'Distributions are published only for pay categories and weekly hours. Choose one of those topics.');
 const event=s.event,comparison=event?.occurredOn?eventComparison(metrics,event.occurredOn,events.filter(e=>e.id!==event.id)):[];
 const confounders=[...new Map(comparison.flatMap(r=>r.alsoInWindow).map(e=>[e.id,e.label])).values()];
 if(event&&confounders.length)notes.push(`Some before/after windows also contain ${confounders.join(', ')}. Those changes cannot be attributed to ${event.label} alone.`);
 const periods=[...new Set(visible.map(r=>r.period))].sort();
 const timeStatus=s.blocked?'not_applied' as const:s.timed?'applied' as const:'any' as const;
 const outsideTimeframe=timeStatus==='applied'?[...new Set(groupRows.map(r=>r.metric_key))].filter(k=>!visible.some(r=>r.metric_key===k)):[];
 const trail=await faqTrail(env,company.id,{published,bands,accounts,pairs,cohorts,events,kind:company.kind,minCluster:minClusterN(env)},now);
 return {company,cohortLabel:s.label,cohortStatus:s.unavailable?'unavailable':s.broad?'all':'selected',metrics,events,clusters,testimony,distribution,coverage:{verifiedContributors:Math.max(0,...visible.map(r=>r.n)),releasesPublished:visible.length,periodsCovered:periods.length,firstPeriod:periods[0]??null,lastPeriod:periods.at(-1)??null,corroboratedClusters:clusters.length,latestPeriodResponses:visible.filter(r=>r.period===periods.at(-1)).reduce((sum,r)=>sum+r.n,0)},suppressed:suppression.notes,notices:notes,timeStatus,outsideTimeframe,testimonyPaging:{page,pageSize:PAGE_ACCOUNTS,matching:matching.length,hasMore:matching.length>from+PAGE_ACCOUNTS},trail,generatedAt:new Date().toISOString(),selectedEvent:event,comparison,facets:cohorts.filter(c=>c.dimension!=='all').map(c=>({label:c.label,dimension:c.dimension})),...(cohortComparison?{cohortComparison}:{}),accountReadings,accountsMentioning};
}

/**
 * Measure order for a question: the primary topic's measures in their listed order, then the other focus topics' (RT-A1).
 * A topic chip (`chip`, null for "all topics") replaces the reading. Focus is ordered with the primary topic first by
 * the interpreter, but it is reordered here as well so an older reading cannot put a secondary topic ahead.
 */
export function priorityOf(i:Pick<Interpretation,'topic'|'focus'>,chip?:TopicId|null):string[] {
 const topics=chip!==undefined?(chip?[chip]:[]):[...(i.topic.value!=='other'?[i.topic.value]:[]),...i.focus.filter(t=>t!==i.topic.value)];
 return [...new Set(topics.flatMap(t=>topicMetrics[t]??[]))];
}
/** Sorts measures by their index in the priority list (earlier first); measures outside it keep questionnaire order after them. */
export const byPriority=(priority:readonly string[])=>(a:{key:string},b:{key:string})=>{const x=priority.indexOf(concept(a.key)),y=priority.indexOf(concept(b.key));return (x<0?Infinity:x)-(y<0?Infinity:y)||0;};
/** Counts of written accounts below this are never stated. */
export const MIN_ACCOUNT_COUNT=5,RELATED_MAX=12;
/** Related accounts for a metric topic: matching accounts only, the ones on the current page first; never padded. */
function relatedAccounts(accounts:readonly Account[],topic:TopicId,shown:Set<string>):string[] {
 const hits=accounts.filter(a=>!a.withheld&&a.topicIds.includes(topic));
 return [...hits.filter(a=>shown.has(a.id)),...hits.filter(a=>!shown.has(a.id))].slice(0,RELATED_MAX).map(a=>a.id);
}
/** A cluster is about a topic when at least half of its distinct sources mention it. */
function clusterAbout(c:CorroborationCluster,byId:Map<string,Account>,topic:TopicId):boolean {
 const sources=c.members.filter(m=>m.duplicateOf===null);
 return sources.filter(m=>byId.get(m.id)?.topicIds.includes(topic)).length*2>=sources.length&&sources.length>0;
}
/**
 * Model readings of written accounts per dimension (not votes). A dimension is listed only when it has at least
 * MIN_ACCOUNT_COUNT confident readings and none of its cells holds 1 to MIN_ACCOUNT_COUNT-1 accounts: suppressing a single
 * small cell would not help while the total and the other cells are shown, so the whole dimension is left out.
 */
function readingsOf(accounts:readonly Account[]):AccountReading[] {
 return DIMENSIONS.flatMap(dimension=>{
  const split={positive:0,negative:0,mixed:0};
  for(const a of accounts){if(a.withheld)continue;const v=a.reading?.dimensions[dimension].value;if(v==='positive'||v==='negative'||v==='mixed')split[v]++;}
  const total=split.positive+split.negative+split.mixed,small=Object.values(split).some(n=>n>0&&n<MIN_ACCOUNT_COUNT);
  return total>=MIN_ACCOUNT_COUNT&&!small?[{dimension,accounts:total,...split}]:[];
 });
}
export const noGroupsNote=(employer:string)=>`${employer} has no published groups, so there is nothing to compare with the whole company.`;
/**
 * Cohort view: the selected group's latest published cell per metric beside the company-wide cell for the same period.
 * Distributions are left out (their stored value is not a statistic). Nothing is substituted: a missing or suppressed
 * group cell is stated as such and the company-wide cell is shown only as itself.
 */
function cohortRows(all:Row[],published:Row[],suppressed:Set<string>,s:Scope,kind:CompanyRef['kind']):CohortComparisonRow[] {
 const target=!s.unavailable&&!s.broad&&s.selected?s.selected.id:null;
 if(!target&&!s.unavailable)return [];
 const scalar=(r:Row)=>r.response_type!=='distribution'&&s.inWindow(r.period);
 const broad=published.filter(r=>scalar(r)&&(r.cohort_id===null||r.cohort_id===s.all?.id));
 const own=target?published.filter(r=>scalar(r)&&r.cohort_id===target):[];
 const hidden=target?all.filter(r=>scalar(r)&&r.cohort_id===target&&suppressed.has(r.id)):[];
 const cell=(r:Row|undefined):CohortComparisonRow['cohort']=>{
  if(!r)return null;
  const {provenance,method}=classifyRelease(kind,r);
  return {value:r.value,n:r.n,period:r.period,releaseId:r.id,cohortLabel:r.cohort_id===target?s.label:'All contributors',verificationMethod:method,provenance};
 };
 const listed=new Set([...own,...broad,...hidden]);
 // Rows are already in questionnaire order (definition sort order, then period).
 const keys=[...new Set(all.filter(r=>listed.has(r)).map(r=>r.metric_key))];
 return keys.map(key=>{
  const mine=own.filter(r=>r.metric_key===key).at(-1),company=broad.filter(r=>r.metric_key===key),ref=(mine??company[0]??hidden.find(r=>r.metric_key===key))!;
  if(mine)return {key,label:ref.label,unit:ref.unit,cohort:cell(mine),company:cell(company.find(r=>r.period===mine.period)),status:'ok' as const};
  return {key,label:ref.label,unit:ref.unit,cohort:null,company:cell(company.at(-1)),status:hidden.some(r=>r.metric_key===key)?'suppressed' as const:'cohort_unavailable' as const};
 });
}

// Emergent FAQ: starter specs plus popular specs, each shown only where its evidence exists. Counts never leave this module.
/** At most FAQ_MAX_ENTRIES questions; popular questions keep up to FAQ_MAX_POPULAR slots so emergent ones are not crowded out. */
export const FAQ_POPULAR_MIN=10,FAQ_WINDOW_QUARTERS=4,FAQ_MAX_ENTRIES=12,FAQ_MAX_POPULAR=6;
export function trailingQuarters(now=new Date(),count=FAQ_WINDOW_QUARTERS):string[] {
 const out:string[]=[];let year=now.getUTCFullYear(),q=Math.floor(now.getUTCMonth()/3)+1;
 for(let k=0;k<count;k++){out.push(`${year}-Q${q}`);if(--q===0){q=4;year--;}}
 return out;
}
interface FaqContext {published:Row[];bands:Map<string,DistributionBand[]>;accounts:readonly Account[];pairs:PairJudgment[];cohorts:CohortRow[];events:EventRow[];kind:CompanyRef['kind'];minCluster:number;clusterMemo?:Map<string,boolean>;}
function specHasEvidence(spec:QuestionSpec,ctx:FaqContext):boolean {
 const all=ctx.cohorts.find(c=>c.dimension==='all'),cohort=spec.cohort===undefined?null:ctx.cohorts.find(c=>c.label===spec.cohort&&c.dimension!=='all');
 if(cohort===undefined)return false;
 const event=spec.event===undefined?null:ctx.events.find(e=>e.id===spec.event&&e.occurredOn);
 if(event===undefined)return false;
 const rows=ctx.published.filter(r=>cohort?r.cohort_id===cohort.id:(r.cohort_id===null||r.cohort_id===all?.id));
 const keys=topicMetrics[spec.topic]??[],scalar=rows.filter(r=>r.response_type!=='distribution'&&(spec.topic==='other'||keys.includes(concept(r.metric_key))));
 if(spec.view==='overview')return scalar.length>0;
 if(spec.view==='timeline'){const views=metricViews(scalar,ctx.bands,ctx.kind,'');return event?eventComparison(views,event.occurredOn!,ctx.events.filter(e=>e.id!==event.id)).length>0:views.some(m=>m.series.length>1);}
 if(spec.view==='distribution'){const pattern=spec.topic==='compensation'?/comp/:/hours|workload/;return rows.some(r=>r.response_type==='distribution'&&pattern.test(r.metric_key)&&(ctx.bands.get(r.id)?.length??0)>0);}
 const pool=ctx.accounts.filter(a=>!a.withheld&&(!cohort||a.cohort_id===cohort.id)&&(!spec.layer||a.layer===spec.layer)&&(spec.topic==='other'||a.topicIds.includes(spec.topic)));
 if(spec.view==='reader')return pool.length>0;
 const memo=ctx.clusterMemo??=new Map(),key=`${cohort?.id??''}|${spec.layer??''}|${spec.topic}`;
 if(!memo.has(key))memo.set(key,corroborate(pool.map(a=>a.id),ctx.pairs,ctx.minCluster).length>0);
 return memo.get(key)!;
}
async function faqTrail(env:Pick<Env,'DB'>,companyId:string,ctx:FaqContext,now:Date):Promise<FaqEntry[]> {
 const quarters=trailingQuarters(now);
 const interest=(await env.DB.prepare(`SELECT canonical_id,SUM(count) AS count FROM faq_interest WHERE company_id=? AND period IN (${quarters.map(()=>'?').join(',')}) GROUP BY canonical_id`).bind(companyId,...quarters).all<{canonical_id:string;count:number}>()).results;
 const popularity=new Map<string,{spec:QuestionSpec;count:number}>();
 for(const row of interest){const spec=specFromStoredId(row.canonical_id);if(!spec)continue;const id=specId(spec);popularity.set(id,{spec,count:(popularity.get(id)?.count??0)+Number(row.count)});}
 const label=(spec:QuestionSpec)=>ctx.events.find(e=>e.id===spec.event)?.label??null;
 const layoffEvent=ctx.events.filter(e=>(e.kind==='layoff'||e.kind==='reorg')&&e.occurredOn).sort((a,b)=>b.occurredOn!.localeCompare(a.occurredOn!))[0];
 const starters=starterSpecs.flatMap(spec=>spec.topic==='layoffs'&&spec.view==='timeline'?(layoffEvent?[{...spec,event:layoffEvent.id}]:[]):[spec]).filter(spec=>specHasEvidence(spec,ctx));
 const seen=new Set(starters.map(specId));
 const popular=[...popularity.values()].filter(p=>p.count>=FAQ_POPULAR_MIN&&!seen.has(specId(p.spec))&&specHasEvidence(p.spec,ctx)).sort((a,b)=>b.count-a.count||specId(a.spec).localeCompare(specId(b.spec))).map(p=>p.spec);
 const brief=(spec:QuestionSpec)=>({specId:specId(spec),question:specWording(spec,{event:label(spec)}),overrides:specOverrides(spec)});
 const shownPopular=popular.slice(0,FAQ_MAX_POPULAR),shownStarters=starters.slice(0,FAQ_MAX_ENTRIES-shownPopular.length);
 const merged:[QuestionSpec,FaqEntry['origin']][]=[];
 for(let k=0;k<Math.max(shownStarters.length,shownPopular.length);k++){if(shownStarters[k])merged.push([shownStarters[k]!,'starter']);if(shownPopular[k])merged.push([shownPopular[k]!,'popular']);}
 return merged.map(([spec,origin])=>({...brief(spec),origin,followUps:relatedSpecs(spec).filter(f=>specHasEvidence(f,ctx)).slice(0,3).map(brief)}));
}

/** Two-company comparison over the union of metrics, with explicit per-side availability and provenance. */
export function compareMetrics(left:EvidencePayload,right:EvidencePayload):ComparisonTable {
 const cell=(side:EvidencePayload,m:MetricView|undefined,period:string|null,key:string):ComparisonCell=>{
  if(side.cohortStatus==='unavailable')return {status:'group_unavailable',cohortLabel:side.cohortLabel};
  if(side.timeStatus==='not_applied')return {status:'filter_not_applied',reason:`The before/after filter needs a documented, dated event for ${side.company.name}; none was applied, so no results are shown.`};
  if(!m){
   if(side.outsideTimeframe.includes(key))return {status:'outside_timeframe'};
   const other=side.metrics.find(x=>concept(x.key)===concept(key));return other?{status:'different_instrument',metricKey:other.key}:{status:'not_published'};
  }
  const p=period?m.series.find(x=>x.period===period):undefined;
  if(!p)return {status:'no_matching_period',latestPeriod:m.latest?.period??null};
  return {status:'value',metricKey:m.key,period:p.period,value:p.value,...(p.bands?{bands:p.bands,median:p.median??null}:{}),n:p.n,releaseId:p.releaseId,verificationMethod:m.verificationMethod,provenance:m.provenance,cohortLabel:m.cohortLabel};
 };
 const rows=[...new Set([...left.metrics,...right.metrics].map(m=>m.key))].map(key=>{
  const a=left.metrics.find(m=>m.key===key),b=right.metrics.find(m=>m.key===key),ref=(a??b)!;
  const aligned=a&&b?a.series.filter(p=>b.series.some(q=>q.period===p.period)).at(-1)?.period??null:null;
  const at=(m:MetricView|undefined)=>a&&b?aligned:m?.latest?.period??null;
  return {key,label:ref.label,unit:ref.unit,responseType:ref.responseType,alignedPeriod:aligned,left:cell(left,a,at(a),key),right:cell(right,b,at(b),key)};
 });
 const notices=right.notices.map(n=>`${right.company.name}: ${n}`);
 if(left.cohortStatus!=='all'||right.cohortStatus!=='all')notices.push(`Groups are defined by each employer: ${left.company.name} shows ${left.cohortLabel}; ${right.company.name} shows ${right.cohortLabel}.`);
 if(rows.some(r=>r.left.status==='different_instrument'||r.right.status==='different_instrument'))notices.push('Some measures come from different questionnaires at each employer and are not paired.');
 if(left.company.kind!==right.company.kind)notices.push('This comparison mixes a fictional demonstration employer with a real employer.');
 const side=(e:EvidencePayload)=>({company:e.company,cohortLabel:e.cohortLabel,cohortStatus:e.cohortStatus,timeStatus:e.timeStatus});
 return {left:side(left),right:side(right),rows,notices,suppressed:right.suppressed};
}

// Discovery: explicit, unit-aware predicates over published releases; no synthetic cross-unit score.
interface ConceptDef {label:string;unit:'percent'|'hours'|'years';better:'high'|'low';keys:readonly string[];topics:readonly TopicId[];}
export const DISCOVERY_CONCEPTS:Readonly<Record<string,ConceptDef>>={
 return_intent:{label:'Would work here again',unit:'percent',better:'high',keys:['return_intent','survey_return_intent'],topics:['culture','layoffs']},
 manager_trust:{label:'Manager keeps commitments',unit:'percent',better:'high',keys:['manager_trust','survey_manager_trust'],topics:['management']},
 manager_return:{label:'Would work for my manager again',unit:'percent',better:'high',keys:['survey_manager_return'],topics:['management']},
 exec_trust:{label:'Trust in executive leadership',unit:'percent',better:'high',keys:['exec_trust','survey_exec_trust'],topics:['culture','layoffs']},
 promotions_clarity:{label:'Promotion criteria are clear',unit:'percent',better:'high',keys:['promotions_clarity','survey_promotions_clarity'],topics:['promotion']},
 promotion_wait_years:{label:'Promotion wait',unit:'years',better:'low',keys:['promotion_wait_years'],topics:['promotion']},
 bad_news_upward:{label:'Bad news travels upward',unit:'percent',better:'high',keys:['bad_news_upward','survey_bad_news_upward'],topics:['management']},
 perf_review_fairness:{label:'Reviews feel fair',unit:'percent',better:'high',keys:['perf_review_fairness','survey_perf_review_fairness'],topics:['management']},
 layoffs_handled:{label:'Layoffs handled respectfully',unit:'percent',better:'high',keys:['layoffs_handled','survey_layoffs_handled'],topics:['layoffs']},
 comp_vs_market:{label:'Compensation at or above market',unit:'percent',better:'high',keys:['comp_vs_market'],topics:['compensation']},
 workload_hours:{label:'Typical weekly hours (median)',unit:'hours',better:'low',keys:['workload_hours'],topics:['workload']},
};
const CONCEPT_ALIASES:Record<string,string>={compensation:'comp_vs_market',survey_compensation:'comp_vs_market',workload:'workload_hours',survey_workload:'workload_hours'};
export function conceptFor(key:string):string|null {const k=CONCEPT_ALIASES[key]??concept(key);return DISCOVERY_CONCEPTS[k]?k:null;}
const passes=(unit:ConceptDef['unit'],direction:'high'|'low',value:number)=>unit==='percent'?(direction==='high'?value>=70:value<=40):unit==='hours'?(direction==='high'?value>=50:value<45):true;
const thresholdText=(unit:ConceptDef['unit'],direction:'high'|'low')=>unit==='percent'?(direction==='high'?'at least 70% agree':'at most 40% agree'):unit==='hours'?(direction==='high'?'median of 50 hours or more':'median under 45 hours'):null;
const comparable=(r:Row,def:ConceptDef)=>def.unit==='percent'?r.response_type==='percent_agree'&&r.unit==='percent':def.unit==='hours'?r.unit==='hours'&&(r.response_type==='number'||medianOf(r)!==null):r.response_type==='number'&&r.unit==='years';
const measured=(r:Row)=>r.response_type==='distribution'?medianOf(r)!:r.value;
export const DISCOVERY_MAX_ROWS=60;
/** `now` fixes the clock for the last_year filter; defaults to the current time. */
export async function discover(env:Env,i:Interpretation,directory:DirectoryEntry[],now:Date=new Date()):Promise<DiscoveryResult> {
 const notices:string[]=[],applied:string[]=[],unsupported:string[]=[],done=(rows:DiscoveryRow[]=[])=>({rows,notices,applied,unsupported});
 if(i.salaryDataRequired){unsupported.push('Salary amounts or pay percentiles');notices.push('Actual salary amounts and pay percentiles are not collected, so no employer can be ranked by pay level.');return done();}
 let pool=directory;
 if(i.industry){
  // Only a directory sector is ever repeated back; any other text is "the requested industry".
  if(i.industry==='unsupported'||!directory.some(c=>c.sector===i.industry)){unsupported.push(`Industry: ${REQUESTED_INDUSTRY}`);notices.push('No employer in the directory is listed under the requested industry, so none are shown. The industry filter was not dropped.');return done();}
  pool=directory.filter(c=>c.sector===i.industry);applied.push(`Industry: ${i.industry}`);
 }
 const groups=[i.cohorts.fn,i.cohorts.seniority].filter((v):v is string=>!!v);
 // A group label is repeated back only when some employer publishes it; anything else is "the requested group".
 const publishedGroups=await publishedGroupLabels(env,groups),shown=(label:string)=>groupLabel([label],publishedGroups);
 if(groups.length>1){unsupported.push(`Combined groups: ${groupLabel(groups,publishedGroups)}`);notices.push('Combined group filters are not published for any employer, so no rows are shown.');return done();}
 const group=groups[0]??null,lastYear=now.getUTCFullYear()-1;
 if(group){applied.push(`Group: ${shown(group)}`);notices.push("Group filters match each employer's own group label; definitions can differ between employers.");}
 if(i.event||i.timeframe==='before_event'||i.timeframe==='after_event'){unsupported.push('Before/after a documented event');notices.push("Discovery cannot align different employers' events, so the before/after filter was not applied. Open an employer to compare before and after its own documented events.");}
 if(i.timeframe==='last_year')applied.push(`Period: ${lastYear} only`);
 const wanted:{concept:string;direction:'high'|'low';source:'preference'|'focus'}[]=[],unknown:string[]=[];
 for(const [key,direction] of Object.entries(i.preferences??{})){
  if(direction!=='high'&&direction!=='low')continue;
  const c=conceptFor(key);if(!c){unknown.push(concept(key).replaceAll('_',' '));continue;}
  if(!wanted.some(w=>w.concept===c))wanted.push({concept:c,direction,source:'preference'});
 }
 if(unknown.length){unsupported.push(...unknown.map(k=>`Criterion: ${k}`));notices.push(`No comparable published measure exists for ${unknown.join(', ')}; ${unknown.length===1?'it was':'they were'} not applied.`);}
 // The question's primary topic ranks first; other focus topics follow. Within a topic, its most direct measure leads
 // (topicMetrics order). Only the primary topic is reported as unsupported: a secondary focus topic without a comparable
 // measure is simply not used, since nobody asked to rank by it (RT-A1).
 const primaryTopic=i.topic.value!=='other'?i.topic.value:(i.focus[0]??null);
 const topics=[...(primaryTopic?[primaryTopic]:[]),...i.focus.filter(t=>t!==primaryTopic)];
 for(const topic of topics){
  const order=topicMetrics[topic]??[],rank=(c:string)=>{const k=order.indexOf(c);return k<0?Infinity:k;};
  const matched=Object.entries(DISCOVERY_CONCEPTS).filter(([,d])=>d.topics.includes(topic)).sort(([a],[b])=>(rank(a)-rank(b))||0);
  if(!matched.length&&topic!=='other'&&topic===primaryTopic){unsupported.push(`Topic: ${TOPIC_NAMES[topic]}`);notices.push(`No comparable published measure exists for ${TOPIC_NAMES[topic]}; it was not used to rank employers.`);}
  for(const [c,d] of matched)if(!wanted.some(w=>w.concept===c))wanted.push({concept:c,direction:d.better,source:'focus'});
 }
 for(const w of wanted){const d=DISCOVERY_CONCEPTS[w.concept]!,t=w.source==='preference'?thresholdText(d.unit,w.direction):null;applied.push(`${d.label}: ${t?`${t}; `:w.source==='preference'?'no threshold; ':''}sorted ${w.direction==='high'?'highest':'lowest'} first`);}
 const keys=[...new Set(wanted.flatMap(w=>DISCOVERY_CONCEPTS[w.concept]!.keys))],marks=keys.map(()=>'?').join(',');
 const [covered,rows,bands,cohorts]=await Promise.all([
  env.DB.prepare('SELECT DISTINCT company_id FROM metric_releases').all<{company_id:string}>().then(r=>new Set(r.results.map(x=>x.company_id))),
  keys.length?env.DB.prepare(`${RELEASES} WHERE d.key IN (${marks}) ORDER BY r.company_id,d.sort_order,r.period`).bind(...keys).all<Row>().then(r=>r.results):Promise.resolve([] as Row[]),
  keys.length?loadBands(env,`d.key IN (${marks})`,keys):Promise.resolve(new Map<string,DistributionBand[]>()),
  env.DB.prepare("SELECT id,company_id,label,dimension FROM cohorts WHERE public=1 AND (dimension='all' OR label=?)").bind(group??'').all<{id:string;company_id:string;label:string;dimension:string}>().then(r=>r.results),
 ]);
 const byCompany=new Map<string,Row[]>();for(const r of rows)byCompany.set(r.company_id,[...(byCompany.get(r.company_id)??[]),r]);
 const built:DiscoveryRow[]=[];let excluded=0;
 for(const company of pool.filter(c=>covered.has(c.id))) {
  const own=byCompany.get(company.id)??[],{suppressedIds}=suppressCells(own,minCohortN(env));
  const cohort=group?cohorts.find(c=>c.company_id===company.id&&c.label===group&&c.dimension!=='all'):undefined,allId=cohorts.find(c=>c.company_id===company.id&&c.dimension==='all')?.id;
  const usable=own.filter(r=>!suppressedIds.has(r.id)&&(group?r.cohort_id===cohort?.id:(r.cohort_id===null||r.cohort_id===allId))&&(i.timeframe!=='last_year'||new Date(periodBounds(r.period)[0]).getUTCFullYear()===lastYear));
  const cohortLabel=group??'All contributors',values:Omit<DiscoveryValue,'verificationMethod'>[]=[],missing:DiscoveryRow['missing']=[],chosen:Row[]=[];
  let fails=false;
  if(group&&!cohort)missing.push({concept:'group',label:shown(group),reason:`${publishedGroups.has(group)?group:'The requested group'} is not a published group at this employer`});
  else for(const w of wanted){
   const def=DISCOVERY_CONCEPTS[w.concept]!,key=def.keys.find(k=>usable.some(r=>r.metric_key===k&&comparable(r,def)));
   if(!key){missing.push({concept:w.concept,label:def.label,reason:'No comparable published measure for this group and period'});continue;}
   const series=usable.filter(r=>r.metric_key===key&&comparable(r,def)),latest=series.at(-1)!,value=measured(latest);chosen.push(...series);
   const meetsThreshold=w.source==='preference'&&def.unit!=='years'?passes(def.unit,w.direction,value):null;
   if(meetsThreshold===false)fails=true;
   values.push({concept:w.concept,label:def.label,metricKey:key,unit:def.unit,measure:def.unit==='percent'?'share_agree':latest.response_type==='distribution'?'median':'value',value,period:latest.period,n:latest.n,releaseId:latest.id,cohortLabel,meetsThreshold});
  }
  if(fails){excluded++;continue;}
  const metrics=metricViews(chosen,bands,company.kind,cohortLabel);
  const insufficient=missing.some(m=>m.concept==='group'||wanted.find(w=>w.concept===m.concept)?.source==='preference')||(wanted.length>0&&!values.length);
  built.push({company:{id:company.id,slug:company.slug,name:company.name,kind:company.kind,sector:company.sector??null},kind:company.kind,kindLabel:company.kind==='real'?'Real employer':'Fictional demonstration',status:insufficient?'insufficient':'match',rank:null,values:values.map(v=>({...v,verificationMethod:metrics.find(m=>m.key===v.metricKey)?.verificationMethod??''})),missing,metrics});
 }
 const byName=(a:DiscoveryRow,b:DiscoveryRow)=>a.company.name.localeCompare(b.company.name);
 const byWanted=(a:DiscoveryRow,b:DiscoveryRow)=>{
  for(const w of wanted){const x=a.values.find(v=>v.concept===w.concept)?.value,y=b.values.find(v=>v.concept===w.concept)?.value;if(x===undefined&&y===undefined)continue;if(x===undefined)return 1;if(y===undefined)return -1;if(x!==y)return w.direction==='high'?y-x:x-y;}
  return byName(a,b);
 };
 const ordered=(['real','sample'] as const).flatMap(kind=>(['match','insufficient'] as const).flatMap(status=>{
  const g=built.filter(r=>r.kind===kind&&r.status===status).sort(status==='match'&&wanted.length?byWanted:byName);
  if(status==='match'&&wanted.length)g.forEach((r,index)=>{r.rank=index+1;});
  return g;
 }));
 notices.push('Discovery lists only employers with published, privacy-approved records and applies explicit filters, not model-generated scores. Missing evidence is not a negative rating.');
 if(!ordered.length)notices.push(unsupported.length?'No published records satisfy the applied constraints. Filters listed as unsupported were not applied.':'No published records satisfy these constraints. None of your requested filters were dropped.');
 else if(!ordered.some(r=>r.kind==='real'&&r.status==='match')&&ordered.some(r=>r.kind==='sample'))notices.push('No real employer has published evidence matching this request. Rows labeled "Fictional demonstration" are illustrative data, not an answer about real employers.');
 if(excluded)notices.push(`${excluded} employer${excluded===1?'':'s'} with published evidence did not meet the requested thresholds and ${excluded===1?'is':'are'} not shown.`);
 const primary=wanted[0];
 if(primary){const periods=[...new Set(ordered.flatMap(r=>r.values.filter(v=>v.concept===primary.concept).map(v=>v.period)))].sort();if(periods.length>1)notices.push(`Latest periods differ between employers (${periods.join(', ')}); each value shows its own period.`);}
 for(const w of wanted){const used=[...new Set(ordered.flatMap(r=>r.values.filter(v=>v.concept===w.concept).map(v=>v.metricKey)))];if(used.length>1)notices.push(`${DISCOVERY_CONCEPTS[w.concept]!.label}: values come from different questionnaires (${used.join(', ')}); compare with care.`);}
 if(!wanted.length&&ordered.length)notices.push('No comparable criterion was requested, so employers are listed alphabetically, not ranked.');
 if(ordered.length>DISCOVERY_MAX_ROWS)notices.push(`Showing ${DISCOVERY_MAX_ROWS} of ${ordered.length} employers with published evidence.`);
 return done(ordered.slice(0,DISCOVERY_MAX_ROWS));
}

// Bounded candidate retrieval for Jev relevance ranking: same filters as the page, relevance before recency.
export const RANK_CANDIDATES_MAX=12;
const STOPWORDS=new Set(['what','that','this','with','from','have','about','there','their','they','does','work','working','company','companies','employer','people','here','like','when','were','been','into','more','than','your','after','before','since','show','tell','give','accounts','account','original','testimony','would','could','should','which','where','them','some','other','really','things','thing','want','know','anyone','ever','still','very','much','many','also']);
export function queryTokens(query:string):string[] {
 return [...new Set((query.toLowerCase().match(/[a-z][a-z'-]{3,}/g)??[]).filter(t=>!STOPWORDS.has(t)).map(t=>t.slice(0,6)))].slice(0,12);
}
/** Pass the page's chip overrides so candidates are drawn from exactly the accounts the page can show. */
/** `retrieved`: ids from optional semantic retrieval over published text, best first; kept only when they pass the page's filters. */
export interface RankOptions extends ScopeOverrides {pool?:AccountPool;now?:Date;retrieved?:readonly string[];}
export async function rankCandidates(env:Env,companyId:string,i:Interpretation,query:string,o:RankOptions={}):Promise<string[]> {
 // The kind only affects provenance labels, which ranking never reads.
 const [pool,cohorts,events]=await Promise.all([o.pool&&o.pool.companyId===companyId?Promise.resolve(o.pool):loadAccountPool(env,{id:companyId,kind:'real'},o.now),getCompanyCohorts(env,companyId),getCompanyEvents(env,companyId)]);
 const s=resolveScope(i,cohorts,events,o,o.now??new Date());
 const candidates=inScope(pool.accounts,s).filter(a=>!a.withheld&&(!s.topic||a.topicIds.includes(s.topic)));
 const patterns=queryTokens(query).map(t=>new RegExp(`\\b${t}`,'i'));
 const score=(a:Account)=>{const text=`${a.body}\n${a.labels.map(l=>l.topic).join('\n')}`;return patterns.filter(p=>p.test(text)).length*2+i.focus.filter(f=>a.topicIds.includes(f)).length;};
 // Semantic retrieval covers analysed accounts only, so it never lifts an account of a held release group (RT-LINK-01).
 const allowed=new Set(candidates.filter(a=>!a.analysisHeld).map(a=>a.id)),semantic=[...new Set(o.retrieved??[])].filter(id=>allowed.has(id));
 const lexical=candidates.map((a,index)=>({id:a.id,index,score:score(a)})).sort((a,b)=>b.score-a.score||a.index-b.index).map(c=>c.id);
 return [...new Set([...semantic.slice(0,SEMANTIC_CANDIDATES_MAX),...lexical])].slice(0,RANK_CANDIDATES_MAX);
}
/** Semantic retrieval fills at most this many ranking slots, so strong keyword matches still reach Jev. */
export const SEMANTIC_CANDIDATES_MAX=8;
export function searchEmployers(directory:DirectoryEntry[],query:string) {
 const q=query.trim().toLowerCase();return q?directory.filter(c=>c.name.toLowerCase().includes(q)||c.slug.includes(q)):directory;
}

// Deterministic answers: fixed templates over released numbers and counts in the payload. Never model prose, never a
// number that is not in the evidence, and fictional employers are labeled in every headline and every fact naming one.
export const ANSWER_FACTS_MAX=8;
type Fact=EvidenceAnswer['facts'][number];
const decimal=(x:number)=>Number.isInteger(x)?String(x):x.toFixed(1);
export function formatMetricValue(value:number,m:{unit:string;responseType?:string}):string {
 if(m.responseType==='percent_agree')return `${Math.round(value)}% agree`;
 if(m.responseType==='scale_5')return `${value.toFixed(1)} of 5`;
 return m.unit==='percent'?`${Math.round(value)}%`:m.unit==='hours'?`${decimal(value)} hours`:m.unit==='years'?`${decimal(value)} years`:decimal(value);
}
export const companyLabel=(c:Pick<CompanyRef,'name'|'kind'>)=>`${c.name}${c.kind==='sample'?' (fictional demonstration)':''}`;
/**
 * A selected published group as it reads mid-sentence: "the engineering group", "the senior IC group", "the EMEA group".
 * The initial capital is dropped only from an ordinary first word: never from an acronym or a mixed-case word, and never
 * for a region, whose label may be a place name ("the London group").
 */
export function groupPhrase(label:string,dimension?:string|null):string {
 const [first='',...rest]=label.trim().split(/\s+/);
 const ordinary=dimension!=='region'&&/^[A-Z][a-z]+(?:[-'’][a-z]+)*$/.test(first);
 const words=[ordinary?first.toLowerCase():first,...rest].join(' ');
 return /\bgroup$/i.test(words)?`the ${words}`:`the ${words} group`;
}
const groupDimension=(e:Pick<EvidencePayload,'facets'>,label:string)=>e.facets?.find(f=>f.label===label)?.dimension??null;
/** Account counts below MIN_ACCOUNT_COUNT are never stated. */
const countText=(n:number,noun:string)=>n>=MIN_ACCOUNT_COUNT?`${n} ${noun}`:n===0?`No ${noun}`:`Fewer than ${MIN_ACCOUNT_COUNT} ${noun}`;
const plural=(n:number,one:string,many:string)=>n===1?one:many;
const pointFact=(m:MetricView,p:MetricSeriesPoint,label=m.label):Fact[]=>p.value===null?[]:[{label,value:formatMetricValue(p.value,m),n:p.n,period:p.period,metricKey:m.key,releaseId:p.releaseId}];
const theEvent=(label:string)=>/^the\b/i.test(label)?label:`the ${label}`;
const withN=(value:string,p:{n:number;period:string})=>`${value} (n=${p.n}, ${p.period})`;
/** "rose from A to B", "fell from A to B" or "was unchanged at A", decided on the displayed values. */
function movement(m:{unit:string;responseType?:string},a:{value:number;n:number;period:string},b:{value:number;n:number;period:string},beforeTail='',afterTail='') {
 const x=formatMetricValue(a.value,m),y=formatMetricValue(b.value,m);
 if(x===y)return `was unchanged at ${x} (n=${a.n}, ${a.period}${beforeTail}; n=${b.n}, ${b.period}${afterTail})`;
 return `${b.value>a.value?'rose':'fell'} from ${withN(x,a)}${beforeTail} to ${withN(y,b)}${afterTail}`;
}
/**
 * `topic`: the question's topic (typed state, so a question and its shared link answer alike). When given, the overview
 * and timeline headline come from that topic's measures, in its listed order, and say so when none is published,
 * instead of answering with another topic's measure (RT-A1). Without it, the first published measure answers.
 */
export interface AnswerContext {route:RouteId;view:ViewId;evidence?:EvidencePayload|null;comparison?:ComparisonTable|null;discovery?:DiscoveryResult|null;topic?:TopicId|null;}
/** Assembles the answer for the view actually shown. Returns null only for cannot_safely_answer. */
export function answerFor(ctx:AnswerContext):EvidenceAnswer|null {
 if(ctx.route==='cannot_safely_answer')return null;
 const e=ctx.evidence??null;
 const done=(headline:string,facts:Fact[]=[]):EvidenceAnswer=>({headline,facts:facts.slice(0,ANSWER_FACTS_MAX),accountsMentioning:e?.accountsMentioning??null,route:ctx.route});
 if(ctx.view==='discovery'||!e)return discoveryAnswer(ctx.discovery?.rows??[],done);
 const at=companyLabel(e.company);
 // A selected group is named wherever its numbers appear, so a group result never reads as the employer's.
 const group=e.cohortStatus==='selected'?e.cohortLabel:null;
 const scope=group?` for ${group} at ${at}`:` at ${at}`,from=group?` from ${group}`:'',tag=(label:string)=>group?`${label} (${group})`:label;
 if(e.cohortStatus==='unavailable'&&ctx.view!=='cohort')return done(`No privacy-approved release exists for ${e.cohortLabel} at ${at}.`);
 if(e.timeStatus==='not_applied')return done(`Before/after results need a documented, dated event at ${at}. None was applied, so no time-scoped results are shown.`);
 const valued=e.metrics.filter(m=>m.series.some(p=>p.value!==null));
 // Empty statements name the employer, and a group only when the reader selected one (never "All contributors"
 // mid-sentence); without a period filter they say "yet", since results can still be published.
 const phrase=group?groupPhrase(group,groupDimension(e,group)):null,forGroup=phrase?` for ${phrase}`:'';
 const emptyScope=phrase?` for ${phrase} at ${at}`:` for ${at}`,when=e.timeStatus==='applied'?' in the selected period':' yet';
 const nothing=`No privacy-approved results are published${emptyScope}${when}.`;
 const asked=ctx.topic&&ctx.topic!=='other'?ctx.topic:null,ofTopic=(key:string)=>!asked||(topicMetrics[asked]??[]).includes(concept(key));
 const nothingFor=(topic:TopicId)=>`No privacy-approved ${TOPIC_NAMES[topic]} measure is published${emptyScope}${when}.`;
 /** The asked topic's items first, each group in its own order, so facts lead with what the question is about. */
 const topicFirst=<T>(items:T[],key:(item:T)=>string)=>asked?[...items.filter(x=>ofTopic(key(x))),...items.filter(x=>!ofTopic(key(x)))]:items;
 if(ctx.view==='compare') {
  const t=ctx.comparison;if(!t)return done(`Choose a second employer to compare with ${at}.`);
  // A row pairs when both sides publish a value for the same period: a number on both sides, or a documented median
  // (weekly hours) on both sides, never one of each. A distribution without a documented median is never paired.
  const same=(r:ComparisonTable['rows'][number])=>r.left.status==='value'&&r.right.status==='value'&&r.left.period===r.right.period;
  const cell=(c:ComparisonCell)=>c.status==='value'?c:null;
  const scalar=(r:ComparisonTable['rows'][number])=>same(r)&&cell(r.left)!.value!==null&&cell(r.right)!.value!==null;
  const medians=(r:ComparisonTable['rows'][number])=>same(r)&&cell(r.left)!.value===null&&cell(r.right)!.value===null&&cell(r.left)!.median!=null&&cell(r.right)!.median!=null;
  const paired=topicFirst(t.rows.filter(r=>scalar(r)||medians(r)),r=>r.key);
  const who=(side:ComparisonTable['left'])=>side.cohortStatus==='selected'?`${side.cohortLabel} at ${companyLabel(side.company)}`:companyLabel(side.company);
  const shown=(r:ComparisonTable['rows'][number],c:Extract<ComparisonCell,{status:'value'}>)=>c.value!==null?formatMetricValue(c.value,r):`median ${formatMetricValue(c.median!,{unit:r.unit})}`;
  const facts=paired.flatMap(r=>[r.left,r.right].flatMap((c,k)=>c.status==='value'?[{label:`${r.label}${c.value===null?' (median)':''}: ${who(k?t.right:t.left)}`,value:c.value!==null?formatMetricValue(c.value,r):formatMetricValue(c.median!,{unit:r.unit}),n:c.n,period:c.period,metricKey:c.metricKey,releaseId:c.releaseId}]:[]));
  // The asked topic's measure answers (workload: the documented median hours); when no measure of it is published for
  // both sides in a matching period that is said plainly, and no other measure is headlined in its place (RT-A1).
  const first=asked?paired.find(r=>ofTopic(r.key)):paired.find(scalar)??paired[0];
  if(!first)return done(asked&&paired.length?`No ${TOPIC_NAMES[asked]} measure is published for both ${who(t.left)} and ${who(t.right)} in a matching period.`:`No measure is published for both ${who(t.left)} and ${who(t.right)} in a matching period.`,facts);
  const l=cell(first.left)!,r=cell(first.right)!;
  return done(`${first.label}, ${l.period}: ${who(t.left)} ${shown(first,l)} (n=${l.n}) and ${who(t.right)} ${shown(first,r)} (n=${r.n}).`,facts);
 }
 if(ctx.view==='timeline') {
  const event=e.selectedEvent;
  const rows=(e.comparison??[]).filter(r=>r.before.value!==null&&r.after.value!==null);
  const own=rows.find(x=>ofTopic(x.key));
  if(event&&rows.length&&!own)return done(`No ${TOPIC_NAMES[asked!]} measure at ${at} has a published period on both sides of ${theEvent(event.label)}${forGroup}.`,rows.flatMap(x=>{const mm=e.metrics.find(y=>y.key===x.key);return mm?[...pointFact(mm,x.before,tag(`${x.label}, before`)),...pointFact(mm,x.after,tag(`${x.label}, after`))]:[];}));
  if(event&&own) {
   const r=own,m=e.metrics.find(x=>x.key===r.key)??{unit:r.unit};
   const also=r.alsoInWindow.length?` The comparison window also contains ${r.alsoInWindow.map(x=>theEvent(x.label)).join(', ')}, so the change cannot be attributed to ${theEvent(event.label)} alone.`:'';
   const facts=topicFirst(rows,x=>x.key).flatMap(x=>{const mm=e.metrics.find(y=>y.key===x.key);return mm?[...pointFact(mm,x.before,tag(`${x.label}, before`)),...pointFact(mm,x.after,tag(`${x.label}, after`))]:[];});
   return done(`${r.label}${scope} ${movement(m,{value:r.before.value!,n:r.before.n,period:r.before.period},{value:r.after.value!,n:r.after.n,period:r.after.period},` before ${theEvent(event.label)}`,' after it')}.${also}`,facts);
  }
  if(event)return done(`No measure at ${at} has a published period on both sides of ${theEvent(event.label)}${forGroup}.`);
  const m=valued.find(x=>ofTopic(x.key)&&x.series.filter(p=>p.value!==null).length>1);
  if(!m)return done(valued.length?`No ${asked?`${TOPIC_NAMES[asked]} `:''}measure at ${at} has more than one published period${forGroup}.`:nothing);
  const points=m.series.filter(p=>p.value!==null),a=points[0]!,b=points.at(-1)!;
  return done(`${m.label}${scope} ${movement(m,{value:a.value!,n:a.n,period:a.period},{value:b.value!,n:b.n,period:b.period})}.`,points.flatMap(p=>pointFact(m,p,tag(`${m.label}, ${p.period}`))));
 }
 if(ctx.view==='distribution') {
  const d=e.distribution;if(!d||!d.bands.length)return done(`No published distribution matches this group, topic and period at ${at}.`);
  const top=[...d.bands].sort((x,y)=>y.share-x.share)[0]!;
  const facts=d.bands.map(b=>({label:tag(b.band),value:`${Math.round(b.share)}%`,n:d.n,period:d.period,metricKey:d.metricKey,releaseId:d.releaseId}));
  return done(`${d.label}${scope}, ${d.period} (n=${d.n}): ${d.median!==null?`median ${formatMetricValue(d.median,{unit:d.unit})}; `:''}the most common answer was ${top.band} (${Math.round(top.share)}%).`,facts);
 }
 if(ctx.view==='cohort') {
  const rows=e.cohortComparison??[];
  if(!rows.length)return done(e.facets?.length?`Choose one of ${at}'s published groups to compare it with the whole company.`:noGroupsNote(at));
  const type=(key:string)=>e.metrics.find(m=>m.key===key)?.responseType;
  const ok=topicFirst(rows.filter(r=>r.status==='ok'&&r.cohort),r=>r.key);
  const facts=ok.flatMap(r=>[{label:`${r.label}: ${e.cohortLabel}`,value:formatMetricValue(r.cohort!.value,{unit:r.unit,responseType:type(r.key)}),n:r.cohort!.n,period:r.cohort!.period,metricKey:r.key,releaseId:r.cohort!.releaseId},...(r.company?[{label:`${r.label}: whole company`,value:formatMetricValue(r.company.value,{unit:r.unit,responseType:type(r.key)}),n:r.company.n,period:r.company.period,metricKey:r.key,releaseId:r.company.releaseId}]:[])]);
  // The asked topic's measure answers; without one beside the whole company that is said, not replaced (RT-A1).
  const r=ok.find(x=>ofTopic(x.key));
  const whom=phrase??e.cohortLabel;
  if(!r)return done(asked&&ok.length?`No privacy-approved ${TOPIC_NAMES[asked]} measure for ${whom} at ${at} can be shown beside the whole company.`:`No published result for ${whom} at ${at} can be shown beside the whole company.`,facts);
  const unit={unit:r.unit,responseType:type(r.key)};
  return done(r.company?`${r.label} at ${at}, ${r.cohort!.period}: ${e.cohortLabel} ${formatMetricValue(r.cohort!.value,unit)} (n=${r.cohort!.n}) and the whole company ${formatMetricValue(r.company.value,unit)} (n=${r.company.n}).`:`${r.label} at ${at}: ${e.cohortLabel} ${withN(formatMetricValue(r.cohort!.value,unit),r.cohort!)}. No company-wide result is published for ${r.cohort!.period}.`,facts);
 }
 if(ctx.view==='clusters') {
  const c=e.clusters;
  if(!c.length)return done(`No group of independently worded accounts${from} describing the same event meets the corroboration rule at ${at} for these filters.`);
  const sources=(n:number)=>n>=MIN_ACCOUNT_COUNT?`${n} independent sources`:`fewer than ${MIN_ACCOUNT_COUNT} independent sources`;
  const largest=Math.max(...c.map(x=>x.reporterCount));
  return done(`${c.length} ${plural(c.length,'group',"groups")} of potentially related accounts${from} at ${at} ${plural(c.length,'meets','meet')} the corroboration rule; the largest has ${sources(largest)}. Similarity is not proof.`,c.map(x=>({label:tag(x.summary),value:sources(x.reporterCount),n:x.reporterCount>=MIN_ACCOUNT_COUNT?x.reporterCount:null,period:x.firstReport===x.lastReport?x.firstReport:`${x.firstReport} to ${x.lastReport}`})));
 }
 if(ctx.view==='reader') {
  const n=e.testimonyPaging.matching;
  // accountReadings never carries a cell of 1 to 4 accounts, so every count stated here is 0 or at least 5.
  // The asked topic's dimensions first (a workload question leads with the workload reading).
  const about=(r:AccountReading)=>DIMENSION_TOPIC[r.dimension as ReadingDimension]===asked;
  const readings=asked?[...(e.accountReadings??[]).filter(about),...(e.accountReadings??[]).filter(r=>!about(r))]:e.accountReadings??[];
  const facts=readings.map(r=>({label:tag(`Model reading of written accounts, not votes: ${r.dimension.replaceAll('_',' ')}`),value:`${r.negative} negative, ${r.mixed} mixed, ${r.positive} positive`,n:r.accounts,period:null}));
  return done(`${countText(n,`published accounts${from}`)} at ${at} match these filters.`,facts);
 }
 const facts=topicFirst(valued,x=>x.key).flatMap(x=>{const p=[...x.series].reverse().find(q=>q.value!==null);return p?pointFact(x,p,tag(x.label)):[];});
 // The asked topic's first published measure answers. A documented median (weekly hours) is stated as a median of its
 // latest period, never as a change: distributions have no deltas.
 const lead=asked?e.metrics.find(x=>ofTopic(x.key)&&x.series.some(p=>p.value!==null||(p.median!==undefined&&p.median!==null))):valued[0];
 if(lead&&!lead.series.some(p=>p.value!==null)) {
  const p=[...lead.series].reverse().find(q=>q.median!==undefined&&q.median!==null)!;
  return done(`${lead.label}${scope}, ${p.period} (n=${p.n}): median ${formatMetricValue(p.median!,lead)}.`,[{label:tag(`${lead.label} (median)`),value:formatMetricValue(p.median!,lead),n:p.n,period:p.period,metricKey:lead.key,releaseId:p.releaseId},...facts]);
 }
 const m=lead;if(!m)return done(asked&&valued.length?nothingFor(asked):nothing,facts);
 const points=m.series.filter(p=>p.value!==null),a=points.at(-2),b=points.at(-1)!;
 return done(a?`${m.label}${scope} ${movement(m,{value:a.value!,n:a.n,period:a.period},{value:b.value!,n:b.n,period:b.period})}.`:`${m.label}${scope}: ${withN(formatMetricValue(b.value!,m),b)}.`,facts);
}
function discoveryAnswer(rows:DiscoveryRow[],done:(headline:string,facts?:Fact[])=>EvidenceAnswer):EvidenceAnswer {
 const value=(v:DiscoveryValue)=>v.measure==='share_agree'?`${Math.round(v.value)}% agree`:v.measure==='median'?`median ${decimal(v.value)} hours`:formatMetricValue(v.value,{unit:v.unit});
 const matches=rows.filter(r=>r.status==='match');
 // A group filter applies to every employer's values; name it so a group value never reads as the employer's.
 const grouped=(v:DiscoveryValue)=>v.cohortLabel!=='All contributors'?` (${v.cohortLabel})`:'';
 const facts=matches.flatMap(r=>r.values.slice(0,1).map(v=>({label:`${companyLabel(r.company)}: ${v.label}${grouped(v)}`,value:value(v),n:v.n,period:v.period,metricKey:v.metricKey,releaseId:v.releaseId})));
 if(!matches.length)return done(rows.length?'No employer with published evidence meets every requested filter; employers missing a measure are listed as insufficient evidence.':'No employer with published, privacy-approved evidence matches these filters.');
 const top=matches.find(r=>r.rank===1),v=top?.values[0];
 if(top&&v) {
  const among=top.kind==='real'?'real employers':'fictional demonstrations',measure=`${v.label.charAt(0).toLowerCase()+v.label.slice(1)}${v.cohortLabel!=='All contributors'?` for ${v.cohortLabel}`:''}`;
  // "Ranks first" needs someone to rank against: when no other employer of its kind publishes that measure, say so.
  const peers=matches.filter(r=>r.kind===top.kind&&r.values.some(x=>x.concept===v.concept)).length;
  if(peers<2)return done(`Among ${among}, only ${companyLabel(top.company)} has a published result on ${measure}: ${value(v)} (n=${v.n}, ${v.period}). Employers without it are not ranked on it.`,facts);
  return done(`${companyLabel(top.company)} ranks first among ${among} on ${measure}: ${value(v)} (n=${v.n}, ${v.period}).`,facts);
 }
 return done(`${matches.length} ${plural(matches.length,'employer has','employers have')} published, privacy-approved records for these filters. They are listed, not ranked.`,facts);
}
