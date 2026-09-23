import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {flushSync} from 'react-dom';
import {post,RequestError,isRateLimited,communitySupplied,ATTACHED_DOMAIN_LABEL,livePausedNote,LIVE_PAUSE_DEFAULT,RATE_LIMITED_CALM,fetchDirectory,isFictional,shownDirectory,publicationRules,accountsRule,homeExamples,isCommunity,displayName,employerLabel,withListing,domainOf,listingOpen,listingPowBits,COMMUNITY_LABEL,humanKey,TOPIC_LABELS,VIEW_LABELS,VIEW_SHORT,VIEW_DESCRIPTIONS,TIMEFRAME_LABELS,LAYER_LABELS,type CanvasResponse,type DirectoryCompany,type SiteConfig,type Overrides,type Metric,type EvidencePayload,type ViewId,type Interpretation} from './api.ts';
import {stateUrl,parseState,stateOverrides,stateOf,hasTypedFilters,validSlug,missingEmployer,neutralized,unpublished,portable,forgetQuestion} from './share.ts';
import {localAnnotations,exactCompany,typedEmployerName,tidyName} from './local-intent.ts';
import {liveStep,historyKind} from './live.ts';
import {controlsRequest,carryInferred,employerBound,idleTimeframe,idleTimeframeNotice,type Changes} from './controls.ts';
import {unlistedNotice,unlistedNotices} from '../worker/src/interpretation.ts';
import {faqCatalog,specOverrides,parseSpecId,specWording} from '../shared/faq.ts';
import type {FaqOverrides} from '../worker/src/types.ts';
import {Composer,Chips,Clarify,Tentative,type Chip,type CursorMark} from './canvas/composer.tsx';
import {heldQuestions,questionOf,offerable} from './forks.ts';
import {Canvas,Answer,Unlisted,isRealEmpty,type CanvasActions} from './canvas/views.tsx';
import {EvidenceLens,type LensTarget} from './canvas/lens.tsx';
import {Rail} from './canvas/rail.tsx';
import {FictionTag,Icon,ShareButton} from './canvas/parts.tsx';
import {ChallengeDialog} from './jury.tsx';
import {AddEmployer} from './add-employer.tsx';
import {loadKeys} from './submit.tsx';
import {chooseIssuerKey} from './community-keys.ts';
import type {IssuerKey} from '../shared/proof.ts';

type Mode='submit'|'live'|'controls';
/** A step of the path in this tab. Its label names the view (an employer, a view, a chosen option), never the reader's words. */
interface Step {label:string;idx:number;}
/**
 * Session-history entry, which browsers can write to disk to restore tabs. `q` is the last question the reader submitted.
 * At most one entry holds a question: only a new entry takes one, and the entry being left drops its own first (see
 * `forgetQuestion`). It never enters the URL.
 */
interface Entry {siwt:1;key:string;idx:number;q:string;pinned:Overrides;trail:Step[];faq?:string;}
/**
 * The reader's own words for this tab, in this page's memory only: the question behind each entry (for Back and Forward)
 * and the words that named each step of the visible path. Nothing here is written to history.state or storage.
 */
const spoken={byKey:new Map<string,string>(),byIdx:new Map<number,string>()};
const wordsOf=(st:Entry|null)=>st?(st.q||spoken.byKey.get(st.key)||''):'';
type Focus='canvas'|'clarify'|{chip:string}|undefined;
/**
 * `asked` is the words a reply answers; `named` an unlisted employer's name already known; `chosen` that the reader picked
 * 'an employer we don't list'; `said` the reader's words that led to this step, shown in the path from memory only.
 * `live` marks a Live reading (a provisional entry), and `settles` an explicit question, which replaces the provisional
 * entry on screen instead of adding a second one (see historyKind).
 */
interface How {kind:'push'|'replace';q:string;label:string;pinned:Overrides;faq?:string|undefined;focus?:Focus;asked?:string;named?:string|null;chosen?:boolean;said?:string;live?:boolean;settles?:boolean;}

const COMPANY_VIEWS:ViewId[]=['overview','compare','timeline','distribution','clusters','reader'];
const SENTINELS=['unspecified','unlisted','none','any','unsupported','comparison'];
const entryOf=(state:unknown):Entry|null=>state&&typeof state==='object'&&(state as Entry).siwt===1?state as Entry:null;
const slugOf=(path:string)=>{if(!path.startsWith('/c/'))return null;try {const s=decodeURIComponent(path.slice(3));return validSlug(s)?s:null;} catch {return null;}};
const newKey=()=>`${Date.now().toString(36)}${Math.random().toString(36).slice(2,8)}`;
const real=(value:string|null|undefined):value is string=>!!value&&!SENTINELS.includes(value);
/**
 * One orchestrated morph between views. A view transition runs the update later (after the old view is captured), so the
 * returned promise settles once the new view is in the DOM: focus moves only after that, never to an element that is
 * about to be removed.
 */
function morph(update:()=>void):Promise<void> {
 const doc=document as Document&{startViewTransition?:(callback:()=>void)=>{updateCallbackDone?:Promise<void>}|undefined};
 if(doc.startViewTransition&&!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const transition=doc.startViewTransition(()=>flushSync(update));
  return Promise.resolve(transition?.updateCallbackDone).then(()=>undefined,()=>undefined);
 }
 update();return Promise.resolve();
}
const labelOf=(r:CanvasResponse)=>r.evidence?(r.view==='overview'?r.evidence.company.name:`${r.evidence.company.name}: ${VIEW_SHORT[r.view]}`):VIEW_LABELS[r.view];

/** Live understanding is on by default (owner decision), except when the browser sends Global Privacy Control; a visitor's
 * own choice is remembered on this device and always wins. Storage can be unavailable, so every access is guarded. */
const LIVE_KEY='siwt-live';
export function initialLive():boolean {
 try {const saved=localStorage.getItem(LIVE_KEY);if(saved==='on')return true;if(saved==='off')return false;} catch {}
 return (navigator as Navigator&{globalPrivacyControl?:boolean}).globalPrivacyControl!==true;
}
function rememberLive(on:boolean) {try {localStorage.setItem(LIVE_KEY,on?'on':'off');} catch {}}

export function EvidenceExperience({config}:{config:SiteConfig|null}) {
 const [directory,setDirectory]=useState<DirectoryCompany[]>([]),[path,setPath]=useState(location.pathname);
 const [display,setDisplay]=useState<CanvasResponse|null>(null),[pending,setPending]=useState<CanvasResponse|null>(null);
 const [q,setQ]=useState(''),[marks,setMarks]=useState<{text:string;marks:CursorMark[]}>({text:'',marks:[]});
 const [live,setLive]=useState(initialLive),[countOptIn,setCountOptIn]=useState(false),[interestCounted,setInterestCounted]=useState<string|boolean>(false);
 const [busy,setBusy]=useState<Mode|null>(null),[error,setError]=useState(''),[calm,setCalm]=useState(''),[pinned,setPinned]=useState<Overrides>({});
 // Live understanding over its own budget pauses quietly; `until` is when it resumes. Enter still searches meanwhile.
 const [livePause,setLivePause]=useState<{seconds:number;until:number}|null>(null);
 // The employer a reply said the directory does not list, as the asker named it (shown only to them, never stored).
 const [unlistedFor,setUnlistedFor]=useState<{name:string|null;chosen:boolean}|null>(null);
 // The name an "Add your employer" form opened from the unlisted state starts with (null: the form is closed).
 const [addingFor,setAddingFor]=useState<string|null>(null);
 // The published credential keys (the same public list for everyone), read only when a real employer's empty record is shown.
 const [issuerKeys,setIssuerKeys]=useState<IssuerKey[]|'failed'|null>(null);
 const [trail,setTrail]=useState<Step[]>([]),[currentIdx,setCurrentIdx]=useState(0);
 const [lens,setLens]=useState<LensTarget|null>(null),[challenge,setChallenge]=useState<string|null>(null),[editing,setEditing]=useState<string|null>(null);
 const [loadingMore,setLoadingMore]=useState(false),[announcement,setAnnouncement]=useState('');
 // The words whose reply carried the server's support resources; the card shows while they are still in the composer.
 const [supportFor,setSupportFor]=useState<string|null>(null);
 const explicitSeq=useRef(0),liveSeq=useRef(0),liveCtl=useRef<AbortController|null>(null),explicitCtl=useRef<AbortController|null>(null),lastLive=useRef('');
 const submitted=useRef(''),lastIdx=useRef(-1),trailRef=useRef<Step[]>([]),displayRef=useRef<CanvasResponse|null>(null),pinnedRef=useRef<Overrides>({});
 const cache=useRef(new Map<string,CanvasResponse>()),counted=useRef(new Set<string>());
 // The provisional entry a Live reading added and the page has not left (see historyKind), and the held reply (a question
 // the page asked instead of changing the view) with the edits its request carried, which a choice on it keeps.
 const provisional=useRef<string|null>(null),held=useRef<{reply:CanvasResponse;pinned:Overrides}|null>(null);
 // A question submitted before the directory arrives waits for it, so a bare employer name never reaches hosted Jev.
 const directoryLoad=useRef<Promise<DirectoryCompany[]>|null>(null),directoryRef=useRef<DirectoryCompany[]>([]);
 const input=useRef<HTMLTextAreaElement>(null),canvasHeading=useRef<HTMLHeadingElement>(null),clarifyHeading=useRef<HTMLHeadingElement>(null);
 const focusPending=useRef(false);
 // A frame can run before a concurrent state update commits. Focus only after the new panel's DOM and ref exist.
 useLayoutEffect(()=>{if(pending&&focusPending.current){focusPending.current=false;clarifyHeading.current?.focus();}},[pending]);
 // The site's config, for filtering a directory that arrives before or after it: with sample employers off, none is listed.
 const configRef=useRef(config);configRef.current=config;
 displayRef.current=display;pinnedRef.current=pinned;directoryRef.current=directory;

 // Explicit requests are superseded only by newer explicit requests, never by keystrokes or Live readings. A Live
 // request is superseded by any newer request, and its result is dropped while an explicit one is in flight. Only explicit
 // requests report problems: a Live reading never shows an error while someone types. A Live pause on a listed
 // employer's exact name opens its record with a controls request (no words) that travels as a Live request.
 const send=useCallback(async(body:{q:string;slug:string|null;overrides:Overrides;mode:Mode;countInterest?:boolean},channel:'live'|'explicit'=body.mode==='live'?'live':'explicit'):Promise<CanvasResponse|null>=>{
  const live=channel==='live',id=live?++liveSeq.current:++explicitSeq.current,explicitAt=explicitSeq.current;
  if(liveCtl.current){liveCtl.current.abort();liveCtl.current=null;}
  if(!live){explicitCtl.current?.abort();setBusy(body.mode);setError('');setCalm('');}
  else if(!explicitCtl.current)setBusy('live');
  const controller=new AbortController();(live?liveCtl:explicitCtl).current=controller;
  const current=()=>live?id===liveSeq.current&&explicitAt===explicitSeq.current&&!explicitCtl.current:id===explicitSeq.current;
  try {
   const result=await post<CanvasResponse>('/api/canvas',{q:body.q,slug:body.slug,overrides:body.overrides,mode:body.mode,consent:body.mode==='live',...(body.countInterest?{countInterest:true}:{})},controller.signal);
   if(!live&&id===explicitSeq.current)explicitCtl.current=null;
   if(current()&&body.q)setSupportFor(result.resources?body.q:null);
   return current()?result:null;
  } catch(err) {
   if(!live&&id===explicitSeq.current)explicitCtl.current=null;
   if((err as Error).name==='AbortError')return null;
   // Live has its own budget; over it, Live pauses for as long as the server says and the last view stays.
   if(live&&isRateLimited(err)){const seconds=err.retryAfter??LIVE_PAUSE_DEFAULT;setLivePause({seconds,until:Date.now()+seconds*1000});}
   if(current()) {
    if(body.q)setSupportFor(err instanceof RequestError&&err.resources?body.q:null);
    if(!live)report(err);
   }
   return null;
  } finally {
   if(live?id===liveSeq.current:id===explicitSeq.current){(live?liveCtl:explicitCtl).current=null;if(!explicitCtl.current)setBusy(null);}
  }
 },[]);
 /** An explicit request's failure: a calm note when the connection's budget is used up, otherwise the error banner. */
 function report(err:unknown){if(isRateLimited(err))setCalm(RATE_LIMITED_CALM);else setError((err as Error).message);}
 // Live resumes by itself when the pause ends.
 useEffect(()=>{if(!livePause)return;const timer=setTimeout(()=>setLivePause(null),Math.max(0,livePause.until-Date.now()));return ()=>clearTimeout(timer);},[livePause]);

 const commit=useCallback((raw:CanvasResponse,how:How)=>{
  const result=neutralized(raw).response;
  if(result.keepCanvas) {
   focusPending.current=how.focus==='clarify';
   const i=result.interpretation;
   // An unlisted employer is named in the asker's own words when that is all they typed; nothing else is guessed.
   setUnlistedFor(i.route==='unlisted'?{name:tidyName(i.unlistedEmployer?.name)??how.named??typedEmployerName(how.asked??how.q,directoryRef.current),chosen:!!how.chosen}:null);
   setPending(result);held.current={reply:result,pinned:how.pinned};
   // The question the panel leads with: a meaning fork first, whatever its tier (see heldQuestions).
   const ask=heldQuestions(offerable(result.interpretation.forks,!!result.evidence))[0];
   setAnnouncement(ask?`Clarification needed: ${questionOf(ask)}`:i.route==='unlisted'?'The employer you named isn’t in the directory yet.':result.notices[0]??'');
   return;
  }
  held.current=null;
  const url=stateUrl(stateOf(result,how.faq)),prev=entryOf(history.state);
  // A Live reading is provisional, and Enter settles it: history keeps one entry per view the reader committed to.
  const kind=historyKind({live:how.live,settles:how.settles,requested:how.kind,current:prev?.key,provisional:provisional.current});
  const settled=!!how.settles&&kind==='replace'&&how.kind==='push';
  const idx=kind==='push'?lastIdx.current+1:(prev?.idx??lastIdx.current+1);
  const key=newKey();cache.current.set(key,result);
  if(cache.current.size>40)cache.current.delete(cache.current.keys().next().value!);
  const steps=[...trailRef.current.filter(s=>s.idx<idx),{label:how.label||labelOf(result),idx}].slice(-8);
  // Only a new entry takes the question; a replaced entry keeps what it held, so an entry already left never regains one.
  // A question that settles the provisional entry on screen takes its place, question included.
  const kept=kind==='replace'&&prev&&!settled?prev.q:how.q;
  const words=how.live?how.said??how.q:how.q;
  if(words)spoken.byKey.set(key,words);
  if(how.said)spoken.byIdx.set(idx,how.said);else if(kind==='push'||settled)spoken.byIdx.delete(idx);
  const entry:Entry={siwt:1,key,idx,q:kept,pinned:how.pinned,trail:steps,...(how.faq?{faq:how.faq}:{})};
  if(kind==='push'){forgetQuestion();history.pushState(entry,'',url);}else history.replaceState(entry,'',url);
  provisional.current=how.live?key:null;
  lastIdx.current=idx;trailRef.current=steps;pinnedRef.current=how.pinned;
  const shown=morph(()=>{setPending(null);setDisplay(result);setTrail(steps);setCurrentIdx(idx);setPath(location.pathname);setPinned(how.pinned);setLens(null);setEditing(null);});
  setAnnouncement(`Showing ${VIEW_LABELS[result.view].toLowerCase()}${result.evidence?` for ${result.evidence.company.name}`:''}.`);
  const focus=how.focus;
  // Focus moves once the new view is in place. A chip the change removed falls back to the first remaining chip, then the composer.
  if(focus)void shown.then(()=>requestAnimationFrame(()=>{
   if(focus==='canvas')canvasHeading.current?.focus();
   else if(focus==='clarify')clarifyHeading.current?.focus();
   else (document.querySelector<HTMLElement>(`[data-chip="${CSS.escape(focus.chip)}"]`)??document.querySelector<HTMLElement>('.chips button[data-chip]')??input.current)?.focus();
  }));
 },[]);

 const load=useCallback(async(st:Entry|null)=>{
  const typed=parseState(location.pathname,location.search),words=wordsOf(st);
  setQ(words);submitted.current=words;setMarks({text:'',marks:[]});setError('');setCalm('');setEditing(null);setLens(null);
  const kept=st?.pinned??{};pinnedRef.current=kept;setPinned(kept);
  // A link followed in this tab opened a new entry: no words named it.
  if(!st)spoken.byIdx.delete(lastIdx.current+1);
  if(!typed.slug&&!hasTypedFilters(typed)) {
   const idx=st?.idx??lastIdx.current+1,steps=[...trailRef.current.filter(s=>s.idx<idx),{label:'All employers',idx}].slice(-8);
   history.replaceState({siwt:1,key:'',idx,q:st?.q??'',pinned:kept,trail:steps} satisfies Entry,'',location.pathname+location.search);
   lastIdx.current=idx;trailRef.current=steps;
   morph(()=>{setDisplay(null);setPending(null);setPath(location.pathname);setTrail(steps);setCurrentIdx(idx);});
   return;
  }
  setPath(location.pathname);setPending(null);
  // An address naming an employer the directory does not list shows its not-found state without asking the server,
  // which answers only listed employers. The directory is usually here already; the first page load waits for it.
  if(typed.slug) {
   const seq=explicitSeq.current;
   const listed=directoryRef.current.length?directoryRef.current:await (directoryLoad.current??Promise.resolve([] as DirectoryCompany[]));
   if(seq!==explicitSeq.current)return;
   if(missingEmployer(typed.slug,listed)) {
    const idx=st?.idx??lastIdx.current+1,steps=[...trailRef.current.filter(s=>s.idx<idx),{label:'Employer not found',idx}].slice(-8);
    history.replaceState({siwt:1,key:'',idx,q:st?.q??'',pinned:kept,trail:steps} satisfies Entry,'',location.pathname+location.search);
    lastIdx.current=idx;trailRef.current=steps;
    morph(()=>{setDisplay(null);setPending(null);setPath(location.pathname);setTrail(steps);setCurrentIdx(idx);});
    setAnnouncement('That employer is not in the directory.');
    return;
   }
  }
  const overrides={...stateOverrides(typed),...kept};
  let result=await send({q:'',slug:typed.slug,overrides,mode:'controls'});
  if(!result)return;
  // A link can name a group or industry that nothing publishes. Such words are not typed public identifiers: the view
  // loads without them and says so, and they never appear on the page or stay in the address.
  const extra=unpublished(result);
  if(extra.cohort||extra.sector) {
   const retry={...overrides};if(extra.cohort)delete retry.cohort;if(extra.sector)delete retry.industry;
   const again=await send({q:'',slug:typed.slug,overrides:retry,mode:'controls'});if(!again)return;
   const name=again.evidence?.company.name;
   result={...again,notices:[...(extra.cohort?[`The group named in this link is not published${name?` for ${name}`:''}, so it was not applied.`]:[]),...(extra.sector?['The industry named in this link is not listed in the directory, so it was not applied.']:[]),...again.notices]};
  }
  commit(result,{kind:'replace',q:words,label:st?.trail.find(s=>s.idx===st.idx)?.label??'',pinned:kept,faq:typed.faq});
 },[send,commit]);

 useEffect(()=>{
  directoryLoad.current=fetchDirectory().then(all=>{const list=shownDirectory(configRef.current,all);setDirectory(list);return list;},(err:Error)=>{setError(err.message);return [] as DirectoryCompany[];});
  const onPop=()=>{
   const st=entryOf(history.state);
   // Arriving at an entry (Back, Forward, a reload) leaves any provisional one: from here, Live adds a new entry.
   provisional.current=null;held.current=null;
   // It also abandons whatever was still loading for the view left behind, so a late reply never navigates away again.
   explicitSeq.current++;liveSeq.current++;explicitCtl.current?.abort();liveCtl.current?.abort();explicitCtl.current=null;liveCtl.current=null;setBusy(null);
   setEditing(null);setLens(null);
   if(st) {
    lastIdx.current=st.idx;trailRef.current=st.trail;setTrail(st.trail);setCurrentIdx(st.idx);
    const hit=st.key?cache.current.get(st.key):undefined;
    if(hit){const words=wordsOf(st);setQ(words);submitted.current=words;setMarks({text:'',marks:[]});setPinned(st.pinned);pinnedRef.current=st.pinned;morph(()=>{setPending(null);setDisplay(hit);setPath(location.pathname);});return;}
   }
   void load(st);
  };
  const shortcut=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();input.current?.focus();}};
  window.addEventListener('popstate',onPop);window.addEventListener('keydown',shortcut);onPop();
  return ()=>{window.removeEventListener('popstate',onPop);window.removeEventListener('keydown',shortcut);explicitSeq.current++;liveSeq.current++;liveCtl.current?.abort();explicitCtl.current?.abort();};
 },[load]);

 // A new reply closes an "Add your employer" form opened from the previous one.
 useEffect(()=>{setAddingFor(null);},[pending]);
 useEffect(()=>{if(config?.sampleEmployers===false)setDirectory(list=>list.some(c=>c.kind==='sample')?shownDirectory(config,list):list);},[config]);
 /** A listing just added (or a domain attached to one): the directory, the cursor and the chips know it at once. */
 const addListing=useCallback((company:DirectoryCompany)=>{setDirectory(list=>list.some(c=>c.slug===company.slug)?list.map(c=>c.slug===company.slug?{...c,domains:[...new Set([...(c.domains??[]),...(company.domains??[])])],communityDomains:[...new Set([...(c.communityDomains??[]),...(company.communityDomains??[])])]}:c):[...list,company]);},[]);
 // The employer a question is asked about: the one on screen, else the page's own, unless the directory does not list it.
 const here=()=>{const shown=displayRef.current?.evidence?.company.slug;if(shown)return shown;const slug=slugOf(location.pathname);return missingEmployer(slug,directoryRef.current)?null:slug;};
 // A community listing is named with its domain and label wherever the page names it, so it never reads as a curated namesake.
 const nameOf=(slug:string)=>{const listed=directory.find(c=>c.slug===slug);return listed?employerLabel(listed):slug;};
 // A pinned event or group belongs to the employer it was chosen on. When a question names another listed employer or
 // asks across employers (recognised on the device), only the edits that mean the same everywhere go with it.
 const pinsFor=(text:string,slug:string|null)=>!slug||localAnnotations(text,{directory}).some(a=>(a.field==='company'&&a.value!==slug)||(a.field==='view'&&a.value==='discovery'))?portable(pinnedRef.current):pinnedRef.current;
 // Employer-bound pins that do travel with a question name their employer, so hosted Jev resolving the question to
 // another employer (a paraphrase the device did not recognise) never applies them there.
 const scoped=(pins:Overrides,slug:string|null):Overrides=>slug&&employerBound(pins)?{...pins,scope:slug}:pins;

 /** Typed, inference-free transition from the view on screen. Pinned keys are the reader's explicit edits. */
 const apply=useCallback(async(changes:Changes,o:{pin:boolean;label:string;from?:CanvasResponse|null;focus?:Focus;faq?:string;extra?:Pick<How,'named'|'chosen'>})=>{
  const from=o.from===undefined?displayRef.current:o.from;
  const base=from?stateOverrides(stateOf(from)):{},source=from?.evidence?.company.slug??null;
  // A choice on a held reply keeps the edits that request carried (see controlsRequest).
  const pins=from&&held.current?.reply===from?held.current.pinned:pinnedRef.current;
  const {overrides,nextPinned}=controlsRequest(base,pins,changes,{pin:o.pin,source});
  // Sentinels such as 'unlisted' travel only as overrides; the request slug names a listed employer or nothing.
  const slug=validSlug(overrides.company)?overrides.company:null;
  const result=await send({q:'',slug,overrides,mode:'controls'});
  if(result){setInterestCounted(false);commit(carryInferred(from,result,Object.keys(changes)),{kind:'push',q:submitted.current,label:o.label,pinned:nextPinned,faq:o.faq,focus:o.focus,...o.extra});}
 },[send,commit]);

 const choose=useCallback((field:string,id:string,from:CanvasResponse|null)=>{
  const key=field==='cohort_function'||field==='cohort_seniority'?'cohort':field;
  const value=(key==='company'&&id==='none')||(key==='topic'&&id==='other')?null:id;
  const option=from?.interpretation.forks.flatMap(f=>f.options).find(o=>o.id===id);
  // The reader said the employer is one we do not list: keep the name their question gave, if any.
  const extra=key==='company'&&id==='unlisted'?{chosen:true,named:tidyName(from?.interpretation.unlistedEmployer?.name)??typedEmployerName(submitted.current,directoryRef.current)}:undefined;
  void apply({[key]:value},{pin:key!=='company',label:option?.label??id,from,focus:extra?'clarify':'canvas',...(extra?{extra}:{})});
 },[apply]);

 const submit=async(text=q.trim(),count=true)=>{
  if(!text)return;
  const listed=directory.length?directory:await (directoryLoad.current??Promise.resolve([] as DirectoryCompany[]));
  const exact=exactCompany(text,listed);
  submitted.current=text;
  // A question that is only a listed employer's name navigates without hosted inference.
  if(exact){const result=await send({q:'',slug:exact,overrides:{company:exact},mode:'controls'});if(result)commit(result,{kind:'push',q:text,label:nameOf(exact),pinned:{},settles:true});return;}
  const slug=here(),marker=`${slug??''}|${text.toLowerCase()}`;
  const counting=count&&countOptIn&&!counted.current.has(marker),pins=pinsFor(text,slug);
  const raw=await send({q:text,slug,overrides:scoped(pins,slug),mode:'submit',...(counting?{countInterest:true}:{})});
  if(!raw)return;
  const result=neutralized(raw).response,spec=result.interpretation.canonicalQuestion?parseSpecId(result.interpretation.canonicalQuestion):null;
  if(result.interestCounted)counted.current.add(marker);
  // The acknowledgement names the standard question that was counted, never the reader's wording.
  setInterestCounted(result.interestCounted?(spec?specWording(spec,{event:result.evidence?.selectedEvent?.label??null}):true):false);
  setMarks({text,marks:result.interpretation.annotations});
  const landed=result.evidence?.company.slug??null;
  commit(result,{kind:'push',q:text,label:'',said:text,pinned:landed===slug?pins:portable(pins),focus:result.keepCanvas?'clarify':undefined,settles:true});
 };

 useEffect(()=>{
  // New words cancel a Live reading still in flight, so a reading of older words can never replace the view.
  if(liveCtl.current){liveCtl.current.abort();liveCtl.current=null;liveSeq.current++;lastLive.current='';setBusy(b=>b==='live'?null:b);}
  if(!live||livePause)return;
  const text=q.trim();
  // Checked on the device before anything is scheduled: words read as a crisis are never sent while someone types.
  if(liveStep(text,{submitted:submitted.current,last:lastLive.current,directory:directoryRef.current}).kind==='skip')return;
  let cancelled=false;
  const timer=setTimeout(()=>{void (async()=>{
   // A bare employer name never reaches hosted Jev, so Live waits for the directory before deciding.
   const listed=directoryRef.current.length?directoryRef.current:await (directoryLoad.current??Promise.resolve([] as DirectoryCompany[]));
   const step=liveStep(text,{submitted:submitted.current,last:lastLive.current,directory:listed});
   if(cancelled||step.kind==='skip')return;
   lastLive.current=text;
   const forget=()=>{if(lastLive.current===text)lastLive.current='';};
   if(step.kind==='navigate') {
    // Already on that record as it opens, with nothing narrowed: there is nothing to change.
    if(location.pathname===`/c/${step.slug}`&&!location.search)return;
    // The same request Enter makes for a listed name: its record, opened with no words.
    const result=await send({q:'',slug:step.slug,overrides:{company:step.slug},mode:'controls'},'live');
    if(!result){forget();return;}
    setError('');setCalm('');
    commit(result,{kind:'replace',q:submitted.current,label:listed.find(c=>c.slug===step.slug)?.name??step.slug,said:text,pinned:{},asked:text,live:true});
    return;
   }
   const slug=here();
   const raw=await send({q:text,slug,overrides:scoped(pinsFor(text,slug),slug),mode:'live'});
   if(!raw){forget();return;}
   const result=neutralized(raw).response;
   setMarks({text,marks:result.interpretation.annotations});setError('');setCalm('');
   commit(result,{kind:'replace',q:submitted.current,label:'',said:text,pinned:pinnedRef.current,asked:text,live:true});
  })();},450);
  return ()=>{cancelled=true;clearTimeout(timer);};
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[q,live,livePause,send,commit]);
 const toggleLive=(on:boolean)=>{setLive(on);rememberLive(on);if(!on){liveCtl.current?.abort();liveCtl.current=null;lastLive.current='';}};

 const loadMore=async()=>{
  const current=displayRef.current,e=current?.evidence;if(!current||!e||loadingMore)return;
  const page=e.testimonyPaging.page+1;if(page>24)return;
  setLoadingMore(true);setError('');setCalm('');
  try {
   const next=await post<CanvasResponse>('/api/canvas',{q:'',slug:e.company.slug,overrides:{...stateOverrides(stateOf(current)),...pinnedRef.current,page},mode:'controls'});
   if(displayRef.current!==current||!next.evidence)return;
   const seen=new Set(e.testimony.map(t=>t.id));
   const merged:CanvasResponse={...current,evidence:{...e,testimony:[...e.testimony,...next.evidence.testimony.filter(t=>!seen.has(t.id))],testimonyPaging:next.evidence.testimonyPaging}};
   const key=entryOf(history.state)?.key;if(key)cache.current.set(key,merged);
   setDisplay(merged);
  } catch(err) {report(err);} finally {setLoadingMore(false);}
 };

 const openMetric:CanvasActions['openMetric']=(metric,source,cell)=>setLens({metric,company:source.company,testimony:source.testimony,clusters:source.clusters,cohortLabel:source.cohortLabel,...(cell?{cell}:{})});
 // The group view lists only the group's measures. A whole-company number for a measure the group lacks opens its
 // question wording and method from the whole-company record (a controls request: no question text, no inference).
 const wholeCompany=useRef(new Map<string,Metric[]>());
 const openCompanyCell:NonNullable<CanvasActions['openCompanyCell']>=async(key,source,cell)=>{
  const slug=source.company.slug;let metrics=wholeCompany.current.get(slug);
  if(!metrics) {
   try {metrics=(await post<CanvasResponse>('/api/canvas',{q:'',slug,overrides:{company:slug},mode:'controls'})).evidence?.metrics??[];wholeCompany.current.set(slug,metrics);}
   catch(err){report(err);return;}
  }
  const metric=metrics.find(m=>m.key===key&&m.series.some(p=>p.releaseId===cell.releaseId))??metrics.find(m=>m.key===key);
  if(metric)openMetric(metric,source,cell);else setError('The evidence for this number could not be found in the whole-company record.');
 };
 const openFaq=(entry:{specId:string;overrides:FaqOverrides},label:string)=>{const o=entry.overrides;void apply({view:o.view,topic:o.topic,cohort:o.cohort,event:o.event,layer:o.layer,timeframe:o.timeframe},{pin:false,label,faq:entry.specId,focus:'canvas'});};
 const rephrase=(text:string)=>{const spec=faqCatalog.find(f=>f.question===text);if(spec)void apply({...specOverrides(spec.spec)},{pin:false,label:text,faq:spec.id,from:display,focus:'canvas'});else{setQ(text);void submit(text,false);}};
 const act:CanvasActions={
  openMetric,openCompanyCell:(key,source,cell)=>void openCompanyCell(key,source,cell),loadMore:()=>void loadMore(),challenge:id=>setChallenge(id),
  setView:view=>void apply({view},{pin:true,label:VIEW_LABELS[view]}),
  setField:(key,value)=>void apply({[key]:value},{pin:true,label:`Changed ${key}`,focus:'canvas'}),
  go:(overrides,label)=>void apply(overrides,{pin:false,label,focus:'canvas'}),
 };
 const reset=()=>{const slug=displayRef.current?.evidence?.company.slug;pinnedRef.current={};setPinned({});void apply(slug?{company:slug}:{},{pin:false,label:'Reset my edits',from:null});};

 const chips=useMemo<Chip[]>(()=>{
  if(!display)return [];
  const i=display.interpretation,e=display.evidence,list:Chip[]=[];
  const companies=directory.map(c=>[c.slug,isFictional(c)?`${c.name} (fictional)`:employerLabel(c)] as [string,string]);
  const add=(key:string,field:string,label:string,o:{options?:Array<[string,string]>;onPick?:(id:string)=>void;onRemove?:()=>void;inferred?:string})=>{
   const fork=offerable(i.forks,!!e).find(f=>f.tier==='fork'&&f.field===field);
   list.push({key,label,removable:!!o.onRemove,editable:!!(fork||o.options),tentative:!!fork,...(o.inferred?{inferred:o.inferred}:{}),
    ...(fork?{options:fork.options.map(x=>[x.id,x.label] as [string,string]),onPick:(id:string)=>choose(fork.field,id,display)}:o.options&&o.onPick?{options:o.options,onPick:o.onPick}:{}),
    ...(o.onRemove?{onRemove:o.onRemove}:{})});
  };
  const edit=(key:string,label:string,value:Overrides[string])=>void apply({[key]:value},{pin:true,label,focus:{chip:key}});
  if(e) {
   add('company','company',employerLabel(withListing(e.company,directory)),{options:companies,onPick:slug=>void apply({company:slug},{pin:false,label:nameOf(slug),focus:{chip:'company'}})});
   if(display.view==='compare') {
    const other=display.compareEvidence?.company,choices=companies.filter(([slug])=>slug!==e.company.slug);
    const pick=(slug:string)=>void apply({compareTo:slug,view:'compare'},{pin:false,label:`Compared with ${nameOf(slug)}`,focus:{chip:'compareTo'}});
    if(other)add('compareTo','compareTo',`Compared with ${employerLabel(withListing(other,directory))}`,{options:choices,onPick:pick,onRemove:()=>void apply({compareTo:null,view:'overview'},{pin:false,label:'Removed the comparison',focus:{chip:'company'}})});
    else add('compareTo','compareTo','Add an employer to compare',{options:choices,onPick:pick});
   }
   const facets=(e.facets??[]).map(f=>[f.label,f.label] as [string,string]);
   const groups=[i.cohorts.fn,i.cohorts.seniority].filter(real);
   if(e.cohortStatus!=='all') {
    if(groups.length===2) {
     // Two groups are two chips, one per slot; editing or removing one never touches the other.
     const [fn,seniority]=groups as [string,string];
     ([['cohortFunction',fn,seniority],['cohortSeniority',seniority,fn]] as const).forEach(([slot,own,other],index)=>{
      const both=(value:string|null)=>slot==='cohortFunction'?{cohortFunction:value,cohortSeniority:other}:{cohortFunction:other,cohortSeniority:value};
      add(`cohort-${index}`,'cohort',own,{options:facets.filter(([label])=>label!==other),onPick:label=>void apply(both(label),{pin:true,label,focus:{chip:`cohort-${index}`}}),onRemove:()=>void apply(both(null),{pin:true,label:`Removed ${own}`,focus:{chip:'cohort'}})});
     });
    }
    else add('cohort','cohort',e.cohortLabel,{options:facets,onPick:label=>edit('cohort',label,label),onRemove:()=>edit('cohort','Whole company',null)});
   } else if(display.view==='cohort'&&facets.length)add('cohort','cohort','Choose a group',{options:facets,onPick:label=>edit('cohort',label,label)});
   if(real(i.event?.value)) {
    const label=e.selectedEvent?.label??e.events.find(v=>v.id===i.event!.value)?.label??'Selected event';
    // An event a deterministic rule selected (the employer's only documented event of the kind the question names) is labeled as inferred.
    const inferred=i.inferred?.find(v=>v.field==='event'&&v.value===i.event!.value);
    add('event','event',label,{options:e.events.map(v=>[v.id,v.label] as [string,string]),onPick:id=>edit('event',e.events.find(v=>v.id===id)?.label??'Changed the event',id),onRemove:()=>void apply({event:null,...(i.timeframe==='before_event'||i.timeframe==='after_event'?{timeframe:'any'}:{})},{pin:true,label:`Removed ${label}`,focus:{chip:'company'}}),
     ...(inferred&&!pinned.event?{inferred:inferred.reason==='single_documented_event'?`Inferred: it is ${e.company.name}’s only documented event of the kind your question names. Change or remove it if you meant something else.`:'Inferred from your question. Change or remove it if you meant something else.'}:{})});
   }
  }
  if(i.topic.value!=='other')add('topic','topic',TOPIC_LABELS[i.topic.value]??i.topic.value,{options:Object.entries(TOPIC_LABELS).filter(([k])=>k!=='other'),onPick:t=>edit('topic',TOPIC_LABELS[t]??t,t),onRemove:()=>edit('topic','All topics',null)});
  if(!e&&real(i.cohorts.fn??i.cohorts.seniority))add('cohort','cohort',(i.cohorts.fn??i.cohorts.seniority)!,{onRemove:()=>edit('cohort','Any group',null)});
  // A before/after choice the view does not apply (the timeline shows every period) says so on its chip.
  if(i.timeframe!=='any')add('timeframe','timeframe',`${TIMEFRAME_LABELS[i.timeframe]??i.timeframe}${idleTimeframe(display)?' (not applied in this view)':''}`,{options:Object.entries(TIMEFRAME_LABELS).filter(([k])=>k==='any'||k==='last_year'||(e?.events.length??0)>0),onPick:t=>edit('timeframe',TIMEFRAME_LABELS[t]??t,t),onRemove:()=>edit('timeframe','All periods','any')});
  if(i.layer)add('layer','layer',LAYER_LABELS[i.layer]??i.layer,{options:Object.entries(LAYER_LABELS),onPick:l=>edit('layer',LAYER_LABELS[l]??l,l),onRemove:()=>edit('layer','Every account type',null)});
  // An industry nobody lists stays a filter the reader can see and remove, without repeating its words.
  if(i.industry==='unsupported'||real(i.industry)){const sectors=[...new Set(directory.map(c=>c.sector).filter((s):s is string=>!!s))].sort().map(s=>[s,s] as [string,string]);add('industry','industry',i.industry==='unsupported'?'Sector: not in the directory':`Sector: ${i.industry}`,{options:sectors,onPick:s=>edit('industry',`Sector: ${s}`,s),onRemove:()=>edit('industry','Any sector',null)});}
  // Preferences rank employers in discovery only; a single employer's page never shows them as filters.
  const prefs=e?[]:Object.entries(i.preferences??{}).filter((p):p is [string,'high'|'low']=>p[1]==='high'||p[1]==='low');
  const prefLabel=(key:string)=>display.discovery.flatMap(r=>r.values).find(v=>v.metricKey===key||v.concept===key)?.label??humanKey(key);
  for(const [key,direction] of prefs)add(`pref-${key}`,'preferences',`${direction==='high'?'Higher':'Lower'} ${prefLabel(key).toLowerCase()}`,{onRemove:()=>edit('preferences','Removed a preference',{...Object.fromEntries(prefs),[key]:'any'})});
  if(prefs.length>1)list.push({key:'pref-clear',label:'Clear all preferences',removable:false,editable:false,action:()=>edit('preferences','Cleared preferences',null)});
  if(i.salaryDataRequired)add('salary','salaryDataRequired','Needs salary amounts (not collected)',{onRemove:()=>edit('salaryDataRequired','Removed the salary requirement',false)});
  if(typeof pinned.view==='string'&&pinned.view===display.view&&display.view!=='overview')add('view','view',`View: ${VIEW_SHORT[display.view]}`,{onRemove:()=>void apply({view:'overview'},{pin:false,label:VIEW_LABELS.overview,focus:{chip:'company'}})});
  return list;
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[display,directory,pinned]);

 const pathSlug=slugOf(path),e=display?.evidence??null;
 const company=e?.company??(pathSlug?directory.find(c=>c.slug===pathSlug)??null:null);
 const home=!display&&path==='/',fictional=isFictional(company);
 // The directory's entry for the employer on screen: its registered verification domain and whether the community listed it.
 const listedCompany=company?directory.find(c=>c.slug===company.slug)??null:null;
 const rules=publicationRules(config);
 // An employer address the directory does not list (the server was not asked; see load).
 const missing=!display&&missingEmployer(pathSlug,directory);
 const cursor=useMemo(()=>{
  if(marks.text&&q===marks.text&&marks.marks.length)return {marks:marks.marks,source:'jev' as const};
  return {marks:localAnnotations(q,{directory,cohorts:e?.facets?.map(f=>f.label)??[],events:e?.events??[]}),source:'device' as const};
 },[q,marks,directory,e]);
 useEffect(()=>{document.title=company?`${displayName(withListing(company,directory))}${isFictional(company)?' (fictional)':''} — Should I Work There`:missing?'Employer not found — Should I Work There':'Should I Work There — know the workplace, protect the person';},[company,missing]);

 const i=display?.interpretation;
 const examples=useMemo(()=>homeExamples(config,directory),[config,directory]);
 const pinnedCount=Object.keys(pinned).length;
 const idle=idleTimeframe(display);
 const notices=display?[...new Set([...display.notices,...(idle?[idleTimeframeNotice(TIMEFRAME_LABELS[idle]??idle)]:[])])]:[];
 const empty=!!display&&isRealEmpty(display),stacked=display?.view==='compare';
 useEffect(()=>{if(!empty||issuerKeys)return;let on=true;loadKeys().then(keys=>{if(on)setIssuerKeys(keys);},()=>{if(on)setIssuerKeys('failed');});return ()=>{on=false;};},[empty,issuerKeys]);
 /** Whether contributions about an employer can be verified (a work-mailbox key exists): 'loading' until the keys arrive, null if they could not be read. */
 const verifiable=(slug:string):boolean|null|'loading'=>{if(!issuerKeys)return 'loading';if(issuerKeys==='failed')return null;try {return chooseIssuerKey(issuerKeys,slug)?.verificationClass==='mailbox';} catch {return null;}};
 // A domain added from an empty record: the directory learns it at once, and the keys are read again (they are created on demand).
 const listedFromRecord=useCallback((company:DirectoryCompany)=>{addListing(company);setIssuerKeys(null);},[addListing]);
 const views=e&&!empty?[...COMPANY_VIEWS,...((e.facets?.length??0)>0?['cohort' as ViewId]:[])]:[];
 const shareUrl=display?stateUrl(stateOf(display,entryOf(history.state)?.faq)):path;
 const currentLabel=(field:string)=>!display||!i?null:field==='company'?e?.company.name??null:field==='view'?VIEW_LABELS[display.view]:field==='topic'?TOPIC_LABELS[i.topic.value]??null:field==='timeframe'?TIMEFRAME_LABELS[i.timeframe]??null:field==='event'?e?.selectedEvent?.label??null:field==='cohort'?e?.cohortLabel??null:field==='industry'?i.industry??null:null;
 const currentId=(field:string)=>!display||!i?null:field==='topic'?i.topic.value:field==='view'?display.view:field==='timeframe'?i.timeframe:field==='event'?e?.selectedEvent?.id??null:field==='company'?e?.company.slug??null:null;
 const suggestions=(i?.suggestions??[]) as Interpretation['suggestions'];
 // An employer the directory does not list has its own state, and the generic notice for it is not repeated there.
 const unlisted=useMemo(()=>{
  if(!pending||pending.interpretation.route!=='unlisted')return null;
  const said=pending.interpretation.unlistedEmployer?.name??null,own=new Set(unlistedNotices(said)),name=unlistedFor?.name??tidyName(said);
  // A name the device recognises as a listed employer is neither repeated nor said to be missing.
  const listed=!!name&&localAnnotations(name,{directory}).some(a=>a.field==='company');
  // When the match was made against part of the directory only, absence is claimed only if the reader said so.
  const partial=pending.notices.includes(unlistedNotice(said,false));
  return {name:listed?null:name,certain:!!unlistedFor?.chosen||(!partial&&!listed),notices:[...new Set(pending.notices)].filter(n=>!own.has(n))};
 },[pending,unlistedFor,directory]);
 const browseDirectory=home?()=>{setPending(null);requestAnimationFrame(()=>{const target=document.getElementById('directory-real');target?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});target?.focus({preventScroll:true});});}:null;
 const applySuggestion=(s:Interpretation['suggestions'][number])=>{
  if(s.field==='preferences'&&s.key)void apply({preferences:{...(i?.preferences??{}),[s.key]:s.value as 'high'|'low'}},{pin:true,label:s.label});
  else if(s.field==='compareTo')void apply({compareTo:s.value,view:'compare'},{pin:false,label:s.label});
  else void apply({[s.field]:s.value},{pin:true,label:s.label});
 };

 return <main id="main" className={`page evidence ${home?'is-home':''}`} aria-busy={busy!==null&&busy!=='live'}>
  {home?<section className="hero">
   <p className="hero-kicker"><span className="pulse" aria-hidden="true"/>Public evidence. Private people.</p>
   <h1>Know the workplace.<br/><span>Keep your privacy.</span></h1>
   <p className="hero-sub">An honest record of working somewhere, built from evidence you can inspect and designed to protect the people behind it.</p>
  </section>:<header className="record-head">
   <a className="back-link" href="/"><Icon name="back" size={16}/>All employers</a>
   <div className="record-title">
    <h1>{company?.name??(display?VIEW_LABELS[display.view]:pathSlug?(missing||error?'Employer not found':'Opening the record…'):'Explore employers')}</h1>
    {company&&<div className="record-tags">{fictional?<FictionTag>Fictional company, illustrative data</FictionTag>:<><span className="tag">Real employer</span>{domainOf(listedCompany)&&<span className="tag tag-quiet tag-domain" title="The work-email domain its verification uses">{domainOf(listedCompany)}</span>}{isCommunity(listedCompany)?<span className="tag tag-community">{COMMUNITY_LABEL}</span>:communitySupplied(listedCompany,domainOf(listedCompany))&&<span className="tag tag-community">{ATTACHED_DOMAIN_LABEL}</span>}{config&&<span className="tag tag-quiet">{config.realPublicationEnabled?'Real-employer publication on':'Real-employer publication paused'}</span>}</>}</div>}
   </div>
   {display&&<ShareButton path={shareUrl} title={company?`${fictional?`${company.name} (fictional demonstration)`:employerLabel(withListing(company,directory))} on Should I Work There`:'Should I Work There'}/>}
  </header>}
  {fictional&&company&&<p className="fiction-banner">{company.name} is a fictional employer. Every number, account and event on this page is demonstration data.</p>}

  <section className={`ask ${home?'ask-hero':''}`} aria-label="Ask about a workplace">
   <Composer value={q} onChange={setQ} onSubmit={()=>void submit()} live={live} onLive={toggleLive} busy={busy==='submit'||busy==='controls'} hero={home}
    placeholder={home?'Find a company, ask a question, compare what matters':company?`What would you like to know about ${company.name}?`:'Name an employer, or ask across employers'}
    marks={cursor.marks} markSource={cursor.source} inputRef={input} serverSupport={supportFor!==null&&supportFor===q.trim()} liveNote={livePause?livePausedNote(livePause.seconds):null}/>
   <Chips chips={chips} editing={editing} setEditing={setEditing} onReset={pinnedCount?reset:undefined} resetLabel={`Reset my edits (${pinnedCount})`}/>
   {pinnedCount>0&&<p className="pins-note">Your edits stay in effect for new questions until you reset them.</p>}
   {suggestions.length>0&&<div className="suggestions" role="group" aria-labelledby="suggestions-label"><span className="suggestions-label" id="suggestions-label">Not applied, one tap away</span>{suggestions.map(s=><button key={`${s.field}:${s.key??''}:${s.value}`} className="pill-button small" onClick={()=>applySuggestion(s)}>{s.label}</button>)}</div>}
   {display&&!pending&&<Tentative forks={offerable(display.interpretation.forks,!!display.evidence)} current={currentLabel} currentId={currentId} onChoose={(field,id)=>choose(field,id,display)}/>}
  </section>

  {missing&&!pending&&<section className="not-found" aria-label="Employer not found"><p>That employer is not in the directory, so there is no record at this address. Search above, or <a href="/">browse all employers</a>.</p></section>}
  {error&&<p className="error" role="alert">{error}{pathSlug&&!display&&!missing&&<> <a href="/">Browse all employers</a></>}</p>}
  {calm&&<p className="calm-note" role="status">{calm}</p>}
  {pending&&unlisted&&<div className="pending"><Unlisted name={unlisted.name} certain={unlisted.certain} notices={unlisted.notices} rules={rules} headingRef={clarifyHeading} onBrowse={browseDirectory} onDismiss={()=>{setPending(null);setAddingFor(null);}} onAdd={addingFor===null&&listingOpen(config)?()=>setAddingFor(unlisted.name??''):null} listing={listingOpen(config)}/>
   {addingFor!==null&&<AddEmployer key={`unlisted:${addingFor}`} context="unlisted" initialName={addingFor} directory={directory} powBits={listingPowBits(config)} rules={rules} onListed={addListing} onClose={()=>setAddingFor(null)}/>}
  </div>}
  {pending&&!unlisted&&<div className="pending">
   <Clarify forks={offerable(pending.interpretation.forks,!!pending.evidence)} notices={[...new Set(pending.notices)]} questionNotes={pending.interpretation.notes??[]} rephrasings={pending.rephrasings??[]} onChoose={(field,id)=>choose(field,id,pending)} onRephrase={rephrase} headingRef={clarifyHeading} keepNote={!!display} situation={pending.interpretation.degraded?'degraded':pending.interpretation.route}/>
   <div className="pending-actions"><button className="link-button" onClick={()=>setPending(null)}>Dismiss</button></div>
  </div>}

  {home&&!pending&&examples.length>0&&<div className="examples" aria-label="Try an example">{examples.map(({text,fictional:demo})=><button key={text} className="pill-button" onClick={()=>{setQ(text);void submit(text,false);}}>{text}{demo&&<span className="tag tag-fiction">Fictional</span>}</button>)}</div>}

  {trail.length>1&&display&&<nav className="trail" aria-label="Your path in this tab"><ol>{trail.map(step=><li key={step.idx}><button aria-current={step.idx===currentIdx?'step':undefined} onClick={()=>{if(step.idx!==currentIdx)history.go(step.idx-currentIdx);}}>{spoken.byIdx.get(step.idx)??step.label}</button></li>)}</ol></nav>}

  {display&&<section className={`canvas ${busy&&busy!=='live'?'is-busy':''}`} aria-labelledby="canvas-title">
   {/* A real employer with nothing published has one heading, the publication rule, inside the canvas. */}
   {!empty&&<div className="canvas-head">
    <p className="canvas-view">{VIEW_LABELS[display.view]}{fictional&&<FictionTag/>}</p>
    <h2 id="canvas-title" ref={canvasHeading} tabIndex={-1}>{display.answer?.headline??(e?VIEW_LABELS[display.view]:'Employers with published evidence')}</h2>
    <p className="canvas-desc">{VIEW_DESCRIPTIONS[display.view]}</p>
    <Answer data={display} act={act}/>
   </div>}
   {views.length>0&&<nav className="view-pills" aria-label="Choose a view">{views.map(view=><button key={view} aria-pressed={display.view===view} onClick={()=>act.setView(view)}>{VIEW_SHORT[view]}</button>)}</nav>}
   {notices.length>0&&<div className="notices">{notices.map(n=><p className="notice" key={n}>{n}</p>)}</div>}
   <div className={`canvas-grid ${!e||empty?'no-rail':stacked?'stacked':''}`}>
    <div className="canvas-main"><Canvas data={display} config={config} act={act} loadingMore={loadingMore} headingRef={canvasHeading} verifiable={verifiable} directory={directory} onListed={listedFromRecord}/></div>
    {e&&!empty&&<Rail data={display} countOptIn={countOptIn} setCountOptIn={setCountOptIn} interestCounted={interestCounted} onFaq={(entry,label)=>openFaq(entry,label)}/>}
   </div>
   <p className="canvas-foot">{i?.source==='jev'&&!i.degraded?'No generated answers. Jev classified your intent; published evidence built this view.':'No generated answers. Your controls chose this view; published evidence built it.'}</p>
  </section>}

  {!display&&(home||!pathSlug)&&<Directory directory={directory} q={q} config={config} onListed={addListing}/>}
  {!display&&pathSlug&&!missing&&!error&&(busy||!directory.length)&&<div className="canvas-skeleton" aria-hidden="true"><i/><i/><i/></div>}
  <p className="visually-hidden" role="status" aria-live="polite">{busy==='submit'?'Reading your question':announcement}</p>
  {lens&&<EvidenceLens target={lens} close={()=>setLens(null)} onChallenge={id=>{setLens(null);setChallenge(id);}}/>}
  {challenge&&<ChallengeDialog testimonyId={challenge} fixture={[...(e?.testimony??[]),...(e?.clusters.flatMap(c=>c.members)??[])].some(t=>t.id===challenge&&'provenance'in t&&t.provenance==='fixture')} onClose={()=>setChallenge(null)}/>}
 </main>;
}

/** Real employers shown before the reader asks for all of them: the directory is long, and the fictional demonstrations follow it. */
const DIRECTORY_PREVIEW=24;
function Directory({directory,q,config,onListed}:{directory:DirectoryCompany[];q:string;config:SiteConfig|null;onListed:(company:DirectoryCompany)=>void}) {
 const [sector,setSector]=useState(''),[expanded,setExpanded]=useState(false),[adding,setAdding]=useState(false),grid=useRef<HTMLDivElement>(null),addButton=useRef<HTMLButtonElement>(null);
 // What is typed in the question box narrows the list on this device (names, domains, and the curated ways of naming them).
 const needle=q.trim().toLowerCase(),searching=needle.length>=2&&needle.length<=40;
 const hit=(c:DirectoryCompany)=>c.name.toLowerCase().includes(needle)||c.slug.includes(needle)||(c.domains??[]).some(d=>d.toLowerCase().includes(needle))||(c.aliases??[]).some(a=>a.alias.toLowerCase().includes(needle));
 const realOnes=directory.filter(c=>c.kind==='real').sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base',numeric:true})),samples=shownDirectory(config,directory).filter(c=>c.kind==='sample');
 const sectors=[...realOnes.reduce((m,c)=>c.sector?m.set(c.sector,(m.get(c.sector)??0)+1):m,new Map<string,number>())].sort(([a],[b])=>a.localeCompare(b));
 const inSector=realOnes.filter(c=>!sector||c.sector===sector),matched=searching?inSector.filter(hit):inSector,none=searching&&!matched.length;
 const pool=none?inSector:matched,limited=!expanded&&!searching&&!sector&&pool.length>DIRECTORY_PREVIEW,shown=limited?pool.slice(0,DIRECTORY_PREVIEW):pool;
 const count=none?'No listed employer matches what you typed. All of them are below.':searching?`${pool.length} ${pool.length===1?'employer matches':'employers match'} what you typed`:limited?`The first ${DIRECTORY_PREVIEW} of ${pool.length}, A to Z`:`${pool.length} ${pool.length===1?'employer':'employers'}${sector?` in ${sector}`:''}, A to Z`;
 const showAll=()=>{setExpanded(true);requestAnimationFrame(()=>grid.current?.querySelectorAll<HTMLAnchorElement>('a.employer')[DIRECTORY_PREVIEW]?.focus());};
 const closeAdd=()=>{setAdding(false);requestAnimationFrame(()=>addButton.current?.focus());};
 return <section className="directory" aria-labelledby="directory-real">
  <div className="directory-head"><h2 id="directory-real" tabIndex={-1}>Real employers</h2><p>{accountsRule(publicationRules(config))} An empty record says nothing about the workplace.</p></div>
  {realOnes.length>DIRECTORY_PREVIEW&&<div className="directory-tools">
   <label className="directory-sector"><span>Sector</span><select value={sector} onChange={event=>setSector(event.target.value)}><option value="">All sectors ({realOnes.length})</option>{sectors.map(([name,n])=><option key={name} value={name}>{name} ({n})</option>)}</select></label>
   <p className="directory-count">{count}</p>
  </div>}
  <div className="employer-grid" ref={grid}>{shown.map(c=><a key={c.slug} className={`employer${isCommunity(c)?' community':''}`} href={`/c/${c.slug}`}><span className="monogram" aria-hidden="true">{c.name.slice(0,1)}</span><span className="employer-name">{displayName(c)}</span>{isCommunity(c)?<span className="tag tag-community">{COMMUNITY_LABEL}</span>:c.sector&&<span className="employer-sector">{c.sector}</span>}</a>)}</div>
  {limited&&<button className="secondary-button directory-more" onClick={showAll}>Show all {pool.length} real employers</button>}
  {adding?<AddEmployer context="home" level={2} initialName={none?q.trim().slice(0,80):''} directory={directory} powBits={listingPowBits(config)} rules={publicationRules(config)} onListed={onListed} onClose={closeAdd}/>
  :listingOpen(config)&&<div className="add-employer-invite"><p><strong>Don’t see your employer?</strong> Anyone can add one with the domain of its work email. Listing reveals nothing about who added it.</p><button ref={addButton} type="button" className="secondary-button" onClick={()=>setAdding(true)}>Add your employer</button></div>}
  {samples.length>0&&<div className="directory-head demo-head"><h2>Fictional demonstrations</h2><p>Fictional employers with illustrative data, so every view can be explored before real evidence exists.</p></div>}
  {samples.length>0&&<div className="employer-grid demo">{samples.map(c=><a key={c.slug} className="employer fictional" href={`/c/${c.slug}`}><span className="monogram" aria-hidden="true">{c.name.slice(0,1)}</span><span className="employer-name">{c.name}</span><FictionTag/></a>)}</div>}
  <ul className="trust-strip"><li>Free for everyone</li><li>No employer privileges</li><li><a href="/source">Open source</a></li></ul>
 </section>;
}
