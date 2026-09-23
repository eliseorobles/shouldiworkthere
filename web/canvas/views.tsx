import {useState,type ReactNode,type RefObject} from 'react';
import {formatValue,isFictional,isCommunity,attachedDomains,publicationRules,accountsRule,aggregatesRule,displayName,employerLabel,withListing,domainOf,listingOpen,listingPowBits,COMMUNITY_LABEL,LAYER_LABELS,TOPIC_LABELS,type CanvasResponse,type ComparisonCell,type ComparisonTable,type DiscoveryRow,type DirectoryCompany,type EvidencePayload,type Metric,type SiteConfig,type ViewId,type CohortCell,type AccountReading,type PublicationRules,type Overrides,type Named} from '../api.ts';
import {AddEmployer} from '../add-employer.tsx';
import {policy} from '../../shared/policy.ts';
import {BRAND} from '../../shared/brand.ts';
import {Bands,FictionTag,Icon,Meta,MetricCard,Note,ProvenanceTag,ShareButton,Testimony} from './parts.tsx';

export interface CanvasActions {
 /** Opens the lens on a metric, or on one published cell of the group-and-company view when `cell` is given. */
 openMetric(metric:Metric,source:Pick<EvidencePayload,'company'|'testimony'|'clusters'|'cohortLabel'>,cell?:CohortCell&{side:'group'|'company'}):void;
 /** Opens the lens on a whole-company cell whose measure the group view does not list, from the whole-company record. */
 openCompanyCell?(key:string,source:Pick<EvidencePayload,'company'|'testimony'|'clusters'|'cohortLabel'>,cell:CohortCell&{side:'company'}):void;
 setView(view:ViewId):void;
 setField(key:string,value:Overrides[string]):void;
 go(overrides:Overrides,label:string):void;
 loadMore():void;
 challenge?:(id:string)=>void;
}
const plural=(n:number,one:string,many=`${one}s`)=>`${n} ${n===1?one:many}`;
/** A community listing's label beside its name (the name itself is written with displayName, domain included). */
const CommunityTag=({company}:{company:Named})=>isCommunity(company)?<span className="tag tag-community">{COMMUNITY_LABEL}</span>:null;

/**
 * `directory` names each employer as the directory lists it (a community listing with its domain and label, where a reply
 * leaves them out); `onListed` receives a domain added from a record that had none.
 */
export function Canvas({data,config,act,loadingMore,headingRef,verifiable,directory=[],onListed}:{data:CanvasResponse;config:SiteConfig|null;act:CanvasActions;loadingMore:boolean;headingRef:RefObject<HTMLHeadingElement|null>;verifiable?:(slug:string)=>boolean|null|'loading';directory?:ReadonlyArray<DirectoryCompany>;onListed?:(company:DirectoryCompany)=>void}) {
 const e=data.evidence;
 if(!e||data.view==='discovery')return <Discovery data={data} act={act} directory={directory}/>;
 if(isRealEmpty(data))return <RealEmpty company={withListing(e.company,directory)} config={config} headingRef={headingRef} verifiable={verifiable?.(e.company.slug)??null} directory={directory} {...(onListed?{onListed}:{})}/>;
 if(isEmptyRecord(data))return <EmptyRecord data={data} act={act}/>;
 switch(data.view) {
  case 'compare':return <Compare data={data} act={act} directory={directory}/>;
  case 'timeline':return <Timeline e={e} act={act}/>;
  case 'distribution':return <Distribution e={e} act={act}/>;
  case 'clusters':return <Clusters e={e} act={act}/>;
  case 'reader':return <Reader e={e} act={act} loading={loadingMore}/>;
  case 'cohort':return <Cohort e={e} act={act}/>;
  default:return <Overview e={e} act={act}/>;
 }
}

function Suppressed({e}:{e:EvidencePayload}) {
 if(!e.suppressed.length)return null;
 return <details className="suppressed"><summary>{plural(e.suppressed.length,'result')} withheld to protect small groups</summary><ul>{e.suppressed.map(s=><li key={`${s.metricKey}:${s.period}`}>{s.metricLabel}, {s.period}: {s.reason==='complementary_suppression'?'withheld so it cannot be worked out from other releases':'fewer contributors than the minimum'}</li>)}</ul></details>;
}

function Readings({rows}:{rows:AccountReading[]}) {
 if(!rows.length)return null;
 return <section className="readings" aria-labelledby="readings-title">
  <h3 id="readings-title">How written accounts read</h3>
  <Note>A model reading of published written accounts, not votes. Only accounts it read with confidence are counted, and any group under five accounts is left out.</Note>
  {rows.map(r=>{const w=(n:number)=>`${r.accounts?n/r.accounts*100:0}%`;return <div className="reading-row" key={r.dimension}>
   <span className="reading-name">{r.dimension.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase())}</span>
   <span className="reading-bar" aria-hidden="true"><i className="pos" style={{width:w(r.positive)}}/><i className="mix" style={{width:w(r.mixed)}}/><i className="neg" style={{width:w(r.negative)}}/></span>
   <span className="reading-counts">{r.accounts} accounts: {r.positive} positive, {r.mixed} mixed, {r.negative} negative</span>
  </div>;})}
 </section>;
}

function Overview({e,act}:{e:EvidencePayload;act:CanvasActions}) {
 const fictional=isFictional(e.company);
 return <>
  {e.metrics.length>0&&<div className="metric-grid">{e.metrics.filter(m=>m.latest).slice(0,8).map(m=><MetricCard key={m.key} metric={m} fictional={fictional} onOpen={()=>act.openMetric(m,e)}/>)}</div>}
  <Suppressed e={e}/>
  {e.accountReadings?.length?<Readings rows={e.accountReadings}/>:null}
  {e.testimony.length>0&&<section className="excerpts" aria-labelledby="excerpts-title">
   <div className="section-row"><h3 id="excerpts-title">Behind the numbers</h3><button className="link-button" onClick={()=>act.setView('reader')}>Read every account</button></div>
   {e.testimony.slice(0,2).map(t=><Testimony key={t.id} item={t} fictional={fictional} attached={attachedDomains(e.company)} {...(act.challenge?{onChallenge:act.challenge}:{})}/>)}
  </section>}
 </>;
}

/** Used only when the server sent no comparison table: the union of both sides' measures, aligned on the latest shared period. */
export function fallbackTable(left:EvidencePayload,right:EvidencePayload):ComparisonTable {
 const keys=[...new Map([...left.metrics,...right.metrics].map(m=>[m.key,m])).values()];
 const side=(e:EvidencePayload)=>({company:e.company,cohortLabel:e.cohortLabel,cohortStatus:e.cohortStatus,timeStatus:e.timeStatus});
 const rows=keys.map(m=>{
  const a=left.metrics.find(x=>x.key===m.key),b=right.metrics.find(x=>x.key===m.key);
  const shared=a&&b?a.series.map(p=>p.period).filter(period=>b.series.some(q=>q.period===period)).sort().at(-1)??null:null;
  const cell=(x:Metric|undefined,e:EvidencePayload):ComparisonCell=>{
   if(!x)return e.cohortStatus==='unavailable'?{status:'group_unavailable',cohortLabel:e.cohortLabel}:{status:'not_published'};
   const p=shared?x.series.find(s=>s.period===shared):null;
   if(!p)return {status:'no_matching_period',latestPeriod:x.latest?.period??null};
   return {status:'value',metricKey:x.key,period:p.period,value:p.value,...(p.median!==undefined?{median:p.median}:{}),...(p.bands?{bands:p.bands}:{}),n:p.n,releaseId:p.releaseId,verificationMethod:x.verificationMethod,provenance:x.provenance,cohortLabel:x.cohortLabel};
  };
  return {key:m.key,label:m.label,unit:m.unit,responseType:m.responseType,alignedPeriod:shared,left:cell(a,left),right:cell(b,right)};
 });
 return {left:side(left),right:side(right),rows,notices:[],suppressed:[]};
}

function CompareCell({cell,e,row,act}:{cell:ComparisonCell;e:EvidencePayload;row:ComparisonTable['rows'][number];act:CanvasActions}) {
 const name=e.company.name;
 if(cell.status!=='value') {
  const text=cell.status==='not_published'?`Not published for ${name}`:cell.status==='different_instrument'?`Different questionnaire (${cell.metricKey})`:cell.status==='group_unavailable'?`Group not available at ${name}`:cell.status==='filter_not_applied'?cell.reason:cell.status==='outside_timeframe'?'Not published for the selected period':`No matching period${cell.latestPeriod?` (latest ${cell.latestPeriod})`:''}`;
  return <div className="split-cell unavailable"><span>{text}</span></div>;
 }
 const metric=e.metrics.find(m=>m.key===cell.metricKey);
 const body=<>
  <span className="split-value num">{row.responseType==='distribution'?(cell.median!=null?`Median ${formatValue(cell.median,row.unit)}`:'Distribution'):formatValue(cell.value,row.unit)}</span>
  {row.responseType==='distribution'&&cell.bands&&<Bands bands={cell.bands} label={`${row.label}, ${name}`}/>}
  <Meta n={cell.n} period={cell.period}/>
  <ProvenanceTag provenance={cell.provenance}/>
 </>;
 return metric?<button className="split-cell" onClick={()=>act.openMetric(metric,e)} aria-label={`${row.label} at ${name}: open the evidence`}>{body}</button>:<div className="split-cell">{body}</div>;
}
function Compare({data,act,directory}:{data:CanvasResponse;act:CanvasActions;directory:ReadonlyArray<DirectoryCompany>}) {
 const left=data.evidence!,right=data.compareEvidence;
 if(!right)return <div className="empty"><h3>Choose a second employer</h3><p>Use “Add an employer to compare” above, or name two employers in one question.</p></div>;
 const table=data.comparisonTable??fallbackTable(left,right);
 const head=(e:EvidencePayload,label:string)=>{const c=withListing(e.company,directory);return <div className="split-side">
  <a className="split-name" href={`/c/${c.slug}`}>{displayName(c)}</a>
  <span className="split-tags">{isFictional(c)?<FictionTag/>:<><span className="tag">Real employer</span><CommunityTag company={c}/></>}</span>
  <span className="split-group">{label}</span>
 </div>;};
 return <div className="split" data-view="compare">
  <div className="split-head">{head(left,table.left.cohortLabel)}{head(right,table.right.cohortLabel)}</div>
  {table.rows.length?table.rows.map(row=><div className="split-row" key={row.key}>
   <div className="split-measure"><span>{row.label}</span>{row.alignedPeriod&&<span className="meta"><span>Aligned on {row.alignedPeriod}</span></span>}</div>
   <CompareCell cell={row.left} e={left} row={row} act={act}/>
   <CompareCell cell={row.right} e={right} row={row} act={act}/>
  </div>):<p className="empty">Neither employer has published measures for this selection.</p>}
  {table.notices.map(n=><Note key={n}>{n}</Note>)}
  <Note>Values are compared only on a shared reporting period. A measure missing on one side is marked, never filled in.</Note>
 </div>;
}

function Timeline({e,act}:{e:EvidencePayload;act:CanvasActions}) {
 const fictional=isFictional(e.company),trend=e.metrics.filter(m=>m.series.length>1&&m.responseType!=='distribution');
 const eventButtons=e.events.map(event=><button key={event.id} className={`event-row ${e.selectedEvent?.id===event.id?'selected':''}`} aria-pressed={e.selectedEvent?.id===event.id} onClick={()=>act.go({event:event.id,view:'timeline'},event.label)}>
  <span className="event-date num">{event.occurredOn?.slice(0,7)??'Undated'}</span><span className="event-label">{event.label}</span><span className="event-note">{event.disclosure}</span>
 </button>);
 return <>
  {e.timeStatus==='not_applied'&&<div className="empty"><h3>Before/after not applied</h3><p>Choose one of this employer's documented events. Without a documented, dated event, no before/after results are shown.</p></div>}
  {e.selectedEvent&&<section className="event-focus" aria-labelledby="event-focus-title">
   <h3 id="event-focus-title">Around the {e.selectedEvent.label}</h3>
   {e.comparison?.length?<div className="before-after">{e.comparison.map(row=>{const metric=e.metrics.find(m=>m.key===row.key);return <button key={row.key} className="ba-card" onClick={()=>metric&&act.openMetric(metric,e)} disabled={!metric}>
    <span className="ba-label">{row.label}</span>
    <span className="ba-values"><span><strong className="num">{formatValue(row.before.value,row.unit)}</strong><Meta n={row.before.n} period={row.before.period}/></span><Icon name="arrow"/><span><strong className="num">{formatValue(row.after.value,row.unit)}</strong><Meta n={row.after.n} period={row.after.period}/></span></span>
    <span className="ba-window">Window {row.window.from} to {row.window.to}</span>
    {row.alsoInWindow.length>0&&<span className="ba-also">Window also contains: {row.alsoInWindow.map(x=>x.label).join(', ')}</span>}
   </button>;})}</div>:<Note>No comparable periods exist strictly before and after this event. A period overlapping the event cannot establish a before/after change.</Note>}
   <Note>A change across an event is not proof the event caused it.</Note>
  </section>}
  {e.outsideTimeframe.length>0&&<Note>Also published, outside the selected period: {e.outsideTimeframe.map(k=>e.metrics.find(m=>m.key===k)?.label??k).join(', ')}.</Note>}
  {trend.length>0?<div className="metric-grid">{trend.slice(0,8).map(m=><MetricCard key={m.key} metric={m} fictional={fictional} onOpen={()=>act.openMetric(m,e)}/>)}</div>:<Note>No measure has more than one published period for this selection.</Note>}
  {e.events.length>0&&<section className="events" aria-labelledby="events-title"><h3 id="events-title">Documented events</h3>{eventButtons}</section>}
 </>;
}

function Distribution({e,act}:{e:EvidencePayload;act:CanvasActions}) {
 const d=e.distribution;
 if(!d) {
  const hours=e.metrics.find(m=>m.responseType==='distribution'&&m.topic==='workload');
  return <div className="empty"><h3>No published distribution matches</h3><p>Distributions exist only for questions answered in bands, such as weekly hours. Salary amounts and pay percentiles are not collected.</p>{hours&&<button className="secondary-button" onClick={()=>act.go({topic:'workload',view:'distribution'},hours.label)}>Show {hours.label.toLowerCase()}</button>}</div>;
 }
 const metric=e.metrics.find(m=>m.key===d.metricKey);
 return <section className="bands-panel" aria-labelledby="bands-title">
  <h3 id="bands-title">{d.label}</h3>
  <Meta n={d.n} period={d.period}>{isFictional(e.company)&&<FictionTag>Illustrative</FictionTag>}</Meta>
  {d.median!=null&&<p className="bands-median">Median <strong className="num">{formatValue(d.median,d.unit)}</strong></p>}
  <Bands bands={d.bands} label={`${d.label}, ${d.period}`}/>
  <Note>Each bar uses the same denominator. Release <code>{d.releaseId}</code>.</Note>
  {metric&&<button className="link-button" onClick={()=>act.openMetric(metric,e)}>Open the evidence for this distribution</button>}
 </section>;
}

const CLUSTER_NOUN:Record<string,string>={fixture:'illustrative',sandbox:'sandbox (not employment-verified)',credentialed:'credentialed',unverified:'not employment-verified',mixed:'mixed-provenance'};
function Clusters({e,act}:{e:EvidencePayload;act:CanvasActions}) {
 if(!e.clusters.length)return <div className="empty"><h3>No recurring experience qualifies yet</h3><p>A cluster needs at least five distinct sources whose every pair was judged to describe the same event in independent words. Similar subject matter alone does not qualify.</p><button className="secondary-button" onClick={()=>act.setView('reader')}>Read the underlying accounts</button></div>;
 return <div className="clusters">{e.clusters.map(c=><section className="cluster" key={c.clusterKey} aria-labelledby={`cluster-${c.clusterKey}`}>
  <span className="cluster-kicker">Potentially related</span>
  <h3 id={`cluster-${c.clusterKey}`}>{c.summary}</h3>
  <p className="cluster-count"><strong className="num">{c.reporterCount}</strong> distinct {CLUSTER_NOUN[c.provenance]??''} sources{c.duplicates>0?`, plus ${plural(c.duplicates,'duplicate')} not counted`:''}</p>
  <Meta period={c.firstReport===c.lastReport?c.firstReport:`${c.firstReport} to ${c.lastReport}`}/>
  <Note>Accounts judged to describe the same event. Similarity is not proof of truth or of independent authorship.</Note>
  <ol className="members">{c.members.map(m=><li key={m.id}><details><summary><code>{m.id}</code><span>{m.period??'Period not reported'}</span><span>{LAYER_LABELS[m.layer]??m.layer}</span>{m.duplicateOf&&<span className="dup">Duplicate of <code>{m.duplicateOf}</code>, not counted</span>}</summary><blockquote>{m.body}</blockquote>{act.challenge&&<button className="link-button member-challenge" onClick={()=>act.challenge!(m.id)}>Challenge under a published rule</button>}</details></li>)}</ol>
 </section>)}</div>;
}

function Reader({e,act,loading}:{e:EvidencePayload;act:CanvasActions;loading:boolean}) {
 const fictional=isFictional(e.company),paging=e.testimonyPaging;
 return <>
  <p className="reader-count">{plural(paging.matching,'account')} {paging.matching===1?'matches':'match'} these filters</p>
  {e.testimony.length?<div className="accounts">{e.testimony.map(t=><Testimony key={t.id} item={t} fictional={fictional} attached={attachedDomains(e.company)} {...(act.challenge?{onChallenge:act.challenge}:{})}/>)}</div>:<div className="empty">No published account matches these filters.</div>}
  {paging.hasMore&&<button className="secondary-button load-more" onClick={act.loadMore} disabled={loading} aria-busy={loading}>{loading?'Loading more accounts':'Load more accounts'}</button>}
 </>;
}

function Cohort({e,act}:{e:EvidencePayload;act:CanvasActions}) {
 const rows=e.cohortComparison;
 if(!rows||e.cohortStatus==='all')return <div className="empty"><h3>Choose a published group</h3><p>This view puts one of the employer's published groups next to the whole company, for the same measures and periods.</p>{(e.facets?.length??0)>0&&<div className="option-row">{e.facets!.map(f=><button key={f.label} className="pill-button" onClick={()=>act.go({cohort:f.label,view:'cohort'},f.label)}>{f.label}</button>)}</div>}</div>;
 // Each published cell opens the lens on its own release: the group's and the whole company's are different releases.
 const cell=(r:NonNullable<typeof rows>[number],side:'group'|'company',missing:string)=>{
  const c=side==='group'?r.cohort:r.company;
  if(!c)return <span className="unavailable">{missing}</span>;
  const metric=e.metrics.find(m=>m.key===r.key),who=c.cohortLabel??(side==='group'?e.cohortLabel:'the whole company');
  const body=<><span className="cohort-value num">{formatValue(c.value,r.unit)}</span><Meta n={c.n} period={c.period}/>{c.provenance&&<ProvenanceTag provenance={c.provenance}/>}</>;
  const open=metric?()=>act.openMetric(metric,e,{...c,side}):side==='company'&&act.openCompanyCell?()=>act.openCompanyCell!(r.key,e,{...c,side:'company'}):null;
  return open?<button className="cohort-cell" onClick={open} aria-label={`${r.label}, ${who}: ${formatValue(c.value,r.unit)}, n = ${c.n}, ${c.period}. Open the evidence`}>{body}<span className="cohort-open" aria-hidden="true"><Icon name="lens" size={14}/></span></button>:<div className="cohort-cell static">{body}</div>;
 };
 return <div className="table-scroll cohort-scroll"><table className="cohort-table">
  <caption>{e.cohortLabel} next to the whole company, for the same measures. Each number opens its own release.</caption>
  <thead><tr><th scope="col">Measure</th><th scope="col">{e.cohortLabel}</th><th scope="col">Whole company</th></tr></thead>
  <tbody>{rows.map(r=><tr key={r.key}>
   <th scope="row">{r.label}</th>
   <td>{r.status==='suppressed'?<span className="unavailable">Withheld to protect a small group</span>:cell(r,'group','Not published for this group')}</td>
   <td>{cell(r,'company','Not published')}</td>
  </tr>)}</tbody>
 </table></div>;
}

function EmptyRecord({data,act}:{data:CanvasResponse;act:CanvasActions}) {
 const e=data.evidence!,i=data.interpretation;
 const parents=(e.facets??[]).filter(f=>f.label!==e.cohortLabel&&e.cohortLabel.includes(f.label));
 return <div className="empty large"><h2>Not enough evidence for this combination</h2>
  <p>We will not substitute a different group, period or topic without asking.{isFictional(e.company)?' This employer is a fictional demonstration.':''}</p>
  <div className="option-row">
   {e.cohortStatus!=='all'&&<button className="secondary-button" onClick={()=>act.setField('cohort',null)}>Show the whole company</button>}
   {parents.map(f=><button key={f.label} className="pill-button" onClick={()=>act.setField('cohort',f.label)}>{f.label} only</button>)}
   {e.timeStatus!=='any'&&<button className="secondary-button" onClick={()=>act.setField('timeframe','any')}>Use all periods</button>}
   {i.topic.value!=='other'&&<button className="secondary-button" onClick={()=>act.setField('topic',null)}>Show every topic</button>}
   {i.layer&&<button className="secondary-button" onClick={()=>act.setField('layer',null)}>Show every account type</button>}
  </div>
 </div>;
}

/**
 * Real employer with nothing published. No progress, counts or estimates are shown: there are none to show. The
 * publication rules (from the site's config) are the page's only heading and text, so the heading takes the canvas
 * heading id and focus. A curated employer without a verification domain (Charles Schwab at launch) offers to add its
 * work-email domain where the site takes listings: the server attaches it only when it is confirmed as that employer's
 * corporate domain, and otherwise lists it separately.
 */
export function RealEmpty({company,config,headingRef,verifiable=null,directory=[],onListed}:{company:Named&{kind?:string};config:SiteConfig|null;headingRef?:RefObject<HTMLHeadingElement|null>;verifiable?:boolean|null|'loading';directory?:ReadonlyArray<DirectoryCompany>;onListed?:(company:DirectoryCompany)=>void}) {
 const [adding,setAdding]=useState(false);
 const paused=config?!config.realPublicationEnabled:null,rules=publicationRules(config);
 // Without a work-mailbox key for this employer nothing about it can be verified yet, so no contribution is offered.
 const unset=verifiable===false;
 const canAdd=unset&&!domainOf(company)&&!isCommunity(company)&&listingOpen(config)&&!!onListed;
 return <div className="opens">
  <span className="opens-mark" aria-hidden="true"><Icon name="lock" size={26}/></span>
  <h2 id="canvas-title" ref={headingRef} tabIndex={-1}>Nothing about {displayName(company)} is published yet.</h2>
  <p>{accountsRule(rules)} {aggregatesRule(rules)}</p>
  <p>An empty record says nothing about working there.</p>
  {unset?<p className="note">{domainOf(company)?`Verification with work mailboxes at ${domainOf(company)} isn’t ready yet, so contributions about it can’t be verified or submitted yet.`:'Verification for this employer isn’t set up yet, so contributions about it can’t be verified or submitted yet.'}{canAdd?' Anyone can add its work-email domain.':''}</p>
  :paused&&<p className="note">Real-employer publication is paused for now. Contributions are accepted and held privately, and any not published within {policy.retention.approvedUnbatchedDays} days are erased.</p>}
  <p className="note">Verified means someone controlled a work mailbox at this employer when they verified. It does not prove identity, or that each contribution comes from a different person.</p>
  <div className="option-row">
   {verifiable!==false&&verifiable!=='loading'&&<a className="primary-button" href={`/submit?employer=${encodeURIComponent(company.slug)}`}>Contribute privately</a>}
   {canAdd&&!adding&&<button type="button" className="primary-button" onClick={()=>setAdding(true)}>Add its work-email domain</button>}
   <ShareButton path={`/c/${company.slug}`} title={`${employerLabel(company)} on Should I Work There`} text={`Nothing about ${employerLabel(company)} is published yet. ${accountsRule(rules)}`} label="Invite coworkers"/>
  </div>
  {/* Once opened, the form stays until closed: its result (a domain attached, or a separate listing) is shown in place. */}
  {adding&&<AddEmployer context="record" initialName={company.name} directory={directory} powBits={listingPowBits(config)} rules={rules} onListed={listed=>onListed?.(listed)} onClose={()=>setAdding(false)}/>}
 </div>;
}

/**
 * An employer the directory does not list. Nothing stands in for it: no other employer and no error. `name` is the
 * asker's own words (tidied) or the server's reading of them; it is shown only here, to them. `certain` is false when
 * the match was made against only part of the directory, so absence is not claimed. `onAdd` opens "Add your employer".
 */
export function Unlisted({name,certain,notices,rules,headingRef,onBrowse,onDismiss,onAdd=null,listing=false}:{name:string|null;certain:boolean;notices:string[];rules:PublicationRules;headingRef:RefObject<HTMLHeadingElement|null>;onBrowse:(()=>void)|null;onDismiss:()=>void;onAdd?:(()=>void)|null;listing?:boolean}) {
 const heading=certain?`${name??'That employer'} isn’t in the directory yet`:`We couldn’t match ${name?`“${name}”`:'that'} to an employer we list`;
 return <section className="opens unlisted" aria-labelledby="clarify-title">
  <span className="opens-mark" aria-hidden="true"><Icon name="lens" size={26}/></span>
  <h2 id="clarify-title" ref={headingRef} tabIndex={-1}>{heading}</h2>
  <p>Nothing is shown in its place, and no other employer stands in for it.</p>
  {notices.map(n=><p className="note" key={n}>{n}</p>)}
  <p className="note">A record can open only for an employer in the directory. {listing?'Anyone can add an employer with the domain of its work email; coworkers then verify with a work mailbox there.':'Adding employers isn’t open on this site right now.'} {accountsRule(rules)}</p>
  <div className="option-row">
   {onAdd&&<button className="primary-button" onClick={onAdd}>{certain&&name?`Add ${name} to the directory`:'Add your employer'}</button>}
   {onBrowse?<button className={onAdd?'secondary-button':'primary-button'} onClick={onBrowse}>Browse the directory</button>:<a className={onAdd?'secondary-button':'primary-button'} href="/">Browse the directory</a>}
   <ShareButton path="/" title={BRAND} label="Share this site"/>
  </div>
  <button className="link-button unlisted-dismiss" onClick={onDismiss}>Dismiss</button>
 </section>;
}

function DiscoveryCard({row,act,directory}:{row:DiscoveryRow;act:CanvasActions;directory:ReadonlyArray<DirectoryCompany>}) {
 const fictional=row.kind==='sample',company=withListing(row.company,directory);
 return <article className={`discovery-card ${fictional?'fictional':''}`}>
  <div className="discovery-head"><a href={`/c/${row.company.slug}`} className="discovery-name">{displayName(company)}</a>{row.rank!==null&&<span className="discovery-rank num">#{row.rank}</span>}</div>
  <div className="discovery-tags">{fictional?<FictionTag>{row.kindLabel}</FictionTag>:<span className="tag">{row.kindLabel}</span>}<CommunityTag company={company}/>{row.company.sector&&<span className="tag tag-quiet">{row.company.sector}</span>}</div>
  {row.values.map(v=>{const metric=row.metrics.find(m=>m.key===v.metricKey);const text=v.measure==='median'?`Median ${formatValue(v.value,v.unit)}`:v.measure==='share_agree'?`${formatValue(v.value,'percent')} agree`:formatValue(v.value,v.unit);
   const inner=<><span className="dv-label">{v.label}</span><strong className="num">{text}</strong><Meta n={v.n} period={v.period}>{v.meetsThreshold===true&&<span className="meets">Meets your criterion</span>}{v.meetsThreshold===false&&<span>Does not meet it</span>}</Meta></>;
   return metric?<button key={v.concept} className="dv" onClick={()=>act.openMetric(metric,{company,testimony:[],clusters:[],cohortLabel:v.cohortLabel})}>{inner}</button>:<div key={v.concept} className="dv">{inner}</div>;})}
  {row.missing.length>0&&<ul className="dv-missing">{row.missing.map(m=><li key={m.concept}>{m.label}: {m.reason}</li>)}</ul>}
 </article>;
}
function Discovery({data,act,directory}:{data:CanvasResponse;act:CanvasActions;directory:ReadonlyArray<DirectoryCompany>}) {
 const rows=data.discovery;
 const groups:Array<[string,string,DiscoveryRow[]]>=[['real','Real employers',rows.filter(r=>r.kind==='real')],['sample','Fictional demonstrations',rows.filter(r=>r.kind==='sample')]];
 const section=(title:string,list:DiscoveryRow[])=>list.length?<div className="discovery-group"><h4>{title}</h4><div className="discovery-grid">{list.map(r=><DiscoveryCard key={r.company.slug} row={r} act={act} directory={directory}/>)}</div></div>:null;
 return <div className="discovery">
  {((data.applied?.length??0)>0||(data.unsupported?.length??0)>0)&&<div className="filters-row">
   {data.applied?.map(a=><span className="tag tag-applied" key={a}>Applied: {a}</span>)}
   {data.unsupported?.map(a=><span className="tag tag-unsupported" key={a}>Not applied: {a}</span>)}
  </div>}
  {!rows.length&&<div className="empty"><h3>No published records match</h3><p>Nothing was dropped to force a result. Missing evidence is not a negative rating.</p></div>}
  {groups.map(([kind,title,list])=>list.length?<section className="discovery-section" key={kind} aria-labelledby={`discovery-${kind}`}>
   <h3 id={`discovery-${kind}`}>{title}</h3>
   {kind==='sample'&&<Note>Illustrative data about fictional employers. Not an answer about any real workplace.</Note>}
   {section('Matches',[...list.filter(r=>r.status==='match')].sort((a,b)=>(a.rank??1e9)-(b.rank??1e9)||a.company.name.localeCompare(b.company.name)))}
   {section('Insufficient evidence',list.filter(r=>r.status==='insufficient'))}
  </section>:null)}
 </div>;
}

export function topicLabel(topic:string|null|undefined) {return topic?TOPIC_LABELS[topic]??topic:'';}
const FACTS_SHOWN=6;
/** The deterministic answer's facts: every one opens the lens on the release it came from. */
export function Answer({data,act}:{data:CanvasResponse;act:CanvasActions}):ReactNode {
 const [all,setAll]=useState(false);
 const answer=data.answer,e=data.evidence;if(!answer)return null;
 type Hit={m:Metric;side:Pick<EvidencePayload,'company'|'testimony'|'clusters'|'cohortLabel'>;cell?:CohortCell&{side:'group'|'company'}};
 // A fact opens the lens on the release it names; a fact whose release no metric on the page lists opens nothing.
 const find=(key?:string,release?:string):Hit|null=>{
  if(!key)return null;
  if(e&&release)for(const row of e.cohortComparison??[]) {
   if(row.key!==key)continue;
   const m=e.metrics.find(x=>x.key===key);if(!m)break;
   if(row.cohort?.releaseId===release)return {m,side:e,cell:{...row.cohort,side:'group'}};
   if(row.company?.releaseId===release)return {m,side:e,cell:{...row.company,side:'company'}};
  }
  for(const side of [e,data.compareEvidence]){const m=side?.metrics.find(x=>x.key===key&&(!release||x.series.some(p=>p.releaseId===release)));if(m&&side)return {m,side};}
  // Discovery facts name a release; open the lens on the employer row that published it.
  for(const row of data.discovery){const m=row.metrics.find(x=>x.key===key&&!!release&&x.series.some(p=>p.releaseId===release));if(m)return {m,side:{company:row.company,testimony:[],clusters:[],cohortLabel:m.cohortLabel}};}
  return null;
 };
 const open=(hit:Hit)=>act.openMetric(hit.m,hit.side,hit.cell);
 // Where the view itself already shows every fact as something that opens its evidence (the record's metric cards, the
 // before/after cards around an event, the group-and-company table), the tiles would only repeat them.
 const covered=data.view==='overview'?!!e?.metrics.some(m=>m.latest):data.view==='timeline'?!!(e?.selectedEvent&&e.comparison?.length):data.view==='cohort'?!!e?.cohortComparison?.some(r=>r.cohort||r.company):false;
 // The accounts-mentioning count appears nowhere else on any view, so it is kept even where the tiles are not.
 const mentions=answer.accountsMentioning&&answer.accountsMentioning.count>=5?<p className="answer-accounts">{answer.accountsMentioning.count} published accounts mention {topicLabel(answer.accountsMentioning.topic).toLowerCase()}.</p>:null;
 if(covered) {
  const lead=answer.facts.map(f=>find(f.metricKey,f.releaseId)).find(Boolean);
  return lead||mentions?<div className="answer">{lead&&<button className="link-button answer-open" onClick={()=>open(lead)}><Icon name="lens" size={15}/>Open the evidence behind this answer</button>}{mentions}</div>:null;
 }
 const facts=all?answer.facts:answer.facts.slice(0,FACTS_SHOWN);
 return <div className="answer">
  {facts.length>0&&<ul className="answer-facts" aria-label="Facts behind this answer">{facts.map((f,index)=>{const hit=find(f.metricKey,f.releaseId);const inner=<><span className="fact-label">{f.label}</span><strong className="num">{f.value}</strong><Meta n={f.n} period={f.period}/></>;
   return <li key={index}>{hit?<button className="fact" onClick={()=>open(hit)}>{inner}<span className="fact-open"><Icon name="lens" size={14}/><span className="visually-hidden">Open the evidence</span></span></button>:<span className="fact">{inner}</span>}</li>;})}</ul>}
  {answer.facts.length>FACTS_SHOWN&&<button className="link-button facts-more" aria-expanded={all} onClick={()=>setAll(v=>!v)}>{all?'Show fewer facts':`Show all ${answer.facts.length} facts`}</button>}
  {mentions}
 </div>;
}
export const isEmptyRecord=(data:CanvasResponse)=>{const e=data.evidence;return !!e&&!e.metrics.length&&!e.testimony.length&&!e.distribution&&data.view!=='compare';};
/** Any filter that can empty a record which is not empty: a group, a period or event, a topic or an account type. */
export const isNarrowed=(data:CanvasResponse)=>{const e=data.evidence,i=data.interpretation;return !!e&&(e.cohortStatus!=='all'||e.timeStatus!=='any'||!!e.selectedEvent||i.topic.value!=='other'||!!i.layer);};
/** A real employer with nothing published at all: the only state that may say the record opens after the publication rule. */
export const isRealEmpty=(data:CanvasResponse)=>isEmptyRecord(data)&&data.evidence!.company.kind==='real'&&!isNarrowed(data);
