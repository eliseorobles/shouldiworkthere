import {companyForms,companySpans,normalize,TOPIC_LEXICON,TOPIC_NAMES,type Matchable} from '../worker/src/interpretation.ts';
import {employerLabel,isCommunity} from './api.ts';

/**
 * On-device semantic cursor. While someone types, known public concepts (listed employers and their aliases, the
 * current employer's published group labels and documented event labels, a fixed topic lexicon and a few view and
 * period cues) are located in their own words by deterministic matching. Nothing here performs network or storage
 * access; hosted Jev reads a question only on an explicit submit or while Live understanding is on.
 */
export type LocalField='company'|'cohort'|'event'|'topic'|'view'|'timeframe'|'layer';
export interface LocalAnnotation {start:number;end:number;field:LocalField;value:string;label:string;}
/**
 * `directory` rows carry their curated aliases (migration 0009) when the server has them; cased aliases keep their case rule
 * here too. A community listing (origin 'community') carries its domains, so it is named with them.
 */
export type Listed=Matchable&{origin?:string|null;domains?:readonly string[]|null};
export interface LocalContext {directory:ReadonlyArray<Listed>;cohorts?:readonly string[];events?:ReadonlyArray<{id:string;label:string}>;}
/**
 * Curated listings first, community listings after, each group in directory order. Where a community listing shares a
 * curated employer's name (anyone may list "Google" with another domain), the words are read as the curated employer.
 */
const curatedFirst=<T extends {origin?:string|null}>(directory:ReadonlyArray<T>):T[]=>[...directory.filter(c=>!isCommunity(c)),...directory.filter(c=>isCommunity(c))];

export const VIEW_CUES:Record<string,{label:string;forms:string[]}>={
 compare:{label:'Side by side',forms:['compare','compared','comparison','versus','vs','side by side']},
 timeline:{label:'Over time',forms:['over time','changed','change','changes','changing','since','trend','trends','before and after']},
 distribution:{label:'Distribution',forms:['distribution','spread','typical week','how many hours']},
 clusters:{label:'Recurring experiences',forms:['keep coming up','keeps coming up','recurring','common complaints','patterns','pattern']},
 reader:{label:'Original accounts',forms:['testimony','accounts','quotes','stories','in their own words']},
 discovery:{label:'Explore employers',forms:['which companies','which employers','best companies','best places','companies where','employers where','ranking']},
};
const TIME_CUES:Record<string,{label:string;forms:string[]}>={last_year:{label:'Previous calendar year',forms:['last year','previous year','past year']}};
const LAYER_CUES:Record<string,{label:string;forms:string[]}>={experience:{label:'Experiences',forms:['firsthand','first-hand','experiences']},claim:{label:'Claims',forms:['claims','allegations','allegation']},opinion:{label:'Opinions',forms:['opinions']}};
const GENERIC=new Set(['individual','contributor','contributors','operations','verified']);
const PRIORITY:Record<LocalField,number>={company:0,event:1,cohort:2,topic:3,view:4,timeframe:5,layer:6};
const MAX_TEXT=600,MAX_ANNOTATIONS=24;

const cache=new Map<string,RegExp|null>();
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Same word-boundary phrase semantics as the server's annotate(), compiled once per form. */
function pattern(form:string,prefix=false):RegExp|null {
 const key=`${prefix?1:0}${form}`;
 if(cache.has(key))return cache.get(key)!;
 const words=normalize(form).split(' ').filter(Boolean);
 const compiled=words.length?new RegExp(`(?<![A-Za-z0-9])${words.map(escape).join('[^A-Za-z0-9]+')}${prefix?'[A-Za-z]*':''}(?![A-Za-z0-9])`,'gi'):null;
 if(cache.size>4000)cache.clear();
 cache.set(key,compiled);return compiled;
}
function spans(text:string,form:string,prefix=false):Array<[number,number]> {
 const re=pattern(form,prefix);if(!re)return [];
 re.lastIndex=0;return [...text.matchAll(re)].map(m=>[m.index,m.index+m[0].length]);
}
function cohortForms(label:string) {
 const words=normalize(label).split(' ').filter(w=>w.length>=5&&!GENERIC.has(w));
 return [{form:label,prefix:false},...words.map(w=>({form:w.slice(0,Math.max(5,w.length-3)),prefix:true}))];
}
function eventForms(label:string) {
 const core=normalize(label).split(' ').filter(w=>!/^\d{4}$/.test(w)).join(' ');
 return [{form:label,prefix:false},...(core.length>=5&&core!==normalize(label)?[{form:core,prefix:false}]:[])];
}

export function localAnnotations(text:string,context:LocalContext):LocalAnnotation[] {
 if(typeof text!=='string'||!text.trim())return [];
 const source=text.slice(0,MAX_TEXT),found:LocalAnnotation[]=[];
 const add=(field:LocalField,value:string,label:string,forms:Array<{form:string;prefix:boolean}>)=>{for(const {form,prefix} of forms)for(const [start,end] of spans(source,form,prefix))found.push({start,end,field,value,label});};
 // The sort below is stable, so where two listings match the same words the curated one, pushed first, is kept.
 for(const company of curatedFirst(context.directory))for(const [start,end] of companySpans(source,company))found.push({start,end,field:'company',value:company.slug,label:employerLabel(company)});
 for(const event of context.events??[])add('event',event.id,event.label,eventForms(event.label));
 for(const label of context.cohorts??[])add('cohort',label,label,cohortForms(label));
 for(const [topic,forms] of Object.entries(TOPIC_LEXICON))add('topic',topic,TOPIC_NAMES[topic as keyof typeof TOPIC_NAMES],forms.map(form=>({form,prefix:false})));
 for(const [view,cue] of Object.entries(VIEW_CUES))add('view',view,cue.label,cue.forms.map(form=>({form,prefix:false})));
 for(const [time,cue] of Object.entries(TIME_CUES))add('timeframe',time,cue.label,cue.forms.map(form=>({form,prefix:false})));
 for(const [layer,cue] of Object.entries(LAYER_CUES))add('layer',layer,cue.label,cue.forms.map(form=>({form,prefix:false})));
 const kept:LocalAnnotation[]=[];
 found.sort((a,b)=>a.start-b.start||(b.end-b.start)-(a.end-a.start)||PRIORITY[a.field]-PRIORITY[b.field]);
 for(const a of found)if(!kept.some(k=>a.start<k.end&&k.start<a.end))kept.push(a);
 return kept.slice(0,MAX_ANNOTATIONS);
}

/** Distinct recognised concepts, in order of first mention, for the "recognised on this device" summary. */
export function recognised(annotations:readonly LocalAnnotation[]):Array<{field:LocalField;value:string;label:string}> {
 const seen=new Set<string>(),out:Array<{field:LocalField;value:string;label:string}>=[];
 for(const a of annotations){const key=`${a.field}:${a.value}`;if(!seen.has(key)){seen.add(key);out.push({field:a.field,value:a.value,label:a.label});}}
 return out;
}

/** Every listing the whole text names exactly, by name, slug or alias (a cased alias counts in any case, as on the server). */
export function namesakes<T extends Listed>(text:string,directory:ReadonlyArray<T>):T[] {
 const q=normalize(text);if(!q||q.length>90)return [];
 return directory.filter(c=>companyForms(c).some(f=>normalize(f.form)===q));
}
/**
 * The directory slug when the whole question is just one listed employer's name or alias; such a question navigates on the
 * device. When a community listing shares the name, the one curated employer of that name is meant; two listings of the
 * same kind are ambiguous (null).
 */
export function exactCompany(text:string,directory:ReadonlyArray<Listed>):string|null {
 const hits=namesakes(text,directory),curated=hits.filter(c=>!isCommunity(c));
 return hits.length===1?hits[0]!.slug:curated.length===1?curated[0]!.slug:null;
}

// Words that make typed text a question or a request rather than just a name.
const NOT_A_NAME=/[?]|(?<![\p{L}\p{N}])(?:what|whats|how|why|when|where|who|which|is|are|was|were|does|do|did|can|could|would|should|will|tell|show|compare|compared|versus|vs|like|about|working|jobs?|culture|pay|salary|salaries|promotions?|layoffs?|managers?|reviews?|interviews?|hiring|benefits|remote|hours|trust)(?![\p{L}\p{N}])/iu;
/**
 * The employer name when the typed text is only a name (at most five words, no question), tidied for display: spaces
 * collapsed, surrounding quotes and end punctuation dropped, and all-lowercase words capitalised. Null when it is a
 * question, or when it names an employer the directory lists. Shown only to the person who typed it; never stored or sent.
 */
export function typedEmployerName(text:string,directory:ReadonlyArray<Matchable>):string|null {
 const clean=tidyName(text);
 if(!clean||clean.split(' ').length>5||NOT_A_NAME.test(clean))return null;
 if(localAnnotations(clean,{directory}).some(a=>a.field==='company'))return null;
 return clean;
}
/** An employer name for display: spaces collapsed, surrounding quotes and end punctuation dropped, all-lowercase words capitalised. */
export function tidyName(text:string|null|undefined):string|null {
 if(typeof text!=='string')return null;
 const clean=text.normalize('NFKC').replace(/\s+/g,' ').trim().replace(/^["'“”‘’]+/,'').replace(/["'“”‘’.!,;:?]+$/,'').trim();
 if(clean.length<2||clean.length>60||!/\p{L}/u.test(clean))return null;
 return clean===clean.toLowerCase()?clean.replace(/(^|[\s-])(\p{L})/gu,(_,lead:string,letter:string)=>lead+letter.toUpperCase()):clean;
}

/** Splits text into plain and annotated runs for the cursor overlay. Offsets are UTF-16 indices into `text`. */
export function segments<T extends {start:number;end:number}>(text:string,annotations:readonly T[]):Array<{text:string;annotation:T|null}> {
 const out:Array<{text:string;annotation:T|null}>=[];let at=0;
 for(const a of [...annotations].sort((x,y)=>x.start-y.start)) {
  if(a.start<at||a.end>text.length||a.end<=a.start)continue;
  if(a.start>at)out.push({text:text.slice(at,a.start),annotation:null});
  out.push({text:text.slice(a.start,a.end),annotation:a});at=a.end;
 }
 if(at<text.length)out.push({text:text.slice(at),annotation:null});
 return out;
}
