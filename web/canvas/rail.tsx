import {useId} from 'react';
import {isFictional,type CanvasResponse,type FaqEntry} from '../api.ts';
import {Note} from './parts.tsx';

const PROVIDERS:Record<string,string>={'workers-ai':'Cloudflare Workers AI','typesafe-api':'TypeSafe API'};
const FALLBACKS:Record<string,string>={native_failed:'the primary provider failed',circuit_open:'the primary provider was paused after repeated failures',native_unavailable:'the primary provider is not configured'};

export function Rail({data,countOptIn,setCountOptIn,interestCounted,onFaq}:{data:CanvasResponse;countOptIn:boolean;setCountOptIn:(v:boolean)=>void;interestCounted:string|boolean;onFaq:(entry:FaqEntry|FaqEntry['followUps'][number],label:string)=>void}) {
 const e=data.evidence,i=data.interpretation,optId=useId();
 if(!e)return null;
 const fictional=isFictional(e.company);
 return <aside className="rail" aria-label="About this view">
  <section>
   <h3>About this record</h3>
   <dl className="rail-facts">
    <div><dt>Group shown</dt><dd>{e.cohortLabel}</dd></div>
    <div><dt>Reporting periods</dt><dd>{e.coverage.firstPeriod?(e.coverage.firstPeriod===e.coverage.lastPeriod?e.coverage.firstPeriod:`${e.coverage.firstPeriod} to ${e.coverage.lastPeriod}`):'None published'}</dd></div>
    <div><dt>Largest single-question sample</dt><dd className="num">{e.coverage.verifiedContributors?`n = ${e.coverage.verifiedContributors}`:'None published'}</dd></div>
   </dl>
   <Note>{fictional?`${e.company.name} is fictional. Every number and account on this page is demonstration data.`:'Contributors choose to take part, so this is not a census of the workforce.'}</Note>
  </section>
  <section>
   <h3>How your question was read</h3>
   {i.degraded?<p className="rail-status">Live understanding unavailable. Nothing was inferred; manual controls still work.</p>
   :i.source==='jev'?<dl className="rail-facts">
    <div><dt>Model</dt><dd>{i.model}</dd></div>
    <div><dt>Provider</dt><dd>{PROVIDERS[i.provider]??i.provider}{i.keySource?` (key: ${i.keySource})`:''}</dd></div>
    <div><dt>Prompt</dt><dd><code>{i.promptVersion}</code></dd></div>
    {i.providerFallback&&<div><dt>Fallback</dt><dd>Used because {FALLBACKS[i.providerFallback]??i.providerFallback}</dd></div>}
   </dl>:<p className="rail-status">Your controls chose this view. No model was used.</p>}
   <Note>Model confidence is not evidence confidence.</Note>
  </section>
  <section className="faq">
   <h3>Questions with evidence here</h3>
   {e.trail.length?<ul className="faq-list">{e.trail.map(entry=><li key={entry.specId}>
    <button className="faq-question" onClick={()=>onFaq(entry,entry.question)}>{entry.question}</button>
    {entry.followUps.length>0&&<div className="faq-follow">{entry.followUps.slice(0,3).map(f=><button key={f.specId} className="faq-followup" onClick={()=>onFaq(f,f.question)}>{f.question}</button>)}</div>}
   </li>)}</ul>:<Note>No evidence-backed questions yet.</Note>}
   <div className="opt-in"><input id={optId} type="checkbox" checked={countOptIn} onChange={event=>setCountOptIn(event.target.checked)}/><label htmlFor={optId}>Count questions I type and submit toward this list. Only a standard question id, the employer and the quarter are counted; my wording is never kept.</label></div>
   {interestCounted&&<p className="rail-ack" role="status">{typeof interestCounted==='string'?<>Counted once toward the standard question “{interestCounted}”.</>:'Counted once for this question.'} Your wording was not kept.</p>}
  </section>
  <a className="rail-link" href="/privacy">Read how search and privacy work</a>
 </aside>;
}
