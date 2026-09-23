import type {Interpretation,RouteId,TopicId,ViewId} from './types.ts';
import {riskSignals} from '../../shared/policy.ts';
// Deterministic interpretation vocabulary shared by the public worker and the inference worker.
// This module must never import ai.ts: the public worker holds no provider credentials or client.
export const INTENT_PROMPT_VERSION='shouldiworkthere-intent-v5';
/**
 * The screening prompt the inference worker asks (worker/inference-core.ts re-exports it). Kept here so the main worker
 * can tell a stored re-check made under an older prompt from a current one without importing the provider client. v3:
 * every question reads the draft as data (RT-ABUSE-01); v4 once the published policy adds the addressed_to_checks signal.
 */
export const SCREEN_PROMPT_VERSION=(riskSignals as readonly string[]).includes('addressed_to_checks')?'shouldiworkthere-policy-screen-v4':'shouldiworkthere-policy-screen-v3';
/** Native-provider circuit breaker (used by ai.ts). Kept here so legal text can cite it without importing the provider client. minBudgetMs: a native timeout under a budget this small was imposed by the caller's deadline, not by the provider, so it never trips the breaker. */
export const BREAKER={failures:3,windowMs:600000,minBudgetMs:1000} as const;
export const APPLY_CONFIDENCE=.78, ASK_BELOW=.45, SECONDARY_CONFIDENCE=.7, FORK_MIN_SHARE=.12, SENTINEL_MARGIN=.25;
/**
 * UNSUPPORTED_AT: cannot_safely_answer needs BOTH the route Choice (that option's probability) and the unsupported noul at
 * or above it; one signal alone shows the nearest evidence with the no-generation notice. AMBIGUOUS_AT: the
 * ambiguous_meaning noul at or above it turns the topic into a fork between meanings (see docs/evaluation.md for the
 * live measurements these were set from).
 */
export const UNSUPPORTED_AT=.8, EVENT_REQUESTED_AT=.65, SALARY_REQUIRED_AT=.7, CANONICAL_AT=.6, FOCUS_AT=.65, AMBIGUOUS_AT=.6;
export const COMPANY_OPTION_LIMIT=250;
export const SENTINELS:readonly string[]=['unspecified','unlisted','none','any','unsupported','comparison'];
export const isSentinel=(value:string|null|undefined)=>value==null||SENTINELS.includes(value);
export const SALARY_NOTE='Actual salary amounts and pay percentiles are not collected. Market-perception answers cannot establish a top-paying employer.';
export const VIEW_OPTIONS:Record<ViewId,string>={overview:'Current structured answers about one company.',compare:'Compare two explicitly named employers.',timeline:'Change over time or before/after a named event.',distribution:'Distribution of weekly hours or compensation categories.',cohort:'One named group (team, function, seniority, location) against the whole company.',clusters:'Repeated or similar reports, corroboration and recurring experiences.',reader:'Read original testimony, quotes, and concrete accounts.',discovery:'Find or rank employers meeting criteria; no single company is the answer.'};
/** Closed set for the Jev route Choice. The first option is the plain metric view. */
export const ROUTE_OPTIONS:Record<RouteId,string>={metric_view:'Published measures about one employer answer it.',comparison:'Two named employers side by side.',timeline:'Change over time, or before and after a documented event.',distribution:'The spread of weekly hours or pay categories.',cohort:'One named group compared with the whole employer.',evidence:'Original written accounts answer it.',clusters:'Recurring or similar reports answer it.',existing_faq:'It is substantially one of the standard questions about an employer.',discovery:'Finding or ranking employers that meet criteria.',needs_generation:'It asks for advice, a prediction, a recommendation, a verdict or a written summary that published numbers and accounts cannot state directly.',cannot_safely_answer:'It asks to identify, locate or target a person, or is unrelated to workplace evidence.'};
export const ROUTE_IDS=Object.keys(ROUTE_OPTIONS) as RouteId[];
/** The evidence view each view-shaped route shows; needs_generation and existing_faq keep the view chosen for the question. */
export const VIEW_ROUTE:Record<ViewId,RouteId>={overview:'metric_view',compare:'comparison',timeline:'timeline',distribution:'distribution',cohort:'cohort',clusters:'clusters',reader:'evidence',discovery:'discovery'};
export const NEEDS_GENERATION_NOTE='This product does not generate answers; here is the evidence we have.';
const LEGACY_ROUTES:Record<string,true>={company:true,clarify:true,unsupported:true};
/**
 * Deterministic route after the reader's overrides: unsafe and unlisted stay; needs_generation stays unless the reader
 * picked a view; existing_faq stays only while the reading is unedited; everything else follows the view shown. Legacy
 * values from an older inference worker ('company', 'clarify', 'unsupported') are mapped so a rolling deploy never
 * degrades the canvas.
 */
export function settleRoute(i:Pick<Interpretation,'route'|'view'>,edits:{view?:boolean;any?:boolean}={}):Interpretation['route'] {
 const route=i.route as string;
 if(route==='unsupported'||route==='cannot_safely_answer')return 'cannot_safely_answer';
 if(route==='unlisted')return 'unlisted';
 if(!LEGACY_ROUTES[route]&&!edits.view&&(route==='needs_generation'||(route==='existing_faq'&&!edits.any)))return route;
 return VIEW_ROUTE[i.view.value]??'metric_view';
}
export const TOPIC_OPTIONS:Record<TopicId,string>={promotion:'Promotion criteria, advancement and fairness.',management:'Direct managers, commitments and performance reviews.',compensation:'Pay, equity and market compensation.',workload:'Weekly hours, work-life balance, on-call and staffing.',layoffs:'Layoffs, restructuring, severance or separation.',location_policy:'Remote work, relocation and office policy.',culture:'Executives, leadership trust, team culture and willingness to return.',other:'Not specified or not about these topics.'};
/**
 * Meanings offered when a question hinges on an ambiguous word ("how political is engineering?"). Each meaning is one
 * typed topic, so choosing it is an ordinary, authoritative topic edit. The fork's shares are Jev's `meaning` Choice.
 */
export const MEANING_OPTIONS:Readonly<Record<'promotion'|'management'|'culture'|'compensation'|'workload',string>>={promotion:'Promotions: who gets promoted and why',management:'Direct managers: favoritism, reviews and commitments',culture:'Leadership and team culture: executives, trust and how colleagues treat each other',compensation:'Pay and compensation',workload:'Workload and hours'};
export const MEANING_NAMES:Readonly<Record<keyof typeof MEANING_OPTIONS,string>>={promotion:'Promotion politics: who gets promoted and why',management:'Manager politics: favoritism and reviews',culture:'Leadership and team culture',compensation:'Pay',workload:'Workload and hours'};
export const MEANING_QUESTION='Which meaning did you intend?';
/**
 * The meaning fork is the primary clarification (D8d), so it leads the forks. The page shows only asks (tier 'ask') while
 * any field asks, so when another field must be asked, a tentative meaning is asked as well rather than applied behind
 * the question: its reading leaves the topic (and focus), and the fork keeps Jev's probabilities. Used by the interpreter
 * and again by the canvas after it adds asks of its own (a documented event, a published group).
 */
export function holdMeaningForAsk(i:Pick<Interpretation,'forks'|'topic'|'focus'>):void {
 const meaning=i.forks.find(f=>f.kind==='meaning');
 if(!meaning)return;
 if(meaning.tier==='fork'&&i.forks.some(f=>f!==meaning&&f.tier!=='fork')) {
  meaning.tier='ask';
  const applied=i.topic.value;
  if(meaning.options.some(o=>o.id===applied)){i.topic={value:'other',confidence:0,probabilities:{}};i.focus=i.focus.filter(t=>t!==applied);}
 }
 i.forks.sort((a,b)=>(a.kind==='meaning'?0:1)-(b.kind==='meaning'?0:1));
}
/**
 * Which documented events each restructuring word names (normalized, word-bounded). Event kinds are the schema's
 * ('layoff', 'reorg', ...); an event whose own label uses the word counts too ("2025 restructuring" is a restructuring
 * whatever kind it was filed under). 'restructuring' names layoffs and reorganizations; layoff words name layoffs; reorg
 * words name reorganizations and restructurings.
 */
export type RestructuringWord='restructuring'|'layoff'|'reorg';
const RESTRUCTURING_WORDS:Readonly<Record<RestructuringWord,{forms:readonly string[];kinds:readonly string[];labels:readonly string[];name:string}>>={
 restructuring:{forms:['restructuring','restructurings','restructure','restructured'],kinds:['layoff','reorg'],labels:['restructur'],name:'restructuring or layoff'},
 layoff:{forms:['layoff','layoffs','laid off','reduction in force','rif','job cuts'],kinds:['layoff'],labels:['layoff','laid off','reduction in force'],name:'layoff'},
 reorg:{forms:['reorg','reorgs','reorganization','reorganisation','reorganized','reorganised'],kinds:['reorg'],labels:['reorg','restructur'],name:'reorganization or restructuring'},
};
const TEMPORAL_FORMS=['before','after','since','following','prior to','changed','change','changes'];
/** The restructuring words a question uses, in a fixed order. */
export function restructuringWords(query:string):RestructuringWord[] {
 return (Object.keys(RESTRUCTURING_WORDS) as RestructuringWord[]).filter(word=>RESTRUCTURING_WORDS[word].forms.some(form=>findSpans(query,form).length>0));
}
/** True when the question names a restructuring (reorg, layoffs) with a before/after/since cue. Deterministic; never a model span. */
export function asksAroundRestructuring(query:string):boolean {
 return restructuringWords(query).length>0&&TEMPORAL_FORMS.some(form=>findSpans(query,form).length>0);
}
/** True when a documented event is one of the kinds the question's restructuring words name (by kind, or by its own label). */
export function eventMatchesWords(event:{label:string;kind?:string|null},words:readonly RestructuringWord[]):boolean {
 const label=normalize(event.label);
 return words.some(word=>{const w=RESTRUCTURING_WORDS[word];return w.kinds.includes(event.kind??'')||w.labels.some(l=>label.includes(l));});
}
/** How the notice names the kind the question asked about ("the only documented layoff for this employer"). */
export const restructuringName=(words:readonly RestructuringWord[])=>words.length===1?RESTRUCTURING_WORDS[words[0]!].name:'restructuring or layoff';
const YEAR=String.raw`(?:19|20)\d{2}`;
let restructuringYearPattern:RegExp|null=null;
/**
 * True when the question dates the restructuring it asks about ("after the 2023 restructuring", "the layoffs of 2024") and
 * the event's own label carries a different year: that event is not the one asked about, so it is never selected for the
 * reader. A label without a year cannot contradict anything, and a year that dates something else ("in 2026 since the
 * reorg") is not the event's.
 */
export function eventYearConflicts(query:string,eventLabel:string):boolean {
 const asked=restructuringYears(query),own=labelYears(eventLabel);
 return asked.length>0&&own.length>0&&!asked.some(y=>own.includes(y));
}
/** The years a question dates a restructuring word with ("after the 2025 restructuring", "the layoffs of 2024"). */
function restructuringYears(query:string):string[] {
 const forms=Object.values(RESTRUCTURING_WORDS).flatMap(w=>w.forms).map(f=>f.split(' ').map(escape).join(String.raw`\s+`)).join('|');
 // One descriptive word may sit between ("the 2025 company restructuring"), never a word that dates something else.
 const between=String.raw`(?:(?!(?:after|before|since|following|prior|until|during|and|or|in|of|at|to|from|the)\b)[a-z]+\s+)?`;
 restructuringYearPattern??=new RegExp(String.raw`\b(${YEAR})\s+${between}(?:${forms})\b|\b(?:${forms})\s+(?:of|in|from)\s+(${YEAR})\b`,'gi');
 return [...query.matchAll(restructuringYearPattern)].map(m=>m[1]??m[2]!);
}
const labelYears=(label:string):string[]=>label.match(new RegExp(String.raw`\b${YEAR}\b`,'g'))??[];
/**
 * True when the question names this documented event itself, not only its kind: by its label ("after the 2025
 * restructuring", "since the spring layoffs"), or by a restructuring word dated with a year the label carries ("the 2025
 * layoffs" for the "2025 restructuring"; the caller has already matched the word to the event's kind). Such an event is
 * the reader's own choice and is simply applied; only an event chosen from its kind alone is labeled as inferred (D8c).
 */
export function eventNamed(query:string,event:{label:string}):boolean {
 const label=normalize(event.label);
 if(label&&` ${normalize(query)} `.includes(` ${label} `))return true;
 const own=labelYears(event.label);
 return own.length>0&&restructuringYears(query).some(y=>own.includes(y));
}
/** Words that do not change what a bare employer-name query asks for ("Stripe", "tell me about working at Anthropic"). */
const BARE_FILLER=new Set(['the','a','an','at','about','for','on','of','in','with','company','employer','workplace','work','working','job','jobs','career','careers','review','reviews','record','records','evidence','info','information','please','show','me','tell','what','whats','how','is','it','its','like','there','inc','corp','llc','ltd','co','overview','profile','page']);
/**
 * The one listed employer a query consists of, give or take filler words; null for anything more (a topic, a second
 * employer, an evaluative word). Used only together with Jev's company Choice agreeing on the same employer.
 */
export function bareEmployer<T extends Matchable>(query:string,directory:T[]):T|null {
 const text=normalize(query);if(!text||text.split(' ').length>10)return null;
 const named=nameMatches(query,directory);if(named.length!==1)return null;
 const company=named[0]!;let rest=` ${text} `;
 for(const alias of [...new Set(companyForms(company).map(f=>normalize(f.form)))].sort((a,b)=>b.length-a.length))rest=rest.split(` ${alias} `).join('  ');
 return rest.split(' ').filter(Boolean).every(word=>BARE_FILLER.has(word))?company:null;
}
export const VIEW_NAMES:Record<ViewId,string>={overview:'Workplace record',compare:'Side by side',timeline:'Through time',distribution:'Full distribution',cohort:'Group and company',clusters:'Recurring experiences',reader:'Original testimony',discovery:'Explore employers'};
export const TOPIC_NAMES:Record<TopicId,string>={promotion:'Promotions',management:'Management',compensation:'Compensation',workload:'Work / life',layoffs:'Layoffs',location_policy:'Remote & office',culture:'Culture',other:'All topics'};
export const TOPIC_LEXICON:Record<Exclude<TopicId,'other'>,string[]>={
 promotion:['promotion','promotions','promoted','promote','promotability','advancement','career progression','career growth','level up','leveling'],
 management:['manager','managers','management','boss','bosses','performance review','performance reviews','reviews','supervisor'],
 compensation:['compensation','comp','pay','paid','salary','salaries','wage','wages','equity','bonus','bonuses','raise','raises','stock'],
 workload:['workload','hours','weekly hours','work-life','work life','work/life','overtime','on-call','on call','burnout','staffing'],
 layoffs:['layoff','layoffs','laid off','restructuring','reorg','reorganization','reduction in force','severance','rif'],
 location_policy:['remote','hybrid','office','return to office','rto','relocation','relocate','on-site','onsite','wfh'],
 culture:['culture','leadership','executives','execs','executive','toxic','work there again','work here again'],
};
export type Annotation=Interpretation['annotations'][number];
export type Suggestion=Interpretation['suggestions'][number];
export function baseInterpretation():Interpretation {
 return {source:'fallback',provider:'none',model:'local controls',promptVersion:INTENT_PROMPT_VERSION,providerFallback:null,degraded:false,latencyMs:0,company:null,compareTo:null,view:{value:'overview',confidence:0,probabilities:{}},topic:{value:'other',confidence:0,probabilities:{}},cohorts:{fn:null,seniority:null},layer:null,event:null,timeframe:'any',wantsTestimony:0,clarify:false,forks:[],suggestions:[],annotations:[],notes:[],focus:[],route:'metric_view',routeChoice:null,canonicalQuestion:null,unlistedEmployer:null,industry:null,preferences:{},salaryDataRequired:false};
}
const GENERIC=new Set(['the','a','an','and','of','labs','lab','inc','corp','corporation','company','co','group','holdings','technologies','technology','tech','systems','retail','semiconductor','semiconductors','global','international','national','united','american','general','first','new','software','services','partners','bank','health','energy','capital','solutions','industries','llc','ltd','plc']);
export const normalize=(text:string)=>text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
/**
 * A curated way of naming a listed employer (company_aliases, migration 0009), written as people write it. A cased alias
 * is a common English word (Target, Visa, Gap) or an acronym built from single letters (AT&T): it names the employer only
 * when written in exactly that case, or when it is the whole question, so "how do I target a promotion" or "what's it
 * like at T-Mobile" never names Target or AT&T.
 */
export interface CompanyAlias {alias:string;cased?:boolean|number|null}
/** Anything the matchers accept: a directory row with its curated aliases, if any. */
export interface Matchable {slug:string;name:string;aliases?:readonly CompanyAlias[]|null}
export interface CompanyForm {form:string;cased:boolean}
/** The forms derived from a name alone (used only for employers without curated aliases, such as the fictional samples). */
function derivedForms(company:{slug:string;name:string}):string[] {
 const name=normalize(company.name),words=name.split(' ').filter(Boolean),forms=new Set([name,normalize(company.slug)]);
 const lead=words[0];if(lead&&lead.length>=4&&!GENERIC.has(lead))forms.add(lead);
 const core=words.filter(w=>!GENERIC.has(w)).join(' ');if(core.length>=3)forms.add(core);
 return [...forms].filter(f=>f.length>=2);
}
/**
 * Every form a listed employer is recognized by. Curated aliases replace the derived forms entirely: a lead word or a
 * name stripped of generic words ("morgan", "charles", "boston", "best", "america", "one") is never guessed for them.
 */
export function companyForms(company:Matchable):CompanyForm[] {
 if(!company.aliases?.length)return derivedForms(company).map(form=>({form,cased:false}));
 const forms=new Map<string,CompanyForm>();
 for(const a of company.aliases) {
  const key=normalize(a.alias),cased=!!a.cased;if(key.length<2)continue;
  const id=cased?`c:${a.alias}`:`i:${key}`;if(!forms.has(id))forms.set(id,{form:cased?a.alias:key,cased});
 }
 return [...forms.values()];
}
/**
 * Case-insensitive forms only (normalized). Safe to match anywhere, including on the device; cased forms are matched by
 * companySpans, which applies their case rule.
 */
export function companyAliases(company:Matchable):string[] {
 return [...new Set(companyForms(company).filter(f=>!f.cased).map(f=>normalize(f.form)))];
}
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const patterns=new Map<string,RegExp|null>();
function phrasePattern(form:string,prefix=false) {
 const key=`${prefix?1:0}${form}`;if(patterns.has(key))return patterns.get(key)!;
 const words=normalize(form).split(' ').filter(Boolean);
 const compiled=words.length?new RegExp(`(?<![A-Za-z0-9])${words.map(escape).join('[^A-Za-z0-9]+')}${prefix?'[A-Za-z]*':''}(?![A-Za-z0-9])`,'gi'):null;
 if(patterns.size>6000)patterns.clear();
 patterns.set(key,compiled);return compiled;
}
export function findSpans(text:string,form:string,prefix=false):Array<[number,number]> {
 const pattern=phrasePattern(form,prefix);if(!pattern)return [];
 return [...text.matchAll(pattern)].map(m=>[m.index,m.index+m[0].length] as [number,number]);
}
const wordsOf=(text:string)=>text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').split(/[^A-Za-z0-9]+/).filter(Boolean);
/** A cased form counts only written in its own case ("Target", "AT&T"), or when it is the whole question ("target?"). */
function casedAt(text:string,[start,end]:[number,number],form:string):boolean {
 if(normalize(text)===normalize(form))return true;
 const found=wordsOf(text.slice(start,end)),own=wordsOf(form);
 return found.length===own.length&&found.every((w,i)=>w===own[i]);
}
/** Where a listed employer is named in the text: word-bounded, with the case rule for cased forms. */
export function companySpans(text:string,company:Matchable):Array<[number,number]> {
 return companyForms(company).flatMap(({form,cased})=>findSpans(text,form).filter(span=>!cased||casedAt(text,span,form)));
}
function withinOneEdit(a:string,b:string) {
 if(Math.abs(a.length-b.length)>1)return false;
 let i=0,j=0,edits=0;
 while(i<a.length&&j<b.length) {
  if(a[i]===b[j]){i++;j++;continue;}
  if(++edits>1)return false;
  if(a.length>b.length)i++;else if(b.length>a.length)j++;else {i++;j++;}
 }
 return edits+(a.length-i)+(b.length-j)<=1;
}
/** Options for the closed-set company question: the whole directory while it fits under the Choice cap (so the model can resolve brands and former names), otherwise the employers the query points at. */
export function companyCandidates<T extends Matchable>(query:string,directory:T[],currentSlug:string|null,limit=COMPANY_OPTION_LIMIT):T[] {
 const pointed=companiesInQuery(query,directory,currentSlug,limit);
 return candidatesComplete(directory,limit)?[...pointed,...directory.filter(c=>!pointed.includes(c))]:pointed;
}
/** True when the company question listed every employer, so "we do not list it" can be stated rather than "we could not match it". */
export const candidatesComplete=(directory:readonly unknown[],limit=COMPANY_OPTION_LIMIT)=>directory.length<=limit;
/**
 * Employers the query itself points at: alias matches (with the case rule), near-typos of a case-insensitive form, plus
 * the current page. It orders the company question and scopes the events and groups offered to the model.
 */
export function companiesInQuery<T extends Matchable>(query:string,directory:T[],currentSlug:string|null,limit=COMPANY_OPTION_LIMIT):T[] {
 const tokens=[...new Set(normalize(query).split(' ').filter(t=>t.length>=5))];
 const scored:Array<{company:T;rank:number;at:number}>=[];
 for(const company of directory) {
  const at=Math.min(...companySpans(query,company).map(([s])=>s));
  if(Number.isFinite(at)){scored.push({company,rank:0,at});continue;}
  const fuzzy=companyAliases(company).flatMap(a=>a.split(' ')).filter(w=>w.length>=5&&!GENERIC.has(w)).some(w=>tokens.some(t=>withinOneEdit(t,w)));
  if(fuzzy)scored.push({company,rank:1,at:0});
  else if(company.slug===currentSlug)scored.push({company,rank:2,at:0});
 }
 const current=directory.find(c=>c.slug===currentSlug);
 const ordered=scored.sort((a,b)=>a.rank-b.rank||a.at-b.at||a.company.slug.localeCompare(b.company.slug)).map(s=>s.company);
 const rest=ordered.filter(c=>c!==current).slice(0,current?limit-1:limit);
 return current?[...rest,current]:rest;
}
/**
 * Employers named explicitly (word-bounded alias match with the case rule), in order of first mention; at one position
 * the longest name wins ("Bank of America" over a shorter form inside it). Used for degraded manual mode, bare-name
 * navigation and "which employer do you mean?".
 */
export function nameMatches<T extends Matchable>(query:string,directory:T[]):T[] {
 const hits=directory.map(company=>{const spans=companySpans(query,company);const at=Math.min(...spans.map(([s])=>s));return {company,at,length:Math.max(0,...spans.filter(([s])=>s===at).map(([s,e])=>e-s))};}).filter(h=>Number.isFinite(h.at));
 const kept=hits.filter(h=>!hits.some(o=>o!==h&&o.at<=h.at&&o.at+o.length>=h.at+h.length&&o.length>h.length));
 return kept.sort((a,b)=>a.at-b.at||b.length-a.length).map(h=>h.company);
}
const STOP=new Set(['i','im','is','are','was','were','am','be','how','what','whats','which','who','why','when','where','does','do','did','can','could','would','should','will','tell','show','compare','compared','versus','vs','the','a','an','any','anyone','my','me','we','our','please','hey','hi','and','or','but','in','at','for','with','about','from','to','of','on','than','like','working','work','works','job','jobs','company','companies','employer','employers','team','teams','engineers','engineer','people','staff','managers','manager','senior','junior','remote','office','january','february','march','april','may','june','july','august','september','october','november','december','monday','tuesday','wednesday','thursday','friday','saturday','sunday','ceo','cto','cfo','hr','nyc','sf','usa','us','uk','eu']);
/** Words that end a lowercase employer name typed after "at", "for", "join" ("acme widgets for engineers"). */
const NAME_END=new Set([...STOP,'good','bad','fair','unfair','toxic','worth','really','okay','ok','great','nice','better','worse','best','worst','right','now','still','there','here','this','that','these','those','it','its','they','them','their','if','after','before','since','during','over','under','into','as','so','too','very','vs','versus','compared','pay','pays','paid','salary','salaries','culture','promotion','promotions','hours','layoffs','layoff','reorg','management','benefits','interview','interviews','today','tomorrow','next','last','soon','later','again','yet','year','years','month','months','week','weeks']);
/** A stop word, including contractions ("What's", "I'm"): every part is a stop word or a single letter. */
const isStop=(word:string)=>normalize(word).split(' ').every(part=>!part||part.length<2||STOP.has(part));
const cleanName=(text:string)=>text.replace(/\s+/g,' ').replace(/^[\s"'“‘(]+|[\s"'”’).,!?;:-]+$/g,'').slice(0,60);
/**
 * Best-effort surface form of an employer the directory does not list, as the asker typed it (spacing and trailing
 * punctuation normalized, case kept); null when not unambiguous. Capitalized names are read first; otherwise a whole
 * one-to-four-word question ("charlesschwab", "acme widgets") or a lowercase name right after "at", "for", "join" and
 * similar is taken. Echoed only to the asker, never stored.
 */
export function unlistedName(query:string,known:string[]):string|null {
 const knownSpans=known.flatMap(form=>findSpans(query,form));
 const overlapsKnown=(start:number,end:number)=>knownSpans.some(([s,e])=>start<e&&s<end);
 const runs=[...query.matchAll(/(?<![A-Za-z0-9])[A-Z][A-Za-z0-9&'’.-]*(?:\s+(?:&\s+)?[A-Z][A-Za-z0-9&'’.-]*)*/g)].map(m=>{
  const words=m[0].replace(/[.'’-]+$/,'').split(/\s+/);let start=m.index;
  while(words.length&&isStop(words[0]!)){start+=words[0]!.length;start+=query.slice(start).length-query.slice(start).trimStart().length;words.shift();}
  while(words.length&&isStop(words.at(-1)!))words.pop();
  const text=words.join(' ');return {text,start,end:start+text.length};
 }).filter(r=>r.text.length>=2&&!overlapsKnown(r.start,r.end));
 const preceded=(r:{start:number})=>/(?:^|[^A-Za-z])(?:at|for|with|about|from|vs\.?|versus|than|join|joining|like|to|and)\s+$/i.test(query.slice(0,r.start));
 const pick=runs.length===1?runs:runs.filter(preceded);
 if(pick.length===1)return cleanName(pick[0]!.text);
 if(runs.length)return null;
 // Lowercase: the whole question is a short name ("charlesschwab", "acme widgets")...
 const whole=cleanName(query.trim()),words=normalize(whole).split(' ').filter(Boolean);
 if(words.length&&words.length<=4&&!words.some(w=>NAME_END.has(w))&&/^[\p{L}\p{N}][\p{L}\p{N}&'’. -]*$/u.test(whole)&&!overlapsKnown(0,query.length))return whole;
 // ...or one lowercase name right after a cue word, up to the first word that cannot be part of it.
 const cued=[...query.matchAll(/(?:^|[^A-Za-z])(?:at|for|join|joining|from|about|with|vs\.?|versus|than)\s+([a-z0-9][a-z0-9&'’.-]*(?:\s+[a-z0-9][a-z0-9&'’.-]*){0,5})/g)].map(m=>{
  const all=m[1]!.split(/\s+/),kept:string[]=[];
  for(const w of all){if(NAME_END.has(normalize(w))||kept.length===3)break;kept.push(w);}
  const text=cleanName(kept.join(' ')),start=m.index+m[0].length-m[1]!.length;
  return {text,start,end:start+text.length};
 }).filter(r=>r.text.length>=2&&!overlapsKnown(r.start,r.end));
 return cued.length===1?cued[0]!.text:null;
}
/**
 * complete=false when the model saw only a prefiltered subset of the directory: then absence is not claimed, only a
 * failed match. The name is the asker's own words; nothing else is shown in its place.
 */
export function unlistedNotice(name:string|null,complete=true) {
 const subject=name?`“${name}”`:'That employer';
 return `${complete?`${subject} isn’t in the directory yet`:`We couldn’t match ${name?subject:'that employer'} to an employer in the directory`}, so no other employer is shown in its place. Search the directory or ask about a listed employer.`;
}
export const UNLISTED_OPTION_LABEL='An employer we don’t list';
export const unlistedNotices=(name:string|null)=>[unlistedNotice(name,true),unlistedNotice(name,false)];
/** The first employer is unlisted and the second is listed ("Acme Widgets vs Stripe"): nothing is compared, and the listed one is named. */
export function unlistedFirstNote(name:string|null,listed:string,complete=true) {
 const subject=name?`“${name}”`:'The first employer';
 return `${complete?`${subject} isn’t in the directory yet`:`We couldn’t match ${name?subject:'the first employer'} to an employer in the directory`}, so it can’t be compared with ${listed}. ${listed}’s own record is in the directory.`;
}
export function unlistedCompareNote(name:string|null,complete=true) {
 const subject=name?`“${name}”`:'the second employer';
 return `${complete?`${name?subject:'The second employer'} isn’t in the directory yet`:`We couldn’t match ${subject} to an employer in the directory`}, so there is nothing to compare it with.`;
}
function cohortForms(label:string) {
 const words=normalize(label).split(' ').filter(w=>w.length>=5&&!GENERIC.has(w)&&!['individual','contributor','operations'].includes(w));
 return [{form:label,prefix:false},...words.map(w=>({form:w.slice(0,Math.max(5,w.length-3)),prefix:true}))];
}
/**
 * Published groups the question names by their whole label, word-bounded and in any case ("how political is
 * engineering?" names Engineering; "engineers" is only a stem of it and is left to Jev's reading). Where labels overlap,
 * the longest one names the words ("hardware engineering" names Hardware engineering, not also Engineering).
 * Deterministic, never a model span.
 */
export function groupsNamed(query:string,labels:readonly string[]):string[] {
 const hits=labels.filter(label=>!isSentinel(label)).map(label=>({label,spans:findSpans(query,label)})).filter(h=>h.spans.length>0);
 const within=([s,e]:[number,number],other:{spans:Array<[number,number]>})=>other.spans.some(([a,b])=>a<=s&&e<=b&&b-a>e-s);
 return hits.filter(h=>!h.spans.every(span=>hits.some(o=>o!==h&&within(span,o)))).map(h=>h.label);
}
function eventForms(label:string) {
 const core=normalize(label).split(' ').filter(w=>!/^\d{4}$/.test(w)).join(' ');
 return [{form:label,prefix:false},...(core.length>=5&&core!==normalize(label)?[{form:core,prefix:false}]:[])];
}
const TIMEFRAME_FORMS:Record<string,string[]>={last_year:['last year','previous year','past year'],before_event:['before','prior to'],after_event:['after','since','following']};
const LAYER_FORMS:Record<string,string[]>={experience:['experience','experiences','firsthand','first-hand'],claim:['claim','claims','allegation','allegations'],opinion:['opinion','opinions']};
export interface AnnotationContext {directory:Matchable[];events?:Array<{id:string;label:string}>;cohorts?:string[];}
/** Deterministic spans for the concepts actually applied; offsets index the query string. Never model-produced spans or counts. */
export function annotate(query:string,i:Interpretation,context:AnnotationContext):Annotation[] {
 if(!query.trim())return [];
 const found:Annotation[]=[];
 const add=(field:string,value:string,label:string,forms:Array<{form:string;prefix:boolean}>)=>{for(const {form,prefix} of forms)for(const [start,end] of findSpans(query,form,prefix))found.push({start,end,field,value,label});};
 const company=(field:string,slug:string|undefined)=>{const c=slug?context.directory.find(d=>d.slug===slug):undefined;if(c)for(const [start,end] of companySpans(query,c))found.push({start,end,field,value:c.slug,label:c.name});};
 company('company',i.company?.value);company('compareTo',i.compareTo?.value);
 for(const label of [i.cohorts.fn,i.cohorts.seniority])if(label)add('cohort',label,label,cohortForms(label));
 const event=i.event?context.events?.find(e=>e.id===i.event!.value):undefined;if(event)add('event',event.id,event.label,eventForms(event.label));
 if(i.topic.value!=='other')add('topic',i.topic.value,TOPIC_NAMES[i.topic.value],(TOPIC_LEXICON[i.topic.value]??[]).map(form=>({form,prefix:false})));
 if(i.view.value==='compare')add('view','compare',VIEW_NAMES.compare,['compare','compared','comparison','versus','vs'].map(form=>({form,prefix:false})));
 if(i.industry)add('industry',i.industry,i.industry,[{form:i.industry,prefix:false}]);
 if(i.timeframe!=='any')add('timeframe',i.timeframe,i.timeframe.replaceAll('_',' '),(TIMEFRAME_FORMS[i.timeframe]??[]).map(form=>({form,prefix:false})));
 if(i.layer)add('layer',i.layer,i.layer,(LAYER_FORMS[i.layer]??[]).map(form=>({form,prefix:false})));
 const kept:Annotation[]=[];
 for(const a of found.sort((x,y)=>x.start-y.start||(y.end-y.start)-(x.end-x.start)))if(!kept.some(k=>a.start<k.end&&k.start<a.end))kept.push(a);
 return kept.slice(0,24);
}
