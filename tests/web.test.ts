import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,statSync,readdirSync} from 'node:fs';
import {testEnv} from './d1.ts';
import {stateUrl,parseState,stateOverrides,stateOf,neutralized,unpublished,portable,isPublishedCriterion,missingEmployer,REQUESTED_GROUP,STATE_KEYS,type TypedState} from '../web/share.ts';
import {localAnnotations,exactCompany,segments,recognised} from '../web/local-intent.ts';
import {ogImageResponse,hasOgImage} from '../worker/src/og.ts';
import {shellMeta,appShell,trustPage,footerHtml,TRUST_PAGES,THEME_SCRIPT,themeScriptResponse} from '../worker/src/pages.ts';
import {legalConfig} from '../worker/src/legal.ts';
import {testimonyBatchMin} from '../worker/src/flags.ts';
import {LEGAL_LINKS} from '../shared/brand.ts';
import {policy} from '../shared/policy.ts';
import {scanText,applySuggestion,articleFor} from '../shared/privacy.ts';
import type {CanvasResponse} from '../web/api.ts';
import {heldQuestions,tentativeForks,questionOf,offerable,probabilityLabel,MEANING_HEADING,type ForkView} from '../web/forks.ts';
import {liveStep,historyKind} from '../web/live.ts';
import {controlsRequest,carryInferred,idleTimeframe,idleTimeframeNotice} from '../web/controls.ts';
import {samplesOn,shownDirectory,publicationRules,accountsRule,aggregatesRule,homeExamples,REAL_EXAMPLES,listingName,domainOf,isCommunity,listingOpen,listingPowBits,employerLabel,displayName,withListing,communitySupplied,attachedDomains,type DirectoryCompany} from '../web/api.ts';
import {domainFrom,domainProblem,nameProblem,namesakesOf,listingConflict,mayAttach,namedListing,ADD_ERRORS,addErrorMessage,DOMAIN_ABUSIVE_MESSAGE} from '../web/listing.ts';
import {powHint,computeStamp,withPow,stampHolds,PowError,POW_CLIENT_MAX_BITS} from '../web/pow-client.ts';
import {nameProblem as serverNameProblem,domainAbuseProblem,addEmployer,INTERNAL_TOKEN_MIN} from '../worker/src/community.ts';
import {getDirectory} from '../worker/src/evidence.ts';
import {CLIENT_ISSUER_PINS} from '../worker/generated/client-assets.ts';
import {OG_IMAGES} from '../worker/generated/og-assets.ts';
import {checkPow,powPrefix,powSubject,powMinute,solvePow,POW_MIN_BITS,type PowBinding} from '../shared/pow.ts';
import {isCommunityKey,sameCommunityKey,canonicalJson,chooseIssuerKey,curatedMailboxKey,pinnedVerifier,verifierProblem,COMMUNITY_KEY_NOTE} from '../web/community-keys.ts';
import type {IssuerKey} from '../shared/proof.ts';
// @ts-expect-error: plain JavaScript tool module without type declarations.
import {seedCompanies,ogHtml} from '../tools/og.mjs';
// @ts-expect-error: plain JavaScript tool module without type declarations.
import {sampleSlugs,ogNamesFor} from '../tools/build.mjs';

/**
 * Which build wrote the generated assets, read from them rather than assumed: `node tools/build.mjs --local` (the local
 * stack, which shows the fictional sample employers and embeds their preview images) records the local issuer registry;
 * a release build records the production registry and leaves the fictional employers' preview images out.
 */
const LOCAL_BUILD=CLIENT_ISSUER_PINS.registry==='local';
const BUILD_HINT=`run node tools/build.mjs${LOCAL_BUILD?' --local':''}`;

const directory=[{slug:'northwind-labs',name:'Northwind Labs'},{slug:'helios-semiconductor',name:'Helios Semiconductor'},{slug:'stripe',name:'Stripe'},{slug:'meta',name:'Meta'}];

test('typed-state URLs carry only typed public identifiers, never question text',()=>{
 const url=stateUrl({slug:'northwind-labs',view:'compare',vs:'helios-semiconductor',topic:'promotion',cohort:'Engineering',event:'ev-nw-restructure-2025',layer:'claim',time:'after_event',faq:'q1:promotion:overview'});
 const params=new URL(url,'https://x').searchParams;
 assert.ok(url.startsWith('/c/northwind-labs?'));
 for(const key of params.keys())assert.ok((STATE_KEYS as readonly string[]).includes(key),`unexpected parameter ${key}`);
 assert.equal(params.get('q'),null);
 // A shared link that smuggles question text or markup is reduced to its typed state.
 const parsed=parseState('/c/northwind-labs','?q=my+manager+Sarah+is+awful&view=reader&cohort=%3Cscript%3E&event=../../etc&topic=gossip&vs=unlisted&pref=salary:high,__proto__:low,Bad:high,promotions_clarity:high');
 // Preferences are never part of a single-employer address, and 'salary' names no published criterion anyway.
 assert.deepEqual(parsed,{slug:'northwind-labs',view:'reader'});
 assert.equal(stateUrl(parsed),'/c/northwind-labs?view=reader');
 assert.equal(parseState('/c/..%2Fadmin','').slug,null);
 assert.equal(parseState('/c/%E0%A4%A','').slug,null,'malformed escapes are ignored, not thrown');
 assert.equal(stateUrl({slug:null,view:'overview'}),'/');
 assert.equal(stateUrl({slug:'x y',view:'discovery',sector:'none'}),'/?view=discovery');
});

test('a typed state round-trips through its URL and reproduces the same overrides',()=>{
 const states:TypedState[]=[{slug:'northwind-labs'},{slug:'northwind-labs',view:'timeline',event:'ev-nw-restructure-2025',time:'after_event',topic:'management'},{slug:null,view:'discovery',topic:'workload',sector:'Software',prefs:{return_intent:'high',workload_hours:'low'}},{slug:'helios-semiconductor',view:'cohort',cohort:'Hardware engineering'}];
 for(const s of states) {
  const url=new URL(stateUrl(s),'https://x');
  const back=parseState(url.pathname,url.search);
  assert.deepEqual(stateOverrides(back),stateOverrides(s));
 }
 assert.deepEqual(stateOverrides({slug:'stripe',view:'reader',layer:'claim'}),{company:'stripe',view:'reader',layer:'claim'});
});

test('the shared view is the committed view: fictional sides, groups and events come from the evidence, not the draft',()=>{
 const base={interpretation:{topic:{value:'promotion'},cohorts:{fn:null,seniority:null},event:null,layer:null,timeframe:'any',industry:null,preferences:{},compareTo:{value:'helios-semiconductor'}},evidence:{company:{slug:'northwind-labs'},cohortStatus:'selected',cohortLabel:'Engineering',selectedEvent:null},compareEvidence:{company:{slug:'helios-semiconductor'}},view:'compare'} as unknown as CanvasResponse;
 assert.deepEqual(stateOf(base),{slug:'northwind-labs',view:'compare',vs:'helios-semiconductor',topic:'promotion',cohort:'Engineering'});
 const unlisted={...base,view:'overview',interpretation:{...base.interpretation,compareTo:{value:'unlisted'}}} as unknown as CanvasResponse;
 assert.equal(stateOf(unlisted).vs,undefined,'sentinels never become link state');
});

test('a link cannot put unpublished group or industry words on a page, in the site voice or in a shared address',()=>{
 const planted='Employees fired for whistleblowing';
 const evidence=(o:Record<string,unknown>)=>({company:{slug:'stripe',name:'Stripe',kind:'real'},cohortStatus:'unavailable',cohortLabel:planted,facets:[{label:'Engineering',dimension:'function'},{label:'Senior IC',dimension:'seniority'}],notices:[`No privacy-approved release exists for ${planted}. Choose a broader group to continue.`],metrics:[],selectedEvent:null,...o});
 const crafted={view:'overview',interpretation:{topic:{value:'other'},cohorts:{fn:planted,seniority:null},event:null,layer:null,timeframe:'any',industry:null,preferences:{},compareTo:null,annotations:[{start:0,end:9,field:'cohort',value:planted,label:planted}],suggestions:[]},
  evidence:evidence({}),compareEvidence:null,discovery:[],notices:[`No privacy-approved release exists for ${planted}. Choose a broader group to continue.`,'Contributors choose to take part.'],
  answer:{headline:`No privacy-approved release exists for ${planted} at Stripe.`,facts:[],route:'metric_view'}} as unknown as CanvasResponse;
 assert.deepEqual(unpublished(crafted),{cohort:planted});
 const {response,dropped}=neutralized(crafted);
 assert.equal(dropped.cohort,planted);
 const shown=JSON.stringify(response);
 assert.ok(!shown.includes('whistleblowing'),'no field the page renders repeats the planted words');
 assert.equal(response.evidence!.cohortLabel,REQUESTED_GROUP);
 assert.equal(response.answer!.headline,'No published results exist for the requested group at Stripe.');
 assert.ok(response.notices.includes('Contributors choose to take part.'),'unrelated notices are kept');
 assert.equal(stateUrl(stateOf(response)),'/c/stripe','the address never carries the planted words');
 assert.deepEqual(neutralized(response).response,response,'neutralizing is idempotent');
 // A published group, or a join of published groups, is a public identifier and stays.
 for(const label of ['Engineering','Engineering + Senior IC']) {
  const real={...crafted,evidence:evidence({cohortLabel:label,notices:[]}),notices:[],answer:null} as unknown as CanvasResponse;
  assert.deepEqual(unpublished(real),{},label);assert.equal(neutralized(real).response,real);
  assert.equal(parseState('/c/stripe',new URL(stateUrl(stateOf(real)),'https://x').search).cohort,label);
 }
 // Discovery: a group no employer publishes, and an industry the directory does not list.
 const found={view:'discovery',evidence:null,compareEvidence:null,directory:[{slug:'northwind-labs',name:'Northwind Labs',kind:'sample',sector:'Software'}],notices:['Group filters match each employer’s own group label; definitions can differ between employers.'],answer:{headline:'No employer with published evidence meets every requested filter.',facts:[],route:'discovery'},
  applied:[`Group: ${planted}`],unsupported:['Industry: Tobacco lobbying'],discovery:[{company:{slug:'northwind-labs',name:'Northwind Labs',kind:'sample'},kind:'sample',values:[],missing:[{concept:'group',label:planted,reason:`${planted} is not a published group at this employer`}]}],
  interpretation:{...crafted.interpretation,industry:'Tobacco lobbying',annotations:[]}} as unknown as CanvasResponse;
 assert.deepEqual(unpublished(found),{cohort:planted,sector:'Tobacco lobbying'});
 const cleaned=neutralized(found).response,text=JSON.stringify(cleaned);
 assert.ok(!text.includes('whistleblowing')&&!text.includes('Tobacco'),text);
 assert.deepEqual(cleaned.applied,['Group: the requested group']);assert.deepEqual(cleaned.unsupported,['Industry: the requested industry']);
 assert.equal(cleaned.interpretation.industry,'unsupported','the filter stays visible and removable without its words');
 assert.equal(stateUrl(stateOf(cleaned)),'/?view=discovery');
 const listed={...found,interpretation:{...found.interpretation,cohorts:{fn:null,seniority:null},industry:'Software'},applied:['Industry: Software'],unsupported:[],discovery:[]} as unknown as CanvasResponse;
 assert.deepEqual(unpublished(listed),{});assert.equal(stateUrl(stateOf(listed)),'/?view=discovery&sector=Software');
});

test('a link or a reading cannot put its own words on a page as a criterion; only published criteria travel, and only in discovery',()=>{
 // Published criteria: the comparable measures discovery ranks on, their metric keys and aliases (worker/src/evidence.ts).
 for(const key of ['promotions_clarity','survey_manager_trust','workload_hours','compensation'])assert.ok(isPublishedCriterion(key),key);
 for(const key of ['salary','google_covers_up_harassment','constructor','__proto__','Bad','x_y'])assert.ok(!isPublishedCriterion(key),key);
 assert.deepEqual(parseState('/','?view=discovery&pref=zebra_quill:high,promotions_clarity:high'),{slug:null,view:'discovery',prefs:{promotions_clarity:'high'}});
 assert.deepEqual(parseState('/c/google','?pref=promotions_clarity:high,x_y:high'),{slug:'google'},'a single-employer address carries no preferences');
 assert.equal(parseState('/c/google','?view=discovery&pref=promotions_clarity:high').prefs?.promotions_clarity,'high');
 assert.equal(stateUrl({slug:'google',prefs:{promotions_clarity:'high'}}),'/c/google');
 assert.deepEqual(stateOverrides({slug:'google',prefs:{promotions_clarity:'high',x_y:'high'}}),{company:'google'});
 assert.deepEqual(stateOverrides({slug:null,view:'discovery',prefs:{promotions_clarity:'high',x_y:'high'}}),{view:'discovery',preferences:{promotions_clarity:'high'}});
 // A reply (from a reading of someone's words, or an older link) that echoes a criterion nothing publishes: its words
 // leave every field the page renders, and it is no longer a filter in effect.
 const echoed={view:'discovery',evidence:null,compareEvidence:null,directory:[],discovery:[],
  notices:['No comparable published measure exists for google covers up harassment; it was not applied.','Contributors choose to take part.'],
  unsupported:['Criterion: google covers up harassment'],applied:['Promotion criteria are clear: at least 70% agree; sorted highest first'],
  answer:{headline:'No employer with published evidence meets every requested filter.',facts:[],route:'discovery'},
  interpretation:{topic:{value:'other'},cohorts:{fn:null,seniority:null},event:null,layer:null,timeframe:'any',industry:null,compareTo:null,
   preferences:{google_covers_up_harassment:'high',promotions_clarity:'high'},
   annotations:[{start:0,end:6,field:'preferences',value:'google_covers_up_harassment',label:'google covers up harassment'}],
   suggestions:[{field:'preferences',key:'google_covers_up_harassment',value:'low',label:'Lower google covers up harassment'},{field:'preferences',key:'workload_hours',value:'low',label:'Lower typical weekly hours'}]}} as unknown as CanvasResponse;
 assert.deepEqual(unpublished(echoed),{criteria:['google_covers_up_harassment']});
 const {response}=neutralized(echoed),text=JSON.stringify(response);
 assert.ok(!/covers up|covers_up|harassment/.test(text),text);
 assert.deepEqual(response.unsupported,['Criterion: a requested criterion']);
 assert.equal(response.notices[0],'A requested criterion is not a published measure, so it was not applied.');
 assert.ok(response.notices.includes('Contributors choose to take part.'),'unrelated notices are kept');
 assert.deepEqual(response.applied,echoed.applied,'published criteria keep their wording');
 assert.deepEqual(response.interpretation.preferences,{promotions_clarity:'high'});
 assert.deepEqual(response.interpretation.suggestions.map(s=>s.key),['workload_hours']);
 assert.equal(stateUrl(stateOf(response)),'/?view=discovery&pref=promotions_clarity%3Ahigh');
 assert.deepEqual(neutralized(response).response,response,'neutralizing is idempotent');
});

test('the on-device detector takes a whole name, including two-letter surnames and appositive commas, so no part survives an approved edit',()=>{
 const named=(text:string)=>scanText(text).filter(f=>f.kind==='named_person').map(f=>f.excerpt);
 assert.deepEqual(named('My manager Dana Wu told me the only senior engineer would be cut.'),['My manager Dana Wu']);
 assert.deepEqual(named('Our director Mark Li said the plan changed.'),['Our director Mark Li']);
 assert.deepEqual(named('Jenny Wu told me the team was cut.'),['Jenny Wu']);
 assert.deepEqual(named('Kevin Li said my review was cancelled.'),['Kevin Li']);
 assert.deepEqual(named('My manager, Dana Lee, told me that.'),['My manager, Dana Lee,']);
 assert.deepEqual(named('Yesterday Dana Lee told me.'),['Dana Lee']);
 assert.deepEqual(named('I was reporting to Sarah Ng in 2024.'),['reporting to Sarah Ng']);
 // A capitalized word left beside a replacement (an older edit, or typed later) is flagged again.
 assert.deepEqual(named('my manager Wu said so.'),['my manager Wu']);
 assert.deepEqual(named('the person involved Li said so.'),['the person involved Li']);
 // The same rule refuses such a search on the server before anything reaches hosted Jev.
 assert.ok(scanText('Jenny Wu told me the team was cut').some(f=>f.severity==='high'));
 assert.deepEqual(named('On March 11 the team met. In May it changed.'),[],'dates and sentence starts are not names');
 for(const [text,to] of [['My manager Dana Lee','my manager'],['Our manager Dana','our manager'],['My colleague Sam Oh','my colleague'],['Our director Mark Li','the person involved'],['reporting to Sarah Ng','reporting to a manager']] as const)
  assert.equal(scanText(`${text} said so.`).find(f=>f.kind==='named_person')?.suggestions[0]?.to,to,text);
});

test('suggested generalizations read as sentences: an article by sound, and a date with its preposition',()=>{
 for(const [role,article] of [['staff engineer','a'],['senior engineer','a'],['frontend engineer','a'],['ML engineer','an'],['UX designer','a'],['HR analyst','an'],['engineer','an'],['iOS engineer','an'],['unique engineer','a']] as const)assert.equal(articleFor(role),article,role);
 const date=(text:string)=>scanText(text).filter(f=>f.kind==='exact_date').map(f=>[f.excerpt,f.suggestions[0]?.to]);
 assert.deepEqual(date('He told me on March 11 that it was over.'),[['on March 11','around then']]);
 assert.deepEqual(date('By March 11, 2026, everyone knew.'),[['By March 11, 2026','by then']]);
 assert.deepEqual(date('It happened 2026-03-02.'),[['2026-03-02','around that time']]);
 assert.deepEqual(date('Since 3/11/2025 nothing changed.'),[['Since 3/11/2025','since then']]);
 assert.deepEqual(date('It was announced on the 11th of March.'),[['on the 11th of March','around then']]);
 const text='They let the only staff engineer go. Our only UX designer left.';
 assert.equal(scanText(text).reduce((t,f)=>applySuggestion(t,f.suggestions[0]!),text),'They let a staff engineer go. a UX designer left.','the editor restores the sentence capital (tests/browser-contribute.spec.ts)');
});

// Shapes the live server returned for "how political is engineering?" (round-3 probes of POST /api/canvas). The polished
// server no longer asks a view question beside a meaning; the client still leads with the meaning if a reply does.
const MEANING:ForkView={field:'topic',kind:'meaning',question:'Which meaning did you intend?',tier:'fork',options:[{id:'culture',label:'Leadership and team culture',share:.84},{id:'management',label:'Manager politics: favoritism and reviews',share:.09},{id:'promotion',label:'Promotion politics: who gets promoted and why',share:.07}]};
const VIEW_ASK:ForkView={field:'view',question:'What would you like to see?',tier:'ask',options:[{id:'overview',label:'Workplace record',share:.5},{id:'discovery',label:'Explore employers',share:.27},{id:'reader',label:'Original testimony',share:.1}]};
const COMPANY_ASK:ForkView={field:'company',question:'Which employer do you mean?',tier:'ask',options:[{id:'northwind-labs',label:'Northwind Labs',share:.5},{id:'none',label:'No specific employer',share:.4}]};

test('a held reply leads with the meaning fork, whatever its tier, and never asks a generic view question in its place',()=>{
 // Home page, live in round 3: the meaning applied tentatively and a view question asked, so the reply was held with only
 // the view question showing. The meaning is now the one question, under its own heading.
 assert.deepEqual(heldQuestions([MEANING,VIEW_ASK]),[MEANING]);
 assert.equal(questionOf(heldQuestions([MEANING,VIEW_ASK])[0]!),MEANING_HEADING);
 assert.equal(MEANING_HEADING,'What did you mean?');
 // The same whatever the order, the meaning's tier (a server may raise it to an ask) or the view question's tier.
 assert.deepEqual(heldQuestions([VIEW_ASK,{...MEANING,tier:'ask'}]),[{...MEANING,tier:'ask'}]);
 assert.deepEqual(heldQuestions([{...VIEW_ASK,tier:'fork'},MEANING]),[MEANING]);
 assert.deepEqual(heldQuestions([{...VIEW_ASK,tier:undefined},MEANING]),[MEANING],'a tierless view fork from an older server is still a view question');
 // Other questions still follow it; tentative readings other than a meaning are not questions.
 const eventFork:ForkView={field:'event',question:'Which documented event?',tier:'fork',options:[{id:'ev-1',label:'2025 restructuring',share:.7}]};
 assert.deepEqual(heldQuestions([COMPANY_ASK,eventFork,MEANING,VIEW_ASK]),[MEANING,COMPANY_ASK]);
 // Without a meaning, nothing changes: every ask, and every tierless fork (older servers), in the server's order.
 const tierless:ForkView={field:'timeframe',question:'Which period should we use?',options:[{id:'any',label:'All periods',share:0}]};
 assert.deepEqual(heldQuestions([COMPANY_ASK,eventFork,VIEW_ASK,tierless]),[COMPANY_ASK,VIEW_ASK,tierless]);
 assert.equal(questionOf(VIEW_ASK),'What would you like to see?');
 assert.equal(questionOf({...MEANING,kind:undefined}),'Which meaning did you intend?','a plain topic fork keeps the server’s question');
 assert.deepEqual(heldQuestions([]),[]);
});

test('tentative readings show a meaning first, and never a fork with nothing left to offer',()=>{
 const viewFork:ForkView={...VIEW_ASK,question:'Which view best answers this?',tier:'fork'};
 const companyFork:ForkView={field:'company',question:'Which employer?',tier:'fork',options:[{id:'northwind-labs',label:'Northwind Labs',share:.77},{id:'unlisted',label:'An employer we don’t list',share:.21}]};
 const others=(f:ForkView)=>f.options.slice(1);
 assert.deepEqual(tentativeForks([companyFork,MEANING,viewFork],others).map(f=>f.field),['topic','company','view']);
 // A reading whose other options were all filtered out (only the applied value is left) offers nothing to choose.
 const lone:ForkView={...companyFork,options:[companyFork.options[0]!]};
 assert.deepEqual(tentativeForks([lone,viewFork],others),[viewFork]);
 assert.deepEqual(tentativeForks([VIEW_ASK,{...MEANING,tier:'ask'}],others),[],'an ask is a question, not a tentative reading');
});

test('a fork option’s share is always labelled as the model’s, and an offered share never reads as 0%',()=>{
 assert.equal(probabilityLabel(.84),'84% model probability');
 assert.equal(probabilityLabel(.07),'7% model probability');
 // The server now offers every meaning Jev gave any share, so a tiny share must not read as zero.
 assert.equal(probabilityLabel(.004),'<1% model probability');
 assert.equal(probabilityLabel(.005),'1% model probability');
 assert.equal(probabilityLabel(1),'100% model probability');
});

test('a reply without an employer offers no view that needs one',()=>{
 // Home page, seen live before the server's polish, not held: discovery shown, with a tentative view reading of
 // 'Workplace record' at 59%. The client does not rely on the server leaving such a reading out.
 const viewFork:ForkView={field:'view',question:'Which view best answers this?',tier:'fork',options:[{id:'overview',label:'Workplace record',share:.59},{id:'discovery',label:'Explore employers',share:.22},{id:'clusters',label:'Recurring experiences',share:.07}]};
 const shown=offerable([MEANING,viewFork],false);
 assert.deepEqual(shown,[MEANING,{...viewFork,options:[viewFork.options[1]!]}]);
 // Discovery is what is already shown, so the view reading has nothing left to offer and is not shown at all.
 const applied=(f:ForkView)=>f.options.filter(o=>o.id!==(f.field==='view'?'discovery':'culture'));
 assert.deepEqual(tentativeForks(shown,applied),[MEANING]);
 // A held view question with no employer keeps only discovery; one with nothing that can open is dropped.
 assert.deepEqual(offerable([VIEW_ASK],false),[{...VIEW_ASK,options:[VIEW_ASK.options[1]!]}]);
 assert.deepEqual(offerable([{...VIEW_ASK,options:VIEW_ASK.options.filter(o=>o.id!=='discovery')},COMPANY_ASK],false),[COMPANY_ASK]);
 // With an employer every view can open, and other fields are never filtered.
 assert.deepEqual(offerable([MEANING,viewFork,COMPANY_ASK],true),[MEANING,viewFork,COMPANY_ASK]);
});

test('pinned events and groups stay with the employer they were chosen on',()=>{
 const pins={event:'ev-nw-leadership-2024',cohort:'Engineering',timeframe:'after_event',topic:'promotion',layer:'claim',view:'timeline',preferences:{workload_hours:'low' as const}};
 assert.deepEqual(portable(pins),{topic:'promotion',layer:'claim',view:'timeline',preferences:{workload_hours:'low'}});
 assert.deepEqual(portable({timeframe:'last_year',industry:'Software',salaryDataRequired:false}),{timeframe:'last_year',industry:'Software',salaryDataRequired:false},'a calendar period means the same everywhere');
});

test('the semantic cursor matches directory names, groups, events and topics on the device, with exact offsets',()=>{
 const calls:string[]=[];const realFetch=globalThis.fetch;
 globalThis.fetch=(async(input:unknown)=>{calls.push(String(input));throw new Error('network');}) as typeof fetch;
 try {
  const text='How have promotions changed at Northwind Labs since the 2025 restructuring for engineers?';
  const marks=localAnnotations(text,{directory,cohorts:['Engineering','Senior individual contributor'],events:[{id:'ev-nw-restructure-2025',label:'2025 restructuring'}]});
  const by=(field:string)=>marks.filter(m=>m.field===field);
  assert.equal(by('company')[0]?.value,'northwind-labs');
  assert.equal(text.slice(by('company')[0]!.start,by('company')[0]!.end),'Northwind Labs');
  assert.equal(by('event')[0]?.value,'ev-nw-restructure-2025');
  assert.equal(text.slice(by('event')[0]!.start,by('event')[0]!.end),'2025 restructuring','the documented event wins over the topic word inside it');
  assert.ok(by('topic').some(m=>m.value==='promotion'));
  assert.ok(by('cohort').some(m=>m.value==='Engineering'&&text.slice(m.start,m.end)==='engineers'));
  assert.ok(by('view').some(m=>m.value==='timeline'));
  for(let i=1;i<marks.length;i++)assert.ok(marks[i]!.start>=marks[i-1]!.end,'annotations never overlap');
  assert.deepEqual(recognised(marks).map(r=>r.field).slice(0,2),['topic','view']);
  assert.deepEqual(calls,[],'typing never touches the network');
 } finally {globalThis.fetch=realFetch;}
 assert.deepEqual(localAnnotations('',{directory}),[]);
 assert.deepEqual(localAnnotations('metadata and metaphors',{directory}),[],'employer names match whole words only');
});

test('only a question that is exactly a listed name navigates without hosted inference',()=>{
 assert.equal(exactCompany('  northwind labs ',directory),'northwind-labs');
 assert.equal(exactCompany('Northwind',directory),'northwind-labs');
 assert.equal(exactCompany('Is Northwind Labs a good place to work?',directory),null);
 assert.equal(exactCompany('',directory),null);
 assert.equal(exactCompany('x'.repeat(200),directory),null);
});

test('cursor segments reproduce the text exactly, whatever the annotations',()=>{
 const text='Compare Northwind Labs and Helios Semiconductor on promotions';
 const cases=[[],[{start:8,end:22}],[{start:8,end:22},{start:27,end:47}],[{start:0,end:500}],[{start:30,end:10}],[{start:8,end:22},{start:10,end:30}]];
 for(const annotations of cases) {
  const parts=segments(text,annotations);
  assert.equal(parts.map(p=>p.text).join(''),text);
 }
});

test('the on-device modules cannot reach the network or storage',()=>{
 for(const file of ['web/local-intent.ts','shared/safety.ts','web/live.ts','web/controls.ts']) {
  const source=readFileSync(file,'utf8');
  assert.doesNotMatch(source,/\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB/,file);
 }
 assert.match(readFileSync('web/canvas/composer.tsx','utf8'),/detectCrisis\(value\)/,'the composer runs the crisis check on the draft locally');
 // The canvas keeps only two explicit choices in browser storage: the theme and the Live understanding switch (both disclosed).
 const web=['web/app.tsx','web/main.tsx','web/share.ts','web/api.ts','web/forks.ts','web/live.ts','web/controls.ts','web/canvas/views.tsx','web/canvas/parts.tsx','web/canvas/composer.tsx','web/canvas/lens.tsx','web/canvas/rail.tsx'].map(f=>readFileSync(f,'utf8')).join('\n');
 assert.deepEqual([...web.matchAll(/localStorage\.(\w+)\(([^,)]*)/g)].map(m=>`${m[1]}(${m[2]})`).sort(),['getItem(LIVE_KEY)','getItem(THEME_KEY)','removeItem(THEME_KEY)','setItem(LIVE_KEY)','setItem(THEME_KEY)'].sort());
 assert.doesNotMatch(web,/sessionStorage|indexedDB|document\.cookie/);
});

test('the theme script keeps only an explicit theme choice, and forgets it on returning to the system theme',async()=>{
 assert.deepEqual([...THEME_SCRIPT.matchAll(/localStorage\.(\w+)\(/g)].map(m=>m[1]).sort(),['getItem','removeItem','setItem']);
 assert.match(THEME_SCRIPT,/const k="siwt-theme"/);
 assert.doesNotMatch(THEME_SCRIPT,/fetch|XMLHttpRequest|sendBeacon|cookie|sessionStorage|indexedDB/);
 const response=themeScriptResponse();assert.equal(response.headers.get('content-type'),'application/javascript');assert.equal(await response.text(),THEME_SCRIPT);
 const store=new Map([['siwt-theme','dark']]),on:Record<string,()=>void>={};
 const root={dataset:{} as Record<string,string>},metas=[{content:'',setAttribute(_:string,v:string){this.content=v;}}];
 const button={hidden:true,dataset:{} as Record<string,string>,label:'',setAttribute(_:string,v:string){this.label=v;},addEventListener(_:string,f:()=>void){on.click=f;}};
 const doc={documentElement:root,querySelectorAll:()=>metas,querySelector:()=>button,getElementById:()=>null};
 const storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>void store.set(k,v),removeItem:(k:string)=>void store.delete(k)};
 new Function('document','localStorage','matchMedia','addEventListener',THEME_SCRIPT)(doc,storage,()=>({matches:false,addEventListener(){}}),(type:string,f:()=>void)=>{on[type]=f;});
 assert.equal(root.dataset.theme,'dark','a stored choice applies before first paint');assert.equal(metas[0]!.content,'#0D1222');
 on.DOMContentLoaded!();assert.equal(button.hidden,false);assert.equal(button.label,'Switch to light theme');
 on.click!();assert.equal(root.dataset.theme,undefined);assert.deepEqual([...store.keys()],[],'choosing the system theme removes the stored choice');
 on.click!();assert.deepEqual([...store.entries()],[['siwt-theme','dark']]);
});

test('the error screen claims neither that nothing was sent nor that something was',()=>{
 // It wraps the contribution, jury and status routes too, where a request may already have been sent before a render error.
 const source=readFileSync('web/main.tsx','utf8');
 assert.doesNotMatch(source,/Nothing you typed was submitted/);
 assert.match(source,/This error does not undo anything you had already sent\./);
});

test('seeded employers have their own Open Graph image within the size and dimension limits; only a local build embeds the fictional ones',()=>{
 const jpegSize=(bytes:Buffer)=>{for(let i=2;i<bytes.length;){if(bytes[i]!==0xff)return null;const marker=bytes[i+1]!,length=bytes.readUInt16BE(i+2);if(marker>=0xc0&&marker<=0xc3)return {height:bytes.readUInt16BE(i+5),width:bytes.readUInt16BE(i+7)};i+=2+length;}return null;};
 const companies=seedCompanies() as Array<{slug:string;name:string;kind:string}>;
 assert.ok(companies.length>=12);
 // The build's list of fictional employers is the seed's.
 assert.deepEqual([...(sampleSlugs() as string[])].sort(),companies.filter(c=>c.kind==='sample').map(c=>c.slug).sort());
 for(const name of ['home',...companies.map(c=>`c-${c.slug}`)]) {
  const file=`web/og/${name}.jpg`;assert.ok(existsSync(file),`${file} is missing; run node tools/og.mjs`);
  assert.ok(statSync(file).size<=90*1024,`${file} is over 90 KB`);
  assert.deepEqual(jpegSize(readFileSync(file)),{width:1200,height:630});
 }
 assert.ok(hasOgImage('home'),`home is not embedded; ${BUILD_HINT}`);
 for(const company of companies) {
  const name=`c-${company.slug}`;
  if(company.kind==='sample')assert.equal(hasOgImage(name),LOCAL_BUILD,LOCAL_BUILD?`${name} is not embedded; ${BUILD_HINT}`:`${name} is a fictional employer's image, embedded in a release build`);
  else assert.ok(hasOgImage(name),`${name} is not embedded; ${BUILD_HINT}`);
 }
 // Exactly the images this build mode embeds: every file in web/og, less the fictional employers' in a release build.
 const files=readdirSync('web/og').map(f=>/^([a-z0-9][a-z0-9-]{0,99})\.jpg$/.exec(f)?.[1]).filter((n):n is string=>!!n);
 assert.deepEqual(Object.keys(OG_IMAGES).sort(),[...(ogNamesFor(files,{local:LOCAL_BUILD}) as string[])].sort(),BUILD_HINT);
});

test('every employer in the directory the worker serves names an Open Graph image the worker serves: its own, or the home image',async()=>{
 // The same directory the worker reads: the seed plus every migration (0009 adds the curated real employers).
 const {env}=testEnv();
 const served=(await env.DB.prepare('SELECT slug,kind FROM companies ORDER BY slug').all<{slug:string;kind:string}>()).results;
 const seeded=new Set((seedCompanies() as Array<{slug:string}>).map(c=>c.slug));
 assert.ok(served.length>seeded.size,'migrations add employers beyond the seed');
 for(const company of served) {
  const image=new URL((await shellMeta(env,`/c/${company.slug}`,new URLSearchParams())).image).pathname,own=hasOgImage(`c-${company.slug}`);
  assert.ok(ogImageResponse(image),`${company.slug}: ${image} is not served`);
  assert.ok(image==='/og/home.jpg'||(own&&image===`/og/c-${company.slug}.jpg`),`${company.slug}: ${image}`);
  // A fictional employer has its own labeled image in a local build; a release build has none, so it gets the home image.
  if(company.kind==='sample')assert.equal(own,LOCAL_BUILD,`${company.slug}: ${LOCAL_BUILD?'a local build embeds the fictional employer’s labeled image':'a release build embeds no fictional employer’s image'}`);
 }
});

test('share images label fictional employers and carry no statistics',()=>{
 const text=(html:string)=>html.replace(/<style>[\s\S]*?<\/style>/,'').replace(/<svg[\s\S]*?<\/svg>/g,'').replace(/<[^>]+>/g,' ');
 const sample=text(ogHtml({kind:'sample',name:'Northwind Labs'})),real=text(ogHtml({kind:'real',name:'Stripe'}));
 assert.match(sample,/Fictional demonstration/);assert.match(sample,/fictional employer/);
 assert.doesNotMatch(sample,/\d/,'no numbers in a fictional card');
 const batch=String(policy.retention.minimumBatch);
 assert.match(real,new RegExp(`This record opens after ${batch} verified coworkers contribute`),'the card states the executable policy, not a copy of it');
 assert.deepEqual(real.match(/\d+/g),[batch],'the only number on a real employer card is the publication rule');
 assert.match(text(ogHtml({kind:'real',name:'<img src=x onerror=alert(1)>'})),/&lt;img/,'names are escaped');
});

test('Open Graph images are served only for known names, as JPEG',async()=>{
 const ok=ogImageResponse('/og/home.jpg');
 assert.equal(ok?.status,200);assert.equal(ok?.headers.get('content-type'),'image/jpeg');
 const bytes=new Uint8Array(await ok!.arrayBuffer());assert.deepEqual([bytes[0],bytes[1]],[0xff,0xd8]);
 // A fictional employer's image is served only by a local build; a release build answers as for any unknown name.
 for(const slug of sampleSlugs() as string[])assert.equal(ogImageResponse(`/og/c-${slug}.jpg`)?.status??null,LOCAL_BUILD?200:null,slug);
 for(const path of ['/og/HOME.jpg','/og/home.png','/og/../home.jpg','/og/__proto__.jpg','/og/constructor.jpg','/og/nobody.jpg','/og/','/og/home.jpg/x'])assert.equal(ogImageResponse(path),null,path);
});

test('page metadata names fictional employers as fictional (only where they exist) and states the publication rule only while nothing is published',async()=>{
 const {env:base,publicDb}=testEnv();
 // Fictional employers exist only with SAMPLE_EMPLOYERS on (locally and in tests); production leaves them out entirely.
 const env={...base,SAMPLE_EMPLOYERS:'on'} as typeof base;
 const home=await shellMeta(env,'/',new URLSearchParams());
 for(const path of ['/c/northwind-labs','/c/helios-semiconductor'])assert.equal((await shellMeta({...base,SAMPLE_EMPLOYERS:'off'} as typeof base,path,new URLSearchParams())).title,home.title,`${path} is not found with sample employers off`);
 assert.doesNotMatch((await shellMeta({...base,SAMPLE_EMPLOYERS:'off'} as typeof base,'/c/stripe',new URLSearchParams('view=compare&vs=northwind-labs'))).title,/fictional|Northwind/);
 assert.match(home.image,/\/og\/home\.jpg$/);
 const fictional=await shellMeta(env,'/c/northwind-labs',new URLSearchParams());
 assert.match(fictional.title,/Northwind Labs \(fictional demonstration\)/);assert.match(fictional.description,/fictional employer/);
 // Its own labeled card where the build embeds it (local), otherwise the neutral home card (a release build leaves it out).
 assert.match(fictional.image,LOCAL_BUILD?/\/og\/c-northwind-labs\.jpg$/:/\/og\/home\.jpg$/);
 const empty=await shellMeta(env,'/c/stripe',new URLSearchParams());
 assert.match(empty.description,new RegExp(`^Nothing is published about Stripe yet\\. Written accounts appear in batches of at least ${testimonyBatchMin(env)} `));assert.match(empty.image,/c-stripe\.jpg$/);
 assert.match(empty.description,/Real-employer publication is currently paused\./,'a paused publication switch is stated wherever the rule is');
 assert.doesNotMatch((await shellMeta({...env,REAL_PUBLICATION_ENABLED:'true'},'/c/stripe',new URLSearchParams())).description,/paused/);
 const compare=await shellMeta(env,'/c/northwind-labs',new URLSearchParams('view=compare&vs=helios-semiconductor&q=secret'));
 assert.match(compare.title,/Northwind Labs \(fictional demonstration\) and Helios Semiconductor \(fictional demonstration\), side by side/,'each fictional name is labeled in the title itself');
 assert.match(compare.description,/fictional/);
 assert.match(compare.image,/\/og\/home\.jpg$/,'a comparison never borrows one employer’s card');
 const mixed=await shellMeta(env,'/c/stripe',new URLSearchParams('view=compare&vs=northwind-labs'));
 assert.match(mixed.title,/^Stripe and Northwind Labs \(fictional demonstration\), side by side/);assert.match(mixed.image,/\/og\/home\.jpg$/);assert.doesNotMatch(mixed.description,/Nothing is published/);
 assert.equal(compare.url,'https://shouldiworkthere.com/c/northwind-labs?view=compare&vs=helios-semiconductor','the canonical link keeps typed state only');
 for(const path of ['/c/unknown-co','/c/<script>','/c/','/c/stripe/../admin'])assert.equal((await shellMeta(env,path,new URLSearchParams())).title,home.title,path);
 const columns=(publicDb.db.prepare('PRAGMA table_info(metric_releases)').all() as Array<{name:string}>).map(c=>c.name);
 const copy=columns.map(c=>c==='id'?"'r-test-stripe'":c==='company_id'?"'co-stripe'":c).join(',');
 publicDb.db.prepare(`INSERT INTO metric_releases(${columns.join(',')}) SELECT ${copy} FROM metric_releases WHERE company_id='co-northwind' LIMIT 1`).run();
 const published=await shellMeta(env,'/c/stripe',new URLSearchParams());
 assert.doesNotMatch(published.description,/Nothing is published/);assert.match(published.image,/\/og\/home\.jpg$/);
 const broken={...env,DB:{prepare:()=>{throw new Error('d1 down');}}} as unknown as typeof env;
 assert.equal((await shellMeta(broken,'/c/stripe',new URLSearchParams())).title,home.title,'a database failure falls back to neutral defaults');
});

test('the app shell escapes metadata and carries Open Graph tags',()=>{
 const html=appShell({title:'x',description:'y',buildId:'b',initialPath:'/',meta:{title:'A "quoted" <title>',description:'D & <b>',image:'https://shouldiworkthere.com/og/home.jpg',url:'https://shouldiworkthere.com/c/x?view=compare&vs=y'}});
 assert.match(html,/<title>A &quot;quoted&quot; &lt;title&gt;<\/title>/);
 assert.match(html,/property="og:image" content="https:\/\/shouldiworkthere\.com\/og\/home\.jpg"/);
 assert.match(html,/name="twitter:card" content="summary_large_image"/);
 assert.match(html,/rel="canonical" href="https:\/\/shouldiworkthere\.com\/c\/x\?view=compare&amp;vs=y"/);
 assert.doesNotMatch(html,/<b>/);
});

test('every server-rendered page carries the legal links, sentence-case headings and labelled tables',async()=>{
 const {env}=testEnv();
 for(const link of LEGAL_LINKS)assert.ok(footerHtml.includes(`href="${link.href}"`),link.href);
 for(const name of TRUST_PAGES) {
  const html=await trustPage(name,env,'test');
  for(const link of LEGAL_LINKS)assert.ok(html.includes(`href="${link.href}"`),`${name} is missing ${link.href}`);
  assert.doesNotMatch(html,/class="eyebrow"|↗/,name);
  assert.doesNotMatch(html,/<h1>[^<]*[A-Z]{4,} [A-Z]{4,}/,`${name} has an all-caps heading`);
  for(const table of html.match(/<table[\s\S]*?<\/table>/g)??[])assert.match(table,/<th scope="col">/,`${name} has a table without column headers`);
  assert.match(html,/<main class="page trust-document" id="main">/);assert.match(html,/class="skip-link" href="#main"/);
  assert.match(html,/data-theme-toggle hidden/,'the theme switch stays hidden without scripts');
  assert.doesNotMatch(html,/app\.js/,`${name} loads the application bundle`);
  assert.match(html,/<head>[\s\S]*<script src="\/theme\.js\?v=test"><\/script>[\s\S]*<\/head>/,`${name} applies the stored theme before first paint`);
 }
 // Jury, challenge and trustee statements follow the running switches, never a fixed "not yet operational".
 const cfg=legalConfig(env);
 for(const name of ['moderation','transparency']) {
  const html=await trustPage(name,env,'test');
  // A class that is switched on says whether a jury of it can form right now (pages.ts statusLine).
  assert.match(html,new RegExp(`Juries for real employers: ${cfg.juryEnabled?'switched on[,.]':'off\\.'}`),name);
  // With no fictional employers (SAMPLE_EMPLOYERS off, as in production) there are no practice juries to switch on.
  assert.match(html,cfg.sampleEmployers===false?/Practice juries: not available, because this site shows no fictional demonstration employers\./:new RegExp(`Practice juries for the fictional demonstration employers: ${cfg.practiceJuriesEnabled?'switched on[,.]':'off\\.'}`),name);
  assert.match(html,env.RATE_LIMIT_SECRET?/Challenges to published accounts: open to anyone\./:/Challenges to published accounts: not open, because the server secret that keys the daily challenge budget is not set\./,name);
  assert.match(await trustPage(name,{...env,RATE_LIMIT_SECRET:'test-secret'} as typeof env,'test'),/Challenges to published accounts: open to anyone\./,`${name} with the budget secret set`);
  assert.doesNotMatch(html,/not yet operational|tracked, not active/,name);
 }
 assert.match(await trustPage('terms',env,'test'),/<h1>Terms of use<\/h1>/);
 assert.match(await trustPage('accessibility',env,'test'),/<h1>Accessibility statement<\/h1>/);
 assert.match(await trustPage('privacy',env,'test'),/<h1>Privacy policy<\/h1>/);
});

test('Live understanding never sends crisis words or a bare listed name to hosted Jev while someone types',()=>{
 const o={submitted:'',last:'',directory};
 assert.deepEqual(liveStep('honestly I want to die after this reorg',o),{kind:'skip',why:'crisis'},'the card is shown on the device; nothing is sent');
 assert.deepEqual(liveStep('   I don’t want to be alive anymore  ',o),{kind:'skip',why:'crisis'});
 assert.deepEqual(liveStep('the deadline is killing me',o),{kind:'read'},'a workplace idiom is still read');
 assert.deepEqual(liveStep('Stripe',o),{kind:'navigate',slug:'stripe'},'a listed name opens its record with a controls request (no words)');
 assert.deepEqual(liveStep(' northwind labs ',o),{kind:'navigate',slug:'northwind-labs'});
 assert.deepEqual(liveStep('how political is engineering?',o),{kind:'read'});
 assert.deepEqual(liveStep('Meta',o),{kind:'skip',why:'short'});
 assert.deepEqual(liveStep('Stripe',{...o,submitted:'Stripe'}),{kind:'skip',why:'same'},'words already submitted are not read again');
 assert.deepEqual(liveStep('how political is engineering?',{...o,last:'how political is engineering?'}),{kind:'skip',why:'same'});
});

test('history keeps one entry per committed view: a Live reading is provisional and Enter settles it',()=>{
 // A small model of session history, driven exactly as web/app.tsx drives it.
 const entries:string[]=['/'];let at=0,provisional:string|null=null,n=0;const keys=['home'];
 const go=(url:string,how:{live?:boolean;settles?:boolean;requested:'push'|'replace'})=>{
  const kind=historyKind({...how,current:keys[at],provisional}),key=`k${++n}`;
  if(kind==='push'){entries.splice(at+1,Infinity,url);keys.splice(at+1,Infinity,key);at++;}else{entries[at]=url;keys[at]=key;}
  provisional=how.live?key:null;
  return kind;
 };
 const back=()=>{at--;provisional=null;return entries[at];};
 // Home, then 'Stripe' typed with Live on, read twice while typing, then Enter.
 assert.equal(go('/c/stripe',{live:true,requested:'replace'}),'push','the first Live reading keeps the home entry');
 assert.equal(go('/c/stripe',{live:true,requested:'replace'}),'replace','later readings replace the provisional entry');
 assert.equal(go('/c/stripe',{settles:true,requested:'push'}),'replace','Enter settles it instead of adding a duplicate');
 assert.deepEqual(entries,['/','/c/stripe']);
 assert.equal(back(),'/','Back returns to the home page');
 // After Back, Live starts a new provisional entry; a tab on a Live reading keeps that reading as a view.
 assert.equal(go('/c/northwind-labs?view=timeline',{live:true,requested:'replace'}),'push');
 assert.equal(go('/c/northwind-labs?view=reader',{requested:'push'}),'push');
 assert.deepEqual(entries,['/','/c/northwind-labs?view=timeline','/c/northwind-labs?view=reader']);
 // Enter on a committed view adds an entry, as before; with Live off nothing is provisional.
 assert.equal(go('/c/helios-semiconductor',{settles:true,requested:'push'}),'push');
 assert.equal(historyKind({requested:'replace',current:'k1',provisional:null}),'replace','a reload or a Back that re-reads its view replaces');
});

test('a choice on a held reply keeps the edits that asked it: Group after Accounts opens the group view',()=>{
 const base={company:'northwind-labs',view:'cohort',topic:'layoffs',event:'ev-nw-restructure-2025',timeframe:'after_event'};
 // The Accounts tab pinned view 'reader'; the Group tab then asked which group (a held reply) with view 'cohort'.
 const held=controlsRequest(base,{view:'cohort'},{cohort:'Engineering'},{pin:true,source:'northwind-labs'});
 assert.equal(held.overrides.view,'cohort');assert.equal(held.overrides.cohort,'Engineering');assert.equal(held.overrides.scope,'northwind-labs');
 assert.deepEqual(held.nextPinned,{view:'cohort',cohort:'Engineering'});
 // The edits behind the view still on screen would have reopened the tab the reader left.
 assert.equal(controlsRequest(base,{view:'reader'},{cohort:'Engineering'},{pin:true,source:'northwind-labs'}).overrides.view,'reader');
 // Switching employer drops every pinned edit; a group chip replaces both per-slot chips.
 assert.deepEqual(controlsRequest(base,{view:'reader',cohort:'Engineering'},{company:'helios-semiconductor'},{pin:false,source:'northwind-labs'}).nextPinned,{});
 const slots=controlsRequest({company:'northwind-labs'},{cohortFunction:'Engineering',cohortSeniority:'Senior IC'},{cohort:'Sales'},{pin:true,source:'northwind-labs'});
 assert.deepEqual(slots.nextPinned,{cohort:'Sales'});assert.equal('cohortFunction'in slots.overrides,false);
});

test('an inferred event keeps its label and note until the reader changes or confirms it',()=>{
 const note='Applied the 2025 restructuring, the only documented restructuring for this employer. Change or remove it in the event chip.';
 const reply=(o:{slug?:string;event?:string|null;inferred?:boolean;notes?:string[]})=>({view:'overview',notices:[...(o.notes??[]),'Contributors choose to take part.'],
  evidence:{company:{slug:o.slug??'northwind-labs'}},
  interpretation:{event:o.event===null?null:{value:o.event??'ev-nw-restructure-2025'},notes:o.notes??[],...(o.inferred?{inferred:[{field:'event',value:'ev-nw-restructure-2025',label:'2025 restructuring',reason:'single_documented_event'}]}:{})}}) as unknown as CanvasResponse;
 const from=reply({inferred:true,notes:[note]});
 const tab=carryInferred(from,reply({}),['view']);
 assert.deepEqual(tab.interpretation.inferred?.map(v=>v.value),['ev-nw-restructure-2025']);
 assert.equal(tab.notices[0],note);assert.equal(tab.notices.filter(n=>n===note).length,1);
 assert.equal(carryInferred(tab,reply({}),['topic']).interpretation.inferred?.length,1,'it survives any number of other changes');
 assert.equal(carryInferred(from,reply({event:'ev-nw-leadership-2024'}),['event']).interpretation.inferred,undefined,'changing the event ends it');
 assert.equal(carryInferred(from,reply({event:null}),['event','timeframe']).interpretation.inferred,undefined,'removing it ends it');
 assert.equal(carryInferred(from,reply({slug:'helios-semiconductor'}),['company']).interpretation.inferred,undefined);
 const own=reply({inferred:true});assert.equal(carryInferred(from,own,['view']),own,'a reply with its own reading is left as it is');
});

test('a before/after choice the timeline does not apply is marked as not applied',()=>{
 const r=(view:string,timeframe:string,timeStatus:string)=>({view,evidence:{timeStatus},interpretation:{timeframe}}) as unknown as CanvasResponse;
 assert.equal(idleTimeframe(r('timeline','before_event','any')),'before_event');
 assert.equal(idleTimeframe(r('overview','before_event','applied')),null);
 assert.equal(idleTimeframe(r('timeline','last_year','applied')),null);
 assert.equal(idleTimeframe(r('overview','any','any')),null);
 assert.equal(idleTimeframe(null),null);
 assert.match(idleTimeframeNotice('Before the event'),/“Before the event” is not applied/);
});

test('an employer address is missing only when the loaded directory does not list it; an unloaded directory proves nothing',()=>{
 assert.equal(missingEmployer('acmewidgets',directory),true,'a slug the directory does not list gets the not-found state without a canvas request');
 assert.equal(missingEmployer('northwind-labs',directory),false);
 assert.equal(missingEmployer('acmewidgets',[]),false,'before the directory arrives (or when it failed) the page asks the server as before');
 assert.equal(missingEmployer(null,directory),false);assert.equal(missingEmployer(undefined,directory),false);assert.equal(missingEmployer('',directory),false);
 // The page skips the server on this rule only (the canvas answers only slugs from the same /api/directory list; the
 // browser test 'an address naming an employer the directory does not list…' checks that seam against the running stack).
 assert.match(readFileSync(new URL('../web/app.tsx',import.meta.url),'utf8'),/if\(missingEmployer\(typed\.slug,listed\)\)/);
});

// ---- Public launch (owner decisions of 2026-09-23): zero sample data, publication copy, community listings, proof of work ----

const REAL_DIRECTORY:DirectoryCompany[]=[{id:'co-charles-schwab',slug:'charles-schwab',name:'Charles Schwab',kind:'real',sector:'Finance'},{id:'co-google',slug:'google',name:'Google',kind:'real',domains:['google.com']},{id:'co-microsoft',slug:'microsoft',name:'Microsoft',kind:'real'},{id:'co-stripe',slug:'stripe',name:'Stripe',kind:'real'}];
const SAMPLE_ENTRY:DirectoryCompany={id:'c_northwind',slug:'northwind-labs',name:'Northwind Labs',kind:'sample'};

test('with sample employers off, nothing fictional is listed or offered, and the home examples name listed real employers',()=>{
 const withSample=[...REAL_DIRECTORY,SAMPLE_ENTRY];
 // Production: SAMPLE_EMPLOYERS off. A sample employer that still arrived (an older reply) is not listed.
 assert.equal(samplesOn({sampleEmployers:false},withSample),false);
 assert.deepEqual(shownDirectory({sampleEmployers:false},withSample).map(c=>c.slug),REAL_DIRECTORY.map(c=>c.slug));
 const production=homeExamples({sampleEmployers:false},withSample);
 assert.deepEqual(production,REAL_EXAMPLES.map(e=>({text:e.text,fictional:false})));
 assert.ok(production.every(e=>!/northwind|helios|meridian/i.test(e.text)),'no fictional employer is named');
 // An example is offered only when the directory lists every employer it names.
 assert.deepEqual(homeExamples({sampleEmployers:false},REAL_DIRECTORY.filter(c=>c.slug!=='microsoft')).map(e=>e.text),['Charles Schwab','What is it like to work at Stripe?']);
 assert.deepEqual(homeExamples({sampleEmployers:false},[]),[],'nothing is offered before the directory arrives');
 // Locally (and in tests) SAMPLE_EMPLOYERS is on: the fictional demonstrations stay, labeled.
 assert.equal(samplesOn({sampleEmployers:true},withSample),true);
 assert.ok(homeExamples({sampleEmployers:true},withSample).every(e=>e.fictional&&/Northwind/.test(e.text)));
 // Without a config, only a directory that lists a sample employer shows fictional content.
 assert.equal(samplesOn(null,REAL_DIRECTORY),false);assert.equal(samplesOn(null,withSample),true);
 assert.deepEqual(shownDirectory(null,withSample),withSample);
});

test('publication copy states the configured account batch and aggregate minimum, never less than the published policy',()=>{
 const rules=publicationRules({publication:{accountBatch:5,aggregateMinimum:25},minimumCohort:25});
 assert.deepEqual(rules,{batch:5,cohort:25});
 assert.equal(accountsRule(rules),'Written accounts publish in batches of 5 per employer, after screening and a random delay.');
 assert.equal(aggregatesRule(rules),'Survey percentages and other aggregate numbers appear only once at least 25 people have answered.');
 assert.deepEqual(publicationRules({publication:{accountBatch:8,aggregateMinimum:40}}),{batch:8,cohort:40});
 // Before the config arrives, or from an older server, the published policy's own thresholds are stated.
 assert.deepEqual(publicationRules(null),{batch:policy.retention.minimumBatch,cohort:(policy.retention as {aggregateMinimum?:number}).aggregateMinimum??25});
 assert.deepEqual(publicationRules({minimumCohort:30}),{batch:policy.retention.minimumBatch,cohort:30});
 // A configured value below the policy floor is never stated.
 assert.equal(publicationRules({publication:{accountBatch:1,aggregateMinimum:3}}).cohort>=25,true);
 assert.equal(publicationRules({publication:{accountBatch:1}}).batch,policy.retention.minimumBatch);
 // The pages state the rules from the config, not a fixed number.
 for(const file of ['web/canvas/views.tsx','web/submit.tsx']) {
  const source=readFileSync(file,'utf8');
  assert.doesNotMatch(source,/batch of (?:at least )?25|minimum batch of 25|at least 25 answers|opens after \{policy\.retention\.minimumBatch\}/,file);
  assert.match(source,/accountsRule\(/,file);
 }
});

test('community listings show their domain beside the name and are labeled; the listing switch and difficulty come from the config',()=>{
 const acme:DirectoryCompany={id:'cc-1',slug:'acme-widgets',name:'Acme Widgets',kind:'real',origin:'community',domains:['acmewidgets.com']};
 assert.equal(listingName(acme),'Acme Widgets (acmewidgets.com)');
 assert.equal(listingName({name:'Stripe'}),'Stripe');
 assert.equal(domainOf(acme),'acmewidgets.com');assert.equal(domainOf({domains:[]}),null);
 assert.equal(isCommunity(acme),true);assert.equal(isCommunity(REAL_DIRECTORY[1]),false);
 assert.equal(listingOpen({employerListing:{open:true}}),true);
 assert.equal(listingOpen({employerListing:{open:false}}),false);assert.equal(listingOpen(null),false,'closed unless the site says it is open');
 assert.equal(listingPowBits({employerListing:{open:true,pow:{bits:12}}}),12);assert.equal(listingPowBits({}),null);
});

test('a domain someone added is labeled as such: every domain of a community listing, and one attached to one of our listings',()=>{
 const schwab:DirectoryCompany={id:'co-charles-schwab',slug:'charles-schwab',name:'Charles Schwab',kind:'real',domains:['schwab.com'],communityDomains:['schwab.com']};
 const google:DirectoryCompany={id:'co-google',slug:'google',name:'Google',kind:'real',domains:['google.com']};
 const acme:DirectoryCompany={id:'cc-1',slug:'acme-widgets',name:'Acme Widgets',kind:'real',origin:'community',domains:['acmewidgets.com'],communityDomains:['acmewidgets.com']};
 assert.equal(communitySupplied(schwab,'schwab.com'),true);assert.equal(communitySupplied(google,'google.com'),false);
 assert.equal(communitySupplied(acme,'acmewidgets.com'),true);assert.equal(communitySupplied({origin:'community'},'x.io'),true,'a community listing’s domains are all the community’s');
 assert.equal(communitySupplied(schwab,null),false);assert.equal(communitySupplied(null,'schwab.com'),false);
 // Accounts label attached domains only: a community listing is labeled as a whole.
 assert.deepEqual(attachedDomains(schwab),['schwab.com']);assert.deepEqual(attachedDomains(acme),[]);assert.deepEqual(attachedDomains(google),[]);
 // A reply without the field (discovery rows) is completed from the directory.
 assert.deepEqual(withListing({slug:'charles-schwab',name:'Charles Schwab'},[schwab]).communityDomains,['schwab.com']);
 const record=readFileSync('web/app.tsx','utf8');
 assert.match(record,/communitySupplied\(listedCompany,domainOf\(listedCompany\)\)&&<span className="tag tag-community">\{ATTACHED_DOMAIN_LABEL\}/,'the record labels an attached domain');
});

test('adding an employer is checked on the device with the server’s domain rules, so no proof of work is spent on a refusal',()=>{
 assert.equal(domainFrom('  Jane.Doe@Acme-Widgets.COM '),'acme-widgets.com','only the domain of a pasted address is kept');
 assert.equal(domainFrom('https://acmewidgets.com/careers?x=1'),'acmewidgets.com');
 assert.equal(domainFrom('acmewidgets.com.'),'acmewidgets.com');
 assert.equal(domainProblem('acmewidgets.com',REAL_DIRECTORY),null);
 assert.match(domainProblem('gmail.com')!.message,/free email provider/);
 assert.match(domainProblem('mailinator.com')!.message,/disposable/);
 assert.match(domainProblem('example.com')!.message,/reserved/);
 assert.match(domainProblem('co.uk')!.message,/not one organization’s domain/);
 assert.match(domainProblem('acme')!.message,/not a domain name/);
 assert.match(domainProblem('')!.message,/Enter the domain/);
 // A domain (or a subdomain of one) already listed names the listing that holds it, and is not sent.
 const taken=domainProblem('mail.google.com',REAL_DIRECTORY);
 assert.equal(taken?.listed?.slug,'google');assert.match(taken!.message,/already listed, as Google \(google\.com\)/);
 assert.equal(nameProblem('Acme Widgets'),null);
 assert.match(nameProblem('')!,/Enter the employer’s name/);
 assert.match(nameProblem('A')!,/2 to 80/);assert.match(nameProblem('x'.repeat(81))!,/2 to 80/);
 assert.match(nameProblem('Acme jane@acme.com')!,/without an email address or link/);
 // Every refusal the server gives (worker/src/community.ts) has plain words; none is shown as a bare code.
 for(const code of ['invalid_request','name_invalid','name_identifying','name_abusive','name_not_organization','domain_invalid','domain_reserved','domain_public_suffix','domain_free_mail','domain_disposable','domain_no_mx','dns_unavailable','checks_unavailable','domain_already_listed','name_already_listed','domain_belongs_to_listed','domain_abusive','domain_name_mismatch','slug_unavailable','rate_limited','listing_daily_limit','listing_unavailable','pow_missing','pow_stale','pow_insufficient'])
  assert.ok(ADD_ERRORS[code]&&!ADD_ERRORS[code]!.includes(code),code);
 const community=readFileSync('worker/src/community.ts','utf8');
 for(const code of new Set([...community.matchAll(/json\(\{error:'([a-z_]+)'/g)].map(m=>m[1]!)))assert.ok(ADD_ERRORS[code],`the listing refusal ${code} has plain words`);
});

test('a listing refusal that names a listing says which one, and the page links to it; the other new refusals say what to change',()=>{
 // The server's 409s carry the listing (worker/src/community.ts companyRef: slug, name and its first domain, if any).
 const google={slug:'google',name:'Google',domain:'google.com'},schwab={slug:'charles-schwab',name:'Charles Schwab'};
 assert.deepEqual(namedListing({error:'name_already_listed',company:google}),{slug:'google',name:'Google',domains:['google.com']});
 assert.deepEqual(namedListing({company:{...schwab,domains:['schwab.com']}}),{slug:'charles-schwab',name:'Charles Schwab',domains:['schwab.com']},'a directory entry is read the same way');
 for(const detail of [{},{company:null},{company:{slug:'',name:'X'}},{company:{slug:'x'}},{company:'google'}])assert.equal(namedListing(detail as Record<string,unknown>),null,JSON.stringify(detail));
 const same=addErrorMessage('name_already_listed',{error:'name_already_listed',company:google});
 assert.match(same,/^Google \(google\.com\) is already listed under this name, with its own domain, so a second listing under the same name was not added\./);
 assert.match(same,/open its record; if this is a different organization, use a name that tells the two apart\. Nothing was added\.$/);
 assert.equal(addErrorMessage('domain_belongs_to_listed',{company:schwab}),'That domain carries the name of Charles Schwab, an employer already in the directory, so it cannot be listed under another name. Nothing was added.');
 // Without the listing (an older or unexpected reply), the plain words stand alone and claim no name.
 assert.equal(addErrorMessage('name_already_listed'),ADD_ERRORS.name_already_listed);assert.equal(addErrorMessage('domain_belongs_to_listed',{company:{}}),ADD_ERRORS.domain_belongs_to_listed);
 assert.match(ADD_ERRORS.domain_abusive!,/insult, accusation or slur, or contain identifying details/);
 assert.match(ADD_ERRORS.domain_name_mismatch!,/does not carry this organization’s name \(a word of it, the whole name or its initials\), and Jev did not confirm it/);
 for(const code of ['name_already_listed','domain_belongs_to_listed','domain_abusive','domain_name_mismatch'])assert.match(ADD_ERRORS[code]!,/nothing was added/i,code);
 // The page no longer offers to override a same-name refusal: the server refuses those listings.
 const form=readFileSync('web/add-employer.tsx','utf8');
 assert.doesNotMatch(form,/different organization that is also called|type="checkbox"/);
 assert.match(form,/listed:namedListing\(e\.detail\)/,'every refusal that names a listing links to it');
});

test('the device refuses exactly the duplicates the server refuses, naming the same listing, so no proof of work is spent on them',async()=>{
 const {env,publicDb}=testEnv();
 // A community listing named "Acme", and the curated directory (0009, 0010): Google and Meta have domains; Charles Schwab
 // (alias 'schwab') and Wells Fargo have none.
 publicDb.db.prepare("INSERT INTO companies(id,slug,name,kind,sector,coverage_note,origin) VALUES('cc-acme','acme-acme-io','Acme','real',NULL,'Added by the community.','community')").run();
 publicDb.db.prepare("INSERT INTO employer_domains(domain,company_id,source,position,registered) VALUES('acme.io','cc-acme','community',0,1)").run();
 // A community listing that took Charles Schwab's name first, with a domain of its own; the curated listing has none.
 publicDb.db.prepare("INSERT INTO companies(id,slug,name,kind,sector,coverage_note,origin) VALUES('cc-twin','charles-schwab-schwab-careers-com','Charles Schwab','real',NULL,'Added by the community.','community')").run();
 publicDb.db.prepare("INSERT INTO employer_domains(domain,company_id,source,position,registered) VALUES('schwab-careers.com','cc-twin','community',0,1)").run();
 const directory=await getDirectory(env) as DirectoryCompany[];
 for(const slug of ['google','meta','charles-schwab','wells-fargo'])assert.ok(directory.some(c=>c.slug===slug),`the test directory lists ${slug}`);
 // The server's own check, up to the first step that needs the network (its MX lookup), which answers 'unavailable' here.
 const listingEnv={...env,ENVIRONMENT:'development',VERIFIER:{fetch:async()=>{throw new Error('the verifier is never reached');}},INTERNAL_TOKEN:'t'.repeat(INTERNAL_TOKEN_MIN),POW_BITS:String(POW_MIN_BITS)} as unknown as typeof env;
 const original=globalThis.fetch;globalThis.fetch=(async()=>new Response('unavailable',{status:502})) as typeof fetch;
 try {
  const cases:Array<[string,string,string|null,string|null]>=[
   ['Google LLC','googlemail-example.io','name_already_listed','google'],
   ['Google Careers','gcareers-example.io','name_already_listed','google'],
   ['Meta Platforms','metaplatforms-example.io','name_already_listed','meta'],
   ['Acme','acme-widgets-example.io','name_already_listed','acme-acme-io'],
   ['Globex Holdings','schwab.net','domain_belongs_to_listed','charles-schwab'],
   ['Globex','wellsfargo.net','domain_belongs_to_listed','wells-fargo'],
   ['Globex','mail.google.com','domain_already_listed','google'],
   // The employer's own domain may still attach to the curated listing (Jev decides next), whoever took the name first;
   // any other domain under that name is refused, naming the listing that holds it.
   ['Charles Schwab','schwab.net',null,null],
   ['Charles Schwab Corp','charles-schwab.com',null,null],
   ['Charles Schwab','schwab-mail.net','name_already_listed','charles-schwab-schwab-careers-com'],
   ['Wells Fargo Staff','wf-staff-example.io',null,null],
   ['Globex Widgets','globexwidgets.io',null,null],
  ];
  for(const [name,domain,code,slug] of cases) {
   const pow=await solvePow({origin:'http://localhost',action:'add-employer',keyId:'',subject:await powSubject.domain(domain)},{bits:POW_MIN_BITS});
   const response=await addEmployer(listingEnv,{name,domain,pow},new Request('http://localhost/api/employers',{method:'POST'}));
   const body=await response.json() as Record<string,unknown>;
   const listed=domainProblem(domain,directory)?.listed,conflict=listingConflict(name,domain,directory);
   const device=listed?{code:'domain_already_listed',slug:listed.slug}:conflict?{code:conflict.code,slug:conflict.listed.slug}:null;
   if(code===null) {
    assert.equal(body.error,'dns_unavailable',`${name} / ${domain}: the server passes its duplicate checks`);
    assert.equal(device,null,`${name} / ${domain}: the device passes it too`);
   } else {
    assert.equal(response.status,409,`${name} / ${domain}`);assert.equal(body.error,code,`${name} / ${domain}`);
    assert.equal((body.company as {slug:string}).slug,slug,`${name} / ${domain}: the server names ${slug}`);
    assert.deepEqual(device,{code,slug},`${name} / ${domain}: the device refuses it the same way`);
    if(!listed&&conflict)assert.equal(conflict.message,addErrorMessage(code,body),`${name} / ${domain}: the device and the server’s refusal read the same`);
   }
  }
 } finally {globalThis.fetch=original;}
 // Names are matched as the server matches them: legal-form and generic words set aside, curated listings first.
 assert.deepEqual(namesakesOf('Google Inc.',directory).map(c=>c.slug),['google']);
 assert.deepEqual(namesakesOf('Charles Schwab Corp',directory).map(c=>c.slug),['charles-schwab','charles-schwab-schwab-careers-com'],'curated first');
 assert.equal(mayAttach('Charles Schwab','schwab.com',directory)?.slug,'charles-schwab');assert.equal(mayAttach('Charles Schwab','schwab.attacker.com',directory),null);
 assert.deepEqual(namesakesOf('Acme Robotics',directory),[],'a name that tells the organizations apart means neither');
});

test('the domain and name rules the device adds are the server’s: words in the domain, and a web address in the name',()=>{
 for(const domain of ['acme-is-a-scam.com','fuckacme.com','john-smith-is-a-predator.com','globex-liars.io','therapist-group.com','scunthorpe-widgets.co.uk','acmewidgets.com','nazir-trading.com']) {
  const device=domainProblem(domain),server=domainAbuseProblem(domain);
  assert.equal(device?.message===DOMAIN_ABUSIVE_MESSAGE,server==='domain_abusive',`${domain}: device ${device?.message} / server ${server}`);
 }
 assert.equal(domainProblem('therapist-group.com'),null,'a word inside an ordinary word is not an insult');
 for(const [name,domain] of [['Google (google.com)','google-jobs.io'],['Booking.com','booking.com'],['Acme (acme.io)','acme.io'],['Acme Widgets','acmewidgets.com']] as const) {
  const device=nameProblem(name,domain),server=serverNameProblem(name,domain);
  assert.equal(device===null,server===null,`${name} with ${domain}: device ${device} / server ${server}`);
 }
 assert.match(nameProblem('Gооgle')!,/no mix of Latin, Cyrillic and Greek letters/,'Cyrillic о among Latin letters');
});

test('a proof-of-work stamp computed without a worker verifies on the server’s check, and a refused stamp is recomputed once with the server’s minute',async()=>{
 const binding:PowBinding={origin:'https://shouldiworkthere.com',action:'add-employer',keyId:'',subject:await powSubject.domain('acmewidgets.com')};
 // Node has no Web Worker, so this is the in-page fallback the browser uses when the worker cannot start.
 const stamp=await computeStamp(binding,{bits:12});
 assert.equal(await checkPow(stamp,binding,12),null);
 assert.equal(await stampHolds(powPrefix(binding,stamp.minute),stamp.nonce,12),true);
 assert.equal(await checkPow(stamp,{...binding,subject:await powSubject.domain('other.com')},12),'pow_insufficient','a stamp is bound to its domain');
 // The verifier's refusal form and the main worker's both read as hints.
 assert.deepEqual(powHint({code:'pow_required',detail:{reason:'pow_stale',bits:22,minute:123}}),{code:'pow_stale',bits:22,minute:123});
 assert.deepEqual(powHint({code:'pow_insufficient',detail:{minute:9,windowMinutes:2}}),{code:'pow_insufficient',bits:null,minute:9});
 assert.equal(powHint({code:'rate_limited',detail:{}}),null);assert.equal(powHint(new Error('x')),null);
 // A device whose clock is ten minutes off: the first stamp is refused as stale, the second uses the server's minute.
 const server=powMinute()+10,sent:number[]=[];let calls=0,working=0;
 const reply=await withPow(()=>binding,async pow=>{calls++;sent.push(pow.minute);if(Math.abs(pow.minute-server)>2)throw Object.assign(new Error('stale'),{code:'pow_stale',detail:{minute:server}});assert.equal(await checkPow(pow,binding,12,server*60000),null);return 'listed';},{bits:12,working:on=>{if(on)working++;}});
 assert.equal(reply,'listed');assert.equal(calls,2);assert.equal(sent[1],server);assert.equal(working,2,'the page is told each time the calculation runs');
 // Any other refusal is not retried.
 let tries=0;
 await assert.rejects(withPow(()=>binding,async()=>{tries++;throw Object.assign(new Error('nope'),{code:'domain_no_mx',detail:{}});},{bits:8}),/nope/);
 assert.equal(tries,1);
});

test('a community key is used only when the publisher and the verifier publish it identically; a curated key is never treated as one',()=>{
 const jwk={kty:'RSA',n:'x'.repeat(342),e:'AQAB',alg:'PS384',ext:true,key_ops:['verify']};
 const key:IssuerKey={id:'acme-widgets:2026-Q3:community',companySlug:'acme-widgets',epoch:'2026-Q3',expiresAt:'2027-01-01T00:00:00.000Z',verificationClass:'mailbox',purpose:'contribution',source:'community',publicKey:jwk as JsonWebKey};
 const reordered={...key,publicKey:{key_ops:['verify'],ext:true,e:'AQAB',n:jwk.n,kty:'RSA',alg:'PS384'} as JsonWebKey};
 assert.equal(isCommunityKey(key),true);
 assert.equal(sameCommunityKey(key,reordered),true,'member order does not matter; members and values do');
 assert.equal(sameCommunityKey(key,{...key,publicKey:{...jwk,alg:'PS256'} as JsonWebKey}),false);
 assert.equal(sameCommunityKey(key,{...key,publicKey:{kty:'RSA',n:jwk.n,e:'AQAB'}}),false,'a copy missing a member is not the same key');
 assert.equal(sameCommunityKey(key,{...key,expiresAt:'2027-02-01T00:00:00.000Z'}),false);
 assert.equal(sameCommunityKey(key,{...key,source:'curated'}),false);
 // The source must agree with the id: a curated id labeled community (to skip the release's pins) is neither.
 assert.equal(isCommunityKey({id:'google:2026-Q3:mailbox',source:'community'}),false);
 assert.equal(isCommunityKey({id:'google:2026-Q3:mailbox'}),false);
 assert.equal(canonicalJson({b:[1,{d:2,c:3}],a:null}),'{"a":null,"b":[1,{"c":3,"d":2}]}');
});

test('a listing refused for its rate is worded by the limit it hit: the day’s attempts, or a minute’s requests',()=>{
 // Only the per-client daily allowance carries limit:'daily' (worker/src/community.ts); the site-wide per-minute limit does not.
 assert.match(addErrorMessage('rate_limited',{error:'rate_limited',limit:'daily',retryAfterSeconds:3600}),/today’s listing attempts.*tomorrow/);
 assert.match(addErrorMessage('rate_limited',{error:'rate_limited'}),/Wait a minute/);
 assert.doesNotMatch(addErrorMessage('rate_limited',{}),/tomorrow/);
 assert.equal(addErrorMessage('domain_no_mx'),ADD_ERRORS.domain_no_mx);
 assert.match(addErrorMessage('something_new'),/\(something_new\)\. Nothing was added\./,'an unknown code is named, never guessed at');
});

test('the name rules checked on the device are the server’s own, so a name it would refuse spends no proof of work',()=>{
 const names=['Acme Widgets','3M','AT&T','Procter & Gamble','Société Générale','Acme Scam','Acme Sucks','Acme\u200bWidgets','Acme\u202eWidgets','!!!','Acme '.repeat(13),'Acmeeeeeee','x','Call 512-555-0142','jane@acme.com','www.acme.com','Acme Frauds Inc'];
 for(const name of names) {
  const server=serverNameProblem(name),device=nameProblem(name.normalize('NFKC').replace(/\s+/g,' ').trim());
  assert.equal(device===null,server===null,`${JSON.stringify(name)}: device ${device} / server ${server}`);
 }
 assert.match(nameProblem('Acme Scam')!,/insult or accusation/);
 assert.match(nameProblem('Acme\u200bWidgets')!,/invisible characters/);
});

test('a community listing that shares a curated employer’s name never stands in for it, and is always named with its domain',()=>{
 const twin:DirectoryCompany={id:'cc-g',slug:'google-google-jobs-io',name:'Google',kind:'real',origin:'community',domains:['google-jobs.io']};
 const curated=REAL_DIRECTORY.find(c=>c.slug==='google')!;
 for(const list of [[twin,...REAL_DIRECTORY],[...REAL_DIRECTORY,twin]]) {
  assert.equal(exactCompany('Google',list),'google','a bare name opens the curated employer, whatever the directory order');
  const marks=localAnnotations('What is it like at Google?',{directory:list}).filter(m=>m.field==='company');
  assert.deepEqual(marks.map(m=>m.value),['google']);
 }
 // Two community listings of one name are ambiguous: neither is opened on the device.
 assert.equal(exactCompany('Acme',[{...twin,slug:'acme-a-io',name:'Acme',domains:['a.io']},{...twin,slug:'acme-b-io',name:'Acme',domains:['b.io']}]),null);
 // The twin's own slug still names it, and its label carries the domain and the community tag.
 const own=localAnnotations('google-google-jobs-io',{directory:[twin,curated]}).find(m=>m.field==='company');
 assert.equal(own?.value,twin.slug);assert.equal(own?.label,'Google (google-jobs.io), added by the community');
 assert.equal(employerLabel(twin),'Google (google-jobs.io), added by the community');
 assert.equal(employerLabel(curated),'Google','a curated employer keeps its name alone');
 assert.equal(displayName(twin),'Google (google-jobs.io)');assert.equal(displayName(curated),'Google');
 // A reply that names the twin without its origin and domains (discovery rows) is completed from the directory.
 const filled=withListing({slug:twin.slug,name:'Google',kind:'real' as const},[curated,twin]);
 assert.equal(employerLabel(filled),'Google (google-jobs.io), added by the community');
 assert.equal(withListing({slug:'unknown',name:'X'},[twin]).origin,undefined);
});

test('a community key never replaces a release-pinned key, and keys are checked only with the verifier the release names',()=>{
 const jwk={kty:'RSA',n:'x'.repeat(342),e:'AQAB'} as JsonWebKey,expiresAt=new Date(Date.now()+86400000*60).toISOString(),epoch='2026-Q3';
 const curated:IssuerKey={id:`google:${epoch}:mailbox`,companySlug:'google',epoch,expiresAt,verificationClass:'mailbox',publicKey:jwk};
 const twin:IssuerKey={id:`google:${epoch}:community`,companySlug:'google',epoch,expiresAt,verificationClass:'mailbox',source:'community',publicKey:jwk};
 const juror:IssuerKey={...curated,id:`google:${epoch}:juror:mailbox`,purpose:'juror'};
 const acme:IssuerKey={...twin,id:`acme:${epoch}:community`,companySlug:'acme'};
 const now=Date.parse('2026-09-01T00:00:00Z');
 // Listed first or last, the community twin of a pinned employer is never chosen; another employer's community key is.
 assert.equal(chooseIssuerKey([twin,curated,acme],'google',now)?.id,curated.id);
 assert.equal(chooseIssuerKey([curated,twin],'google',now)?.id,curated.id);
 assert.equal(chooseIssuerKey([twin,curated,acme],'acme',now)?.id,acme.id);
 // Only a curated key of the same purpose counts: a juror key does not shut out a community contribution key.
 assert.equal(chooseIssuerKey([twin,juror],'google',now)?.id,twin.id);
 assert.equal(curatedMailboxKey([twin,juror],'google','juror',now)?.id,juror.id);
 assert.equal(curatedMailboxKey([twin,acme],'google','contribution',now),null);
 // The verifier a release names: the build's, else the production verifier on the production site, else none (local).
 assert.equal(pinnedVerifier('https://shouldiworkthere.com'),'https://verify.shouldiworkthere.com');
 assert.equal(pinnedVerifier('http://localhost:8788'),null);
 assert.equal(verifierProblem('https://verify.shouldiworkthere.com','https://verify.shouldiworkthere.com'),null);
 assert.match(verifierProblem('https://verify.attacker.example','https://verify.shouldiworkthere.com')!,/built for https:\/\/verify\.shouldiworkthere\.com\. Nothing was sent/);
 assert.match(verifierProblem('https://verify.shouldiworkthere.com/other','https://verify.shouldiworkthere.com')!,/Nothing was sent/);
 assert.equal(verifierProblem('http://localhost:8790',null),null,'nothing is pinned outside a release');
 assert.match(verifierProblem('',null)!,/unavailable/);
 assert.doesNotMatch(COMMUNITY_KEY_NOTE,/byte/,'the copies are compared member for member, not byte for byte');
});

test('the proof of work refuses a difficulty far above the default before any work, and stops, sending nothing, when asked',async()=>{
 const binding:PowBinding={origin:'https://shouldiworkthere.com',action:'start',keyId:'k',subject:await powSubject.email('a@acme.com')};
 let sent=0;const send=async()=>{sent++;return 'sent';};
 await assert.rejects(withPow(()=>binding,send,{bits:POW_CLIENT_MAX_BITS+1}),(e:unknown)=>e instanceof PowError&&e.code==='pow_too_hard');
 assert.equal(sent,0);
 // A refusal asking for a harder target than the page will compute is not retried.
 await assert.rejects(withPow(()=>binding,async()=>{sent++;throw Object.assign(new Error('harder'),{code:'pow_required',detail:{reason:'pow_insufficient',bits:30,minute:powMinute()}});},{bits:8}),(e:unknown)=>e instanceof PowError&&e.code==='pow_too_hard');
 assert.equal(sent,1);
 // Stopped before it starts, or while it runs (the in-page search yields between slices): nothing is sent.
 const stopped=new AbortController();stopped.abort();
 await assert.rejects(withPow(()=>binding,send,{bits:8,signal:stopped.signal}),(e:unknown)=>e instanceof PowError&&e.code==='pow_stopped');
 const running=new AbortController(),states:boolean[]=[];
 const pending=withPow(()=>binding,send,{bits:POW_CLIENT_MAX_BITS,signal:running.signal,working:on=>states.push(on)});
 setTimeout(()=>running.abort(),30);
 await assert.rejects(pending,(e:unknown)=>e instanceof PowError&&e.code==='pow_stopped'&&/nothing was sent/.test(e.message));
 assert.equal(sent,1);assert.deepEqual(states,[true,false],'the page is told the calculation ended');
});
