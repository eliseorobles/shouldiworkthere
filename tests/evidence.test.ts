import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testEnv,type TestD1} from './d1.ts';
import {buildEvidence,eventComparison,corroborate,corroborateDetailed,compareMetrics,discover,rankCandidates,loadAccountPool,readingFrom,reportingQuarter,trailingQuarters,getDirectory,classifyTestimony,medianOf,answerFor,companyLabel,WITHHELD_BODY,SANDBOX_LABEL,LEGACY_CREDENTIAL_LABEL,LEGACY_CREDENTIAL_CLASS,UNRECORDED_LABEL,MAILBOX_LABEL,FAQ_POPULAR_MIN,FAQ_MAX_POPULAR,FAQ_MAX_ENTRIES,DISCOVERY_MAX_ROWS,MAX_ACCOUNTS,MIN_ACCOUNT_COUNT,SEMANTIC_CANDIDATES_MAX,type PairJudgment} from '../worker/src/evidence.ts';
import {baseInterpretation} from '../worker/src/jev.ts';
import {specId,parseSpecId,specWording,specFromInterpretation,specFromStoredId,starterSpecs,faqCatalog,validSpec,type QuestionSpec} from '../shared/faq.ts';
import type {Interpretation,MetricView,TopicId} from '../worker/src/types.ts';

const RISK_KEYS=['private_identity','contextual_identity','threat','doxxing','personal_attack','promotional','manipulation'];
const interp=(o:Partial<Interpretation>={}):Interpretation=>({...baseInterpretation(),...o});
const pick=<T extends string>(value:T)=>({value,confidence:1,probabilities:{}});
// Clock pinned for every time-relative filter, so results do not change as the calendar moves.
const NOW=new Date('2026-09-22T12:00:00Z');
const CREDENTIALED='Verified employment relationship with Northwind Labs at the time described';
const LEGACY_CLASS='Verified employment relationship, single use credential, claim claim_4ab19d';
function addAccount(db:TestD1,a:{id:string;body:string;company?:string;cohort?:string|null;layer?:string;period?:string|null;cls?:string;batch?:string;published?:string}) {
 db.prepare('INSERT INTO testimony(id,company_id,cohort_id,layer,body,period,event_id,verification_class,release_batch,published_at,withdrawn_at) VALUES(?,?,?,?,?,?,NULL,?,?,?,NULL)').bind(a.id,a.company??'co-northwind',a.cohort??null,a.layer??'experience',a.body,a.period===undefined?'2026-Q1':a.period,a.cls??CREDENTIALED,a.batch??'batch-2026-h1',a.published??'2026-Q2').raw();
}
function addPairs(db:TestD1,pairs:PairJudgment[]) {for(const p of pairs)db.prepare('INSERT INTO evidence_pairs(left_id,right_id,same_event,copied,model,prompt_version) VALUES(?,?,?,?,?,?)').bind(p.left_id,p.right_id,p.same_event,p.copied,'test','test').raw();}
const same=(left_id:string,right_id:string,same_event=.95,copied=.05):PairJudgment=>({left_id,right_id,same_event,copied});
const clique=(ids:string[])=>ids.flatMap((a,index)=>ids.slice(index+1).map(b=>same(a,b)));
function addSurveyRelease(db:TestD1,company:string,key:string,o:{value?:number;n?:number;cls?:'demo'|'mailbox';distribution?:boolean;bands?:[string,number][]}={}) {
 const cls=o.cls??'mailbox',id=`aggregate:${company}:2026-Q3:${cls}:${key}`;
 db.prepare("INSERT OR IGNORE INTO metric_definitions(id,key,label,question,response_type,unit,direction,method_note,verification_method) VALUES(?,?,?,?,?,?,'neutral','Explicit optional questionnaire answers.','Definition-level method')").bind(`survey-${key}`,`survey_${key}`,key,key,o.distribution?'distribution':'percent_agree',o.distribution?'category':'percent').raw();
 db.prepare("INSERT INTO metric_releases(id,company_id,metric_id,cohort_id,period,value,n,release_batch,published_at,verification_method) VALUES(?,?,?,NULL,'2026-Q3',?,?,'2026-Q3','2026-Q3',?)").bind(id,company,`survey-${key}`,o.value??0,o.n??30,cls==='demo'?'Sandbox responses from fictional-employer credentials; not unique people and not employment-verified.':'One work-mailbox credential per employer and issuance quarter; not a census.').raw();
 for(const [index,[band,share]] of (o.bands??[]).entries())db.prepare('INSERT INTO distribution_bands(release_id,band,share,sort_order) VALUES(?,?,?,?)').bind(id,band,share,index).raw();
 return id;
}

// Analysis exposure and render-time privacy defenses.
test('public testimony carries a typed reading, never risk signals, and low-confidence dimensions read as unknown',async()=>{
 const {env,publicDb}=testEnv();
 const noul=(v:number)=>({type:'noul',noul:v});
 const analysis={...Object.fromEntries(RISK_KEYS.map(k=>[k,noul(.91)])),firsthand:noul(.9),mentions_harassment:noul(.8),mentions_promotion:noul(.95),mentions_layoff:noul(.3),
  direct_manager:{type:'choice',choice:'negative',confidence:.55,probabilities:{negative:.55,unknown:.45}},promotion_clarity:{type:'choice',choice:'negative',confidence:.92,probabilities:{negative:.92,unknown:.08}},
  specificity:{type:'score',score:1.43,confidence:.7,probabilities:{'0':0,'1':.57,'2':.43},legend:{'0':'a','1':'b','2':'c'}}};
 publicDb.prepare('INSERT INTO evidence_analysis(testimony_id,analysis_json,model,prompt_version,source_hash) VALUES(?,?,?,?,?)').bind('t-006',JSON.stringify(analysis),'jev-test','evidence-v3','h').raw();
 const e=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp()});assert.ok(e);
 const item=e.testimony.find(t=>t.id==='t-006');assert.ok(item?.reading);
 assert.equal(item.reading.dimensions.direct_manager.value,'unknown','confidence .55 is below the reading threshold');
 assert.equal(item.reading.dimensions.promotion_clarity.value,'negative');
 assert.deepEqual(item.reading.mentions.sort(),['harassment','promotion']);
 assert.equal(item.reading.specificity,'some_detail');assert.equal(item.reading.model,'jev-test');assert.equal(item.reading.promptVersion,'evidence-v3');
 const json=JSON.stringify(e);
 for(const key of [...RISK_KEYS,'firsthand','analysis'])assert.equal(json.includes(`"${key}"`),false,`${key} must never reach the public payload`);
});
test('reading mapping drops unknown keys and rejects malformed answers',()=>{
 const r=readingFrom({manipulation:{type:'noul',noul:1},workload:{type:'choice',choice:'catastrophic',confidence:.99},compensation:{type:'noul',noul:.9}},'m','p');
 assert.ok(r);assert.equal(r.dimensions.workload.value,'unknown');assert.equal(r.dimensions.compensation.value,'unknown');assert.equal(r.specificity,null);assert.equal('manipulation'in r,false);
 assert.equal(readingFrom('not an object','m','p'),undefined);assert.equal(readingFrom([1,2],'m','p'),undefined);
});
test('specificity below the reading confidence threshold is not reported',()=>{
 const score=(confidence:number)=>readingFrom({specificity:{type:'score',score:2,confidence,probabilities:{'0':0,'1':.05,'2':.95}}},'m','p')?.specificity;
 assert.equal(score(.59),null,'a confident-looking level from an unconfident answer is dropped');assert.equal(score(.6),'specific');
 assert.equal(readingFrom({specificity:{type:'noul',noul:.99,confidence:.99}},'m','p')?.specificity,null,'wrong answer type');
});
test('testimony with a direct identifier is withheld from the payload and never offered to inference',async()=>{
 const {env,publicDb}=testEnv();
 addAccount(publicDb,{id:'legacy-named',body:'My manager Dana told me the promotion committee would ignore the published criteria for everyone on our floor.',published:'2026-09-22T05:01:29.790Z'});
 const e=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp()});assert.ok(e);
 const item=e.testimony.find(t=>t.id==='legacy-named');assert.ok(item);
 assert.equal(item.body,WITHHELD_BODY);assert.equal(item.withheld,true);assert.equal(item.reading,undefined);assert.deepEqual(item.topicIds,[]);
 assert.equal(JSON.stringify(e).includes('Dana'),false);assert.ok(e.notices.some(n=>/withheld/.test(n)));
 assert.equal(e.testimony.filter(t=>t.id!=='legacy-named').some(t=>t.withheld),false,'ordinary fixture accounts are not withheld');
 const ids=await rankCandidates(env,'co-northwind',interp({topic:pick('promotion')}),'promotion committee criteria');
 assert.equal(ids.includes('legacy-named'),false);assert.ok(ids.includes('t-006'));
});
test('withheld text cannot be probed through the topic filter',async()=>{
 const {env,publicDb}=testEnv();
 addAccount(publicDb,{id:'legacy-named',body:'My manager Dana told me the promotion committee would ignore the published criteria for everyone on our floor.'});
 const promo=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick('reader')}),topicFilter:'promotion',now:NOW}))!;
 assert.deepEqual(promo.testimony.map(t=>t.id),['t-006'],'the hidden text mentions promotion, but the placeholder is not tagged with it');
 assert.equal(promo.testimonyPaging.matching,1,'the withheld account is not counted as matching');assert.ok(promo.notices.includes('Showing only accounts related to promotions. Remove the topic to read every account.'));
 const every=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick('reader')}),topicFilter:null,now:NOW}))!;
 assert.equal(every.testimony.find(t=>t.id==='legacy-named')?.withheld,true,'withheld placeholders appear only in the unfiltered view');
});
test('an account with a direct identifier never counts toward a cluster, and its text never leaks',async()=>{
 const ids=['cq-a','cq-b','cq-c','cq-d','cq-e'];
 const run=async(named:boolean)=>{
  const {env,publicDb}=testEnv();
  ids.forEach((id,k)=>addAccount(publicDb,{id,period:'2025-Q3',body:k===0&&named?'Our director Priya cancelled the autumn planning review twice and replaced it with a written update.':`The autumn planning review was cancelled twice and replaced by a written update (${k}).`}));
  addPairs(publicDb,clique(ids));
  return (await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!;
 };
 assert.equal((await run(false)).clusters.length,1,'control: five clean sources form a cluster');
 const named=await run(true);
 assert.equal(named.clusters.length,0,'four speakable sources remain, below the threshold');assert.equal(named.coverage.corroboratedClusters,0);
 assert.equal(JSON.stringify(named).includes('Priya'),false);
});
test('an FAQ question whose only supporting account is withheld does not appear',async()=>{
 const run=async(named:boolean)=>{
  const {env,publicDb}=testEnv();
  addAccount(publicDb,{id:'remote-1',body:named?'Our director Priya told remote staff to relocate to the office within a month.':'Remote staff were told to relocate to the office within a month.'});
  return (await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!.trail.map(t=>t.question);
 };
 assert.ok((await run(false)).includes('How are remote workers treated?'),'control: a speakable account is evidence');
 assert.equal((await run(true)).includes('How are remote workers treated?'),false);
});
test('publication timestamps are served at reporting-quarter precision only',async()=>{
 const {env,publicDb}=testEnv();addAccount(publicDb,{id:'ms-stamp',body:'Our planning cycle moved to quarterly reviews and the team adapted without much friction.',published:'2026-09-22T05:01:29.790Z'});
 const e=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp()});assert.ok(e);
 for(const t of e.testimony)assert.match(t.publishedAt,/^20\d{2}-Q[1-4]$/);
 assert.equal(e.testimony.find(t=>t.id==='ms-stamp')?.publishedAt,'2026-Q3');assert.equal(e.testimony.find(t=>t.id==='t-001')?.publishedAt,'2025-Q3');
 assert.equal(reportingQuarter('garbage'),'');assert.equal(reportingQuarter('2024-Q2'),'2024-Q2');
});
test('account order inside a reporting quarter does not reveal publication sequence',async()=>{
 const {env,publicDb}=testEnv();
 addAccount(publicDb,{id:'aa-early',body:'Quarterly goals were set late but the team still delivered the main release.',published:'2026-07-01T00:00:00Z'});
 addAccount(publicDb,{id:'zz-late',body:'Planning reviews became shorter and more focused over the summer months.',published:'2026-09-20T00:00:00Z'});
 const ids=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp()}))!.testimony.map(t=>t.id);
 assert.ok(ids.indexOf('aa-early')<ids.indexOf('zz-late'),'same quarter sorts by id, not by exact time');assert.ok(ids.indexOf('zz-late')<ids.indexOf('t-005'),'newer quarters still come first');
});

// Corroboration.
test('A~B and B~C with A!~C never form a cluster: clusters are cliques, not chains',()=>{
 assert.deepEqual(corroborate(['a','b','c'],[same('a','b'),same('b','c'),same('a','c',.2)],3),[]);
 assert.deepEqual(corroborate(['a','b','c'],[same('a','b'),same('b','c')],3),[],'an unjudged pair is not a match');
 assert.equal(corroborate(['a','b','c'],[same('a','b'),same('b','c'),same('a','c')],3).length,1);
});
test('chain and star patterns do not reach the cluster threshold; a full clique does',()=>{
 const ids=['a','b','c','d','e'];
 assert.deepEqual(corroborate(ids,[same('a','b'),same('b','c'),same('c','d'),same('d','e')],5),[]);
 assert.deepEqual(corroborate(ids,[same('a','b'),same('a','c'),same('a','d'),same('a','e')],5),[]);
 const found=corroborate(ids,clique(ids),5);assert.equal(found.length,1);assert.equal(found[0]!.length,5);
});
test('copy-paste accounts merge into one source and never add a witness',()=>{
 const four=['a','b','c','d'];
 assert.deepEqual(corroborate([...four,'e'],[...clique(four),same('a','e',.97,.97),...['b','c','d'].map(x=>same(x,'e'))],5),[],'four independent sources plus a copy is still four');
 const five=['a','b','c','d','f'],result=corroborate([...five,'e'],[...clique(five),same('a','e',.97,.97),...['b','c','d','f'].map(x=>same(x,'e'))],5);
 assert.equal(result.length,1);assert.equal(result[0]!.length,5,'five sources');assert.deepEqual(result[0]!.find(s=>s.includes('e')),['a','e']);
 assert.deepEqual(corroborate(five,[...clique(five).filter(p=>!(p.left_id==='a'&&p.right_id==='b')),same('a','b',.95,.3)],5),[],'an uncertain copy score breaks the clique');
});
test('corroboration output does not depend on pair order',()=>{
 const ids=['a','b','c','d','e','f','g'],pairs=[...clique(['a','b','c','d','e']),same('f','g'),same('e','f')];
 assert.deepEqual(corroborate(ids,[...pairs].reverse(),5),corroborate(ids,pairs,5));
});
test('each clique search has its own budget, so disjoint clusters are not lost after a costly first search',()=>{
 // Complete 5-partite graph with 12 accounts per part: 12 disjoint valid 5-cliques, and a very costly exhaustive search.
 const ids=[0,1,2,3,4].flatMap(p=>Array.from({length:12},(_,k)=>`p${p}-${String(k).padStart(2,'0')}`));
 const pairs=ids.flatMap((a,index)=>ids.slice(index+1).filter(b=>a.slice(0,2)!==b.slice(0,2)).map(b=>same(a,b)));
 const {clusters,complete}=corroborateDetailed(ids,pairs,5);
 assert.equal(clusters.length,12);
 for(const c of clusters){const parts=c.map(s=>s[0]!.slice(0,2));assert.equal(new Set(parts).size,parts.length,'every returned cluster is still a true clique');}
 assert.equal(complete,false,'a search that stopped on its budget is reported, not hidden');
 const sparse=corroborateDetailed(['a','b','c','d','e','f','g','h','i','j'],[...clique(['a','b','c','d','e']),...clique(['f','g','h','i','j']),same('e','f')],5);
 assert.equal(sparse.clusters.length,2);assert.equal(sparse.complete,true);
});
test('clusters respect cohort, layer and time filters, skip unavailable cohorts, and expose every member',async()=>{
 const {env,publicDb}=testEnv();const ids=['x-a','x-b','x-c','x-d','x-e'];
 ids.forEach((id,index)=>addAccount(publicDb,{id,cohort:index<4?'ch-nw-eng':'ch-nw-sales',period:'2025-Q3',body:`The quarterly planning review in the autumn was cancelled twice and then replaced by a written update (${index}).`}));
 for(let k=0;k<45;k++)addAccount(publicDb,{id:`filler-${String(k).padStart(2,'0')}`,body:'The cafeteria menu rotated weekly and the coffee machine was usually working.',published:'2026-Q3'});
 addPairs(publicDb,clique(ids));
 const all=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW});assert.ok(all);
 assert.equal(all.clusters.length,1);const c=all.clusters[0]!;
 assert.equal(c.reporterCount,5);assert.equal(c.members.length,5);assert.ok(c.members.every(m=>m.body.length>20&&m.duplicateOf===null));
 assert.ok(ids.some(id=>!all.testimony.some(t=>t.id===id)),'at least one member is beyond the testimony page, yet inspectable');
 assert.equal(c.summary,'Potentially related illustrative accounts');assert.equal(/verified/i.test(c.summary),false);
 assert.equal((await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),cohortLabelOverride:'Engineering',now:NOW}))?.clusters.length,0,'only four members are in Engineering');
 const unavailable=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),cohortLabelOverride:'Only engineer in Dallas',now:NOW});
 assert.equal(unavailable?.clusters.length,0);assert.equal(unavailable?.cohortStatus,'unavailable');
 assert.equal((await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),layerOverride:'opinion',now:NOW}))?.clusters.length,0);
 assert.equal((await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({timeframe:'last_year'}),now:NOW}))?.clusters.length,1,'2025-Q3 is last year on the pinned clock');
 assert.equal((await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({timeframe:'last_year'}),now:new Date('2027-03-01T12:00:00Z')}))?.clusters.length,0,'and not a year later');
});

// Event and timeframe correctness.
test("another company's event is never applied and before/after without a documented event shows nothing time-scoped",async()=>{
 const {env}=testEnv();
 const foreign=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({event:pick('ev-he-rto-2025'),timeframe:'after_event'})});assert.ok(foreign);
 assert.equal(foreign.selectedEvent,null);assert.equal(foreign.metrics.length,0);assert.equal(foreign.testimony.length,0);assert.deepEqual(foreign.comparison,[]);
 assert.ok(foreign.notices.some(n=>/not documented for Northwind Labs/.test(n)));
 const missing=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({timeframe:'before_event'})});assert.ok(missing);
 assert.equal(missing.metrics.length,0);assert.ok(missing.notices.some(n=>/documented events/.test(n)));
 const timeline=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({timeframe:'after_event',view:pick('timeline')})});assert.ok(timeline);
 assert.ok(timeline.metrics.length>0,'the timeline still shows reporting periods to choose an event from');assert.ok(timeline.notices.length>0);
});
test('after_event filters metrics and testimony to periods that start after the event',async()=>{
 const {env}=testEnv();const e=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({event:pick('ev-nw-restructure-2025'),timeframe:'after_event'})});assert.ok(e);
 assert.ok(e.metrics.every(m=>m.series.every(p=>p.period>='2026')));assert.deepEqual(e.testimony.map(t=>t.id).sort(),['t-003','t-004','t-005','t-006']);
});
test('last_year applies to testimony as well as metrics',async()=>{
 const {env}=testEnv();
 for(const [now,year] of [[NOW,'2025'],[new Date('2027-03-01T12:00:00Z'),'2026']] as const) {
  const e=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({timeframe:'last_year'}),now});assert.ok(e);
  assert.ok(e.testimony.length>0);assert.ok(e.testimony.every(t=>t.period?.startsWith(year)));assert.ok(e.metrics.length>0);assert.ok(e.metrics.every(m=>m.series.every(p=>p.period.startsWith(year))));
  assert.equal(e.timeStatus,'applied');
 }
});
test('last_year with nothing in that year says so and substitutes nothing',async()=>{
 const {env}=testEnv();const e=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({timeframe:'last_year'}),now:new Date('2031-06-01T00:00:00Z')}))!;
 assert.equal(e.metrics.length,0);assert.equal(e.testimony.length,0);assert.ok(e.outsideTimeframe.includes('return_intent'));
 assert.ok(e.notices.some(n=>/fall inside the selected period/.test(n)));assert.equal(e.notices.some(n=>/no publishable cells/.test(n)),false,'the group has cells; the period has none');
});
test('an unapplied before/after filter is reported as such, not as an empty cohort',async()=>{
 const {env}=testEnv();
 const e=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({timeframe:'after_event'}),cohortLabelOverride:'Engineering',now:NOW}))!;
 assert.equal(e.timeStatus,'not_applied');assert.equal(e.metrics.length,0);
 assert.ok(e.notices.some(n=>/documented events/.test(n)));assert.equal(e.notices.some(n=>/no publishable cells/.test(n)),false);
});
test('before/after windows are bounded by adjacent documented events and flag events inside the window',async()=>{
 const point=(period:string,value:number)=>({period,value,n:100,ciLow:null,ciHigh:null,eventId:null,releaseId:`r-${period}`,releaseBatch:'b'});
 const metric={key:'return_intent',label:'Would work here again',unit:'percent',responseType:'percent_agree',series:[point('2022',80),point('2026',30)]} as MetricView;
 const others=[{id:'e1',label:'2023 compensation refresh',occurredOn:'2023-01-15'},{id:'e3',label:'2025 restructuring',occurredOn:'2025-02-10'}];
 assert.equal(eventComparison([metric],'2024-09-02').length,1,'unbounded, 2022→2026 would be reported');
 assert.deepEqual(eventComparison([metric],'2024-09-02',others),[],'2022 precedes the previous event and 2026 follows the next one');
 const {env}=testEnv();
 const e=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({event:pick('ev-nw-leadership-2024'),view:pick('timeline')})});assert.ok(e);
 const row=e.comparison?.find(r=>r.key==='return_intent');assert.equal(row?.before.period,'2023');assert.equal(row?.after.period,'2025');
 assert.deepEqual(row?.alsoInWindow.map(x=>x.id).sort(),['ev-nw-comp-2023','ev-nw-restructure-2025']);assert.ok(e.notices.some(n=>/cannot be attributed to 2024 leadership change alone/.test(n)));
 const restructuring=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({event:pick('ev-nw-restructure-2025'),view:pick('timeline')})});
 const r2=restructuring?.comparison?.find(r=>r.key==='return_intent');assert.equal(r2?.before.period,'2024');assert.equal(r2?.after.period,'2026');assert.deepEqual(r2?.window,{from:'2024',to:'2026'});
});
test('the topic chip filters accounts and says how many remain, never stating a count under five',async()=>{
 const {env,publicDb}=testEnv();const e=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick('reader')}),topicFilter:'promotion'});assert.ok(e);
 assert.deepEqual(e.testimony.map(t=>t.id),['t-006']);assert.ok(e.notices.includes('Showing only accounts related to promotions. Remove the topic to read every account.'));
 assert.ok(!e.notices.some(n=>/\b1 of 6\b/.test(n)),'one matching account is never stated as a count');
 const none=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick('reader')}),topicFilter:null});assert.equal(none?.testimony.length,6);
 const hours=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({topic:pick('promotion')}),topicFilter:'workload'});
 assert.equal(hours?.metrics[0]?.key,'workload_hours','the topic chip, not the original reading, orders the metrics');
 for(let k=0;k<4;k++)addAccount(publicDb,{id:`promo-${k}`,body:`Promotion criteria were explained in calibration round ${k}.`});
 const five=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick('reader')}),topicFilter:'promotion'});
 assert.ok(five?.notices.includes('Showing the 5 of 10 accounts related to promotions. Remove the topic to read every account.'));
});

// Distribution metrics.
test('distribution view: a topic uses only its own distribution; with no topic it shows a published one (weekly hours, then pay) instead of an empty headline',async()=>{
 const {env,publicDb}=testEnv();
 const hours=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({topic:pick('workload'),view:pick('distribution')})});
 assert.equal(hours?.distribution?.metricKey,'workload_hours');assert.equal(hours?.distribution?.median,47);assert.equal(hours?.distribution?.bands.length,5);
 const pay=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({topic:pick('compensation'),view:pick('distribution')})});
 assert.equal(pay?.distribution,null,'never substitute the hours histogram for a pay question');assert.ok(pay?.notices.some(n=>/compensation distribution/.test(n)));
 assert.match(answerFor({route:'metric_view',view:'distribution',evidence:pay!,topic:'compensation'})!.headline,/^No published distribution matches/);
 // Production journey: /c/northwind-labs?view=distribution with no topic answered "No published distribution matches…"
 // although the weekly-hours distribution (median 47 h) is published.
 const untopical=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick('distribution')})});
 assert.equal(untopical?.distribution?.metricKey,'workload_hours','no topic: the published weekly-hours distribution');
 assert.ok(!untopical?.notices.some(n=>/Distributions are published only/.test(n)),'no "choose a topic" notice when one is shown');
 const headline=answerFor({route:'metric_view',view:'distribution',evidence:untopical!,topic:'other'})!.headline;
 assert.match(headline,/median 47/);assert.doesNotMatch(headline,/No published distribution/);
 // A topic that has no distribution of its own never borrows one, and a view other than distribution selects none.
 const promotion=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({topic:pick('promotion'),view:pick('distribution')})});
 assert.equal(promotion?.distribution,null);assert.ok(promotion?.notices.includes('Distributions are published only for pay categories and weekly hours. Choose one of those topics.'));
 assert.equal((await buildEvidence(env,{slug:'northwind-labs',interpretation:interp()}))?.distribution,null,'overview selects no distribution');
 // With no weekly-hours distribution, a topic-less distribution view falls back to the published pay distribution.
 addSurveyRelease(publicDb,'co-stripe','compensation',{distribution:true,bands:[['Below market',20],['Market',50],['Above market',25],['Exceptional',5]]});
 assert.equal((await buildEvidence(env,{slug:'stripe',interpretation:interp({view:pick('distribution')})}))?.distribution?.metricKey,'survey_compensation');
});
test('distribution metrics carry bands and never a value or delta',async()=>{
 const {env,publicDb}=testEnv();
 addSurveyRelease(publicDb,'co-stripe','compensation',{distribution:true,bands:[['Below market',20],['Market',50],['Above market',25],['Exceptional',5]]});
 const e=await buildEvidence(env,{slug:'stripe',interpretation:interp({topic:pick('compensation'),view:pick('distribution')})});assert.ok(e);
 const m=e.metrics.find(x=>x.key==='survey_compensation');assert.ok(m);
 assert.equal(m.latest?.value,null);assert.equal(m.latest?.median,null);assert.equal(m.delta,null);assert.equal(m.latest?.bands?.length,4);
 assert.equal(e.distribution?.metricKey,'survey_compensation');assert.equal(e.distribution?.median,null);
 const nw=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp()});const hours=nw?.metrics.find(x=>x.key==='workload_hours');
 assert.ok(hours?.series.every(p=>p.value===null&&(p.bands?.length??0)>0));assert.equal(hours?.delta,null);
 assert.equal(eventComparison(nw!.metrics,'2025-02-10').some(r=>r.key==='workload_hours'),false);
});
test('a distribution value is shown as a median only when its definition documents one',async()=>{
 const {env,publicDb}=testEnv();
 // An hours distribution written through the placeholder path (value 0) under the documented-median definition.
 publicDb.prepare("INSERT INTO metric_releases(id,company_id,metric_id,cohort_id,period,value,n,release_batch,published_at) VALUES('r-stripe-hours','co-stripe','m-hours',NULL,'2026',0,40,'2026-Q3','2026-Q3')").raw();
 publicDb.prepare("INSERT INTO distribution_bands(release_id,band,share,sort_order) VALUES('r-stripe-hours','Under 40',60,0),('r-stripe-hours','40–49',40,1)").raw();
 // An hours distribution whose definition does not document a median: its stored value must never surface.
 publicDb.prepare("INSERT INTO metric_definitions(id,key,label,question,response_type,unit,direction,method_note,verification_method) VALUES('survey-hours','survey_weekly_hours','Weekly hours','Weekly hours','distribution','hours','neutral','Explicit optional questionnaire answers.','Recorded on each release.')").raw();
 publicDb.prepare("INSERT INTO metric_releases(id,company_id,metric_id,cohort_id,period,value,n,release_batch,published_at,verification_method) VALUES('aggregate:co-stripe:2026-Q3:mailbox:weekly_hours','co-stripe','survey-hours',NULL,'2026-Q3',38,40,'2026-Q3','2026-Q3','One work-mailbox credential per employer and issuance quarter; not a census.')").raw();
 const e=(await buildEvidence(env,{slug:'stripe',interpretation:interp({topic:pick('workload'),view:pick('distribution')})}))!;
 assert.equal(e.metrics.find(m=>m.key==='workload_hours')?.latest?.median,null,'a zero placeholder is not a median');
 assert.equal(e.metrics.find(m=>m.key==='survey_weekly_hours')?.latest?.median,null,'no median marker, no median');
 assert.equal(e.distribution?.median,null);
 assert.equal(medianOf({response_type:'distribution',metric_key:'workload_hours',method_note:'Median reported weekly hours.',value:47}),47);
 const found=await discover(env,interp({view:pick('discovery'),preferences:{workload_hours:'low'}}),await getDirectory(env),NOW);
 const stripe=found.rows.find(r=>r.company.slug==='stripe');assert.equal(stripe?.status,'insufficient','a fabricated 0-hour median must not pass the under-45 filter');assert.deepEqual(stripe?.values,[]);
});

// Provenance.
test('lens provenance: release ids per point and release-level verification method',async()=>{
 const {env,publicDb}=testEnv();addSurveyRelease(publicDb,'co-stripe','manager_trust',{value:80});
 const e=await buildEvidence(env,{slug:'northwind-labs',interpretation:interp()});const m=e?.metrics.find(x=>x.key==='return_intent');
 assert.deepEqual(m?.series.map(p=>p.releaseId),['r-001','r-002','r-003','r-004','r-005']);assert.equal(m?.series[0]?.releaseBatch,'batch-2022-h1');assert.equal(m?.topic,'culture');
 const s=await buildEvidence(env,{slug:'stripe',interpretation:interp()});const survey=s?.metrics.find(x=>x.key==='survey_manager_trust');
 assert.equal(survey?.verificationMethod,'One work-mailbox credential per employer and issuance quarter; not a census.','release-level method wins over the definition');assert.equal(survey?.provenance,'credentialed');
});
test('sample-company pages label real visitors sandbox contributions as sandbox, not fixtures',async()=>{
 const {env,publicDb}=testEnv();addSurveyRelease(publicDb,'co-meridian','manager_trust',{value:60,cls:'demo'});
 addAccount(publicDb,{id:'sb-1',company:'co-meridian',cls:'Sandbox contribution; not employment-verified',body:'Store scheduling changed twice this season and shift swaps became harder to arrange.'});
 const e=await buildEvidence(env,{slug:'meridian-retail',interpretation:interp()});assert.ok(e);
 const sandbox=e.metrics.find(m=>m.key==='survey_manager_trust'),fixture=e.metrics.find(m=>m.key==='manager_trust');
 assert.equal(sandbox?.provenance,'sandbox');assert.ok(sandbox?.verificationMethod.startsWith(SANDBOX_LABEL));
 assert.equal(fixture?.provenance,'fixture');assert.equal(fixture?.verificationMethod,'Illustrative fixture; not employee responses');
 assert.equal(e.testimony.find(t=>t.id==='sb-1')?.verificationClass,SANDBOX_LABEL);assert.equal(e.testimony.find(t=>t.id==='t-011')?.verificationClass,'Illustrative testimony');
});
test('fixtures are recognised positively: earlier visitors\' accounts are never relabelled as fixtures or as credentialed',async()=>{
 const {env,publicDb}=testEnv();
 addAccount(publicDb,{id:'sub_legacy_nw',cls:LEGACY_CLASS,batch:'batch-2026-09-23',published:'2026-09-22T05:01:29.790Z',body:'The planning review moved to a written format and meetings became shorter over the summer.'});
 addAccount(publicDb,{id:'sub_legacy_st',company:'co-stripe',cls:LEGACY_CLASS,batch:'batch-2026-09-23',body:'Onboarding took three weeks and the documentation was mostly accurate.'});
 addAccount(publicDb,{id:'t_mailbox',company:'co-stripe',cls:'Work mailbox verified; relationship self-reported',batch:'2026-Q3',body:'Team planning happens every six weeks and priorities are written down.'});
 addAccount(publicDb,{id:'lookalike',cls:CREDENTIALED,batch:'2026-Q3',body:'Code reviews are usually completed within a day on my team.'});
 const nw=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!,st=(await buildEvidence(env,{slug:'stripe',interpretation:interp(),now:NOW}))!;
 const legacy=nw.testimony.find(t=>t.id==='sub_legacy_nw');
 assert.equal(legacy?.provenance,'sandbox');assert.equal(legacy?.verificationClass,LEGACY_CREDENTIAL_LABEL,'a visitor contribution on a sample page is not a fixture');
 assert.equal(st.testimony.find(t=>t.id==='sub_legacy_st')?.provenance,'sandbox','a demonstration credential on a real employer is not credentialed');
 assert.equal(st.testimony.find(t=>t.id==='t_mailbox')?.provenance,'credentialed');assert.equal(st.testimony.find(t=>t.id==='t_mailbox')?.verificationClass,MAILBOX_LABEL);
 const lookalike=nw.testimony.find(t=>t.id==='lookalike');assert.equal(lookalike?.provenance,'unverified','seeded wording outside a seed batch is not a fixture');assert.equal(lookalike?.verificationClass,UNRECORDED_LABEL);
 for(const e of [nw,st])assert.equal(/claim_/.test(JSON.stringify(e)),false,'stored class strings with claim ids are never echoed');
 assert.equal(nw.testimony.find(t=>t.id==='t-001')?.provenance,'fixture');
 assert.deepEqual(classifyTestimony('real','Verified employment relationship with Stripe at the time described','batch-2026-h1'),{provenance:'unverified',label:UNRECORDED_LABEL},'seeded wording on a real employer is not a fixture');
});

// Two-company comparison.
test('comparison covers the union of metrics with explicit per-side availability',async()=>{
 const {env,publicDb}=testEnv();addSurveyRelease(publicDb,'co-meridian','manager_trust',{value:60,cls:'demo'});
 const left=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp()}))!,right=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp()}))!;
 const table=compareMetrics(left,right),wait=table.rows.find(r=>r.key==='promotion_wait_years');
 assert.equal(wait?.left.status,'not_published');assert.equal(wait?.right.status,'value','right-only metrics are not dropped');
 const comp=table.rows.find(r=>r.key==='comp_vs_market');assert.equal(comp?.alignedPeriod,'2026');assert.equal(comp?.right.status==='value'&&comp.right.releaseId,'r-042');
 const noCohort=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp(),cohortLabelOverride:'Engineering'}))!;
 const t2=compareMetrics((await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),cohortLabelOverride:'Engineering'}))!,noCohort);
 assert.ok(t2.rows.every(r=>r.right.status==='group_unavailable'));assert.ok(t2.notices.some(n=>n.startsWith('Helios Semiconductor: No privacy-approved release exists for Engineering')));
 const t3=compareMetrics(left,(await buildEvidence(env,{slug:'meridian-retail',interpretation:interp()}))!);
 assert.equal(t3.rows.find(r=>r.key==='survey_manager_trust')?.left.status,'different_instrument');
});
test('comparison cells carry provenance, and distributions compare by bands, never by a value',async()=>{
 const {env}=testEnv();
 const table=compareMetrics((await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!,(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp(),now:NOW}))!);
 const comp=table.rows.find(r=>r.key==='comp_vs_market')!;assert.ok(comp.left.status==='value'&&comp.left.provenance==='fixture');assert.ok(comp.right.status==='value'&&comp.right.provenance==='fixture');
 const hours=table.rows.find(r=>r.key==='workload_hours')!;assert.equal(hours.responseType,'distribution');
 for(const cell of [hours.left,hours.right]){assert.equal(cell.status,'value');if(cell.status!=='value')continue;assert.equal(cell.value,null);assert.ok((cell.bands?.length??0)>0);}
 assert.equal(hours.left.status==='value'&&hours.left.median,47);
});
test('comparison says when a side could not apply the time filter or had nothing in the window',async()=>{
 const {env}=testEnv();const after=interp({event:pick('ev-nw-restructure-2025'),timeframe:'after_event'});
 const left=(await buildEvidence(env,{slug:'northwind-labs',interpretation:after,now:NOW}))!,right=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:after,now:NOW}))!;
 assert.equal(left.timeStatus,'applied');assert.equal(right.timeStatus,'not_applied');
 const table=compareMetrics(left,right);assert.equal(table.right.timeStatus,'not_applied');
 assert.ok(table.rows.length>0&&table.rows.every(r=>r.right.status==='filter_not_applied'),'never "not published" when the real cause is the unapplied filter');
 assert.ok(table.rows.some(r=>r.left.status==='value'));
 const lastYear=interp({timeframe:'last_year'});
 const nw=(await buildEvidence(env,{slug:'northwind-labs',interpretation:lastYear,now:NOW}))!,he=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:lastYear,now:NOW}))!;
 const rows=compareMetrics(nw,he).rows;
 assert.equal(rows.find(r=>r.key==='manager_trust')?.right.status,'outside_timeframe','Helios publishes it, but not for 2025');
 assert.equal(rows.find(r=>r.key==='exec_trust')?.right.status,'not_published','Helios never published it');
});

// Discovery.
test('discovery sorts hours lower-first by explicit unit and never averages across units',async()=>{
 const {env}=testEnv();const result=await discover(env,interp({topic:pick('workload'),focus:['workload'],view:pick('discovery')}),await getDirectory(env));
 assert.deepEqual(result.rows.map(r=>[r.company.slug,r.values[0]?.value]),[['meridian-retail',38],['helios-semiconductor',45],['northwind-labs',47]]);
 const v=result.rows[0]!.values[0]!;assert.equal(v.metricKey,'workload_hours');assert.equal(v.measure,'median');assert.equal(v.n,1750);assert.equal(v.period,'2026');assert.equal(v.releaseId,'r-056');
 assert.ok(result.rows.every(r=>r.kind==='sample'&&r.kindLabel==='Fictional demonstration'));assert.ok(result.notices.some(n=>/No real employer/.test(n)));
});
test('discovery follows the requested direction and lists employers lacking a requested metric as insufficient',async()=>{
 const {env}=testEnv();const result=await discover(env,interp({view:pick('discovery'),preferences:{exec_trust:'low'}}),await getDirectory(env));
 assert.deepEqual(result.rows.filter(r=>r.status==='match').map(r=>r.company.slug),['northwind-labs']);
 const insufficient=result.rows.filter(r=>r.status==='insufficient');assert.deepEqual(insufficient.map(r=>r.company.slug).sort(),['helios-semiconductor','meridian-retail']);
 assert.ok(insufficient.every(r=>r.missing.some(m=>m.concept==='exec_trust')&&r.rank===null));assert.ok(result.applied.some(a=>/at most 40% agree/.test(a)));
});
test('discovery matches survey_ keys so real employers are found, separated from fictional rows',async()=>{
 const {env,publicDb}=testEnv();addSurveyRelease(publicDb,'co-stripe','manager_trust',{value:80,n:25});
 const result=await discover(env,interp({view:pick('discovery'),preferences:{manager_trust:'high'}}),await getDirectory(env));
 const stripe=result.rows[0]!;assert.equal(stripe.company.slug,'stripe');assert.equal(stripe.kindLabel,'Real employer');assert.equal(stripe.values[0]?.metricKey,'survey_manager_trust');assert.equal(stripe.values[0]?.meetsThreshold,true);
 assert.equal(result.rows.some(r=>r.company.kind==='sample'&&r.status==='match'),false,'every fictional employer is below 70%');assert.ok(result.notices.some(n=>/did not meet the requested thresholds/.test(n)));
});
test('discovery never thresholds a category distribution',async()=>{
 const {env,publicDb}=testEnv();addSurveyRelease(publicDb,'co-stripe','workload',{distribution:true,bands:[['Under 40',50],['40–49',50]]});
 const result=await discover(env,interp({view:pick('discovery'),preferences:{workload_hours:'low'}}),await getDirectory(env));
 const stripe=result.rows.find(r=>r.company.slug==='stripe');assert.equal(stripe?.status,'insufficient');assert.deepEqual(stripe?.values,[]);
});
test('discovery ranks focus metrics one at a time and does not rank employers without them',async()=>{
 const {env}=testEnv();const result=await discover(env,interp({topic:pick('promotion'),focus:['promotion'],view:pick('discovery')}),await getDirectory(env));
 assert.deepEqual(result.rows.filter(r=>r.status==='match').map(r=>[r.company.slug,r.rank]),[['helios-semiconductor',1],['northwind-labs',2]]);
 assert.equal(result.rows.find(r=>r.company.slug==='meridian-retail')?.status,'insufficient');
});
test('discovery applies or explicitly reports every requested filter',async()=>{
 const {env}=testEnv();const directory=await getDirectory(env);
 const salary=await discover(env,interp({view:pick('discovery'),salaryDataRequired:true}),directory);assert.deepEqual(salary.rows,[]);assert.ok(salary.unsupported.length>0);
 const industry=await discover(env,interp({view:pick('discovery'),industry:'unsupported'}),directory);assert.deepEqual(industry.rows,[]);assert.ok(industry.unsupported.some(u=>/Industry/.test(u)));
 const fintech=await discover(env,interp({view:pick('discovery'),industry:'Semiconductors',focus:['workload']}),directory);assert.deepEqual(fintech.rows.map(r=>r.company.slug),['helios-semiconductor']);assert.ok(fintech.applied.includes('Industry: Semiconductors'));
 const event=await discover(env,interp({view:pick('discovery'),event:pick('ev-nw-restructure-2025'),timeframe:'after_event'}),directory);assert.ok(event.unsupported.some(u=>/Before\/after/.test(u)));assert.ok(event.notices.some(n=>/before\/after filter was not applied/.test(n)));
 const unknown=await discover(env,interp({view:pick('discovery'),preferences:{parking_quality:'high'}}),directory);assert.ok(unknown.unsupported.some(u=>/parking quality/.test(u)));
 const group=await discover(env,interp({view:pick('discovery'),focus:['culture'],cohorts:{fn:'Engineering',seniority:null}}),directory);
 const nw=group.rows.find(r=>r.company.slug==='northwind-labs');assert.equal(nw?.values.find(v=>v.concept==='return_intent')?.releaseId,'r-029');
 assert.ok(group.rows.filter(r=>r.company.slug!=='northwind-labs').every(r=>r.status==='insufficient'&&r.missing[0]?.concept==='group'));
});
test('discovery last_year uses only that year\'s releases on the supplied clock',async()=>{
 const {env}=testEnv();const directory=await getDirectory(env),i=interp({view:pick('discovery'),preferences:{exec_trust:'low'},timeframe:'last_year'});
 const y2025=await discover(env,i,directory,NOW),v=y2025.rows.find(r=>r.company.slug==='northwind-labs')?.values[0];
 assert.equal(v?.period,'2025');assert.equal(v?.value,33);assert.ok(y2025.applied.includes('Period: 2025 only'));
 const y2026=await discover(env,i,directory,new Date('2027-03-01T12:00:00Z'));assert.equal(y2026.rows.find(r=>r.company.slug==='northwind-labs')?.values[0]?.period,'2026');
 const empty=await discover(env,i,directory,new Date('2031-06-01T00:00:00Z'));assert.equal(empty.rows.some(r=>r.status==='match'),false,'nothing from other years is substituted');
});
test('discovery says how many employers it is not showing when rows are capped',async()=>{
 const {env,publicDb}=testEnv();
 for(let k=0;k<DISCOVERY_MAX_ROWS+5;k++){const id=`co-bulk-${String(k).padStart(3,'0')}`;publicDb.prepare("INSERT INTO companies(id,slug,name,kind,sector) VALUES(?,?,?,'real','Software')").bind(id,`bulk-${k}`,`Bulk Employer ${String(k).padStart(3,'0')}`).raw();addSurveyRelease(publicDb,id,'exec_trust',{value:80});}
 const result=await discover(env,interp({view:pick('discovery'),preferences:{exec_trust:'high'}}),await getDirectory(env),NOW);
 // 65 real matches plus Helios and Meridian (no executive-trust measure: insufficient); Northwind fails the threshold.
 assert.equal(result.rows.length,DISCOVERY_MAX_ROWS);assert.ok(result.notices.includes(`Showing ${DISCOVERY_MAX_ROWS} of ${DISCOVERY_MAX_ROWS+5+2} employers with published evidence.`),result.notices.join(' | '));
 assert.ok(result.rows.every(r=>r.kind==='real'),'real employers are listed before fictional ones');
});

// Candidate retrieval for ranking.
test('an older relevant account outranks newer irrelevant ones in bounded candidate retrieval',async()=>{
 const {env,publicDb}=testEnv();
 for(let k=0;k<15;k++)addAccount(publicDb,{id:`new-${String(k).padStart(2,'0')}`,body:'The cafeteria menu rotated weekly and the coffee machine was usually working.',published:'2026-Q3'});
 const ids=await rankCandidates(env,'co-northwind',interp(),'Do senior engineers need a sponsor approval for promotion packets?');
 assert.ok(ids.length<=12);assert.equal(ids[0],'t-006');
 const scoped=await rankCandidates(env,'co-northwind',interp({cohorts:{fn:'Sales',seniority:null}}),'quotas');assert.deepEqual(scoped,['t-003']);
 assert.deepEqual(await rankCandidates(env,'co-northwind',interp({cohorts:{fn:'Nonexistent',seniority:null}}),'quotas'),[]);
});
test('ranked candidates beyond the newest page stay reachable when pinned',async()=>{
 const {env,publicDb}=testEnv();
 for(let k=0;k<45;k++)addAccount(publicDb,{id:`new-${String(k).padStart(2,'0')}`,body:'The cafeteria menu rotated weekly and the coffee machine was usually working.',published:'2026-Q3'});
 assert.equal((await buildEvidence(env,{slug:'northwind-labs',interpretation:interp()}))!.testimony.some(t=>t.id==='t-006'),false);
 const ids=await rankCandidates(env,'co-northwind',interp(),'sponsor approval for promotion packets');
 assert.ok((await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),pinTestimonyIds:ids}))!.testimony.some(t=>t.id==='t-006'));
});
test('candidate retrieval applies the same chip overrides as the page',async()=>{
 const {env}=testEnv();
 assert.deepEqual(await rankCandidates(env,'co-northwind',interp(),'quotas',{cohortLabelOverride:'Sales'}),['t-003']);
 assert.deepEqual(await rankCandidates(env,'co-northwind',interp(),'leadership',{layerOverride:'opinion'}),['t-004']);
 assert.deepEqual(await rankCandidates(env,'co-northwind',interp({topic:pick('workload')}),'anything at all',{topicFilter:'promotion'}),['t-006']);
 assert.equal((await rankCandidates(env,'co-northwind',interp({cohorts:{fn:'Sales',seniority:null}}),'quotas',{cohortLabelOverride:null})).length,6,'removing the group chip widens the pool');
 assert.deepEqual(await rankCandidates(env,'co-northwind',interp(),'quotas',{cohortLabelOverride:'Only engineer in Dallas'}),[]);
});
test('one account pool serves ranking and the page; a pool for another employer is never used',async()=>{
 const {env,publicDb}=testEnv();
 const pool=await loadAccountPool(env,{id:'co-northwind',kind:'sample'});
 addAccount(publicDb,{id:'after-load',body:'A later account about the quarterly planning cadence.'});
 const reused=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),accountPool:pool,now:NOW}))!;
 assert.equal(reused.testimony.some(t=>t.id==='after-load'),false,'the request pool is reused rather than reloaded');
 const helios=await loadAccountPool(env,{id:'co-helios',kind:'sample'});
 const fresh=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),accountPool:helios,now:NOW}))!;
 assert.ok(fresh.testimony.some(t=>t.id==='after-load'));assert.equal(fresh.testimony.some(t=>['t-007','t-008','t-009','t-010'].includes(t.id)),false);
 assert.deepEqual(await rankCandidates(env,'co-northwind',interp(),'quotas',{pool,cohortLabelOverride:'Sales'}),['t-003']);
});
test('reader pages reach every matching account and say whether more exist',async()=>{
 const {env,publicDb}=testEnv();
 for(let k=0;k<45;k++)addAccount(publicDb,{id:`new-${String(k).padStart(2,'0')}`,body:'The cafeteria menu rotated weekly and the coffee machine was usually working.',published:'2026-Q3'});
 const first=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick('reader')}),now:NOW}))!;
 assert.equal(first.testimony.length,40);assert.deepEqual(first.testimonyPaging,{page:0,pageSize:40,matching:51,hasMore:true});
 const second=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick('reader')}),testimonyPage:1,now:NOW}))!;
 assert.equal(second.testimony.length,11);assert.equal(second.testimonyPaging.hasMore,false);
 const seen=new Set([...first.testimony,...second.testimony].map(t=>t.id));assert.equal(seen.size,51);assert.ok(seen.has('t-006'),'the oldest relevant account is reachable');
});
test('accounts beyond the loading cap are disclosed, not silently dropped',async()=>{
 const {env,publicDb}=testEnv();
 for(let k=0;k<=MAX_ACCOUNTS;k++)addAccount(publicDb,{id:`bulk-${String(k).padStart(4,'0')}`,body:'The cafeteria menu rotated weekly and the coffee machine was usually working.',published:'2026-Q3'});
 const e=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!;
 assert.ok(e.notices.some(n=>n.startsWith(`Only the newest ${MAX_ACCOUNTS} accounts`)));
 assert.equal((await buildEvidence(testEnv().env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!.notices.some(n=>/Only the newest/.test(n)),false);
});

// Emergent FAQ.
test('question specs are deterministic, round-trip, and paraphrases with the same typed fields collapse',()=>{
 const a=interp({topic:{value:'promotion',confidence:.91,probabilities:{promotion:.91}},view:{value:'overview',confidence:.8,probabilities:{}},model:'m1',notes:['first phrasing']});
 const b=interp({topic:{value:'promotion',confidence:.7,probabilities:{promotion:.7,management:.3}},view:{value:'overview',confidence:.95,probabilities:{}},model:'m2',notes:['second phrasing']});
 const sa=specFromInterpretation(a),sb=specFromInterpretation(b);assert.ok(sa&&sb);assert.equal(specId(sa),specId(sb));
 const spec:QuestionSpec={topic:'management',view:'reader',cohort:'Senior individual contributor',layer:'claim'};
 assert.deepEqual(parseSpecId(specId(spec)),spec);assert.equal(specWording(spec),'Senior individual contributor: Show me specific claims about management.');
 assert.equal(parseSpecId('q1:management:reader:x=1'),null);assert.equal(parseSpecId('q1:management:distribution'),null);assert.equal(parseSpecId('q1:bogus:overview'),null);
 assert.equal(specFromStoredId('remote')&&specId(specFromStoredId('remote')!),specId({topic:'location_policy',view:'reader'}));
 assert.deepEqual(starterSpecs.length,9);assert.ok(faqCatalog.every(q=>validSpec(q.spec)&&q.id===specId(q.spec)));
});
test('specFromInterpretation keeps only approved public cohort labels and documented event ids',()=>{
 const scope={cohorts:['Engineering'],events:['ev-nw-restructure-2025']};
 assert.equal(specFromInterpretation(interp({topic:pick('promotion'),cohorts:{fn:'Dana Smith team',seniority:null}}),scope),null,'free text never becomes a spec');
 assert.equal(specFromInterpretation(interp({topic:pick('promotion'),cohorts:{fn:'Engineering',seniority:null}})),null,'no scope, no cohort');
 assert.equal(specFromInterpretation(interp({topic:pick('promotion'),cohorts:{fn:'Engineering',seniority:null}}),scope)?.cohort,'Engineering');
 assert.equal(specFromInterpretation(interp({view:pick('timeline'),event:pick('ev-he-rto-2025')}),scope),null);
 assert.equal(specFromInterpretation(interp({view:pick('timeline'),event:pick('ev-nw-restructure-2025'),timeframe:'after_event'}),scope)?.event,'ev-nw-restructure-2025');
 assert.equal(specFromInterpretation(interp({view:pick('compare')}),scope),null);assert.equal(specFromInterpretation(interp({timeframe:'last_year'}),scope),null);
});
test('starter questions appear only where their evidence exists',async()=>{
 const {env}=testEnv();
 assert.deepEqual((await buildEvidence(env,{slug:'stripe',interpretation:interp()}))?.trail,[]);
 const nw=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp()}))!;const q=nw.trail.map(t=>t.question);
 assert.ok(q.includes('What changed after the 2025 restructuring?'));assert.ok(q.includes('What does a typical working week look like?'));
 assert.equal(q.includes('How does compensation compare with the market?'),false,'no pay distribution is published');
 assert.equal(q.includes('How are remote workers treated?'),false);assert.equal(q.includes('What experiences keep coming up?'),false,'no clusters exist');
 const layoffs=nw.trail.find(t=>t.question==='What changed after the 2025 restructuring?');assert.deepEqual(layoffs?.overrides,{topic:'layoffs',view:'timeline',cohort:null,event:'ev-nw-restructure-2025',layer:null,timeframe:'any'});
 const helios=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp()}))!;
 assert.ok(helios.trail.some(t=>t.question==='How are remote workers treated?'));assert.equal(helios.trail.some(t=>/restructuring/.test(t.question)),false,'Helios has no documented layoff or reorg');
 assert.ok(nw.trail.every(t=>t.origin==='starter'));
});
test('a popular question needs both the interest threshold and evidence, and counts are never displayed',async()=>{
 const {env,publicDb}=testEnv();const [now,,,oldest]=trailingQuarters(NOW),stale='2020-Q1';
 const add=(spec:QuestionSpec|string,period:string,count:number)=>publicDb.prepare('INSERT INTO faq_interest(company_id,canonical_id,period,count) VALUES(?,?,?,?)').bind('co-northwind',typeof spec==='string'?spec:specId(spec),period,count).raw();
 const popular:QuestionSpec={topic:'management',view:'reader',cohort:'Engineering'},almost:QuestionSpec={topic:'workload',view:'reader'},empty:QuestionSpec={topic:'location_policy',view:'overview'};
 add(popular,now!,FAQ_POPULAR_MIN-4);add(popular,oldest!,4);add(almost,now!,FAQ_POPULAR_MIN-1);add(almost,stale,50);add(empty,now!,500);add('free text question',now!,500);
 const e=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!;
 const entry=e.trail.find(t=>t.specId===specId(popular));assert.ok(entry,'10 opt-in counts in the trailing four quarters plus evidence');
 assert.equal(entry.origin,'popular');assert.equal(entry.question,'Engineering: Show me original accounts about management.');
 assert.equal(e.trail.some(t=>t.specId===specId(almost)),false,'below threshold inside the window');
 assert.equal(e.trail.some(t=>t.specId===specId(empty)),false,'a frequent question with no evidence is not an answered FAQ');
 const json=JSON.stringify(e.trail);assert.equal(/"(ask)?count"/i.test(json),false);assert.equal(/\b(500|10|9)\b/.test(json),false,'no interest number is exposed');assert.equal(json.includes('free text'),false);
 for(const t of e.trail)for(const f of t.followUps)assert.ok(parseSpecId(f.specId));
});
test('emergent questions keep reserved slots instead of being crowded out by starters',async()=>{
 const {env,publicDb}=testEnv();const [now]=trailingQuarters(NOW);
 const specs:QuestionSpec[]=[{topic:'management',view:'reader'},{topic:'layoffs',view:'reader'},{topic:'culture',view:'reader'},{topic:'workload',view:'reader'},{topic:'promotion',view:'reader'},{topic:'management',view:'timeline'},{topic:'promotion',view:'timeline'}];
 specs.forEach((s,k)=>publicDb.prepare('INSERT INTO faq_interest(company_id,canonical_id,period,count) VALUES(?,?,?,?)').bind('co-northwind',specId(s),now,50+k).raw());
 const trail=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!.trail;
 const starters=trail.filter(t=>t.origin==='starter'),popular=trail.filter(t=>t.origin==='popular');
 assert.equal(popular.length,FAQ_MAX_POPULAR,'every qualifying emergent question up to the reserved slots');assert.ok(trail.length<=FAQ_MAX_ENTRIES);
 assert.equal(starters.length,6,'Northwind keeps all six evidence-backed starters');
 assert.equal(trail[1]?.origin,'popular','emergent questions are interleaved, not appended after every starter');
 assert.equal(popular.some(t=>t.specId===specId(specs[0]!)),false,'the least-asked qualifying spec is the one left out');
});

// Deterministic answers, cohort view, account readings and lens relations.
const releaseIds=(e:{metrics:MetricView[]})=>new Set(e.metrics.flatMap(m=>m.series.map(p=>p.releaseId)));
test('answers are assembled only from released numbers: every fact cites a release in the payload and the headline repeats its numbers',async()=>{
 const {env}=testEnv();
 const e=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({topic:pick('promotion')}),now:NOW}))!;
 const a=answerFor({route:'metric_view',view:'overview',evidence:e})!;
 assert.equal(a.headline,'Promotion criteria are clear at Northwind Labs (fictional demonstration) fell from 49% agree (n=560, 2025) to 43% agree (n=360, 2026).');
 assert.ok(a.facts.length>0&&a.facts.length<=8);
 for(const f of a.facts){assert.ok(f.releaseId&&releaseIds(e).has(f.releaseId),f.label);assert.equal(typeof f.n,'number');}
 const cited=a.facts.find(f=>f.metricKey==='promotions_clarity')!;assert.equal(cited.value,'43% agree');assert.equal(cited.n,360);assert.equal(cited.period,'2026');
 assert.equal(answerFor({route:'cannot_safely_answer',view:'overview',evidence:e}),null);
 assert.equal(answerFor({route:'needs_generation',view:'overview',evidence:e})!.headline,a.headline,'needs_generation shows the same evidence answer, never prose');
});
test('a before/after headline states both measured values with n and period and names other events in the window',async()=>{
 const {env}=testEnv();
 const e=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick('timeline'),event:pick('ev-nw-restructure-2025'),timeframe:'any'}),now:NOW}))!;
 const a=answerFor({route:'timeline',view:'timeline',evidence:e})!;
 assert.equal(a.headline,'Would work here again at Northwind Labs (fictional demonstration) fell from 54% agree (n=701, 2024) before the 2025 restructuring to 21% agree (n=415, 2026) after it. The comparison window also contains the 2024 leadership change, so the change cannot be attributed to the 2025 restructuring alone.');
 assert.ok(a.facts.some(f=>f.label==='Would work here again, before'&&f.releaseId==='r-003'));assert.ok(a.facts.some(f=>f.label==='Would work here again, after'&&f.releaseId==='r-005'));
 const none=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({event:pick('ev-he-rto-2025'),timeframe:'after_event'}),now:NOW}))!;
 assert.match(answerFor({route:'metric_view',view:'overview',evidence:none})!.headline,/^Before\/after results need a documented, dated event/);
 const undated=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick('timeline'),event:pick('ev-he-rto-2025')}),now:NOW}))!;
 assert.ok(undated.notices.some(n=>n.startsWith('The selected event is not documented')));assert.doesNotMatch(answerFor({route:'timeline',view:'timeline',evidence:undated})!.headline,/before|after it/,'a refused event is never named as the cause');
});
test('distribution answers read the published bands and a documented median only',async()=>{
 const {env}=testEnv();
 const e=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick('distribution'),topic:pick('workload')}),now:NOW}))!;
 const a=answerFor({route:'distribution',view:'distribution',evidence:e})!;
 assert.equal(a.headline,'Typical weekly hours at Northwind Labs (fictional demonstration), 2026 (n=360): median 47 hours; the most common answer was 45 to 49 (33%).');
 assert.deepEqual(a.facts.map(f=>`${f.label}=${f.value}`),['Under 40=9%','40 to 44=26%','45 to 49=33%','50 to 54=20%','55 or more=12%']);
 const pay=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick('distribution'),topic:pick('compensation')}),now:NOW}))!;
 assert.match(answerFor({route:'distribution',view:'distribution',evidence:pay})!.headline,/^No published distribution matches/);
});
test('account counts below five are never stated, in the headline or as a topic count',async()=>{
 const {env,publicDb}=testEnv();
 const read=async()=>{const e=(await buildEvidence(env,{slug:'stripe',interpretation:interp({view:pick('reader')}),topicFilter:'compensation',now:NOW}))!;return {e,a:answerFor({route:'evidence',view:'reader',evidence:e})!};};
 let {e,a}=await read();assert.equal(a.headline,'No published accounts at Stripe match these filters.');assert.equal(e.accountsMentioning,null);
 const add=(k:number)=>addAccount(publicDb,{id:`pay-${k}`,company:'co-stripe',body:`Our bonus and salary bands were explained clearly in review number ${k}.`,cls:'Work mailbox verified; relationship self-reported',batch:'2026-Q3'});
 for(let k=0;k<MIN_ACCOUNT_COUNT-1;k++)add(k);
 ({e,a}=await read());assert.equal(a.headline,'Fewer than 5 published accounts at Stripe match these filters.');assert.equal(e.accountsMentioning,null);assert.equal(a.accountsMentioning,null);
 assert.equal(/\b[1-4]\b/.test(a.headline.replace('Fewer than 5','')),false);
 add(98);add(99);
 ({e,a}=await read());assert.equal(a.headline,'6 published accounts at Stripe match these filters.');assert.deepEqual(a.accountsMentioning,{topic:'compensation',count:6});
 assert.ok(!a.headline.includes('fictional'),'real employers are not labeled fictional');
});
test('fictional employers are labeled in every headline, and in every fact that names an employer',async()=>{
 const {env}=testEnv();
 for(const view of ['overview','timeline','distribution','cohort','clusters','reader'] as const) {
  const e=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp({view:pick(view),topic:pick(view==='distribution'?'workload':'other')}),now:NOW}))!;
  assert.match(answerFor({route:'metric_view',view,evidence:e})!.headline,/Helios Semiconductor \(fictional demonstration\)/,view);
 }
 const left=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!,right=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp(),now:NOW}))!;
 const a=answerFor({route:'comparison',view:'compare',evidence:left,comparison:compareMetrics(left,right)})!;
 assert.equal(a.headline,'Would work here again, 2026: Northwind Labs (fictional demonstration) 21% agree (n=415) and Helios Semiconductor (fictional demonstration) 63% agree (n=900).');
 assert.ok(a.facts.every(f=>f.label.includes('(fictional demonstration)')));
 const found=await discover(env,interp({focus:['management']}),await getDirectory(env),NOW);
 const d=answerFor({route:'discovery',view:'discovery',discovery:found})!;
 assert.ok(d.facts.length>0);
 assert.equal(d.headline,'Helios Semiconductor (fictional demonstration) ranks first among fictional demonstrations on manager keeps commitments: 69% agree (n=900, 2026).');
 const nothing=answerFor({route:'discovery',view:'discovery',discovery:await discover(env,interp({preferences:{manager_trust:'high'}}),await getDirectory(env),NOW)})!;
 assert.deepEqual(nothing.facts,[]);assert.match(nothing.headline,/^No employer/);
 for(const f of d.facts){const row=found.rows.find(r=>f.label.startsWith(`${companyLabel(r.company)}:`));assert.ok(row,f.label);if(row.kind==='sample')assert.ok(f.label.includes('(fictional demonstration)'));}
 assert.match(d.headline,/ranks first among (real employers|fictional demonstrations)/);
});
test('the cohort view puts the group beside the whole company for the same period and never substitutes',async()=>{
 const {env,publicDb}=testEnv();
 const e=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp({view:pick('cohort'),cohorts:{fn:null,seniority:'Remote'}}),now:NOW}))!;
 const rows=e.cohortComparison!;assert.ok(rows);
 const intent=rows.find(r=>r.key==='return_intent')!;
 const fixture={verificationMethod:'Illustrative fixture; not employee responses',provenance:'fixture'};
 assert.deepEqual(intent,{key:'return_intent',label:'Would work here again',unit:'percent',cohort:{value:52,n:190,period:'2026',releaseId:'r-046',cohortLabel:'Remote',...fixture},company:{value:63,n:900,period:'2026',releaseId:'r-036',cohortLabel:'All contributors',...fixture},status:'ok'});
 const wait=rows.find(r=>r.key==='promotion_wait_years')!;assert.equal(wait.status,'cohort_unavailable');assert.equal(wait.cohort,null);assert.equal(wait.company?.releaseId,'r-040');
 assert.ok(!rows.some(r=>r.key==='workload_hours'),'distributions have no value to compare');
 assert.equal(answerFor({route:'cohort',view:'cohort',evidence:e})!.headline,'Would work here again at Helios Semiconductor (fictional demonstration), 2026: Remote 52% agree (n=190) and the whole company 63% agree (n=900).');
 publicDb.prepare("INSERT INTO metric_releases(id,company_id,metric_id,cohort_id,period,value,n,release_batch,published_at) VALUES('r-small','co-helios','m-manager-trust','ch-he-remote','2026',80,7,'batch-2026-h1','2026-Q2')").raw();
 const small=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp({view:pick('cohort'),cohorts:{fn:null,seniority:'Remote'}}),now:NOW}))!;
 const trust=small.cohortComparison!.find(r=>r.key==='manager_trust')!;
 assert.equal(trust.status,'suppressed');assert.equal(trust.cohort,null);assert.equal(trust.company?.period,'2024','the complementary-suppressed company cell of that period is not shown either');
 assert.ok(!JSON.stringify(small).includes('"value":80'),'the suppressed cell never leaks');
 const none=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp({view:pick('cohort')}),now:NOW}))!;
 assert.deepEqual(none.cohortComparison,[]);assert.ok(none.notices.some(n=>n.startsWith("Choose one of this employer's published groups")));
 const unknown=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp({view:pick('cohort'),cohorts:{fn:'Nonexistent team',seniority:null}}),now:NOW}))!;
 assert.ok(unknown.cohortComparison!.length>0&&unknown.cohortComparison!.every(r=>r.status==='cohort_unavailable'&&r.cohort===null));
 assert.equal((await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp({cohorts:{fn:null,seniority:'Remote'}}),now:NOW}))!.cohortComparison,undefined,'only the cohort view carries the comparison');
});
test('account readings count confident model readings per dimension, omit dimensions under five, and ignore withheld accounts',async()=>{
 const {env,publicDb}=testEnv();
 const choice=(value:string,confidence=.9)=>({type:'choice',choice:value,confidence,probabilities:{[value]:confidence,unknown:1-confidence}});
 const analyze=(id:string,answers:Record<string,unknown>)=>publicDb.prepare('INSERT INTO evidence_analysis(testimony_id,analysis_json,model,prompt_version,source_hash) VALUES(?,?,?,?,?)').bind(id,JSON.stringify(answers),'jev-test','evidence-v3','h').raw();
 for(let k=0;k<6;k++)addAccount(publicDb,{id:`rd-${k}`,body:`Planning meetings were run openly in cycle ${k}.`});
 addAccount(publicDb,{id:'rd-named',body:'My manager Dana Smith ran the planning meetings openly every cycle.'});
 for(let k=0;k<5;k++)analyze(`rd-${k}`,{direct_manager:choice('negative'),workload:choice('mixed')});
 analyze('rd-5',{direct_manager:choice('positive'),workload:choice('mixed',.4)});
 analyze('rd-named',{direct_manager:choice('positive'),workload:choice('mixed')});
 analyze('t-001',{workload:choice('negative',.55)});
 const e=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!;
 // direct_manager has 5 negative and 1 positive reading: the single positive would be a count under five, so the dimension is left out.
 assert.deepEqual(e.accountReadings,[{dimension:'workload',accounts:5,positive:0,negative:0,mixed:5}]);
 const reader=answerFor({route:'evidence',view:'reader',evidence:e})!;
 assert.ok(reader.facts.length>0&&reader.facts.every(f=>f.label.startsWith('Model reading of written accounts, not votes:')));
 for(const f of reader.facts)assert.doesNotMatch(f.value,/\b[1-4]\b/,f.value);
 for(let k=6;k<10;k++){addAccount(publicDb,{id:`rd-${k}`,body:`Planning meetings were run openly in cycle ${k}.`});analyze(`rd-${k}`,{direct_manager:choice('positive')});}
 const grown=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!;
 assert.deepEqual(grown.accountReadings?.find(r=>r.dimension==='direct_manager'),{dimension:'direct_manager',accounts:10,positive:5,negative:5,mixed:0},'listed once every cell is 0 or at least five');
 for(let k=6;k<10;k++)publicDb.prepare('DELETE FROM evidence_analysis WHERE testimony_id=?').bind(`rd-${k}`).raw();
 publicDb.prepare("DELETE FROM evidence_analysis WHERE testimony_id='rd-0'").raw();
 const fewer=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!;
 assert.deepEqual(fewer.accountReadings,[],'workload drops below five, and direct_manager keeps a cell under five');
});
test('the Evidence Lens relates accounts and clusters to a metric by topic only, never by recency',async()=>{
 const {env,publicDb}=testEnv();
 const ids=['cl-1','cl-2','cl-3','cl-4','cl-5'];
 for(const id of ids)addAccount(publicDb,{id,body:`Promotion packets were returned without feedback during the ${id} review cycle.`});
 addPairs(publicDb,clique(ids));
 addAccount(publicDb,{id:'zz-newest',body:'The cafeteria menu rotated weekly and the coffee machine was usually working.',published:'2026-Q3'});
 addAccount(publicDb,{id:'named-promo',body:'My manager Dana Smith blocked every promotion packet on the team.'});
 const e=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!;
 const byId=new Map(e.testimony.map(t=>[t.id,t]));
 const clarity=e.metrics.find(m=>m.key==='promotions_clarity')!;
 assert.ok(clarity.related&&clarity.related.testimonyIds.length>0);
 for(const id of clarity.related.testimonyIds)assert.ok(byId.get(id)?.topicIds.includes('promotion'),id);
 assert.ok(!clarity.related.testimonyIds.includes('zz-newest')&&!clarity.related.testimonyIds.includes('named-promo'));
 assert.equal(e.clusters.length,1);assert.deepEqual(clarity.related.clusterKeys,[e.clusters[0]!.clusterKey]);
 const hours=e.metrics.find(m=>m.key==='workload_hours')!;assert.deepEqual(hours.related?.clusterKeys,[]);
 for(const m of e.metrics)for(const id of m.related?.testimonyIds??[])assert.ok(byId.get(id)?.topicIds.includes(m.topic!),`${m.key} ${id}`);
});
test('semantic retrieval candidates are kept only when they pass the page filters, and never fill every ranking slot',async()=>{
 const {env,publicDb}=testEnv();
 addAccount(publicDb,{id:'named-x',body:'My manager Dana Smith told everyone the quotas changed.'});
 const retrieved=['t-004','t-007','ghost','named-x','t-006'];
 assert.deepEqual((await rankCandidates(env,'co-northwind',interp(),'leadership',{retrieved})).slice(0,2),['t-004','t-006']);
 assert.deepEqual(await rankCandidates(env,'co-northwind',interp(),'quotas',{retrieved,cohortLabelOverride:'Sales'}),['t-003']);
 for(let k=0;k<12;k++)addAccount(publicDb,{id:`sem-${String(k).padStart(2,'0')}`,body:`An account about the quarterly planning cadence, number ${k}.`});
 const many=Array.from({length:12},(_,k)=>`sem-${String(k).padStart(2,'0')}`);
 const ranked=await rankCandidates(env,'co-northwind',interp(),'sponsor approval for promotion packets',{retrieved:many});
 assert.deepEqual(ranked.slice(0,SEMANTIC_CANDIDATES_MAX),many.slice(0,SEMANTIC_CANDIDATES_MAX));assert.ok(ranked.includes('t-006'),'a strong keyword match keeps a slot');
});
test('the scrubbed legacy class keeps its not-employment-verified label',()=>{
 assert.deepEqual(classifyTestimony('real',LEGACY_CREDENTIAL_CLASS,'2026-Q3'),{provenance:'sandbox',label:LEGACY_CREDENTIAL_LABEL});
 assert.deepEqual(classifyTestimony('sample',LEGACY_CREDENTIAL_CLASS,'batch-2026-h1'),{provenance:'sandbox',label:LEGACY_CREDENTIAL_LABEL});
});
test('a selected group is named in every answer headline and fact, so a group result never reads as the employer\'s',async()=>{
 const {env,publicDb}=testEnv();
 publicDb.prepare("INSERT INTO metric_releases(id,company_id,metric_id,cohort_id,period,value,n,release_batch,published_at) VALUES('r-eng-2024','co-northwind','m-return-intent','ch-nw-eng','2024',40,110,'batch-2024-h2','2024-11-01')").raw();
 publicDb.prepare("INSERT INTO metric_releases(id,company_id,metric_id,cohort_id,period,value,n,release_batch,published_at) VALUES('r-eng-hours','co-northwind','m-hours','ch-nw-eng','2026',49,120,'batch-2026-h1','2026-05-01')").raw();
 for(const [band,share,k] of [['Under 45',30,0],['45 or more',70,1]] as const)publicDb.prepare('INSERT INTO distribution_bands(release_id,band,share,sort_order) VALUES(?,?,?,?)').bind('r-eng-hours',band,share,k).raw();
 const eng={cohorts:{fn:'Engineering',seniority:null}};
 const answer=async(view:'overview'|'timeline'|'distribution'|'clusters'|'reader',extra:Partial<Interpretation>={})=>{
  const e=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick(view),topic:pick(view==='distribution'?'workload':'other'),...eng,...extra}),now:NOW}))!;
  assert.equal(e.cohortStatus,'selected');return answerFor({route:'metric_view',view,evidence:e})!;
 };
 const overview=await answer('overview');
 assert.equal(overview.headline,'Would work here again for Engineering at Northwind Labs (fictional demonstration) fell from 40% agree (n=110, 2024) to 24% agree (n=120, 2026).');
 const before=await answer('timeline',{event:pick('ev-nw-restructure-2025')});
 assert.match(before.headline,/^Would work here again for Engineering at Northwind Labs \(fictional demonstration\) fell from 40% agree \(n=110, 2024\) before the 2025 restructuring to 24% agree \(n=120, 2026\) after it\./);
 const series=await answer('timeline');assert.match(series.headline,/^Would work here again for Engineering at /);
 const hours=await answer('distribution');assert.match(hours.headline,/^Typical weekly hours for Engineering at Northwind Labs \(fictional demonstration\), 2026 \(n=120\)/);
 for(const a of [overview,before,series,hours]){assert.ok(a.facts.length>0,a.headline);for(const f of a.facts)assert.ok(f.label.endsWith('(Engineering)'),f.label);}
 assert.match((await answer('reader')).headline,/published accounts from Engineering at Northwind Labs/);
 assert.match((await answer('clusters')).headline,/accounts from Engineering describing/);
 const company=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now:NOW}))!;
 assert.doesNotMatch(answerFor({route:'metric_view',view:'overview',evidence:company})!.headline,/Engineering/,'company-wide answers name no group');
 const left=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(eng),now:NOW}))!,right=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp(),now:NOW}))!;
 const compared=answerFor({route:'comparison',view:'compare',evidence:left,comparison:compareMetrics(left,right)})!;
 assert.equal(compared.headline,'Would work here again, 2026: Engineering at Northwind Labs (fictional demonstration) 24% agree (n=120) and Helios Semiconductor (fictional demonstration) 63% agree (n=900).');
 assert.ok(compared.facts.filter(f=>f.label.includes('Northwind')).every(f=>f.label.includes('Engineering at Northwind Labs')));
 const found=await discover(env,interp({focus:['culture'],cohorts:{fn:'Engineering',seniority:null}}),await getDirectory(env),NOW);
 const d=answerFor({route:'discovery',view:'discovery',discovery:found})!;
 // Only Northwind Labs publishes an Engineering group, so it is not said to rank first against employers without one.
 assert.equal(d.headline,'Among fictional demonstrations, only Northwind Labs (fictional demonstration) has a published result on would work here again for Engineering: 24% agree (n=120, 2026). Employers without it are not ranked on it.');
 assert.ok(d.facts.length>0);for(const f of d.facts)assert.ok(f.label.endsWith('(Engineering)'),f.label);
});
test('the cohort view on an employer without published groups says so instead of asking for one',async()=>{
 const {env}=testEnv();
 const e=(await buildEvidence(env,{slug:'stripe',interpretation:interp({view:pick('cohort')}),now:NOW}))!;
 assert.deepEqual(e.cohortComparison,[]);assert.deepEqual(e.facets,[]);
 assert.ok(e.notices.includes('Stripe has no published groups, so there is nothing to compare with the whole company.'));
 assert.ok(!e.notices.some(n=>n.startsWith('Choose one of')),'never asks for a group that does not exist');
 assert.equal(answerFor({route:'cohort',view:'cohort',evidence:e})!.headline,'Stripe has no published groups, so there is nothing to compare with the whole company.');
});
test('every cohort fact opens in the lens: its release is in the payload with group, verification method and provenance',async()=>{
 const {env}=testEnv();
 const e=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp({view:pick('cohort'),cohorts:{fn:null,seniority:'Remote'}}),now:NOW}))!;
 const a=answerFor({route:'cohort',view:'cohort',evidence:e})!;
 const cells=new Map(e.cohortComparison!.flatMap(r=>[r.cohort,r.company]).filter(c=>c!==null).map(c=>[c.releaseId,c]));
 assert.ok(a.facts.length>0);
 for(const f of a.facts) {
  assert.ok(f.releaseId&&(releaseIds(e).has(f.releaseId)||cells.has(f.releaseId)),f.label);
  const cell=cells.get(f.releaseId!);assert.ok(cell,f.label);assert.ok(cell.verificationMethod&&cell.provenance&&cell.cohortLabel,f.label);
 }
 assert.ok([...cells.values()].some(c=>c.cohortLabel==='Remote')&&[...cells.values()].some(c=>c.cohortLabel==='All contributors'));
});
test('Evidence Lens relations stay inside the page\'s filters, so every related account can be reached by paging',async()=>{
 const {env,publicDb}=testEnv();
 addAccount(publicDb,{id:'mgr-only',body:'My manager cancelled every one-to-one for a quarter.'});
 addAccount(publicDb,{id:'mgr-promo',body:'My manager never explained the promotion criteria to anyone on the team.'});
 const e=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({view:pick('reader')}),topicFilter:'promotion',now:NOW}))!;
 const reachable=new Set(e.testimony.map(t=>t.id));assert.ok(!e.testimonyPaging.hasMore);
 const trust=e.metrics.find(m=>m.key==='manager_trust')!;
 assert.deepEqual(trust.related?.testimonyIds,['mgr-promo'],'a management account outside the promotion filter is not offered');
 for(const m of e.metrics)for(const id of m.related?.testimonyIds??[])assert.ok(reachable.has(id),`${m.key} ${id}`);
});

test('a group label is repeated only when some employer publishes it; otherwise the evidence, notices and answer say "the requested group"',async()=>{
 const {env}=testEnv();
 const {groupLabel,publishedGroupLabels,REQUESTED_GROUP,REQUESTED_GROUPS}=await import('../worker/src/evidence.ts');
 assert.deepEqual([...await publishedGroupLabels(env,['Engineering','Remote','Tiger team','All verified contributors'])].sort(),['Engineering','Remote'],'the whole-company group is not a group label');
 assert.equal(groupLabel(['Engineering'],new Set(['Engineering'])),'Engineering');
 assert.equal(groupLabel(['Tiger team'],new Set()),REQUESTED_GROUP);assert.equal(groupLabel(['Engineering','Tiger team'],new Set(['Engineering'])),REQUESTED_GROUPS);
 const e=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({cohorts:{fn:'Tiger team',seniority:null}}),now:NOW}))!;
 assert.equal(e.cohortStatus,'unavailable');assert.equal(e.cohortLabel,REQUESTED_GROUP);
 const answer=answerFor({route:'metric_view',view:'overview',evidence:e})!;
 assert.equal(answer.headline,'No privacy-approved release exists for the requested group at Northwind Labs (fictional demonstration).');
 assert.ok(!JSON.stringify({e,answer}).includes('Tiger team'));
 const elsewhere=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp({cohorts:{fn:'Engineering',seniority:null}}),now:NOW}))!;
 assert.equal(elsewhere.cohortLabel,'Engineering','published at another employer, so it may be named');
 const found=await discover(env,interp({cohorts:{fn:'Tiger team',seniority:null},view:pick('discovery')}),await getDirectory(env),NOW);
 assert.ok(found.applied.includes(`Group: ${REQUESTED_GROUP}`));assert.ok(!JSON.stringify(found).includes('Tiger team'));
 assert.ok(found.rows.every(r=>r.missing.every(m=>m.concept!=='group'||(m.label===REQUESTED_GROUP&&m.reason==='The requested group is not a published group at this employer'))));
});

// RT-A1 / RT-ABUSE-08: the question's own topic heads the measures and the answer; its absence is said, never replaced.
test('measures follow the question’s topic list, primary topic first, whatever order the focus arrives in',async()=>{
 const {env}=testEnv();
 const keys=async(o:Partial<Interpretation>)=>(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(o),now:NOW}))!.metrics.map(m=>m.key);
 assert.deepEqual((await keys({topic:pick('management'),focus:['layoffs','management','culture']})).slice(0,2),['manager_trust','bad_news_upward']);
 assert.equal((await keys({topic:pick('culture'),focus:['management','layoffs','culture']}))[0],'exec_trust','a culture question leads with trust in leadership, not "would work here again"');
 assert.equal((await keys({topic:pick('workload'),focus:['workload','management']}))[0],'workload_hours');
 // A topic chip replaces the reading; "all topics" keeps questionnaire order.
 const chip=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp({topic:pick('management')}),topicFilter:'promotion',now:NOW}))!;
 assert.equal(chip.metrics[0]!.key,'promotions_clarity');
});

test('the headline answers the asked topic: a median for weekly hours, the topic’s own before/after row, and a plain "none published" otherwise',async()=>{
 const {env}=testEnv();
 const build=(o:Partial<Interpretation>)=>buildEvidence(env,{slug:'northwind-labs',interpretation:interp(o),now:NOW}).then(e=>e!);
 const hours=await build({topic:pick('workload'),focus:['workload','management']});
 const a=answerFor({route:'metric_view',view:'overview',evidence:hours,topic:'workload'})!;
 assert.equal(a.headline,'Typical weekly hours at Northwind Labs (fictional demonstration), 2026 (n=360): median 47 hours.');
 assert.deepEqual([a.facts[0]!.label,a.facts[0]!.value,a.facts[0]!.n,a.facts[0]!.period],['Typical weekly hours (median)','47 hours',360,'2026']);
 assert.ok(a.facts.every(f=>f.releaseId&&releaseIds(hours).has(f.releaseId)),'every fact cites a published release');
 assert.doesNotMatch(a.headline,/rose|fell/,'a distribution never gets a delta');
 // No published measure for the asked topic: said plainly; the other measures stay as facts, never as the answer.
 const office=await build({topic:pick('location_policy')});
 const none=answerFor({route:'metric_view',view:'overview',evidence:office,topic:'location_policy'})!;
 assert.equal(none.headline,'No privacy-approved remote and office policy measure is published for Northwind Labs (fictional demonstration) yet.');
 assert.ok(none.facts.length>0);
 // Timeline around the restructuring: the asked topic's row, or a plain statement that it has none on both sides.
 const around=(topic:'management'|'culture'|'workload')=>build({topic:pick(topic),view:pick('timeline'),event:pick('ev-nw-restructure-2025')}).then(e=>answerFor({route:'timeline',view:'timeline',evidence:e,topic})!);
 assert.match((await around('management')).headline,/^Manager keeps commitments at Northwind Labs \(fictional demonstration\) fell from 66% agree \(n=690, 2024\) before the 2025 restructuring to 47% agree/);
 assert.match((await around('culture')).headline,/^Trust in executive leadership at Northwind Labs \(fictional demonstration\) fell from 52% agree/);
 const work=await around('workload');
 assert.equal(work.headline,'No workload measure at Northwind Labs (fictional demonstration) has a published period on both sides of the 2025 restructuring.');
 assert.ok(work.facts.length>0,'the other measures’ before/after values stay listed as facts');
 // Without a topic the first published measure answers, as before.
 assert.equal(answerFor({route:'metric_view',view:'overview',evidence:office})!.headline,answerFor({route:'metric_view',view:'overview',evidence:await build({})})!.headline);
});

// Round-3 verification, failure 5: a comparison answers the asked topic, or says plainly that it cannot.
test('a comparison answers the asked topic: workload compares the documented median hours, and a topic neither side publishes is said plainly, never replaced',async()=>{
 const {env}=testEnv();
 const side=(slug:string,topic:TopicId)=>buildEvidence(env,{slug,interpretation:interp({topic:pick(topic),focus:[topic],view:pick('compare')}),now:NOW}).then(e=>e!);
 const compare=async(topic:TopicId)=>{const left=await side('northwind-labs',topic),right=await side('helios-semiconductor',topic);return answerFor({route:'comparison',view:'compare',evidence:left,comparison:compareMetrics(left,right),topic})!;};
 const work=await compare('workload');
 assert.equal(work.headline,'Typical weekly hours, 2026: Northwind Labs (fictional demonstration) median 47 hours (n=360) and Helios Semiconductor (fictional demonstration) median 45 hours (n=900).');
 assert.deepEqual(work.facts.slice(0,2).map(f=>[f.label,f.value,f.n,f.period]),[['Typical weekly hours (median): Northwind Labs (fictional demonstration)','47 hours',360,'2026'],['Typical weekly hours (median): Helios Semiconductor (fictional demonstration)','45 hours',900,'2026']],'the workload facts lead');
 assert.ok(work.facts.every(f=>f.releaseId&&f.label.includes('(fictional demonstration)')));
 assert.doesNotMatch(work.headline,/Would work here again|rose|fell/,'never another measure, never a delta for a distribution');
 // No remote and office measure is published: said plainly; the other paired measures stay as facts, not as the answer.
 const office=await compare('location_policy');
 assert.equal(office.headline,'No remote and office policy measure is published for both Northwind Labs (fictional demonstration) and Helios Semiconductor (fictional demonstration) in a matching period.');
 assert.ok(office.facts.length>0);
 // A topic with a number on both sides answers with its own measure.
 assert.match((await compare('management')).headline,/^Manager keeps commitments, 2026: Northwind Labs \(fictional demonstration\) \d+% agree \(n=\d+\) and Helios Semiconductor/);
 // Discovery never says "ranks first" when no other employer of its kind publishes the measure (only Northwind Labs
 // publishes trust in executive leadership, which a culture question ranks by first).
 const culture=answerFor({route:'discovery',view:'discovery',discovery:await discover(env,interp({topic:pick('culture'),focus:['culture']}),await getDirectory(env),NOW)})!;
 assert.equal(culture.headline,'Among fictional demonstrations, only Northwind Labs (fictional demonstration) has a published result on trust in executive leadership: 29% agree (n=410, 2026). Employers without it are not ranked on it.');
 // The cohort view and the account readings follow the asked topic too.
 const e=(await buildEvidence(env,{slug:'helios-semiconductor',interpretation:interp({view:pick('cohort'),cohorts:{fn:null,seniority:'Remote'},topic:pick('management')}),now:NOW}))!;
 const cohort=answerFor({route:'cohort',view:'cohort',evidence:e,topic:'management'})!;
 // Helios publishes no management measure for its Remote group: said, and the published measures stay as facts.
 assert.equal(cohort.headline,'No privacy-approved management measure for the Remote group at Helios Semiconductor (fictional demonstration) can be shown beside the whole company.');
 assert.ok(cohort.facts.length>0);
 assert.match(answerFor({route:'cohort',view:'cohort',evidence:e})!.headline,/^Would work here again at Helios Semiconductor \(fictional demonstration\), 2026: Remote 52% agree/,'without a topic, as before');
 assert.match(answerFor({route:'cohort',view:'cohort',evidence:e,topic:'culture'})!.headline,/^(Trust in executive leadership|Would work here again) at Helios Semiconductor/,'a culture question leads with a culture measure');
});

// Round-3 verification, failure 6: the empty headline names the employer, and a group only when one was selected.
test('an empty record reads "No privacy-approved results are published for <Employer> yet.", naming a group only when one was selected, in sentence case',async()=>{
 const {env,publicDb}=testEnv();
 const answer=async(o:Partial<Interpretation>={})=>answerFor({route:'metric_view',view:'overview',evidence:(await buildEvidence(env,{slug:'stripe',interpretation:interp(o),now:NOW}))!})!;
 const stripe=await answer();
 assert.equal(stripe.headline,'No privacy-approved results are published for Stripe yet.');assert.deepEqual(stripe.facts,[]);
 assert.equal((await answer({timeframe:'last_year'})).headline,'No privacy-approved results are published for Stripe in the selected period.');
 publicDb.prepare("INSERT INTO cohorts(id,company_id,label,dimension,parent_id,public) VALUES('ch-st-eng','co-stripe','Engineering','function',NULL,1),('ch-st-ic','co-stripe','Senior IC','seniority',NULL,1),('ch-st-ldn','co-stripe','London','region',NULL,1)").raw();
 assert.equal((await answer({cohorts:{fn:'Engineering',seniority:null}})).headline,'No privacy-approved results are published for the engineering group at Stripe yet.');
 assert.equal((await answer({cohorts:{fn:null,seniority:'Senior IC'}})).headline,'No privacy-approved results are published for the senior IC group at Stripe yet.');
 assert.equal((await answer({cohorts:{fn:null,seniority:'London'}})).headline,'No privacy-approved results are published for the London group at Stripe yet.','a region may be a place name, so its case is kept');
 const {groupPhrase}=await import('../worker/src/evidence.ts');
 assert.deepEqual([groupPhrase('EMEA sales','function'),groupPhrase('Store operations','function'),groupPhrase('On-site','region'),groupPhrase('Hourly','employment_status'),groupPhrase('Platform group','function')],['the EMEA sales group','the store operations group','the On-site group','the hourly group','the platform group']);
 for(const o of [{},{timeframe:'last_year' as const},{cohorts:{fn:'Engineering',seniority:null}}])assert.doesNotMatch((await answer(o)).headline,/All contributors|All verified contributors/);
});

// RT-LINK-01: analysis order must not show which account was analysed (and so submitted) when.
test('RT-LINK-01: readings, reading-based topics, pair judgments and semantic retrieval of a release group appear together, once every account in it is analysed or its release quarter has ended',async()=>{
 const {env,publicDb}=testEnv();
 const SANDBOX='Sandbox contribution; not employment-verified',ids=['lk-0','lk-1','lk-2','lk-3','lk-4'];
 // NOW is in 2026-Q3, the quarter these accounts were released in (release_batch is the publication quarter).
 for(const id of ids)addAccount(publicDb,{id,body:`The planning meetings were cancelled again in sprint ${id.slice(-1)}.`,cls:SANDBOX,batch:'2026-Q3',published:'2026-Q3',period:'2026-Q2'});
 addAccount(publicDb,{id:'lk-named',body:'My manager Dana Smith cancelled the planning meetings again.',cls:SANDBOX,batch:'2026-Q3',published:'2026-Q3',period:'2026-Q2'});
 addPairs(publicDb,clique(ids));
 const choice=(value:string)=>({type:'choice',choice:value,confidence:.9,probabilities:{[value]:.9,unknown:.1}});
 const analyze=(id:string)=>publicDb.prepare('INSERT INTO evidence_analysis(testimony_id,analysis_json,model,prompt_version,source_hash) VALUES(?,?,?,?,?)').bind(id,JSON.stringify({direct_manager:choice('negative'),mentions_layoff:{type:'noul',noul:.9}}),'jev-test','evidence-v3','h').raw();
 const load=async(now=NOW)=>{const e=(await buildEvidence(env,{slug:'northwind-labs',interpretation:interp(),now}))!;return {e,item:(id:string)=>e.testimony.find(t=>t.id===id)!};};
 const ranked=(now=NOW)=>rankCandidates(env,'co-northwind',interp(),'planning meetings',{retrieved:['lk-4'],now});
 for(const id of ids.slice(0,4))analyze(id);
 let {e,item}=await load();
 for(const id of ids.slice(0,4)) {
  assert.equal(item(id).reading,undefined,`${id}: analysed, but its release group is not complete`);
  assert.ok(!item(id).topicIds.includes('layoffs')&&!item(id).topicIds.includes('management'),`${id}: no topic tag drawn from the held reading`);
 }
 assert.ok(!(e.accountReadings??[]).some(r=>r.dimension==='direct_manager'),'the model-reading tallies wait too');
 assert.equal(e.clusters.length,0,'pair judgments of a held group are not used');
 assert.notEqual((await ranked())[0],'lk-4','semantic retrieval never lifts an account of a held group');
 assert.equal((await loadAccountPool(env,{id:'co-northwind',kind:'sample'},NOW)).accounts.find(a=>a.id==='lk-0')!.analysisHeld,true);
 // The last analysable account lands: the whole group appears at once. The withheld account (a direct identifier) is
 // never analysed and never holds its group.
 analyze('lk-4');({e,item}=await load());
 for(const id of ids){assert.equal(item(id).reading?.dimensions.direct_manager.value,'negative',id);assert.ok(item(id).topicIds.includes('layoffs'),id);}
 assert.equal(item('lk-named').withheld,true);
 assert.deepEqual(e.accountReadings?.find(r=>r.dimension==='direct_manager'),{dimension:'direct_manager',accounts:5,positive:0,negative:5,mixed:0});
 assert.equal(e.clusters.length,1);assert.equal((await ranked())[0],'lk-4');
 // The fixed delay: once the release quarter has ended, a group shows what is analysed even if an account never is.
 addAccount(publicDb,{id:'lk-late',body:'The planning meetings moved to Fridays.',cls:SANDBOX,batch:'2026-Q3',published:'2026-Q3',period:'2026-Q2'});
 ({item}=await load());assert.equal(item('lk-0').reading,undefined,'a new unanalysed account in the same release group holds it again');
 ({item}=await load(new Date('2026-10-01T00:00:00Z')));assert.ok(item('lk-0').reading,'2026-Q3 has ended');assert.equal(item('lk-late').reading,undefined);
 // Groups are independent: another period, or an earlier release quarter, is not held by this one.
 addAccount(publicDb,{id:'lk-q1',body:'The planning meetings were fine in the first quarter.',cls:SANDBOX,batch:'2026-Q3',published:'2026-Q3',period:'2026-Q1'});analyze('lk-q1');
 addAccount(publicDb,{id:'lk-old',body:'Planning meetings ran on time last spring.',cls:SANDBOX,batch:'2026-Q2',published:'2026-Q2',period:'2026-Q2'});analyze('lk-old');
 addAccount(publicDb,{id:'lk-old-2',body:'Planning meetings were skipped last spring.',cls:SANDBOX,batch:'2026-Q2',published:'2026-Q2',period:'2026-Q2'});
 ({item}=await load());assert.ok(item('lk-q1').reading,'another period is its own group');assert.ok(item('lk-old').reading,'an earlier release quarter has ended');
 // Seeded fixtures (no quarter stamp) are never held.
 const {heldReleaseGroups}=await import('../worker/src/evidence.ts');
 assert.ok([...await heldReleaseGroups(env,'co-northwind',NOW)].every(k=>JSON.parse(k)[2]==='2026-Q3'));
});
