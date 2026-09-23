import type {EvidencePayload as BaseEvidence,Interpretation as BaseInterpretation,ViewId as BaseView,MetricView,MetricSeriesPoint,DiscoveryRow,DiscoveryValue,ComparisonTable,ComparisonCell,TestimonyItem,CorroborationCluster,FaqEntry,Provenance,DistributionBand} from '../worker/src/types.ts';
import {policy} from '../shared/policy.ts';
export type {MetricSeriesPoint,DiscoveryRow,DiscoveryValue,ComparisonTable,ComparisonCell,TestimonyItem,CorroborationCluster,FaqEntry,Provenance,DistributionBand};
// Fields the round-2 evidence API adds (answer, cohort view, account readings, related sources) are optional here so
// the client renders correctly against servers that do not send them yet. Nothing is filled in when absent.
export type ViewId=BaseView|'cohort';
export type RouteId='metric_view'|'comparison'|'timeline'|'distribution'|'cohort'|'evidence'|'clusters'|'existing_faq'|'discovery'|'needs_generation'|'cannot_safely_answer';
export type Metric=MetricView&{related?:{testimonyIds:string[];clusterKeys:string[]}};
/** One published number in the group-and-company view. The last three fields name whose number it is and how it was verified. */
export interface CohortCell {value:number|null;n:number;period:string;releaseId:string;cohortLabel?:string;verificationMethod?:string;provenance?:Provenance;}
export interface CohortRow {key:string;label:string;unit:string;cohort:CohortCell|null;company:CohortCell|null;status:'ok'|'cohort_unavailable'|'suppressed';}
export interface AccountReading {dimension:string;accounts:number;positive:number;negative:number;mixed:number;}
export type EvidencePayload=Omit<BaseEvidence,'metrics'|'cohortComparison'|'accountReadings'>&{metrics:Metric[];cohortComparison?:CohortRow[]|null;accountReadings?:AccountReading[]|null};
export type Interpretation=Omit<BaseInterpretation,'route'>&{route:string};
export interface AnswerFact {label:string;value:string;n:number|null;period:string|null;metricKey?:string;releaseId?:string;}
export interface Answer {headline:string;facts:AnswerFact[];accountsMentioning?:{topic:string;count:number}|null;route:RouteId|string;}
/**
 * `aliases`: the curated ways of naming the employer (public directory data), used by the on-device matcher. `domains`:
 * the work-mailbox domains its verification accepts, primary first, when any are registered. `origin`: 'community' for a
 * listing a visitor added (POST /api/employers); absent for curated listings. `communityDomains`: those of `domains` a
 * visitor supplied; on a curated listing, a domain someone attached to it (absent when none, and from older servers).
 */
export interface DirectoryCompany {id:string;slug:string;name:string;kind:'sample'|'real';sector?:string|null;aliases?:Array<{alias:string;cased:boolean}>;origin?:'community'|null;domains?:string[]|null;communityDomains?:string[]|null;}
export interface CanvasResponse {
 interpretation:Interpretation;evidence:EvidencePayload|null;view:ViewId;compareEvidence:EvidencePayload|null;notices:string[];discovery:DiscoveryRow[];directory?:DirectoryCompany[];
 degraded?:boolean;keepCanvas?:boolean;rephrasings?:string[];applied?:string[];unsupported?:string[];interestCounted?:boolean;comparisonTable?:ComparisonTable|null;answer?:Answer|null;
 /** Present only when the server's support-resources check matched the asker's own words. Its contents are never rendered. */
 resources?:unknown;
}
/**
 * sampleEmployers: SAMPLE_EMPLOYERS is on (fictional sample employers exist on this deployment; off in production).
 * publication.accountBatch: TESTIMONY_BATCH_MIN, the smallest batch in which one employer's written accounts publish;
 * publication.aggregateMinimum (and minimumCohort): MIN_COHORT_N, the fewest answers behind any published aggregate.
 * employerListing: whether anyone may add an employer (POST /api/employers) and the proof of work it asks for.
 */
export interface EmployerListing {open:boolean;perClientPerDay?:number;pow?:{version?:number;bits?:number;windowMinutes?:number;worker?:string}|null;}
export interface SiteConfig {verifierOrigin:string;realPublicationEnabled:boolean;policyVersion:string;minimumCohort:number;juryEnabled?:boolean;moderation?:{juryEnabled:boolean;challengesEnabled:boolean;appealsEnabled:boolean}|null;sampleEmployers?:boolean;publication?:{accountBatch?:number;aggregateMinimum?:number}|null;employerListing?:EmployerListing|null;}
/**
 * Whether fictional sample employers appear on this deployment. The site's config decides (SAMPLE_EMPLOYERS); without it,
 * only a directory that actually lists one shows them. Production lists none, so no fictional section or label renders.
 */
export const samplesOn=(config:{sampleEmployers?:boolean|null}|null|undefined,directory:ReadonlyArray<{kind:string}>)=>config?.sampleEmployers!==false&&directory.some(c=>c.kind==='sample');
/** The directory as this deployment shows it: with sample employers off, none is listed even if a reply carried one. */
export const shownDirectory=<T extends {kind:string}>(config:{sampleEmployers?:boolean|null}|null|undefined,directory:T[]):T[]=>config?.sampleEmployers===false?directory.filter(c=>c.kind!=='sample'):directory;
/** The floor the server applies to MIN_COHORT_N (the published policy's aggregate minimum); also what the copy says before the config arrives. */
export const MINIMUM_COHORT_FLOOR=(policy.retention as {aggregateMinimum?:number}).aggregateMinimum??25;
export interface PublicationRules {batch:number;cohort:number;}
const whole=(value:unknown,fallback:number)=>typeof value==='number'&&Number.isInteger(value)&&value>0?value:fallback;
/**
 * The publication thresholds, from the site's config: written accounts publish per employer in batches of
 * testimonyBatchMin after screening and a random delay; percentages and other aggregates need minimumCohort answers.
 * Without a config the published policy's batch and the cohort floor are stated.
 */
export function publicationRules(config:{publication?:{accountBatch?:number;aggregateMinimum?:number}|null;minimumCohort?:number|null}|null|undefined):PublicationRules {
 const floor=policy.retention.minimumBatch,cohort=config?.publication?.aggregateMinimum??config?.minimumCohort;
 return {batch:Math.max(floor,whole(config?.publication?.accountBatch,floor)),cohort:Math.max(MINIMUM_COHORT_FLOOR,whole(cohort,MINIMUM_COHORT_FLOOR))};
}
/** Whether this site takes new listings now (the config says so explicitly), and the proof-of-work difficulty it asks for. */
export const listingOpen=(config:{employerListing?:EmployerListing|null}|null|undefined)=>config?.employerListing?.open===true;
export const listingPowBits=(config:{employerListing?:EmployerListing|null}|null|undefined)=>typeof config?.employerListing?.pow?.bits==='number'?config.employerListing.pow.bits:null;
/** The two publication rules in the site's voice, worded the same wherever they appear. */
export const accountsRule=(r:PublicationRules)=>`Written accounts publish in batches of ${r.batch} per employer, after screening and a random delay.`;
export const aggregatesRule=(r:PublicationRules)=>`Survey percentages and other aggregate numbers appear only once at least ${r.cohort} people have answered.`;
/**
 * Example questions on the home page. Where this deployment has fictional sample employers (the local demonstration),
 * they exercise every view with illustrative data and are tagged fictional. Without them (production), the examples name
 * real employers, and each is offered only when the directory lists every employer it names.
 */
const FICTIONAL_EXAMPLES=['Northwind Labs','Compare Northwind Labs and Helios Semiconductor','How has trust in managers changed at Northwind Labs?'];
export const REAL_EXAMPLES:ReadonlyArray<{text:string;slugs:readonly string[]}>=[{text:'Charles Schwab',slugs:['charles-schwab']},{text:'Compare Google and Microsoft',slugs:['google','microsoft']},{text:'What is it like to work at Stripe?',slugs:['stripe']}];
export function homeExamples(config:{sampleEmployers?:boolean|null}|null|undefined,directory:ReadonlyArray<DirectoryCompany>):Array<{text:string;fictional:boolean}> {
 if(!directory.length)return [];
 if(samplesOn(config,directory))return FICTIONAL_EXAMPLES.map(text=>({text,fictional:true}));
 return REAL_EXAMPLES.filter(e=>e.slugs.every(slug=>directory.some(c=>c.slug===slug&&c.kind==='real'))).map(e=>({text:e.text,fictional:false}));
}
/** A listing a visitor added. It names its work-email domain beside the employer's name wherever it is listed. */
export const isCommunity=(company:{origin?:string|null}|null|undefined)=>company?.origin==='community';
export const COMMUNITY_LABEL='Added by the community';
/** The primary work-email domain verification accepts for an employer, when one is registered. */
export const domainOf=(company:{domains?:readonly string[]|null}|null|undefined)=>company?.domains?.[0]??null;
/**
 * Whether a domain listed for an employer was supplied by a visitor rather than curated: every domain of a community
 * listing, and a domain someone attached to one of our listings (the directory's communityDomains).
 */
export const communitySupplied=(company:{origin?:string|null;communityDomains?:readonly string[]|null}|null|undefined,domain:string|null|undefined)=>!!company&&!!domain&&(isCommunity(company)||!!company.communityDomains?.includes(domain));
/** The label beside a domain someone attached to one of our listings (a community listing carries COMMUNITY_LABEL itself). */
export const ATTACHED_DOMAIN_LABEL='Domain added by the community';
/** The domains someone attached to one of our listings (none for a community listing, whose label covers every domain). */
export const attachedDomains=(company:{origin?:string|null;communityDomains?:readonly string[]|null}|null|undefined):string[]=>company&&!isCommunity(company)?[...(company.communityDomains??[])]:[];
/** "Acme (acme.com)" when a verification domain is registered, otherwise the name alone. */
export const listingName=(company:{name:string;domains?:readonly string[]|null})=>{const domain=domainOf(company);return domain?`${company.name} (${domain})`:company.name;};
/** An employer as a reply or the directory describes it: enough to name it, and to tell a community listing apart. */
export interface Named {slug:string;name:string;origin?:string|null;domains?:readonly string[]|null;communityDomains?:readonly string[]|null;}
/**
 * An employer's name wherever it appears as text (chips, options, the cursor, share text, titles): a community listing
 * always with its domain and the community label ("Google (google-jobs.io), added by the community"), so a listing that
 * shares a curated employer's name never reads as that employer. A curated employer keeps its name alone.
 */
export const employerLabel=(company:{name:string;origin?:string|null;domains?:readonly string[]|null})=>isCommunity(company)?`${listingName(company)}, ${COMMUNITY_LABEL.toLowerCase()}`:company.name;
/** The name where a community tag is shown beside it: a community listing with its domain ("Acme (acme.com)"), a curated employer by name. */
export const displayName=(company:{name:string;origin?:string|null;domains?:readonly string[]|null})=>isCommunity(company)?listingName(company):company.name;
/**
 * A company from a reply with the directory's facts about it filled in (its community origin and verification domains),
 * for replies that name an employer without them (discovery rows do). The reply's own values win when it has them.
 */
export function withListing<T extends Named>(company:T,directory:ReadonlyArray<DirectoryCompany>=[]):T&Named {
 const listed=directory.find(c=>c.slug===company.slug);
 if(!listed)return company;
 return {...company,origin:company.origin??listed.origin??null,domains:company.domains?.length?company.domains:listed.domains??null,communityDomains:company.communityDomains??listed.communityDomains??null};
}
export type Overrides={[key:string]:string|null|false|number|Record<string,'high'|'low'|'any'>};

const ERRORS:Record<string,string>={
 rate_limited:'Many requests arrived from this connection. Wait a minute and try again.',
 live_consent_required:'Live understanding needs to be switched on before it can read what you type.',
 invalid_request:'That request could not be read. Reload the page and try again.',
 unknown_company:'That employer is not in the directory.',
 request_too_large:'That question is too long.',
 origin_not_allowed:'This request came from another site and was refused.',
};
/**
 * A refused request. `resources` is set when the refusal still carried the server's support resources for the asker;
 * `retryAfter` (seconds) when the server said how long to wait, from its reply or its Retry-After header.
 */
export class RequestError extends Error {
 code:string;status:number;resources:boolean;retryAfter:number|null;
 constructor(message:string,code:string,status:number,resources=false,retryAfter:number|null=null){super(message);this.code=code;this.status=status;this.resources=resources;this.retryAfter=retryAfter;}
}
export const isRateLimited=(error:unknown):error is RequestError=>error instanceof RequestError&&(error.status===429||error.code==='rate_limited');
const seconds=(value:unknown)=>{const n=typeof value==='string'?Number(value):value;return typeof n==='number'&&Number.isFinite(n)&&n>0?Math.min(600,Math.ceil(n)):null;};
export async function post<T>(path:string,body:unknown,signal?:AbortSignal):Promise<T> {
 const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal});
 const data=await response.json().catch(()=>({})) as T&{error?:string;decision?:{explanations?:string[]};resources?:unknown;retryAfterSeconds?:unknown};
 if(!response.ok) {
  const code=typeof data.error==='string'?data.error:'request_failed';
  throw new RequestError(data.decision?.explanations?.join(' ')||ERRORS[code]||(code.includes(' ')?code:'This request could not be completed. Your last view is unchanged.'),code,response.status,Boolean(data.resources),seconds(data.retryAfterSeconds)??seconds(response.headers.get('retry-after')));
 }
 return data;
}
/** How long Live understanding pauses after its own budget is used up, when the server does not say. */
export const LIVE_PAUSE_DEFAULT=60;
/** The quiet note under the composer while Live understanding is paused. Enter still searches. */
export const livePausedNote=(pause:number)=>`Live understanding paused for ${pause>90?`${Math.round(pause/60)} minutes`:'a minute'} — press Enter to search.`;
/** An explicit request over the connection's budget: calm, inline, and the last view stays. */
export const RATE_LIMITED_CALM='Many requests arrived from this connection, so this one was not read. Your last view stays in place; try again in a minute.';
/**
 * The privacy line for support resources that came back from the server rather than from the on-device check. The
 * publisher computes them from the asker's own words for that one reply and keeps nothing about the match.
 */
export const SERVER_RESOURCES_NOTE='This note was added to the site’s answer to what you sent. Only you see it: nothing about it is stored, logged or reported, and it does not change the evidence or what you can ask.';
export async function fetchDirectory():Promise<DirectoryCompany[]> {const response=await fetch('/api/directory');if(!response.ok)throw new Error('The employer directory is unavailable right now.');return ((await response.json()) as {companies:DirectoryCompany[]}).companies;}
export async function fetchConfig():Promise<SiteConfig|null> {try {const response=await fetch('/api/config');return response.ok?await response.json() as SiteConfig:null;} catch {return null;}}

const trim=(value:number,digits=1)=>Number.isInteger(value)?String(value):value.toFixed(digits);
export function formatValue(value:number|null|undefined,unit:string) {
 if(value===null||value===undefined||!Number.isFinite(value))return '—';
 return unit==='percent'?`${trim(value)}%`:unit==='hours'?`${trim(value)} h`:unit==='years'?`${trim(value)} ${value===1?'year':'years'}`:trim(value,2);
}
export const unitName=(unit:string)=>unit==='hours'?'hours a week':unit==='years'?'years':unit==='percent'?'percent':'';
export function sparkPath(values:number[],width=320,height=90) {
 const min=Math.min(...values),max=Math.max(...values),span=max-min||1;
 return values.map((v,index)=>`${index?'L':'M'}${(8+index*(width-16)/Math.max(1,values.length-1)).toFixed(1)},${(height-8-(v-min)/span*(height-16)).toFixed(1)}`).join(' ');
}
export const TOPIC_LABELS:Record<string,string>={promotion:'Promotions',management:'Management',compensation:'Compensation',workload:'Work / life',layoffs:'Layoffs',location_policy:'Remote & office',culture:'Culture',other:'All topics'};
export const VIEW_LABELS:Record<ViewId,string>={overview:'Workplace record',compare:'Side by side',timeline:'Through time',distribution:'The full distribution',clusters:'Recurring experiences',reader:'Original accounts',discovery:'Explore employers',cohort:'Group and company'};
export const VIEW_SHORT:Record<ViewId,string>={overview:'Record',compare:'Compare',timeline:'Over time',distribution:'Distribution',clusters:'Recurring',reader:'Accounts',discovery:'Explore',cohort:'Group'};
export const VIEW_DESCRIPTIONS:Record<ViewId,string>={
 overview:'Structured answers with their sample sizes and periods. Every number opens to its evidence.',
 compare:'The same measures for both employers, aligned on a shared reporting period where one exists.',
 timeline:'What changed across reporting periods. A change over time is not proof of what caused it.',
 distribution:'How answers spread across bands. Averages hide differences.',
 clusters:'Accounts judged to describe the same event, worded independently. Similarity is not proof.',
 reader:'The words contributors approved, unedited. Experiences, claims and opinions stay distinct.',
 discovery:'Employers with published evidence, filtered only by criteria you can see. Missing evidence is not a negative rating.',
 cohort:'A published group next to the whole company, for the same measures and periods.',
};
export const LAYER_LABELS:Record<string,string>={experience:'Experience',claim:'Claim',opinion:'Opinion'};
export const PROVENANCE_LABELS:Record<Provenance,string>={fixture:'Illustrative',sandbox:'Not employment-verified (sandbox or earlier demonstration credential)',credentialed:'Work-mailbox credential',unverified:'Verification not recorded'};
export const TIMEFRAME_LABELS:Record<string,string>={any:'All periods',last_year:'Previous calendar year',before_event:'Before the event',after_event:'After the event'};
export const humanKey=(key:string)=>{const text=key.replace(/^survey_/,'').replaceAll('_',' ');return text.charAt(0).toUpperCase()+text.slice(1);};
export const FICTION_LABEL='Fictional demonstration';
/** Site chrome shared by the app and the server-rendered trust pages (legal links come from shared/brand.ts). */
export const NAV_LINKS:ReadonlyArray<{href:string;label:string}>=[{href:'/',label:'Explore'},{href:'/constitution',label:'The Covenant'},{href:'/transparency',label:'Transparency'}];
export const TRUST_LINKS:ReadonlyArray<{href:string;label:string}>=[{href:'/constitution',label:'Constitution'},{href:'/moderation',label:'Moderation'},{href:'/transparency',label:'Transparency'},{href:'/jury',label:'Juries'},{href:'/status',label:'Contribution status'},{href:'/source',label:'Source'},{href:'/finances',label:'Finances'}];
export const THEME_KEY='siwt-theme';
export const isFictional=(company:{kind:string}|null|undefined)=>company?.kind==='sample';
