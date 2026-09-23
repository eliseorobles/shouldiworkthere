import {useEffect,useRef} from 'react';
import {formatValue,TOPIC_LABELS,isFictional,isCommunity,attachedDomains,displayName,COMMUNITY_LABEL,type Metric,type MetricSeriesPoint,type TestimonyItem,type CorroborationCluster,type CohortCell,type Named} from '../api.ts';
import {FictionTag,Icon,Meta,Note,ProvenanceTag,Testimony} from './parts.tsx';

type Point=Pick<MetricSeriesPoint,'period'|'value'|'n'|'releaseId'|'releaseBatch'|'bands'|'median'>;

/**
 * What the lens opens on. `cell` narrows it to one published number from the group-and-company view: that cell names its
 * own group, release, verification and provenance, which can differ from the metric the view lists (the whole-company
 * cell is a different release from the group's metric).
 */
export interface LensTarget {metric:Metric;company:Named&{kind:string};testimony:TestimonyItem[];clusters:CorroborationCluster[];cohortLabel?:string;cell?:CohortCell&{side:'group'|'company'};}

/** Accounts linked to a measure: the server's related ids when present, otherwise accounts sharing its topic. Never unrelated padding. */
export function relatedAccounts(target:LensTarget):{accounts:TestimonyItem[];clusters:CorroborationCluster[];basis:'linked'|'topic'|'none'|'other_group'} {
 const {metric,testimony,clusters}=target;
 // The accounts on this page are the selected group's; none belong beside the whole-company number.
 if(target.cell?.side==='company')return {accounts:[],clusters:[],basis:'other_group'};
 if(metric.related) {
  const accounts=metric.related.testimonyIds.map(id=>testimony.find(t=>t.id===id)).filter((t):t is TestimonyItem=>!!t&&!t.withheld);
  return {accounts,clusters:clusters.filter(c=>metric.related!.clusterKeys.includes(c.clusterKey)),basis:'linked'};
 }
 if(!metric.topic)return {accounts:[],clusters:[],basis:'none'};
 return {accounts:testimony.filter(t=>!t.withheld&&t.topicIds.includes(metric.topic!)).slice(0,4),clusters:clusters.filter(c=>c.topics.includes(metric.topic!)),basis:'topic'};
}

export function EvidenceLens({target,close,onChallenge}:{target:LensTarget;close:()=>void;onChallenge?:(id:string)=>void}) {
 const ref=useRef<HTMLDialogElement>(null),{metric,company,cell}=target,fictional=isFictional(company);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const dialog=ref.current;if(dialog&&!dialog.open)dialog.showModal();return ()=>{if(previous?.isConnected)previous.focus();};},[]);
 const distribution=metric.responseType==='distribution';
 // A cell shows exactly its own release; otherwise the metric's latest point and every release of it.
 const series:Point[]=cell?[{period:cell.period,value:cell.value,n:cell.n,releaseId:cell.releaseId,releaseBatch:''}]:metric.series;
 const latest:Point|null=cell?series[0]!:metric.latest;
 const related=relatedAccounts(target);
 const linkedCount=metric.related?.testimonyIds.length??0;
 const heading=related.basis==='linked'?'Linked accounts':related.basis==='other_group'?'Accounts':metric.topic?`Accounts about ${(TOPIC_LABELS[metric.topic]??metric.topic).toLowerCase()}`:'Related accounts';
 const empty=related.basis==='none'?'This measure has no topic mapping, so no accounts are shown beside it.'
  :related.basis==='other_group'?`The accounts in this view are filtered to ${target.cohortLabel??'the selected group'}, so none are listed beside the whole-company number.`
  :related.basis==='linked'&&linkedCount>0?'The linked accounts are not on the pages loaded so far. Load more accounts in the Accounts view to read them.'
  :'No published account on this page is linked to this measure.';
 return <dialog className="lens" ref={ref} onCancel={event=>{event.preventDefault();close();}} aria-labelledby="lens-title" onClick={event=>{if(event.target===ref.current)close();}}>
  <div className="lens-inner">
   <div className="lens-head"><span className="lens-kicker"><Icon name="lens" size={16}/>Evidence lens</span><button className="icon-button" onClick={close} aria-label="Close the evidence lens"><Icon name="close"/></button></div>
   <h2 id="lens-title">{metric.label}</h2>
   <p className="lens-company">{displayName(company)}{cell?.cohortLabel?<span className="lens-group">{cell.cohortLabel}</span>:null}{fictional&&<FictionTag/>}{isCommunity(company)&&<span className="tag tag-community">{COMMUNITY_LABEL}</span>}</p>
   {latest&&<p className="lens-value num">{distribution?(latest.median!=null?`Median ${formatValue(latest.median,metric.unit)}`:'Distribution'):formatValue(latest.value,metric.unit)}</p>}
   {latest&&<Meta n={latest.n} period={latest.period}/>}
   <dl className="lens-facts">
    <div><dt>Question asked</dt><dd>“{metric.question}”</dd></div>
    <div><dt>Group</dt><dd>{cell?.cohortLabel??metric.cohortLabel}</dd></div>
    <div><dt>Method</dt><dd>{metric.methodNote}</dd></div>
    <div><dt>Verification</dt><dd>{cell?.verificationMethod??metric.verificationMethod}</dd></div>
    <div><dt>Provenance</dt><dd><ProvenanceTag provenance={cell?.provenance??metric.provenance}/></dd></div>
    <div><dt>Exclusions</dt><dd>{metric.exclusions??'Missing answers are excluded. Contributors choose to take part, so this is not a census.'}</dd></div>
   </dl>
   <h3>{cell?'This release':'Every release'}</h3>
   <div className="table-scroll"><table className="ledger">
    <caption className="visually-hidden">{cell?`The release behind ${metric.label}, ${cell.cohortLabel??''}`:`Releases of ${metric.label}`}</caption>
    <thead><tr><th scope="col">Period</th><th scope="col">Result</th><th scope="col">n</th><th scope="col">Release</th></tr></thead>
    <tbody>{series.map(p=><tr key={p.releaseId||p.period}>
     <th scope="row">{p.period}</th>
     <td>{distribution?<>{p.bands?.map(b=><span className="band-inline" key={b.band}>{b.band} <span className="num">{Math.round(b.share)}%</span></span>)}{p.median!=null&&<span className="band-inline">Median <span className="num">{formatValue(p.median,metric.unit)}</span></span>}</>:<span className="num">{formatValue(p.value,metric.unit)}</span>}</td>
     <td className="num">{p.n}</td>
     <td><code>{p.releaseId}</code>{p.releaseBatch&&<span className="release-batch">Batch <code>{p.releaseBatch}</code></span>}</td>
    </tr>)}</tbody>
   </table></div>
   <Note>{(cell?.provenance??metric.provenance)==='fixture'
    ?'These illustrative numbers were written as demonstration data, not collected from anyone. For real employers, numbers come only from explicit questionnaire answers. Written accounts are context; they are never counted as the votes behind a number.'
    :'Numbers come from explicit questionnaire answers. Written accounts are context; they are never counted as the votes behind a number.'}</Note>
   <h3>{heading}</h3>
   {related.clusters.map(c=><p className="lens-cluster" key={c.clusterKey}>Recurring experience: {c.summary} <span className="meta"><span className="num">{c.reporterCount} distinct sources</span></span></p>)}
   {related.accounts.length?<>
    {related.basis==='topic'&&<Note>Accounts on this page that share the measure’s topic. They are context, not the answers behind the number.</Note>}
    {related.accounts.map(t=><Testimony key={t.id} item={t} fictional={fictional} attached={attachedDomains(company)} {...(onChallenge?{onChallenge}:{})}/>)}
    {related.basis==='linked'&&related.accounts.length<linkedCount&&<Note>More linked accounts are on pages not loaded yet.</Note>}
   </>:<Note>{empty}</Note>}
   <button className="secondary-button lens-back" onClick={close}>Back to the record</button>
  </div>
 </dialog>;
}
