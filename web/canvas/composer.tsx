import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState,type KeyboardEvent,type RefObject} from 'react';
import {detectCrisis,crisisCopyFor,crisisResourcesFor,CRISIS_COPY} from '../../shared/safety.ts';
import {segments} from '../local-intent.ts';
import {SERVER_RESOURCES_NOTE} from '../api.ts';
import {heldQuestions,questionOf,tentativeForks,probabilityLabel,type ForkView} from '../forks.ts';
import {Icon} from './parts.tsx';

export interface CursorMark {start:number;end:number;field:string;label:string;}
const FIELD_NAMES:Record<string,string>={company:'employer',compareTo:'compared employer',cohort:'group',event:'event',topic:'topic',view:'view',timeframe:'period',layer:'account type',industry:'sector'};

export function Composer({value,onChange,onSubmit,live,onLive,busy,placeholder,marks,markSource,inputRef,hero,serverSupport=false,liveNote=null}:{
 value:string;onChange:(v:string)=>void;onSubmit:()=>void;live:boolean;onLive:(v:boolean)=>void;busy:boolean;placeholder:string;
 marks:CursorMark[];markSource:'device'|'jev';inputRef:RefObject<HTMLTextAreaElement|null>;hero:boolean;
 /** The last reply carried the server's support resources for words the on-device check did not match. */
 serverSupport?:boolean;
 /** Set while Live understanding is paused (its own budget was used up): a quiet note, never an error. Enter still searches. */
 liveNote?:string|null;
}) {
 const layer=useRef<HTMLDivElement>(null),hintId=useId(),privacyId=useId();
 useLayoutEffect(()=>{const t=inputRef.current;if(!t)return;t.style.height='auto';t.style.height=`${Math.min(t.scrollHeight,240)}px`;},[value,inputRef]);
 const parts=useMemo(()=>segments(value,marks),[value,marks]);
 const seen=new Set<string>(),summary=marks.filter(m=>{const k=`${m.field}:${m.label}`;return seen.has(k)?false:(seen.add(k),true);});
 const key=(event:KeyboardEvent<HTMLTextAreaElement>)=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();onSubmit();}};
 const crisis=useMemo(()=>detectCrisis(value),[value]);
 return <>
  <div className={`composer ${hero?'composer-hero':''} ${live?'is-live':''} ${live&&liveNote?'is-paused':''} ${busy?'is-busy':''}`}>
   <div className="composer-field">
    <div className="cursor-layer" ref={layer} aria-hidden="true">{parts.map((p,index)=>p.annotation?<mark key={index} className={`cursor-mark from-${markSource} field-${p.annotation.field}`}>{p.text}</mark>:<span key={index}>{p.text}</span>)}{'​'}</div>
    <textarea ref={inputRef} value={value} rows={1} maxLength={600} spellCheck={false} autoComplete="off" aria-label="Ask about working somewhere" aria-describedby={`${hintId} ${privacyId}`} placeholder={placeholder}
     onChange={event=>onChange(event.target.value)} onKeyDown={key} onScroll={event=>{if(layer.current)layer.current.scrollTop=event.currentTarget.scrollTop;}}/>
   </div>
   <div className="composer-bar">
    <button type="button" className="live-toggle" role="switch" aria-checked={live} onClick={()=>onLive(!live)}><span className="live-knob" aria-hidden="true"/>Live understanding{live&&liveNote&&<span className="live-paused-tag" aria-hidden="true">Paused</span>}</button>
    <div className="recognised" id={hintId}>{summary.length>0&&<><span className="recognised-label">{markSource==='device'?'Recognized on this device':'Jev understood'}</span>{summary.slice(0,5).map(m=><span className={`recognised-item field-${m.field}`} key={`${m.field}:${m.label}`} title={`${m.label} (${FIELD_NAMES[m.field]??m.field})`}>{m.label}<span className="visually-hidden"> ({FIELD_NAMES[m.field]??m.field})</span></span>)}</>}</div>
    <button type="button" className="send" aria-label="Read the evidence" disabled={busy||!value.trim()} onClick={onSubmit}>{busy?<span className="send-spinner" aria-hidden="true"/>:<Icon name="send" size={20}/>}</button>
   </div>
  </div>
  <p className="live-paused" role="status">{live&&liveNote?liveNote:''}</p>
  <p className="composer-privacy" id={privacyId}>{live?<>Live understanding is on: when you pause, what you type is sent to Jev to read your intent. This site does not save it, but the model provider may keep what it receives. Switch it off above; your choice is remembered on this device. <a href="/privacy#jev">How Jev is used</a></>:'Your typing stays on this device until you press Enter. Live understanding is off.'}</p>
  {crisis?<CrisisCard kind={crisis.kind} about={crisis.about}/>:serverSupport?<CrisisCard kind="self_harm" privacy={SERVER_RESOURCES_NOTE}/>:null}
 </>;
}

/**
 * Calm, non-blocking support card. Its links always come from shared/safety.ts, never from a reply. The default privacy
 * line is for the on-device check; a card prompted by the server's reply says so instead.
 */
export function CrisisCard({kind,about,privacy=CRISIS_COPY.privacy}:{kind:'self_harm'|'danger';about?:'someone_else'|undefined;privacy?:string}) {
 const [hidden,setHidden]=useState(false),id=useId();
 useEffect(()=>setHidden(false),[kind,about,privacy]);
 if(hidden)return null;
 const copy=crisisCopyFor({kind,excerpt:'',...(about?{about}:{})});
 return <section className="crisis" aria-labelledby={id}>
  <h2 id={id}>{copy.heading}</h2><p>{copy.body}</p>
  <ul>{crisisResourcesFor(kind).map(r=><li key={r.id}><strong>{r.name}</strong><span className="crisis-region">{r.region}</span><p>{r.detail}</p><span className="crisis-links">{r.links.map(l=><a key={l.href} href={l.href} {...(l.href.startsWith('https:')?{target:'_blank',rel:'noopener noreferrer'}:{})}>{l.label}{l.href.startsWith('https:')&&<span className="visually-hidden"> (opens in a new tab)</span>}</a>)}</span></li>)}</ul>
  <p className="note">{privacy}</p>
  <button className="link-button" onClick={()=>setHidden(true)}>Hide this note</button>
 </section>;
}

/** `inferred` marks a value a deterministic rule applied (never Jev's own confident choice), with the reason in plain words. */
export interface Chip {key:string;label:string;removable:boolean;editable:boolean;tentative?:boolean;inferred?:string;options?:Array<[string,string]>;onRemove?:()=>void;onPick?:(id:string)=>void;action?:()=>void;}
export function Chips({chips,editing,setEditing,label='What we understood',onReset,resetLabel}:{chips:Chip[];editing:string|null;setEditing:(key:string|null)=>void;label?:string;onReset?:(()=>void)|undefined;resetLabel?:string}) {
 const open=chips.find(c=>c.key===editing);
 const close=(focus=true)=>{const key=editing;setEditing(null);if(focus&&key)requestAnimationFrame(()=>document.querySelector<HTMLButtonElement>(`[data-chip="${CSS.escape(key)}"]`)?.focus());};
 if(!chips.length&&!onReset)return null;
 return <div className="chips" role="group" aria-label={label}>
  {chips.map(c=>c.action?<button key={c.key} className="chip chip-action" data-chip={c.key} onClick={c.action}>{c.label}</button>:<span className={`chip ${c.tentative?'chip-tentative':''} ${c.inferred?'chip-inferred':''} ${editing===c.key?'chip-open':''}`} key={c.key} title={c.inferred}>
   {c.editable?<button className="chip-main" data-chip={c.key} aria-expanded={editing===c.key} aria-haspopup="dialog" onClick={()=>setEditing(editing===c.key?null:c.key)}>
    {c.inferred&&<span className="chip-inferred-tag">Inferred</span>}{c.label}{c.tentative&&<span className="chip-q" aria-hidden="true">?</span>}<span className="visually-hidden">{c.inferred?`. ${c.inferred}`:''}{c.tentative?', uncertain: choose to confirm or change':', change'}</span><Icon name="chevron" size={14}/>
   </button>:<span className="chip-main static" data-chip={c.key} tabIndex={-1}>{c.inferred&&<span className="chip-inferred-tag">Inferred</span>}{c.label}{c.inferred&&<span className="visually-hidden">. {c.inferred}</span>}</span>}
   {c.removable&&<button className="chip-x" aria-label={`Remove ${c.label}`} onClick={c.onRemove}><Icon name="close" size={14}/></button>}
  </span>)}
  {onReset&&<button className="link-button chips-reset" onClick={onReset}>{resetLabel??'Reset my edits'}</button>}
  {open&&open.options&&open.onPick&&<ChipEditor chip={open} close={close}/>}
 </div>;
}

function ChipEditor({chip,close}:{chip:Chip;close:(focus?:boolean)=>void}) {
 const [filter,setFilter]=useState(''),first=useRef<HTMLButtonElement|HTMLInputElement>(null),box=useRef<HTMLDivElement>(null);
 const options=chip.options!,long=options.length>8;
 const shown=options.filter(([,label])=>!filter||label.toLowerCase().includes(filter.toLowerCase())).slice(0,60);
 useEffect(()=>{first.current?.focus();},[]);
 useEffect(()=>{const outside=(event:MouseEvent)=>{if(box.current&&!box.current.contains(event.target as Node)&&!(event.target as Element).closest?.('.chip-open'))close(false);};document.addEventListener('mousedown',outside);return ()=>document.removeEventListener('mousedown',outside);},[close]);
 const keys=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.key==='Escape'){event.preventDefault();close();return;}
  if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return;
  const buttons=[...(box.current?.querySelectorAll<HTMLButtonElement>('.chip-option')??[])];if(!buttons.length)return;
  event.preventDefault();const at=buttons.indexOf(document.activeElement as HTMLButtonElement);
  buttons[(at+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
 };
 return <div className="chip-editor" ref={box} role="dialog" aria-label={`Change ${chip.label}`} onKeyDown={keys}>
  {long&&<input ref={first as RefObject<HTMLInputElement>} className="chip-filter" type="search" placeholder="Filter" aria-label="Filter choices" value={filter} onChange={event=>setFilter(event.target.value)}/>}
  <div className="chip-options">{shown.map(([id,label],index)=><button key={id} className="chip-option" ref={!long&&index===0?first as RefObject<HTMLButtonElement>:undefined} onClick={()=>{chip.onPick!(id);close(false);}}>{label}</button>)}{!shown.length&&<span className="note">No matching choice.</span>}</div>
  <button className="link-button" onClick={()=>close()}>Close</button>
 </div>;
}

const SITUATION:Record<string,string>={unsupported:'This is not something the evidence here can answer',cannot_safely_answer:'This is not something the evidence here can answer',unlisted:'We don’t list that employer',degraded:'Jev didn’t read this question'};
/**
 * A held reply's questions (see `heldQuestions`): a meaning fork first, whatever its tier, and never a generic view
 * question in its place. `questionNotes` are the interpretation's own notes about the question (they stay above the
 * choices); the reply's other notices describe the view it holds back, which is not shown, so they follow the choices.
 */
export function Clarify({forks,notices,questionNotes=[],rephrasings,onChoose,onRephrase,headingRef,keepNote,situation}:{forks:ForkView[];notices:string[];questionNotes?:string[];rephrasings?:string[];onChoose:(field:string,id:string)=>void;onRephrase?:(text:string)=>void;headingRef:RefObject<HTMLHeadingElement|null>;keepNote:boolean;situation?:string}) {
 const ask=heldQuestions(forks);
 if(!ask.length&&!notices.length&&!rephrasings?.length)return null;
 const title=ask[0]?questionOf(ask[0]):SITUATION[situation??'']??'About your question';
 const lead=ask.length?notices.filter(n=>questionNotes.includes(n)):notices,after=ask.length?notices.filter(n=>!questionNotes.includes(n)):[];
 return <section className="clarify" aria-labelledby="clarify-title">
  <h2 id="clarify-title" ref={headingRef} tabIndex={-1}>{title}</h2>
  {lead.map(n=><p key={n}>{n}</p>)}
  {ask.map((f,index)=><div className={`clarify-fork ${f.kind==='meaning'?'is-meaning':''}`} key={`${f.field}:${index}`}>
   {index>0&&<h3>{questionOf(f)}</h3>}
   <p className="note">{f.kind==='meaning'?'Your question can mean different things, and each meaning is a different view of the evidence.':'We need your choice.'}{keepNote?' Your last view stays in place until you pick.':''}</p>
   <div className="option-row">{f.options.map(o=><button key={o.id} className="option" onClick={()=>onChoose(f.field,o.id)}><span>{o.label}</span>{o.share>0&&<span className="option-prob num">{probabilityLabel(o.share)}</span>}</button>)}</div>
  </div>)}
  {ask.some(f=>f.options.some(o=>o.share>0))&&<p className="note clarify-prob">Model probability is how sure the model is about your wording. It says nothing about the evidence.</p>}
  {after.length>0&&<div className="clarify-after">{after.map(n=><p className="note" key={n}>{n}</p>)}</div>}
  {rephrasings&&rephrasings.length>0&&onRephrase&&<div className="option-row">{rephrasings.map(r=><button key={r} className="pill-button" onClick={()=>onRephrase(r)}>{r}</button>)}</div>}
 </section>;
}

/**
 * Tentative readings: already applied and shown, with the alternatives one tap away. The applied option is recognised by
 * its typed value when the page knows it (a meaning's label differs from the topic chip's), otherwise by its label.
 */
export function Tentative({forks,current,currentId,onChoose}:{forks:ForkView[];current:(field:string)=>string|null;currentId?:(field:string)=>string|null;onChoose:(field:string,id:string)=>void}) {
 const applied=(f:ForkView)=>{const id=currentId?.(f.field);return f.options.find(o=>id!=null&&o.id===id)??f.options.find(o=>o.label===current(f.field))??null;};
 const alternatives=(f:ForkView)=>{const now=applied(f);return f.options.filter(o=>o!==now&&o.label!==current(f.field)).slice(0,4);};
 // A meaning first; a fork with nothing left to offer is not shown.
 const list=tentativeForks(forks,alternatives);if(!list.length)return null;
 return <div className="tentative">{list.map((f,index)=><div key={`${f.field}:${index}`} className={`tentative-row ${f.kind==='meaning'?'is-meaning':''}`}>
  <span>{f.kind==='meaning'?'Read as':'Showing'} <strong>{applied(f)?.label??current(f.field)??'our best reading'}</strong>{f.kind==='meaning'&&applied(f)&&applied(f)!.share>0?<span className="option-prob num"> {probabilityLabel(applied(f)!.share)}</span>:null}. Or did you mean</span>
  {alternatives(f).map(o=><button key={o.id} className="pill-button" onClick={()=>onChoose(f.field,o.id)}>{o.label}{o.share>0&&<span className="option-prob num">{probabilityLabel(o.share)}</span>}</button>)}
 </div>)}
  {list.some(f=>alternatives(f).some(o=>o.share>0))&&<p className="note">Model probability is how sure the model is about your wording. It says nothing about the evidence.</p>}
 </div>;
}
