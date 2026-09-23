import {useId,useState,type ReactNode} from 'react';
import {formatValue,sparkPath,PROVENANCE_LABELS,LAYER_LABELS,FICTION_LABEL,humanKey,type Metric,type TestimonyItem,type Provenance,type DistributionBand} from '../api.ts';
import {shareView,absoluteUrl} from '../share.ts';

const ICONS:Record<string,string>={
 send:'M12 19V5M5.5 11.5 12 5l6.5 6.5',close:'M6 6l12 12M18 6 6 18',share:'M12 15V4m0 0L8 8m4-4 4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5',
 sun:'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
 moon:'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',chevron:'m6 9 6 6 6-6',lens:'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4',
 lock:'M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5M6 10.5h12a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7.5a1 1 0 0 1 1-1Zm6 4v2',arrow:'M5 12h14m-5-5 5 5-5 5',back:'M19 12H5m5-5-5 5 5 5',
};
export function Icon({name,size=18}:{name:keyof typeof ICONS|string;size?:number}) {
 return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={ICONS[name]??''} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
export function FictionTag({children=FICTION_LABEL}:{children?:ReactNode}) {return <span className="tag tag-fiction">{children}</span>;}
export function ProvenanceTag({provenance}:{provenance:Provenance}) {return <span className={`tag tag-${provenance}`}>{PROVENANCE_LABELS[provenance]}</span>;}
/** Sample size and period as separate items; never a dot-joined string. */
export function Meta({n,period,children}:{n?:number|null;period?:string|null;children?:ReactNode}) {
 return <span className="meta">{n!=null&&<span className="num">n = {n}</span>}{period&&<span>{period}</span>}{children}</span>;
}
export function Note({children}:{children:ReactNode}) {return <p className="note">{children}</p>;}

export function Sparkline({metric}:{metric:Metric}) {
 const points=metric.series.filter(p=>p.value!==null);
 if(metric.responseType==='distribution'||!points.length)return null;
 const values=points.map(p=>p.value as number),path=points.length>1?sparkPath(values):null;
 const label=`${metric.label}: ${points.map(p=>`${p.period}, ${formatValue(p.value,metric.unit)}, n = ${p.n}`).join('; ')}.`;
 const min=Math.min(...values),max=Math.max(...values),span=max-min||1;
 const at=(v:number,index:number)=>[8+index*(304)/Math.max(1,points.length-1),82-(v-min)/span*74] as const;
 return <figure className="spark"><svg viewBox="0 0 320 90" role="img" aria-label={label} preserveAspectRatio="none">
  <path className="spark-guide" d="M8 8H312M8 45H312M8 82H312"/>
  {path?<path className="spark-line" d={path}/>:null}
  {points.map((p,index)=>{const [x,y]=points.length>1?at(p.value as number,index):[160,45];return <circle key={p.period} className={index===points.length-1?'spark-dot last':'spark-dot'} cx={x} cy={y} r={index===points.length-1?4:2.5}/>;})}
 </svg><figcaption><span>{points[0]!.period}</span>{points.length>1&&<span>{points.at(-1)!.period}</span>}</figcaption></figure>;
}
export function Bands({bands,label}:{bands:DistributionBand[];label?:string}) {
 return <div className="bands" role="list" aria-label={label}>{bands.map(b=><div className="band" role="listitem" key={b.band}><span className="band-name">{b.band}</span><span className="band-track" aria-hidden="true"><i style={{width:`${Math.max(0,Math.min(100,b.share))}%`}}/></span><strong className="num">{Math.round(b.share)}%</strong></div>)}</div>;
}

export function MetricCard({metric,fictional,onOpen}:{metric:Metric;fictional:boolean;onOpen:()=>void}) {
 const latest=metric.latest;if(!latest)return null;
 const distribution=metric.responseType==='distribution';
 const worse=metric.delta!==null&&metric.delta!==0&&metric.direction!=='neutral'&&((metric.delta<0)===(metric.direction==='higher_is_better'));
 return <button className="metric-card" onClick={onOpen}>
  <span className="metric-label">{metric.label}</span>
  <span className="metric-value num">{distribution?(latest.median!=null?`Median ${formatValue(latest.median,metric.unit)}`:'Distribution'):formatValue(latest.value,metric.unit)}
   {metric.delta!==null&&!distribution&&<small className={worse?'delta delta-worse':'delta'}>{metric.delta>0?'+':metric.delta<0?'−':''}{Number(Math.abs(metric.delta).toFixed(1))}{metric.unit==='percent'?' pts':metric.unit==='hours'?' h':metric.unit==='years'?' yrs':''}{metric.deltaPeriod?` since ${metric.deltaPeriod}`:''}</small>}
  </span>
  {distribution&&latest.bands?<Bands bands={latest.bands} label={`${metric.label}, ${latest.period}`}/>:<Sparkline metric={metric}/>}
  <span className="metric-foot"><Meta n={latest.n} period={latest.period}/>{fictional&&<FictionTag>Illustrative</FictionTag>}<span className="metric-open">Open the evidence<Icon name="lens" size={15}/></span></span>
 </button>;
}

const READING_VALUES:Record<string,string>={positive:'Positive',negative:'Negative',mixed:'Mixed',unknown:'Unknown'};
/**
 * "Verified with a work mailbox at acme.com", or "at one of acme.com and acme.co.uk" for an employer with several domains.
 * A domain someone attached to one of our listings (`attached`) says so beside it.
 */
export function verifiedAt(domains:readonly string[],attached:readonly string[]=[]):ReactNode {
 const shown=domains.slice(0,4).map((d,index)=><span key={d}>{index>0?(index===Math.min(domains.length,4)-1?' and ':', '):''}<span className="tag-domain">{d}</span>{attached.includes(d)?' (added by the community)':''}</span>);
 return <>Verified with a work mailbox at {domains.length>1?'one of ':''}{shown}{domains.length>4?`, and ${domains.length-4} more`:''}</>;
}
export function Testimony({item,fictional,attached=[],onChallenge}:{item:TestimonyItem;fictional:boolean;attached?:readonly string[];onChallenge?:(id:string)=>void}) {
 const [open,setOpen]=useState(false),readingId=useId();
 return <article className={`account layer-${item.layer}`} id={`account-${item.id}`}>
  <div className="account-meta">
   <span className={`layer-tag layer-${item.layer}`}>{LAYER_LABELS[item.layer]??item.layer}</span>
   {item.period&&<span>Reporting period {item.period}</span>}
   <span>Published {item.publishedAt}</span>
   <ProvenanceTag provenance={item.provenance}/>
   {fictional&&item.provenance!=='fixture'&&<FictionTag>Fictional employer</FictionTag>}
  </div>
  {item.withheld?<p className="account-withheld">{item.body}</p>:<blockquote>{item.body}</blockquote>}
  {item.eventLabel&&!item.withheld&&<p className="account-event">About the {item.eventLabel}</p>}
  <div className="account-foot">
   <span>{item.verificationClass}</span>
   {/* A work-mailbox verified account names the employer's verification domains: the contributor's mailbox was at one of them. */}
   {item.verificationDomains?.length?<span>{verifiedAt(item.verificationDomains,attached)}</span>:null}
   {item.relevance!==undefined&&<span>Model relevance {Math.round(item.relevance*100)}%, how closely it matches your question, not whether it is true</span>}
  </div>
  <div className="account-actions">
   {item.reading&&!item.withheld&&<button className="link-button" aria-expanded={open} aria-controls={readingId} onClick={()=>setOpen(v=>!v)}>{open?'Hide the model reading':'Show the model reading'}</button>}
   {onChallenge&&!item.withheld&&<button className="link-button" onClick={()=>onChallenge(item.id)}>Challenge under a published rule</button>}
   <code className="account-id" title="Public account id">{item.id}</code>
  </div>
  {open&&item.reading&&<div className="reading" id={readingId}>
   <dl>{Object.entries(item.reading.dimensions).map(([key,d])=><div key={key}><dt>{humanKey(key)}</dt><dd>{READING_VALUES[d.value]??d.value}{d.value!=='unknown'&&<span className="num"> {Math.round(d.confidence*100)}%</span>}</dd></div>)}</dl>
   <Note>Model reading of this text, not votes or findings of fact. Below 60% confidence it reads unknown. {item.reading.model}, prompt {item.reading.promptVersion}.</Note>
  </div>}
 </article>;
}

export function ShareButton({path,title,text,label='Share this view'}:{path:string;title:string;text?:string;label?:string}) {
 const [status,setStatus]=useState<{kind:'copied'|'manual'|'';url:string}>({kind:'',url:''});
 const share=async()=>{const url=absoluteUrl(path);const outcome=await shareView({url,title,...(text?{text}:{})});setStatus({kind:outcome==='copied'?'copied':outcome==='unavailable'?'manual':'',url});};
 return <span className="share">
  <button className="pill-button" onClick={()=>void share()}><Icon name="share" size={16}/>{label}</button>
  <span className="share-status" role="status">{status.kind==='copied'?'Link copied. It holds only the view, never your question.':''}</span>
  {status.kind==='manual'&&<label className="share-manual">Copy this link<input readOnly value={status.url} onFocus={event=>event.currentTarget.select()}/></label>}
 </span>;
}
