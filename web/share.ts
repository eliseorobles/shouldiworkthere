import {parseSpecId} from '../shared/faq.ts';
import {conceptFor,DISCOVERY_CONCEPTS} from '../worker/src/evidence.ts';
import type {CanvasResponse,ComparisonCell,Overrides} from './api.ts';

/**
 * Typed-state URLs. A view is addressed only by public, typed identifiers: an employer slug, a view name, enum values,
 * a published group label, a documented event id and the published criteria discovery ranks on. Question text never
 * enters a URL. Only the last submitted question is kept in the tab's own session history (history.state), which the
 * browser does not send anywhere; see `forgetQuestion`.
 */
export interface TypedState {
 slug:string|null;view?:string;vs?:string;topic?:string;cohort?:string;event?:string;layer?:string;time?:string;sector?:string;
 prefs?:Record<string,'high'|'low'>;faq?:string;
}
export const STATE_KEYS=['view','vs','topic','cohort','event','layer','time','sector','pref','faq'] as const;
const VIEWS=['overview','compare','timeline','distribution','clusters','reader','discovery','cohort'];
const TOPICS=['promotion','management','compensation','workload','layoffs','location_policy','culture'];
const LAYERS=['experience','claim','opinion'],TIMES=['last_year','before_event','after_event'];
const SENTINELS=['unspecified','unlisted','none','any','unsupported','comparison'];
const SLUG=/^[a-z0-9][a-z0-9-]{0,89}$/,ID=/^[A-Za-z0-9][A-Za-z0-9_:.-]{0,99}$/,PREF=/^[a-z][a-z0-9_]{0,59}$/;
// Published group and sector labels: letters, digits and a few separators, no markup or URL syntax.
const LABEL=/^[\p{L}\p{N}][\p{L}\p{N} &'’+/(),.-]{0,99}$/u;
export const validSlug=(value:unknown):value is string=>typeof value==='string'&&SLUG.test(value)&&!SENTINELS.includes(value);
/**
 * An employer address (/c/<slug>) the directory does not list. The server's canvas answers only listed slugs, so such a
 * page shows its not-found state without asking it. An empty directory (not loaded yet, or unavailable) proves nothing.
 */
export const missingEmployer=(slug:string|null|undefined,directory:readonly {slug:string}[])=>!!slug&&directory.length>0&&!directory.some(c=>c.slug===slug);
const pick=(value:string|null|undefined,ok:(v:string)=>boolean)=>value&&ok(value)?value:undefined;
/**
 * A preference key discovery can rank on: one of the published comparable measures (worker/src/evidence.ts
 * DISCOVERY_CONCEPTS, their metric keys and aliases). Any other key is words someone chose, never a public identifier.
 */
export function isPublishedCriterion(key:string):boolean {
 const c=PREF.test(key)?conceptFor(key):null;
 return !!c&&Object.hasOwn(DISCOVERY_CONCEPTS,c);
}
/** Preferences rank employers in discovery only; a single-employer address never carries them. */
const discoveryState=(s:TypedState)=>!s.slug||s.view==='discovery';
const publishedPrefs=(prefs:Record<string,string>|undefined)=>Object.entries(prefs??{}).filter((e):e is [string,'high'|'low']=>isPublishedCriterion(e[0])&&(e[1]==='high'||e[1]==='low'));

export function stateUrl(s:TypedState):string {
 const p=new URLSearchParams();
 if(s.view&&s.view!=='overview'&&VIEWS.includes(s.view))p.set('view',s.view);
 if(s.vs&&validSlug(s.vs))p.set('vs',s.vs);
 if(s.topic&&TOPICS.includes(s.topic))p.set('topic',s.topic);
 if(s.cohort&&LABEL.test(s.cohort))p.set('cohort',s.cohort);
 if(s.event&&ID.test(s.event))p.set('event',s.event);
 if(s.layer&&LAYERS.includes(s.layer))p.set('layer',s.layer);
 if(s.time&&TIMES.includes(s.time))p.set('time',s.time);
 if(s.sector&&LABEL.test(s.sector)&&!SENTINELS.includes(s.sector))p.set('sector',s.sector);
 const prefs=discoveryState(s)?publishedPrefs(s.prefs).sort(([a],[b])=>a.localeCompare(b)).slice(0,12):[];
 if(prefs.length)p.set('pref',prefs.map(([k,v])=>`${k}:${v}`).join(','));
 if(s.faq&&parseSpecId(s.faq))p.set('faq',s.faq);
 const path=s.slug&&validSlug(s.slug)?`/c/${s.slug}`:'/',query=p.toString();
 return query?`${path}?${query}`:path;
}

/**
 * Parses a location into typed state. Unknown parameters (including any `q`) are ignored, and invalid values dropped. A
 * preference is kept only when it names a published criterion and the address is a discovery view, so a crafted link
 * cannot put its own words on an employer's page as a criterion.
 */
export function parseState(pathname:string,search:string):TypedState {
 const p=new URLSearchParams(search),raw=pathname.startsWith('/c/')?safeDecode(pathname.slice(3)):null;
 const prefs:Record<string,'high'|'low'>={};
 for(const part of (p.get('pref')??'').split(',').slice(0,12)){const [k,v]=part.split(':');if(k&&isPublishedCriterion(k)&&(v==='high'||v==='low'))prefs[k]=v;}
 const s:TypedState={slug:validSlug(raw)?raw:null};
 const set=<K extends keyof TypedState>(key:K,value:TypedState[K]|undefined)=>{if(value!==undefined)s[key]=value;};
 set('view',pick(p.get('view'),v=>VIEWS.includes(v)));set('vs',pick(p.get('vs'),validSlug));set('topic',pick(p.get('topic'),v=>TOPICS.includes(v)));
 set('cohort',pick(p.get('cohort'),v=>LABEL.test(v)));set('event',pick(p.get('event'),v=>ID.test(v)));set('layer',pick(p.get('layer'),v=>LAYERS.includes(v)));
 set('time',pick(p.get('time'),v=>TIMES.includes(v)));set('sector',pick(p.get('sector'),v=>LABEL.test(v)&&!SENTINELS.includes(v)));
 if(Object.keys(prefs).length&&discoveryState(s))s.prefs=prefs;
 set('faq',pick(p.get('faq'),v=>!!parseSpecId(v)));
 return s;
}
function safeDecode(value:string) {try {return decodeURIComponent(value);} catch {return null;}}
export const hasTypedFilters=(s:TypedState)=>Object.keys(s).some(k=>k!=='slug');

/** Canvas request overrides that reproduce a typed state exactly, with no inference. */
export function stateOverrides(s:TypedState):Overrides {
 const o:Overrides={};
 if(s.slug)o.company=s.slug;
 if(s.view)o.view=s.view;
 if(s.vs)o.compareTo=s.vs;
 if(s.topic)o.topic=s.topic;
 if(s.cohort)o.cohort=s.cohort;
 if(s.event)o.event=s.event;
 if(s.layer)o.layer=s.layer;
 if(s.time)o.timeframe=s.time;
 if(s.sector)o.industry=s.sector;
 const prefs=discoveryState(s)?publishedPrefs(s.prefs):[];
 if(prefs.length)o.preferences=Object.fromEntries(prefs);
 return o;
}

/** Chip and rail label for a group that a link or a question named but no release publishes. Its words are never repeated. */
export const REQUESTED_GROUP='Requested group (not published)';
const escapeRe=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const mentions=(text:string,label:string)=>new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(label)}(?![\\p{L}\\p{N}])`,'u').test(text);

/** A group label the response itself vouches for: one of the employers' published groups, or a join of them. */
export function isPublishedGroup(r:CanvasResponse,label:string):boolean {
 if(!label||label===REQUESTED_GROUP)return false;
 if(r.evidence) {
  const facets=new Set([...(r.evidence.facets??[]),...(r.compareEvidence?.facets??[])].map(f=>f.label));
  return label.split(' + ').every(part=>facets.has(part));
 }
 // Discovery: some employer row resolved the group instead of listing it as missing.
 return r.discovery.some(row=>!row.missing.some(m=>m.concept==='group'));
}
/** A sector named in the directory the response came with. */
export const isListedSector=(r:CanvasResponse,sector:string)=>!!sector&&!SENTINELS.includes(sector)&&(r.directory??[]).some(c=>c.sector===sector);

/** Wording for a preference that names no published criterion. Its words are never repeated. */
export const REQUESTED_CRITERION='a requested criterion';
export interface Unpublished {cohort?:string;sector?:string;criteria?:string[];}
/** The ways a response can spell an unpublished preference key: the key, without the questionnaire prefix, and as words. */
const criterionWords=(key:string)=>{const bare=key.replace(/^survey_/,'');return [...new Set([key,bare,bare.replaceAll('_',' ')])].filter(w=>w.length>0);};
/** Group, industry or criterion words a response would echo although nothing publishes them (they came from a link or from someone's wording). */
export function unpublished(r:CanvasResponse):Unpublished {
 const out:Unpublished={},i=r.interpretation;
 const criteria=Object.entries(i.preferences??{}).filter(([key,direction])=>(direction==='high'||direction==='low')&&!isPublishedCriterion(key)).map(([key])=>key);
 if(criteria.length)out.criteria=criteria;
 if(r.evidence) {
  const side=[r.evidence,r.compareEvidence].find(x=>x&&x.cohortStatus==='unavailable'&&x.cohortLabel!==REQUESTED_GROUP&&!isPublishedGroup(r,x.cohortLabel));
  if(side)out.cohort=side.cohortLabel;
 } else {
  const groups=[i.cohorts.fn,i.cohorts.seniority].filter((g):g is string=>!!g&&!SENTINELS.includes(g)&&g!==REQUESTED_GROUP);
  if(groups.length>1||(groups.length===1&&!isPublishedGroup(r,groups[0]!)))out.cohort=groups.join(' + ');
 }
 if(r.view==='discovery'&&i.industry&&!SENTINELS.includes(i.industry)&&!isListedSector(r,i.industry))out.sector=i.industry;
 return out;
}

/**
 * The response as it may be shown and shared: unpublished group, industry or criterion words are replaced by neutral
 * wording in every field the page renders (labels, headline, facts, notices, filters, cursor labels, chips), so a crafted
 * link cannot put arbitrary text on an employer's page in the site's voice. Idempotent.
 */
export function neutralized(r:CanvasResponse):{response:CanvasResponse;dropped:Unpublished} {
 const dropped=unpublished(r);
 if(!dropped.cohort&&!dropped.sector&&!dropped.criteria)return {response:r,dropped};
 const criteria=(dropped.criteria??[]).flatMap(criterionWords);
 const words=(text:string)=>dropped.cohort&&mentions(text,dropped.cohort)?'the requested group':dropped.sector&&mentions(text,dropped.sector)?'the requested industry':criteria.some(w=>mentions(text,w))?REQUESTED_CRITERION:null;
 const keep=(text:string)=>!words(text);
 const where=r.evidence?` at ${r.evidence.company.name}`:'';
 const group=(label:string)=>label===dropped.cohort?REQUESTED_GROUP:label;
 const cell=(c:ComparisonCell):ComparisonCell=>'cohortLabel'in c?{...c,cohortLabel:group(c.cohortLabel)}:c;
 const filter=(entry:string)=>{const w=words(entry);return w?`${entry.includes(':')?entry.slice(0,entry.indexOf(':')):'Filter'}: ${w}`:entry;};
 const side=<T extends NonNullable<CanvasResponse['evidence']>>(e:T):T=>({...e,cohortLabel:group(e.cohortLabel),notices:e.notices.filter(keep),metrics:e.metrics.map(m=>({...m,cohortLabel:group(m.cohortLabel)}))});
 const removed=r.notices.length-r.notices.filter(keep).length;
 const several=(dropped.criteria?.length??0)>1;
 const added=[...(removed&&dropped.cohort?[`The requested group is not a published group${where}, so no results are shown for it.`]:[]),...(removed&&dropped.sector?['The requested industry is not listed in the directory, so no employers are shown for it.']:[]),
  ...(dropped.criteria?[several?'Some requested criteria are not published measures, so they were not applied.':'A requested criterion is not a published measure, so it was not applied.']:[])];
 const i=r.interpretation,t=r.comparisonTable,a=r.answer;
 const headline=(text:string)=>{const w=words(text);return !w?text:w==='the requested group'?`No published results exist for the requested group${where}.`:w==='the requested industry'?'No employer is listed under the requested industry.':'A requested criterion is not a published measure, so no employer is ranked by it.';};
 const once=(list:string[])=>[...new Set(list)];
 const response:CanvasResponse={...r,
  notices:once([...added,...r.notices.filter(keep)]),
  evidence:r.evidence?side(r.evidence):null,compareEvidence:r.compareEvidence?side(r.compareEvidence):null,
  ...(t?{comparisonTable:{...t,left:{...t.left,cohortLabel:group(t.left.cohortLabel)},right:{...t.right,cohortLabel:group(t.right.cohortLabel)},notices:t.notices.filter(keep),
   rows:t.rows.map(row=>({...row,left:cell(row.left),right:cell(row.right)}))}}:{}),
  ...(a?{answer:{...a,headline:headline(a.headline),facts:a.facts.filter(f=>keep(f.label))}}:{}),
  ...(r.applied?{applied:once(r.applied.map(filter))}:{}),...(r.unsupported?{unsupported:once(r.unsupported.map(filter))}:{}),
  discovery:r.discovery.map(row=>({...row,missing:row.missing.map(m=>m.concept==='group'&&!keep(`${m.label} ${m.reason}`)?{...m,label:'Requested group',reason:'Not a published group at this employer'}:m)})),
  interpretation:{...i,
   cohorts:dropped.cohort?(r.evidence?{fn:null,seniority:null}:{fn:REQUESTED_GROUP,seniority:null}):i.cohorts,
   industry:dropped.sector?'unsupported':i.industry,
   // A criterion nothing publishes was not applied; it is not a filter in effect, so it leaves the chips and the address.
   ...(dropped.criteria&&i.preferences?{preferences:Object.fromEntries(Object.entries(i.preferences).filter(([key])=>!dropped.criteria!.includes(key)))}:{}),
   annotations:i.annotations.map(x=>{const w=words(`${x.label} ${x.value}`);return w?{...x,label:w,value:w}:x;}),
   suggestions:i.suggestions.filter(s=>keep(`${s.label} ${s.value}`)&&(s.field!=='preferences'||!s.key||isPublishedCriterion(s.key))),
  },
 };
 return {response,dropped};
}

const EMPLOYER_ONLY=['event','cohort','cohortFunction','cohortSeniority','scope'];
/** Edits that mean the same at every employer. A documented event, a published group (either slot) and an event-based period do not. */
export function portable(pins:Overrides):Overrides {
 return Object.fromEntries(Object.entries(pins).filter(([key,value])=>!EMPLOYER_ONLY.includes(key)&&!(key==='timeframe'&&(value==='before_event'||value==='after_event'))));
}

/** The typed state a committed canvas response is showing: what a shared link must reproduce. */
export function stateOf(r:CanvasResponse,faq?:string):TypedState {
 const i=r.interpretation,e=r.evidence,discovery=!e;
 const s:TypedState={slug:e?.company.slug??null};
 if(r.view!=='overview')s.view=r.view;
 const vs=r.compareEvidence?.company.slug??i.compareTo?.value;
 if(r.view==='compare'&&validSlug(vs)&&vs!==s.slug)s.vs=vs;
 if(i.topic.value!=='other')s.topic=i.topic.value;
 // Only a published group or a directory sector is a public identifier; anything else stays out of the address.
 const cohort=e?(e.cohortStatus!=='all'?e.cohortLabel:undefined):(i.cohorts.fn??i.cohorts.seniority??undefined);
 if(cohort&&(e?.cohortStatus==='selected'||isPublishedGroup(r,cohort)))s.cohort=cohort;
 const event=e?.selectedEvent?.id??i.event?.value;
 if(!discovery&&event&&!SENTINELS.includes(event))s.event=event;
 if(i.layer&&LAYERS.includes(i.layer))s.layer=i.layer;
 if(i.timeframe!=='any')s.time=i.timeframe;
 if(i.industry&&isListedSector(r,i.industry))s.sector=i.industry;
 const prefs=Object.fromEntries(publishedPrefs(i.preferences as Record<string,string>|undefined));
 if(discovery&&Object.keys(prefs).length)s.prefs=prefs;
 if(faq)s.faq=faq;
 return s;
}

/**
 * Called before a new history entry is pushed: the entry being left drops its question, so at most one entry holds one,
 * the last question submitted (browsers can write session history to disk to restore tabs). Earlier questions are kept
 * only in this page's memory, for Back and Forward in this session, and are gone when the page reloads or closes.
 */
export function forgetQuestion() {
 try {
  const st:unknown=typeof history==='undefined'?null:history.state;
  if(st&&typeof st==='object'&&typeof (st as {q?:unknown}).q==='string'&&(st as {q:string}).q)history.replaceState({...(st as object),q:''},'',location.href);
 } catch {}
}

export type ShareOutcome='shared'|'copied'|'cancelled'|'unavailable';
/** Web Share when the device offers it, otherwise the clipboard. The URL carries typed state only. */
export async function shareView(o:{url:string;title:string;text?:string}):Promise<ShareOutcome> {
 const nav=typeof navigator==='undefined'?null:navigator as Navigator&{share?:(data:ShareData)=>Promise<void>};
 if(nav?.share) {
  try {await nav.share({title:o.title,...(o.text?{text:o.text}:{}),url:o.url});return 'shared';}
  catch(error) {if((error as Error).name==='AbortError')return 'cancelled';}
 }
 try {await nav!.clipboard.writeText(o.url);return 'copied';} catch {return 'unavailable';}
}
export const absoluteUrl=(path:string)=>`${typeof location==='undefined'?'':location.origin}${path}`;
