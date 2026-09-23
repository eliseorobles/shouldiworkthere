import {evaluate,type AIEnv,type AIResponse,type Question} from './ai.ts';
import type {Distribution,Interpretation,RouteId,TopicId,ViewId,Fork} from './types.ts';
import {specFromInterpretation,specId} from '../../shared/faq.ts';
import {DISCOVERY_CONCEPTS} from './evidence.ts';
import {APPLY_CONFIDENCE,ASK_BELOW,SECONDARY_CONFIDENCE,FORK_MIN_SHARE,SENTINEL_MARGIN,UNSUPPORTED_AT,EVENT_REQUESTED_AT,SALARY_REQUIRED_AT,FOCUS_AT,AMBIGUOUS_AT,SALARY_NOTE,NEEDS_GENERATION_NOTE,VIEW_OPTIONS,TOPIC_OPTIONS,ROUTE_OPTIONS,VIEW_ROUTE,VIEW_NAMES,TOPIC_NAMES,TOPIC_LEXICON,UNLISTED_OPTION_LABEL,MEANING_OPTIONS,MEANING_NAMES,MEANING_QUESTION,holdMeaningForAsk,asksAroundRestructuring,restructuringWords,eventMatchesWords,eventYearConflicts,eventNamed,restructuringName,groupsNamed,bareEmployer,baseInterpretation,companyCandidates,companiesInQuery,candidatesComplete,companyForms,nameMatches,unlistedName,unlistedNotice,unlistedCompareNote,unlistedFirstNote,isSentinel,type CompanyAlias} from './interpretation.ts';
export {baseInterpretation,VIEW_OPTIONS,TOPIC_OPTIONS,ROUTE_OPTIONS,INTENT_PROMPT_VERSION,APPLY_CONFIDENCE,ASK_BELOW,SECONDARY_CONFIDENCE,FORK_MIN_SHARE,SENTINEL_MARGIN,COMPANY_OPTION_LIMIT,UNSUPPORTED_AT,AMBIGUOUS_AT} from './interpretation.ts';
export const INTENT_TIMEOUT_MS=7000,PREFERENCE_LIMIT=12;
/** Questions whose missing or malformed answer only drops the meaning fork; every other intent answer still fails closed. */
export const OPTIONAL_INTENT_QUESTIONS:readonly string[]=['ambiguous_meaning','meaning'];
/** Search preferences are the discovery concepts, so every preference Jev can return is one discovery can apply or report. */
export const DEFAULT_PREFERENCES:{key:string;label:string}[]=Object.entries(DISCOVERY_CONCEPTS).map(([key,d])=>({key,label:d.label.charAt(0).toLowerCase()+d.label.slice(1)}));
/** Documented events of the employers the query points at; `company` (slug) and `kind` let a lone event of a named kind be selected deterministically. */
export interface InterpretationEvent {id:string;label:string;kind?:string|null;company?:string|null}
/** directory[].domain: set only when another listed employer has the same name, so the options read "Name (domain)". */
export interface InterpretationInput {query:string;directory:{id?:string;slug:string;name:string;sector?:string|null;aliases?:CompanyAlias[]|null;domain?:string|null}[];events:InterpretationEvent[];cohortOptions:{fn:string[];other:string[]};currentSlug:string|null;preferenceMetrics?:{key:string;label:string}[];}
const choice=(instructions:string,criteria:Record<string,string>):Question=>({type:'choice',instructions,criteria});
const noul=(instructions:string):Question=>({type:'noul',instructions});
const labels=(values:string[])=>Object.fromEntries(values.filter(v=>!isSentinel(v)).map(v=>[v,v]));
export function buildQuestions(input:InterpretationInput):Record<string,Question> {
 const company=Object.fromEntries(companyCandidates(input.query,input.directory,input.currentSlug).filter(c=>!isSentinel(c.slug)).map(c=>[c.slug,c.domain?`${c.name} (${c.domain})`:c.name]));
 const sectors=labels([...new Set(input.directory.map(c=>c.sector??''))].slice(0,250));
 const preferences=(input.preferenceMetrics?.length?input.preferenceMetrics:DEFAULT_PREFERENCES).slice(0,PREFERENCE_LIMIT);
 return {
  company:choice('Which employer is named first or is the main subject of the query? Choose unlisted when the query names an employer that is not one of these options. Choose unspecified when no employer is named; currentPage is context only.',{unspecified:'No employer is named in the query',unlisted:'An employer is named, but it is not one of these options',...company}),
  compare_to:choice('Which DIFFERENT second employer is explicitly compared with the first? Never repeat the first employer. Choose unlisted when the second named employer is not one of these options.',{none:'No second employer',unlisted:'A second employer is named, but it is not one of these options',...company}),
  view:choice('Select the best visual presentation. Recurring reports use clusters. An explicit time comparison uses timeline. One named group compared with the rest of the company uses cohort. A question about fairness alone uses overview.',VIEW_OPTIONS),
  topic:choice('What is the primary workplace subject?',TOPIC_OPTIONS),
  cohort_function:choice('Which function or team does the query name? A plural or informal form names the listed function (engineers or engineering names Engineering). Choose any when the query names no function or team; choose unsupported only when it names one that is not listed. Do not infer a role from a topic.',{any:'Not requested',unsupported:'Requested function is not available',...labels(input.cohortOptions.fn)}),
  cohort_seniority:choice('Which seniority, location or employment group does the query name? Choose any when it names none; choose unsupported only when it names one that is not listed.',{any:'Not requested',unsupported:'Requested group or location is not available',...labels(input.cohortOptions.other)}),
  industry:choice('Which industry does the query explicitly restrict employers to? Match fintech to Payments where available. Choose unsupported rather than dropping a requested industry.',{any:'No industry restriction',unsupported:'Requested industry is absent',...sectors}),
  salary_data_required:noul('Does answering require actual salary amounts or compensation percentiles, rather than respondents saying pay is at or above market?'),
  ...Object.fromEntries(preferences.map(({key,label})=>[`preference_${key}`,choice(`When selecting employers, which direction is explicitly requested for ${label}? Ignore sentiments about a named company; this is a search preference.`,{any:'No direction requested',high:'Higher values requested',low:'Lower values requested'})])),
  ...(input.events.length?{event:choice('Which listed event is explicitly referenced, or is the sole relevant event referred to as the reorg/layoff? Use none if unsupported or ambiguous.',{none:'No unambiguous known event',...Object.fromEntries(input.events.filter(e=>!isSentinel(e.id)).map(e=>[e.id,e.label]))})}:{}),
  timeframe:choice('Which time restriction is explicitly requested?',{any:'No time restriction',last_year:'The previous calendar year',before_event:'Before a known event only',after_event:'Since or after a known event only',comparison:'Both before AND after, or what changed following an event',unsupported:'A specific period other than these, such as a named year, month or date range'}),
  layer:choice('Did the user explicitly request experiences, factual allegations, or opinions? Do not infer a layer merely from asking about fairness.',{any:'No explicit layer',experience:'Firsthand experiences explicitly requested',claim:'Specific factual claims explicitly requested',opinion:'Opinions explicitly requested'}),
  route:choice('Which route answers this question? This product never writes answers: it shows published measures and original accounts. Questions about how things are at an employer, even yes/no or judgment questions (are promotions fair, is the workload heavy, how toxic or political is it), are answered by those measures and accounts: choose the matching evidence route. Choose needs_generation only for advice about the asker\'s own decision, a prediction, a recommendation, or a request to write a summary. Choose cannot_safely_answer only when it asks to identify, locate or target a person, or is unrelated to workplaces; office politics, culture and a bare employer name are workplace questions.',ROUTE_OPTIONS),
  unsupported:noul('Is the request unrelated to workplaces (for example national politics, weather or coding help), or does it ask to identify, name, locate or target an individual person (for example who a manager is or where someone lives)? Office politics, culture, fairness and a bare employer name are workplace requests.'),
  ambiguous_meaning:noul('Does the question hinge on a word with two or more distinct workplace meanings, such as \'political\' (promotion politics, manager favoritism, or leadership and team culture)? A question with one clear subject, such as pay, workload, toxicity or promotion fairness, is not ambiguous.'),
  meaning:choice('Read the question\'s central descriptive word as a workplace subject. Spread probability across every subject it could reasonably mean; for example \'political\' could mean promotion politics, manager favoritism or leadership and team culture.',MEANING_OPTIONS),
  event_requested:noul('Does the query ask about a specific event, such as since the reorg, after layoffs, or before a leadership change?'),
  wants_testimony:noul('Does the user ask for underlying written accounts or concrete examples?'),
  ...Object.fromEntries(Object.entries(TOPIC_OPTIONS).filter(([k])=>k!=='other').map(([k,label])=>[`focus_${k}`,noul(`Is ${label} materially relevant to the query?`)])),
 };
}
function dist<T extends string>(response:AIResponse,id:string,fallback:T):Distribution<T> {
 const a=response.answers[id]; return a?.type==='choice'?{value:a.choice as T,confidence:a.confidence,probabilities:a.probabilities}:{value:fallback,confidence:0,probabilities:{}};
}
function yes(response:AIResponse,id:string) {const a=response.answers[id]; return a?.type==='noul'?a.noul:0;}
const ranked=(d:Distribution,skip:(id:string)=>boolean)=>Object.entries(d.probabilities).filter(([id])=>!skip(id)).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
export type Tier='apply'|'fork'|'ask';
/** apply: confident; fork: tentative reading plus alternatives; ask: nothing applied. A sentinel close to the top value always asks. */
export function tierOf(d:Distribution,sentinels:string[]=[]):Tier {
 if(sentinels.length&&!sentinels.includes(d.value)&&(d.probabilities[d.value]??0)-Math.max(0,...sentinels.map(s=>d.probabilities[s]??0))<SENTINEL_MARGIN)return 'ask';
 return d.confidence>=APPLY_CONFIDENCE?'apply':d.confidence>=ASK_BELOW?'fork':'ask';
}
type Option=Fork['options'][number];
/**
 * A fork offers only readings Jev gave a real share (FORK_MIN_SHARE), never zero-share options filled in by name order
 * (live: "Or did you mean 3M | Abbott" at 0% after the directory grew). `extra` options (such as "an employer we don't
 * list") follow the same rule. An ask keeps its way out (`exit`, such as "No specific employer") whatever that option's
 * share, because the reader must be able to decline; a tentative fork shows it only at FORK_MIN_SHARE. A tentative fork
 * with no alternative left, or an ask with nothing but the way out, is no fork: null.
 */
function makeFork(field:string,question:string,d:Distribution,names:Record<string,string>,tier:'fork'|'ask',skip:(id:string)=>boolean,o:{extra?:Option[];exit?:Option;allow?:(id:string)=>boolean}={}):Fork|null {
 const offered=[...ranked(d,skip).filter(([id,share])=>share>=FORK_MIN_SHARE&&(o.allow?.(id)??true)).slice(0,3).map(([id,share])=>({id,label:names[id]??id,share})),...(o.extra??[]).filter(x=>x.share>=FORK_MIN_SHARE)];
 const exit=o.exit&&(tier==='ask'||o.exit.share>=FORK_MIN_SHARE)?[o.exit]:[];
 if(tier==='fork'?offered.length+exit.length<2:!offered.length)return null;
 return {field,question,tier,options:[...offered,...exit]};
}
const FORK_ORDER=['company','event','cohort','timeframe','industry','topic','view'];
/** The meaning fork is the primary clarification (D8d), so it leads; the rest follow FORK_ORDER. */
const forkRank=(f:Fork)=>f.kind==='meaning'?-1:FORK_ORDER.indexOf(f.field);
function knownForms(input:InterpretationInput) {
 return [...input.directory.flatMap(c=>companyForms(c).map(f=>f.form)),...input.cohortOptions.fn,...input.cohortOptions.other,...input.events.map(e=>e.label),...Object.values(TOPIC_LEXICON).flat()];
}
/** Throws when the provider fails or answers are malformed; callers must not treat a failure as an interpretation. */
export async function interpret(env:AIEnv,input:InterpretationInput,options:{timeoutMs?:number}={}):Promise<Interpretation> {
 if(!input.query.trim())return baseInterpretation();
 const start=Date.now(),current=input.directory.find(c=>c.slug===input.currentSlug)??null;
 const response=await evaluate(env,{query:input.query,currentPage:current?.name??null},buildQuestions(input),{timeoutMs:options.timeoutMs??INTENT_TIMEOUT_MS,optional:OPTIONAL_INTENT_QUESTIONS});
 return fromAnswers(response,input,Date.now()-start);
}
export function fromAnswers(response:AIResponse,input:InterpretationInput,latencyMs=0):Interpretation {
 const i:Interpretation={...baseInterpretation(),source:'jev',provider:response.provider,model:response.model,providerFallback:response.fallbackReason??null,keySource:response.keySource??null,latencyMs,...(response.usage?{usage:response.usage}:{})};
 const forks:Fork[]=[],notes:string[]=[],suggestions:Interpretation['suggestions']=[];
 const names=Object.fromEntries(input.directory.map(c=>[c.slug,c.name])),eventNames=Object.fromEntries(input.events.map(e=>[e.id,e.label]));
 // A secondary reading applies at SECONDARY_CONFIDENCE; between ASK_BELOW and that it is offered as a suggestion; below
 // ASK_BELOW it is not offered at all (RT-A4: a 0.09 reading is not "one tap away", it is noise).
 const secondary=(field:string,d:Distribution,label:string,key?:string)=>{
  if(isSentinel(d.value))return false;
  if(d.confidence>=SECONDARY_CONFIDENCE)return true;
  if(d.confidence>=ASK_BELOW)suggestions.push({field,...(key?{key}:{}),value:d.value,label,confidence:d.confidence});
  return false;
 };
 const company=dist<string>(response,'company','unspecified');
 const complete=candidatesComplete(input.directory),unlistedShare=company.probabilities.unlisted??0;
 const listedByName=nameMatches(input.query,input.directory),compared=dist<string>(response,'compare_to','none');
 // "An employer we don't list" is offered, or weighed against a listed reading, only when the question plausibly names
 // one: it names no listed employer, or it has a name-like phrase that is not a listed employer. A question naming only
 // listed employers never gets that option from a stray share (live: .21 for "…at Northwind Labs?" on its own page).
 const unlistedPlausible=!listedByName.length||!!unlistedName(input.query,knownForms(input));
 const unlistedWeight=unlistedPlausible?unlistedShare:0,companySentinels=['unspecified',...(unlistedPlausible?['unlisted']:[])];
 // A listed employer is offered only when the question plausibly names it: by name, alias or a near-typo of one
 // (companiesInQuery), as the page it is asked on, or as Jev's own likeliest listed reading (a brand or former name).
 const pointed=new Set(companiesInQuery(input.query,input.directory,input.currentSlug).map(c=>c.slug)),topListed=ranked(company,isSentinel)[0]?.[0];
 const plausibleListed=(slug:string)=>pointed.has(slug)||slug===topListed;
 const noEmployer={id:'none',label:'No specific employer',share:company.probabilities.unspecified??0};
 const companyOptions={extra:unlistedPlausible?[{id:'unlisted',label:UNLISTED_OPTION_LABEL,share:unlistedShare}]:[],exit:noEmployer,allow:plausibleListed};
 const pushFork=(f:Fork|null)=>{if(f)forks.push(f);};
 // "Acme Widgets vs Stripe": the listed name the query uses is the employer compare_to resolved to, so the first employer
 // is the one the directory does not list. It gets the unlisted state (never discovery), named as typed (D12, RT-A2).
 const comparedListed=company.value==='unlisted'&&company.confidence>=ASK_BELOW?listedByName.find(c=>c.slug===compared.value):undefined;
 if(comparedListed) {
  const name=unlistedName(input.query,knownForms(input));
  i.route='unlisted';i.unlistedEmployer={name};notes.push(unlistedNotice(name,complete),unlistedFirstNote(name,comparedListed.name,complete));
  forks.push({field:'company',question:'Open a listed employer’s record instead?',tier:'ask',options:[{id:comparedListed.slug,label:comparedListed.name,share:compared.probabilities[comparedListed.slug]??0}]});
 } else if(company.value==='unlisted'&&listedByName.length) {
  // A listed name is in the query but Jev reads the main employer as unlisted: ask. When the query also names another
  // employer (the name as typed), that unlisted reading is offered too, so it is never dropped.
  const name=unlistedName(input.query,knownForms(input));
  forks.push({field:'company',question:'Which employer do you mean?',tier:'ask',options:[...listedByName.slice(0,3).map(c=>({id:c.slug,label:c.name,share:company.probabilities[c.slug]??0})),...(name?[{id:'unlisted',label:`${name} (not in the directory)`,share:unlistedShare}]:[]),noEmployer]});
 } else if(company.value==='unlisted') {
  if(company.confidence>=ASK_BELOW) {
   const name=unlistedName(input.query,knownForms(input));
   i.route='unlisted';i.unlistedEmployer={name};notes.push(unlistedNotice(name,complete));
   const alternatives=ranked(company,isSentinel).filter(([id,share])=>share>=FORK_MIN_SHARE&&plausibleListed(id)).slice(0,3);
   if(alternatives.length)forks.push({field:'company',question:'Did you mean one of these listed employers?',tier:'ask',options:alternatives.map(([id,share])=>({id,label:names[id]??id,share}))});
  } else pushFork(makeFork('company','Which employer do you mean?',company,names,'ask',isSentinel,companyOptions));
 } else if(company.value==='unspecified') {
  // A listed rival or "an employer we do not list" close to "no employer" asks: the current page (or discovery) is never the silent answer.
  const close=(share:number)=>share>=Math.max(FORK_MIN_SHARE,(company.probabilities.unspecified??0)-SENTINEL_MARGIN);
  const rival=ranked(company,isSentinel).find(([id])=>id!==input.currentSlug);
  if(company.confidence<APPLY_CONFIDENCE&&((rival&&close(rival[1]))||close(unlistedWeight)))pushFork(makeFork('company','Did you mean a specific employer?',company,names,'ask',isSentinel,companyOptions));
 } else {
  // Only "no employer" competing with the page the reader is on is harmless; a real (plausible) unlisted share never
  // resolves to the current page. A tentative reading keeps a fork only while an alternative reaches FORK_MIN_SHARE
  // (live, on Northwind Labs' page: Northwind Labs .77 for a question naming it drew "Or did you mean 3M | Abbott |
  // An employer we don't list 21%", none of which the question named).
  const onlyCurrentPage=company.value===input.currentSlug&&unlistedWeight<FORK_MIN_SHARE&&!ranked(company,isSentinel).some(([id,share])=>id!==input.currentSlug&&share>=FORK_MIN_SHARE);
  const tier=onlyCurrentPage?'apply':tierOf(company,companySentinels);
  if(tier!=='ask')i.company=company;
  if(tier!=='apply')pushFork(makeFork('company',tier==='ask'?'Which employer do you mean?':'Which employer?',company,names,tier,isSentinel,companyOptions));
 }
 const drop=(field:string)=>{for(let k=forks.length-1;k>=0;k--)if(forks[k]!.field===field)forks.splice(k,1);};
 // A query that is essentially one listed employer's name, which Jev also resolved to that employer, navigates to its
 // record (metric view) and is never refused or held for a view question.
 const bare=bareEmployer(input.query,input.directory),navigate=!!bare&&company.value===bare.slug;
 if(navigate){i.company=company;drop('company');}
 // A question that hinges on an ambiguous word ("how political is engineering?") is never resolved silently, however
 // confident the topic reading: its meanings are offered with Jev's own probabilities from the `meaning` Choice. Every
 // meaning Jev gave any share is offered (the alternatives measured 2% to 12% live, so FORK_MIN_SHARE would hide the
 // fork D8d requires); a meaning with no share at all is never listed.
 const meaning=dist<string>(response,'meaning','none'),meanings=ranked(meaning,id=>!Object.hasOwn(MEANING_OPTIONS,id)).filter(([,share])=>share>0).slice(0,3);
 const meaningFork=!navigate&&yes(response,'ambiguous_meaning')>=AMBIGUOUS_AT&&meanings.length>=2;
 const view=dist<ViewId>(response,'view','overview'),viewTier=tierOf(view);
 // Without an employer (none read, none asked about, no page) only discovery can be shown, so the view is not a question
 // (live, home page: "Workplace record" was offered for "how political is engineering?" with no employer).
 const employerInPlay=!!i.company||!!input.currentSlug||forks.some(f=>f.field==='company');
 if(navigate)i.view={value:'overview',confidence:view.probabilities.overview??0,probabilities:view.probabilities};
 else {
  if(viewTier!=='ask')i.view=view;
  // The meaning fork takes precedence (D8d): an unsure view is not asked beside it, so the meanings are the clarification
  // the reader sees; the employer's record (or discovery without one) is shown until the reader picks another view.
  if(viewTier!=='apply'&&employerInPlay&&!(meaningFork&&viewTier==='ask'))pushFork(makeFork('view',viewTier==='ask'?'What would you like to see?':'Which view best answers this?',view,VIEW_NAMES,viewTier,()=>false));
 }
 const topic=dist<TopicId>(response,'topic','other'),topicTier:Tier=topic.value==='other'?'apply':tierOf(topic,['other']);
 if(navigate){if(topicTier==='apply')i.topic=topic;}
 else {
  if(topicTier!=='ask')i.topic=topic;
  if(topicTier!=='apply')pushFork(makeFork('topic',MEANING_QUESTION,topic,TOPIC_NAMES,topicTier,id=>id==='other',{exit:{id:'other',label:TOPIC_NAMES.other,share:topic.probabilities.other??0}}));
 }
 if(meaningFork) {
  drop('topic');
  const [top,share]=meanings[0]!,tier=share>=ASK_BELOW?'fork':'ask';
  i.topic=tier==='fork'?{value:top as TopicId,confidence:share,probabilities:meaning.probabilities}:baseInterpretation().topic;
  forks.push({field:'topic',kind:'meaning',question:MEANING_QUESTION,tier,options:meanings.map(([id,s])=>({id,label:MEANING_NAMES[id as keyof typeof MEANING_NAMES],share:s}))});
 }
 const primary=i.company?.value??input.currentSlug,other=compared;
 const namedOther=listedByName.find(c=>c.slug!==primary);
 // The unlisted first employer's comparison partner is offered as its own record above, never applied as a comparison.
 if(comparedListed)i.compareTo=null;
 else if(other.value==='unlisted'&&namedOther)suggestions.push({field:'compareTo',value:namedOther.slug,label:`Compare with ${namedOther.name}`,confidence:other.probabilities[namedOther.slug]??0});
 else if(other.value==='unlisted'&&other.confidence>=SECONDARY_CONFIDENCE) {
  const name=unlistedName(input.query,knownForms(input));i.unlistedEmployer??={name};
  notes.push(unlistedCompareNote(name,complete));
 } else if(other.value!==primary&&secondary('compareTo',other,`Compare with ${names[other.value]??other.value}`))i.compareTo=other;
 let unsupportedCohort=false;const cohortDists:Distribution[]=[],namedNotApplied:Array<{label:string;share:number}>=[];
 for(const [id,slot,labels] of [['cohort_function','fn',input.cohortOptions.fn],['cohort_seniority','seniority',input.cohortOptions.other]] as const) {
  const d=dist<string>(response,id,'any');cohortDists.push(d);
  if(d.value==='unsupported'&&d.confidence>=SECONDARY_CONFIDENCE)unsupportedCohort=true;
  // A published group the question names by its label, which Jev also reads as the group asked about, applies from
  // ASK_BELOW rather than SECONDARY_CONFIDENCE. Live, "how political is engineering?" drew Engineering at .69 to .76, so
  // at .7 the group came and went between identical searches (and between Live and Enter). Jev must still choose it.
  else if(!isSentinel(d.value)&&d.confidence>=ASK_BELOW&&groupsNamed(input.query,labels).includes(d.value))i.cohorts[slot]=d.value;
  else if(secondary('cohort',d,d.value))i.cohorts[slot]=d.value;
  for(const label of groupsNamed(input.query,labels))if(i.cohorts[slot]!==label)namedNotApplied.push({label,share:d.probabilities[label]??0});
 }
 // A group the question names by its label but that is not applied is never dropped silently: it is offered one tap away
 // whatever Jev's share, because the reader's own words name it (a low model share alone is noise, RT-A4; this is not).
 if(!unsupportedCohort)for(const {label,share} of namedNotApplied)if(!suggestions.some(s=>s.field==='cohort'&&s.value===label))suggestions.push({field:'cohort',value:label,label,confidence:share});
 if(unsupportedCohort) {
  i.cohorts={fn:null,seniority:null};
  notes.push('The group you asked about has no privacy-approved release here, so no group filter is applied. Pick a published group or keep the whole-company record.');
  // Only groups Jev read at FORK_MIN_SHARE or more are offered, never zero-share groups in name order; the group chip
  // still lists every published group.
  const options=cohortDists.flatMap(d=>ranked(d,isSentinel)).filter(([,share])=>share>=FORK_MIN_SHARE).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([id,share])=>({id,label:id,share}));
  if(options.length)forks.push({field:'cohort',question:'Which published group should we show?',tier:'ask',options});
 }
 const layer=dist<string>(response,'layer','any');if(secondary('layer',layer,layer.value))i.layer=layer.value;
 const eventRequested=yes(response,'event_requested')>EVENT_REQUESTED_AT;
 if(input.events.length) {
  const event=dist<string>(response,'event','none');
  if(!isSentinel(event.value)) {
   if(event.confidence>=SECONDARY_CONFIDENCE)i.event=event;
   else if(eventRequested)pushFork(makeFork('event','Which documented event?',event,eventNames,'ask',isSentinel));
   else if(event.confidence>=ASK_BELOW)suggestions.push({field:'event',value:event.value,label:eventNames[event.value]??event.value,confidence:event.confidence});
  }
 }
 // "Since the restructuring at X": when the employer the question is about has exactly one documented event of the kind
 // the question names (layoffs name layoffs, a reorg names reorganizations and restructurings, a restructuring names
 // both), that event is selected deterministically. It stays an editable chip and carries Jev's own probability for it
 // (never a made-up one). The page the reader is on is the subject only when the question names no other listed
 // employer: a question about another employer never borrows this page's event.
 // The rule, never Jev's confidence, decides both the selection and its label (live, the same event drew .94 to .96 for
 // "after the 2025 restructuring" and .36 to .45 for "since the restructuring"). Two things stop it: Jev's confident
 // reading of a different event stays Jev's, and a question that dates the restructuring to another year than the event's
 // label ("after the 2023 restructuring") is not about it. The label: only an event chosen from its kind alone ("since the
 // restructuring") is labeled inferred, with the notice saying why; a question that names the event itself ("after the
 // 2025 restructuring", eventNamed) chose it, so it is simply applied, like any chip (production journey, 2026-09-23).
 const pageIsSubject=!forks.some(f=>f.field==='company')&&listedByName.every(c=>c.slug===input.currentSlug);
 const subject=i.company?.value??(pageIsSubject?input.currentSlug:null),words=restructuringWords(input.query);
 if(subject&&asksAroundRestructuring(input.query)) {
  const lone=input.events.filter(e=>e.company===subject&&eventMatchesWords(e,words));
  if(lone.length===1&&(!i.event||i.event.value===lone[0]!.id)&&!eventYearConflicts(input.query,lone[0]!.label)) {
   const e=lone[0]!,d=dist<string>(response,'event','none');
   i.event={value:e.id,confidence:d.probabilities[e.id]??0,probabilities:d.probabilities};
   drop('event');for(let k=suggestions.length-1;k>=0;k--)if(suggestions[k]!.field==='event')suggestions.splice(k,1);
   if(!eventNamed(input.query,e)) {
    i.inferred=[{field:'event',value:e.id,label:e.label,reason:'single_documented_event'}];
    notes.push(`Applied ${/^the\b/i.test(e.label)?e.label:`the ${e.label}`}, the only documented ${restructuringName(words)} for this employer. Change or remove it in the event chip.`);
   }
  }
 }
 const askEvent=()=>{if(input.events.length&&!forks.some(f=>f.field==='event'))forks.push({field:'event',question:'Which documented event?',tier:'ask',options:input.events.slice(0,6).map(e=>({id:e.id,label:e.label,share:0}))});};
 if(eventRequested&&!i.event){notes.push('Select a documented event. We will not invent a restructuring date.');askEvent();}
 const time=dist<string>(response,'timeframe','any');
 if(time.value==='unsupported'&&time.confidence>=SECONDARY_CONFIDENCE) {
  notes.push('That period is not available as a filter, so no period filter is applied. Available: all periods, the previous calendar year, or before/after a documented event.');
  forks.push({field:'timeframe',question:'Which period should we use?',tier:'ask',options:[{id:'any',label:'All periods',share:time.probabilities.any??0},{id:'last_year',label:'Previous calendar year',share:time.probabilities.last_year??0},...(input.events.length?[{id:'before_event',label:'Before an event',share:time.probabilities.before_event??0},{id:'after_event',label:'After an event',share:time.probabilities.after_event??0}]:[])]});
 } else if((time.value==='before_event'||time.value==='after_event'||time.value==='last_year')&&secondary('timeframe',time,time.value.replaceAll('_',' '))) {
  if(time.value==='last_year'||i.event)i.timeframe=time.value;
  else {notes.push('Choose a documented event to apply a before/after filter. No period filter is applied yet.');askEvent();}
 }
 const industry=dist<string>(response,'industry','any');
 if(industry.value==='unsupported'&&industry.confidence>=SECONDARY_CONFIDENCE) {
  notes.push('That industry is not in the directory, so no industry filter is applied.');
  const options=ranked(industry,isSentinel).filter(([,share])=>share>=FORK_MIN_SHARE).slice(0,3).map(([id,share])=>({id,label:id,share}));
  if(options.length)forks.push({field:'industry',question:'Which listed industry did you mean?',tier:'ask',options});
 } else if(secondary('industry',industry,industry.value))i.industry=industry.value;
 const preferences:Record<string,'high'|'low'|'any'>={};
 for(const {key,label} of (input.preferenceMetrics?.length?input.preferenceMetrics:DEFAULT_PREFERENCES).slice(0,PREFERENCE_LIMIT)) {
  const d=dist<string>(response,`preference_${key}`,'any');
  if(secondary('preferences',d,`Prefer ${d.value==='high'?'higher':'lower'}: ${label}`,key))preferences[key]=d.value as 'high'|'low';
 }
 i.preferences=preferences;
 if(yes(response,'salary_data_required')>SALARY_REQUIRED_AT){i.salaryDataRequired=true;notes.push(SALARY_NOTE);}
 i.wantsTestimony=yes(response,'wants_testimony');
 // When something else must be asked, the meaning is asked too, first, instead of being applied behind the question.
 i.forks=forks;holdMeaningForAsk(i);
 // Focus: the primary topic first, then the other materially relevant topics by Jev's probability, so the question's own
 // subject heads the measures, the answer and discovery's ranking (RT-A1).
 const related=(Object.keys(TOPIC_OPTIONS) as TopicId[]).filter(k=>k!=='other').map(k=>[k,yes(response,`focus_${k}`)] as const).filter(([,p])=>p>FOCUS_AT).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([k])=>k);
 i.focus=[...(i.topic.value!=='other'?[i.topic.value]:[]),...related.filter(t=>t!==i.topic.value)];
 // Route decision (a Choice): unsafe and needs-generation outcomes are special; otherwise the route follows the view shown.
 const route=dist<RouteId>(response,'route','metric_view');
 i.routeChoice=response.answers.route?.type==='choice'?route:null;
 // Refusing needs BOTH signals: the route Choice's cannot_safely_answer probability and the unsupported noul. One alone
 // shows the nearest evidence with the no-generation notice instead; a navigated employer name is never refused. A lone
 // refusal signal on a question Jev itself reads as a workplace word with several meanings (the meaning fork) is not
 // doubt about the question: its evidence view is shown as for any other workplace question (measured: "how political
 // is engineering?" on the home page drew cannot_safely_answer at 0.70 to 0.78 with the meaning fork in every run).
 const unsupportedYes=yes(response,'unsupported'),routeUnsafe=route.value==='cannot_safely_answer'&&(route.probabilities.cannot_safely_answer??route.confidence)>=UNSUPPORTED_AT;
 const unsafe=!navigate&&unsupportedYes>=UNSUPPORTED_AT&&routeUnsafe;
 const doubtful=!navigate&&!unsafe&&!meaningFork&&(unsupportedYes>=UNSUPPORTED_AT||route.value==='cannot_safely_answer');
 const decided=(value:RouteId)=>route.value===value&&route.confidence>=SECONDARY_CONFIDENCE;
 if(unsafe)i.route='cannot_safely_answer';
 else if(i.route!=='unlisted')i.route=navigate?'metric_view':doubtful||decided('needs_generation')?'needs_generation':VIEW_ROUTE[i.view.value];
 if(i.route==='needs_generation')notes.push(NEEDS_GENERATION_NOTE);
 i.forks=forks.sort((a,b)=>forkRank(a)-forkRank(b));
 i.notes=notes;i.suggestions=suggestions;
 // Tentative ('fork') readings are applied and shown with their alternatives; only 'ask' forks hold the canvas.
 i.clarify=forks.some(f=>f.tier!=='fork')||unsafe||i.route==='unlisted';
 // The canonical question is the typed spec of what is shown, never a model-chosen string.
 const spec=i.route==='needs_generation'?null:specFromInterpretation(i,{cohorts:[...input.cohortOptions.fn,...input.cohortOptions.other],events:input.events.map(e=>e.id)});
 i.canonicalQuestion=spec?specId(spec):null;
 if(i.canonicalQuestion&&decided('existing_faq')&&!i.clarify&&!navigate)i.route='existing_faq';
 return i;
}
