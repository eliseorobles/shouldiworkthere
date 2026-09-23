import type {LayerId,TopicId,ViewId} from '../worker/src/types.ts';
// Canonical FAQ questions are typed specs built only from public enums, public cohort labels and
// documented event ids. Wording comes from fixed templates, never from a model or from user text.
export const FAQ_TOPICS=['promotion','management','compensation','workload','layoffs','location_policy','culture','other'] as const satisfies readonly TopicId[];
export const FAQ_VIEWS=['overview','timeline','distribution','clusters','reader'] as const satisfies readonly ViewId[];
export const FAQ_LAYERS=['experience','claim','opinion'] as const satisfies readonly LayerId[];
export type FaqTopic=typeof FAQ_TOPICS[number];
export type FaqView=typeof FAQ_VIEWS[number];
export interface QuestionSpec {topic:FaqTopic;view:FaqView;cohort?:string;event?:string;layer?:LayerId;}
export interface SpecScope {cohorts?:readonly string[];events?:readonly string[];}
export interface SpecSource {view:{value:string};topic:{value:string};cohorts:{fn:string|null;seniority:string|null};event:{value:string}|null;layer:string|null;timeframe:string;compareTo?:unknown;clarify?:boolean;route?:string;}
const has=<T extends string>(list:readonly T[],value:unknown):value is T=>list.includes(value as T);
const DISTRIBUTION_TOPICS:readonly FaqTopic[]=['compensation','workload'];
export function validSpec(s:QuestionSpec):boolean {
 return has(FAQ_TOPICS,s.topic)&&has(FAQ_VIEWS,s.view)&&(s.view!=='distribution'||DISTRIBUTION_TOPICS.includes(s.topic))
  &&(s.cohort===undefined||(typeof s.cohort==='string'&&s.cohort.length>0&&s.cohort.length<=100))
  &&(s.event===undefined||(typeof s.event==='string'&&s.event.length>0&&s.event.length<=100&&s.view==='timeline'))
  &&(s.layer===undefined||(has(FAQ_LAYERS,s.layer)&&(s.view==='reader'||s.view==='clusters')));
}
export function specId(s:QuestionSpec):string {
 return ['q1',s.topic,s.view,...(s.cohort?[`c=${encodeURIComponent(s.cohort)}`]:[]),...(s.event?[`e=${encodeURIComponent(s.event)}`]:[]),...(s.layer?[`l=${s.layer}`]:[])].join(':');
}
export function parseSpecId(id:string):QuestionSpec|null {
 if(typeof id!=='string'||id.length>400)return null;
 const [version,topic,view,...rest]=id.split(':');
 if(version!=='q1'||!has(FAQ_TOPICS,topic)||!has(FAQ_VIEWS,view))return null;
 const spec:QuestionSpec={topic,view};
 try {for(const part of rest){const [k,v]=[part.slice(0,2),decodeURIComponent(part.slice(2))];if(k==='c=')spec.cohort=v;else if(k==='e=')spec.event=v;else if(k==='l=')spec.layer=v as LayerId;else return null;}}catch{return null;}
 return validSpec(spec)&&specId(spec)===id?spec:null;
}
const OVERVIEW:Record<FaqTopic,string>={promotion:'Are promotions fair and the criteria clear?',management:'Do managers keep their commitments?',compensation:'Do people say pay is at or above market?',workload:'How heavy is the workload?',layoffs:'Were layoffs handled respectfully?',location_policy:'How do remote and office policies affect people?',culture:'Would people choose to work here again?',other:'What does the overall record show?'};
const TIMELINE:Record<FaqTopic,string>={promotion:'How has promotion clarity changed over time?',management:'How has trust in managers changed over time?',compensation:'How have views on pay changed over time?',workload:'How has the workload changed over time?',layoffs:'How have layoff-related measures changed over time?',location_policy:'How has remote and office policy changed over time?',culture:'Would people still choose to work here, and has that changed?',other:'How has the record changed over time?'};
const AFTER:Record<FaqTopic,string>={promotion:'How did promotion clarity change',management:'How did trust in managers change',compensation:'How did views on pay change',workload:'How did the workload change',layoffs:'What changed',location_policy:'How did remote and office policy change',culture:'How did culture and leadership change',other:'How did the record change'};
const NOUN:Record<FaqTopic,string>={promotion:'promotions',management:'management',compensation:'pay',workload:'workload',layoffs:'layoffs and restructuring',location_policy:'remote and office policy',culture:'culture and leadership',other:'this workplace'};
const LAYER_NOUN:Record<LayerId,string>={experience:'firsthand experiences',claim:'specific claims',opinion:'opinions'};
/** Deterministic wording. `labels.event` is the documented event's public label. */
export function specWording(s:QuestionSpec,labels:{event?:string|null}={}):string {
 const base=s.view==='overview'?OVERVIEW[s.topic]
  :s.view==='timeline'?(s.event?`${AFTER[s.topic]} after the ${labels.event??'selected event'}?`:TIMELINE[s.topic])
  :s.view==='distribution'?(s.topic==='compensation'?'How does compensation compare with the market?':'What does a typical working week look like?')
  :s.view==='clusters'?`What ${s.layer?LAYER_NOUN[s.layer]:'experiences'}${s.topic==='other'?'':` about ${NOUN[s.topic]}`} keep coming up?`
  :s.topic==='location_policy'&&!s.layer?'How are remote workers treated?'
  :`Show me ${s.layer?LAYER_NOUN[s.layer]:s.topic==='other'?'the original workplace accounts':'original accounts'}${s.topic==='other'?'':` about ${NOUN[s.topic]}`}.`;
 return s.cohort?`${s.cohort}: ${base}`:base;
}
/** The original nine questions, expressed as specs. They appear only where their evidence exists. */
export const starterSpecs:readonly QuestionSpec[]=[
 {topic:'promotion',view:'overview'},{topic:'management',view:'overview'},{topic:'compensation',view:'distribution'},{topic:'workload',view:'distribution'},
 {topic:'layoffs',view:'timeline'},{topic:'culture',view:'timeline'},{topic:'other',view:'clusters'},{topic:'other',view:'reader'},{topic:'location_policy',view:'reader'},
];
export const faqCatalog=starterSpecs.map(spec=>({id:specId(spec),question:specWording(spec),topic:spec.topic,view:spec.view,spec}));
/** Interest recorded before typed specs existed used these ids. */
export const LEGACY_FAQ_IDS:Readonly<Record<string,string>>=Object.fromEntries(['promotion','management','pay','workload','layoffs','culture','reports','testimony','remote'].map((id,index)=>[id,specId(starterSpecs[index]!)]));
export function specFromStoredId(id:string):QuestionSpec|null {return parseSpecId(LEGACY_FAQ_IDS[id]??id);}
/**
 * Maps a typed interpretation to a canonical spec. Cohort labels and event ids are kept only when the
 * caller's scope approves them (the company's public cohort labels and documented event ids); anything
 * else returns null rather than a broadened or free-text spec.
 */
/** Routes whose view is a single-employer evidence view a spec can describe ('company' is the pre-route-choice value). */
const SPEC_ROUTES=new Set(['metric_view','timeline','distribution','clusters','evidence','existing_faq','company']);
export function specFromInterpretation(i:SpecSource,scope:SpecScope={}):QuestionSpec|null {
 if(i.compareTo||i.clarify||(i.route!==undefined&&!SPEC_ROUTES.has(i.route))||i.timeframe==='last_year')return null;
 const topic=i.topic.value,view=i.view.value;
 if(!has(FAQ_TOPICS,topic)||!has(FAQ_VIEWS,view))return null;
 const cohorts=[i.cohorts.fn,i.cohorts.seniority].filter((c):c is string=>!!c);
 if(cohorts.length>1||(cohorts[0]!==undefined&&!scope.cohorts?.includes(cohorts[0])))return null;
 const event=i.event?.value;
 if(event!==undefined&&!scope.events?.includes(event))return null;
 if((i.timeframe==='before_event'||i.timeframe==='after_event')&&event===undefined)return null;
 if(i.layer!==null&&!has(FAQ_LAYERS,i.layer))return null;
 const spec:QuestionSpec={topic,view,...(cohorts[0]?{cohort:cohorts[0]}:{}),...(event?{event}:{}),...(i.layer?{layer:i.layer}:{})};
 return validSpec(spec)?spec:null;
}
/** Candidate follow-up questions; the evidence compiler keeps only those with evidence. */
export function relatedSpecs(s:QuestionSpec):QuestionSpec[] {
 const views:Record<FaqView,FaqView[]>={overview:['timeline','reader','clusters'],timeline:['overview','reader'],distribution:['overview','timeline'],clusters:['reader'],reader:['clusters','overview']};
 const base={...(s.cohort?{cohort:s.cohort}:{})};
 const out:QuestionSpec[]=[...views[s.view].map(view=>({topic:s.topic,view,...base,...(s.layer&&(view==='reader'||view==='clusters')?{layer:s.layer}:{})})),...(s.cohort?[{topic:s.topic,view:s.view,...(s.event?{event:s.event}:{}),...(s.layer?{layer:s.layer}:{})}]:[]),...(s.event?[{topic:s.topic,view:s.view,...base}]:[])];
 const seen=new Set([specId(s)]);
 return out.filter(x=>validSpec(x)&&!seen.has(specId(x))&&seen.add(specId(x)));
}
export function specOverrides(s:QuestionSpec) {
 return {topic:s.topic==='other'?null:s.topic,view:s.view,cohort:s.cohort??null,event:s.event??null,layer:s.layer??null,timeframe:'any' as const};
}
