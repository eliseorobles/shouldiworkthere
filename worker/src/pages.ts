import {CLIENT_CSS,CLIENT_FONTS} from '../generated/client-assets.ts';
import type {Env} from './types.ts';
import {publicStats,ARCHIVE_FORMAT} from './ledger.ts';
import {policy,policyVersions,policyDocument,employersNeeded,seatsPerEmployer,ownEmployerExcluded,type JuryClass} from '../../shared/policy.ts';
import {publicIssuerKeys} from './credentials.ts';
import {ISSUANCE_POLICY,JUROR_QUOTA} from '../../shared/proof.ts';
import {BRAND,CANONICAL_ORIGIN,LEGAL_LINKS,LEGAL_FIRST_SERVED,CONTACT} from '../../shared/brand.ts';
import {legalConfig,privacyPolicyHtml,termsHtml,accessibilityHtml,legalRequestsContactHtml,longDate,LEGAL_PAGES,type LegalConfig} from './legal.ts';
import {moderationStatus,moderationStats} from './moderation.ts';
import {RELEASE_MANIFEST} from '../generated/release-manifest.ts';
import {getCompanyBySlug} from './evidence.ts';
import {hasOgImage,ogImageName} from './og.ts';
import {samplesEnabled,testimonyBatchMin,aggregateMinimum} from './flags.ts';
import {correctionLog,verifierLinkState} from './community.ts';
import {NAV_LINKS,TRUST_LINKS,THEME_KEY} from '../../web/api.ts';
export function escapeHtml(value:string) {return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
export const stylesheet=()=>`${CLIENT_FONTS}\n${CLIENT_CSS}`;
export const favicon=()=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6F84FF"/><stop offset="1" stop-color="#3D52CC"/></linearGradient></defs><rect width="64" height="64" rx="18" fill="url(#g)"/><path d="M23 23c0-11 20-11 20 0 0 8-11 7-11 16" stroke="white" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="32" cy="49" r="3" fill="white"/></svg>`;

export interface ShellMeta {title:string;description:string;image:string;url:string;}
const DEFAULT_TITLE=`${BRAND} — know the workplace, protect the person`;
const DEFAULT_DESCRIPTION='Workplace evidence you can inspect, with sample sizes, periods and sources. Free access, no employer privileges, privacy-first contributions.';
const social=(m:ShellMeta)=>[['og:type','website'],['og:site_name',BRAND],['og:title',m.title],['og:description',m.description],['og:url',m.url],['og:image',m.image],['og:image:type','image/jpeg'],['og:image:width','1200'],['og:image:height','630'],['og:image:alt',m.title]].map(([p,c])=>`<meta property="${p}" content="${escapeHtml(c!)}">`).join('')
 +[['twitter:card','summary_large_image'],['twitter:title',m.title],['twitter:description',m.description],['twitter:image',m.image]].map(([n,c])=>`<meta name="${n}" content="${escapeHtml(c!)}">`).join('');
const head=(m:ShellMeta,id:string)=>`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(m.title)}</title><meta name="description" content="${escapeHtml(m.description)}"><meta name="color-scheme" content="light dark"><meta name="theme-color" content="#F6F8FD" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0D1222" media="(prefers-color-scheme: dark)"><link rel="canonical" href="${escapeHtml(m.url)}">${social(m)}<link rel="icon" href="/favicon.svg"><link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/app.css?v=${id}"><script src="/theme.js?v=${id}"></script>`;
/**
 * Served as /theme.js and loaded synchronously in <head>: applies an explicitly chosen theme before first paint, and on
 * server-rendered pages (no #app-root) shows and wires the theme switch. Its only storage is the THEME_KEY choice, which
 * is removed when the reader returns to the system theme. Pages work without it.
 */
export const THEME_SCRIPT=`(()=>{const k=${JSON.stringify(THEME_KEY)},r=document.documentElement,m=matchMedia('(prefers-color-scheme: dark)');
const effective=()=>{const t=r.dataset.theme;return t==='light'||t==='dark'?t:m.matches?'dark':'light'};
const paint=()=>document.querySelectorAll('meta[name="theme-color"]').forEach(x=>x.setAttribute('content',effective()==='dark'?'#0D1222':'#F6F8FD'));
let stored=null;try{stored=localStorage.getItem(k)}catch{}
if(stored==='light'||stored==='dark'){r.dataset.theme=stored;paint()}
addEventListener('DOMContentLoaded',()=>{
 const b=document.querySelector('[data-theme-toggle]');if(!b||document.getElementById('app-root'))return;
 const sync=()=>{const e=effective();b.dataset.mode=e;b.setAttribute('aria-label','Switch to '+(e==='dark'?'light':'dark')+' theme')};
 b.hidden=false;sync();
 b.addEventListener('click',()=>{const next=effective()==='dark'?'light':'dark',follow=next===(m.matches?'dark':'light');try{if(follow)localStorage.removeItem(k);else localStorage.setItem(k,next)}catch{}if(follow)delete r.dataset.theme;else r.dataset.theme=next;paint();sync()});
 m.addEventListener('change',()=>{paint();sync()});
});})();`;
export const themeScriptResponse=()=>new Response(THEME_SCRIPT,{headers:{'content-type':'application/javascript','cache-control':'public,max-age=300','x-content-type-options':'nosniff'}});
const ogImage=(name:string)=>`${CANONICAL_ORIGIN}/og/${hasOgImage(name)?name:'home'}.jpg`;
const SLUG=/^[a-z0-9][a-z0-9-]{0,89}$/;
async function hasPublishedEvidence(env:Pick<Env,'DB'>,companyId:string) {
 const row=await env.DB.prepare('SELECT (EXISTS(SELECT 1 FROM metric_releases WHERE company_id=?1) OR EXISTS(SELECT 1 FROM testimony WHERE company_id=?1 AND withdrawn_at IS NULL)) AS has').bind(companyId).first<{has:number}>();
 return !!row?.has;
}
/**
 * Per-page title, description and Open Graph image for the app shell. Only directory records and typed, validated
 * parameters are used; anything else falls back to the site defaults. Fictional employers are named as fictional, and a
 * real employer's "opens after" wording is used only when nothing about it is published.
 */
export async function shellMeta(env:Env,path:string,search:URLSearchParams):Promise<ShellMeta> {
 const site=(title:string,description:string,at:string):ShellMeta=>({title,description,image:ogImage('home'),url:`${CANONICAL_ORIGIN}${at}`});
 if(path==='/submit'||path==='/contribute')return site(`Contribute privately — ${BRAND}`,'Prove a work relationship without revealing who you are. Drafts stay on your device until you choose to submit them.','/submit');
 if(path==='/jury')return site(`Anonymous juries — ${BRAND}`,'How temporary anonymous juries answer one narrow policy question at a time, and whether they are active yet.','/jury');
 if(path==='/status')return site(`Check a contribution — ${BRAND}`,'Check the status of a contribution with its withdrawal capability. The check does not identify you.','/status');
 const home=site(DEFAULT_TITLE,DEFAULT_DESCRIPTION,'/');
 const slug=path.startsWith('/c/')?path.slice(3):null;
 if(!slug||!SLUG.test(slug))return home;
 try {
  const company=await getCompanyBySlug(env,slug);if(!company)return home;
  const url=`${CANONICAL_ORIGIN}/c/${company.slug}`,vs=search.get('vs');
  const other=search.get('view')==='compare'&&vs&&SLUG.test(vs)&&vs!==slug?await getCompanyBySlug(env,vs):null;
  // A comparison gets the neutral site image: neither employer's card describes both, and each name carries its label.
  // Fictional employers are named as such; a community listing carries its domain beside the name, as everywhere it is listed.
  const named=(c:{name:string;kind:string;origin?:string;domains?:string[]})=>c.kind==='sample'?`${c.name} (fictional demonstration)`:c.origin==='community'&&c.domains?.[0]?`${c.name} (${c.domains[0]})`:c.name;
  const community=(c:{origin?:string})=>c.origin==='community'?' Listed by the community; not endorsed by the site or the employer.':'';
  if(other)return {title:`${named(company)} and ${named(other)}, side by side — ${BRAND}`,description:`${company.kind==='sample'||other.kind==='sample'?'Includes fictional demonstration data. ':''}The same published measures for both employers, compared only on a shared reporting period, each traceable to its evidence.`,image:ogImage('home'),url:`${url}?view=compare&vs=${other.slug}`};
  // getCompanyBySlug already hides fictional employers unless SAMPLE_EMPLOYERS is 'on'; this keeps OG text honest if it ever did not.
  if(company.kind==='sample'&&!samplesEnabled(env))return home;
  if(company.kind==='sample')return {title:`${named(company)} — ${BRAND}`,description:`${company.name} is a fictional employer. Every number, account and event on its page is illustrative data you can inspect.`,image:ogImage(ogImageName(company.slug)),url};
  if(await hasPublishedEvidence(env,company.id))return {title:`${named(company)} — ${BRAND}`,description:`Published workplace evidence about ${company.name}, with sample sizes, periods and sources you can inspect.${community(company)}`,image:ogImage('home'),url};
  const paused=env.REAL_PUBLICATION_ENABLED==='true'?'':' Real-employer publication is currently paused.';
  return {title:`${named(company)} — ${BRAND}`,description:`Nothing is published about ${company.name} yet. Written accounts appear in batches of at least ${testimonyBatchMin(env)} verified contributions, after screening and a random delay; survey figures need ${aggregateMinimum(env)}. An empty record says nothing about working there.${paused}${community(company)}`,image:company.origin==='community'?ogImage('home'):ogImage(ogImageName(company.slug)),url};
 } catch {return home;}
}
export function appShell(o:{title:string;description:string;buildId:string;initialPath:string;meta?:ShellMeta}) {
 const meta=o.meta??{title:o.title,description:o.description,image:ogImage('home'),url:`${CANONICAL_ORIGIN}${o.initialPath}`};
 return `<!doctype html><html lang="en"><head>${head(meta,o.buildId)}</head><body><div id="app-root"></div><noscript><main class="page trust-document"><h1>${BRAND}</h1><p>The evidence canvas needs JavaScript. Without it you can read the <a href="/constitution">constitution</a>, the <a href="/privacy">privacy policy</a>, the <a href="/terms">terms of use</a> and the <a href="/transparency">transparency record</a>.</p></main></noscript><script src="/app.js?v=${o.buildId}" defer></script></body></html>`;
}
const ICON:Record<string,string>={sun:'M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66 1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14-1.41-1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',moon:'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',back:'M19 12H5m5-5-5 5 5 5'};
const svg=(name:string,size=18)=>`<svg class="icon ${name}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${ICON[name]}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const list=(links:ReadonlyArray<{href:string;label:string}>)=>`<ul>${links.map(l=>`<li><a href="${escapeHtml(l.href)}">${escapeHtml(l.label)}</a></li>`).join('')}</ul>`;
// The theme switch is hidden until /theme.js enhances it; the page is complete without scripts.
const nav=`<header class="topbar"><a class="wordmark" href="/" aria-label="${BRAND}, home"><img src="/favicon.svg" alt="" width="28" height="28"><span class="wordmark-text" aria-hidden="true">should i work there<span class="wordmark-q">?</span></span><span class="badge">Preview</span></a><nav class="nav" aria-label="Main">${NAV_LINKS.map(l=>`<a href="${l.href}">${escapeHtml(l.label)}</a>`).join('')}<button type="button" class="icon-button theme-toggle" data-theme-toggle hidden aria-label="Switch theme">${svg('sun')}${svg('moon')}</button><a class="nav-cta" href="/submit">Contribute</a></nav></header>`;
/** Every server-rendered page carries the legal links (Privacy, Terms, Accessibility, Legal requests). */
export const footerHtml=`<footer class="footer"><div class="footer-brand"><span class="footer-name">${BRAND}</span><span>Know the workplace. Protect the person.</span></div><nav class="footer-links" aria-label="Legal">${list(LEGAL_LINKS)}</nav><nav class="footer-links" aria-label="How it works">${list(TRUST_LINKS)}</nav><p class="footer-note">Free access. No ads. No employer privileges.</p></footer>`;
const PAGE_META:Record<string,{title:string;description:string}>={
 constitution:{title:'The Covenant',description:`The versioned commitments that govern ${BRAND}: free access, no employer privileges, open source.`},
 privacy:{title:LEGAL_PAGES.privacy.title,description:LEGAL_PAGES.privacy.description},
 terms:{title:LEGAL_PAGES.terms.title,description:LEGAL_PAGES.terms.description},
 accessibility:{title:LEGAL_PAGES.accessibility.title,description:LEGAL_PAGES.accessibility.description},
 moderation:{title:'Constitutional moderation',description:'The executable, versioned moderation policy, how juries and challenges run, and this quarter’s moderation counts.'},
 transparency:{title:'Transparency',description:'Live contribution counts, the signed release manifest, verifiable archives and how to check them yourself.'},
 'legal-requests':{title:'Legal requests',description:'How to send a legal notice, court order or subpoena, and a public record of legal requests and how they were answered.'},
 source:{title:'Source code',description:`Download and inspect the source of ${BRAND}, and check it against the signed release.`},
 finances:{title:'Finances',description:'How the site is paid for, recorded without invented figures.'},
};
export const TRUST_PAGES=Object.keys(PAGE_META);
const frame=(name:string,content:string,id:string)=>{
 const m=PAGE_META[name]??{title:BRAND,description:DEFAULT_DESCRIPTION};
 return `<!doctype html><html lang="en"><head>${head({title:`${m.title} — ${BRAND}`,description:m.description,image:ogImage('home'),url:`${CANONICAL_ORIGIN}/${name}`},id)}</head><body><div class="frame"><a class="skip-link" href="#main">Skip to content</a>${nav}<main class="page trust-document" id="main"><a class="back-link" href="/">${svg('back',16)}Back to the evidence</a>${content}</main>${footerHtml}</div></body></html>`;
};
/** A heading and paragraph whose text is already HTML (escape anything that is not literal copy). */
const section=(title:string,text:string,id?:string)=>`<h2${id?` id="${id}"`:''}>${title}</h2><p>${text}</p>`;
const bullets=(items:string[])=>`<ul>${items.map(i=>`<li>${i}</li>`).join('')}</ul>`;
const headed=(heads:string[],rows:string[][])=>`<div class="ledger-scroll"><table class="ledger"><thead><tr>${heads.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((c,i)=>i===0?`<th scope="row">${c}</th>`:`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const statLabel=(key:string)=>{const text=key.replaceAll('_',' ');return text.charAt(0).toUpperCase()+text.slice(1);};
/** 1001 → '1,001' (fixed, locale-independent). */
const thousands=(n:number)=>String(n).replace(/\B(?=(\d{3})+(?!\d))/g,',');
const WORDS=['zero','one','two','three','four','five','six','seven','eight','nine','ten'];
const words=(n:number)=>WORDS[n]??String(n);
const code=(text:string)=>`<code>${escapeHtml(text)}</code>`;
/** A value from the policy document that may not exist in every version, as escaped text (or ''). */
const policyText=(value:unknown)=>typeof value==='string'?escapeHtml(value):'';

/**
 * The covenant served at /constitution. It is versioned like the legal pages: a change gets a new version and a history
 * row, and the effective date is set to the day the version is first served (1.0.0: the legal pages' first go-live date,
 * LEGAL_FIRST_SERVED, which later legal versions never move).
 */
export const COVENANT={
 version:'1.0.0',
 effective:LEGAL_FIRST_SERVED,
 commitments:['Access will remain free.','Employers receive no privileged access.','Employers cannot buy influence or pay for suppression.','We do not sell user data or aggregated review intelligence.','We do not sell behavioral data.','We minimize identifying information and isolate verification.','Anonymous speech is protected to the maximum extent permitted by law.','The same executable moderation rules apply to every organization.','Material changes require public notice and review.','Core platform code and protocols remain open source.'],
 history:[{version:'1.0.0',effective:LEGAL_FIRST_SERVED,summary:'First versioned text: the ten commitments, the protected principles, the proposed amendment process and the link to the executable moderation policy.'}],
} as const;

/**
 * The switches a trust page states. The legal pages narrow real-employer juries, challenges and trustees by
 * moderationStatus(), which also requires live juror keys and the challenge secret, so they never describe a real-employer
 * jury that cannot form; the status line states both the configured switch and whether each kind of jury can form now.
 */
async function liveConfig(env:Env) {
 const configured=legalConfig(env), live=await moderationStatus(env).catch(()=>null), capacity=await juryCapacity(env);
 // Practice juries stay as configured: juror tokens for fictional employers can be obtained (and must be described)
 // whether or not enough keys exist for a case to reach a decision; the pages say a practice jury decides only when one can form.
 const narrowed=live?legalConfig(env,{juryEnabled:configured.juryEnabled&&live.juryEnabled,challengesEnabled:live.challengesEnabled,trusteesEnabled:live.trusteeExceptionsEnabled}):configured;
 return {configured,live,narrowed,capacity};
}
type JuryCapacity=Record<JuryClass,{withKeys:number;exist:number|null}>;
/**
 * How many employers of each jury class publish live juror keys that count toward forming a jury (the curated keys
 * moderation.ts jurorEmployers reads: a key the verifier created for a domain added by the community never counts, policy
 * 0.8.0), and how many fictional employers exist where they are shown (none where SAMPLE_EMPLOYERS is not 'on'), so the
 * status line can say why a jury cannot form. Null if unreadable.
 */
async function juryCapacity(env:Env):Promise<JuryCapacity|null> {
 try {
  const slugs:Record<JuryClass,Set<string>>={sandbox:new Set(),mailbox:new Set()};
  for(const k of await publicIssuerKeys(env,'juror'))if(k.source!=='community')slugs[k.verificationClass==='mailbox'?'mailbox':'sandbox'].add(k.companySlug);
  const samples=samplesEnabled(env)?await env.DB.prepare("SELECT COUNT(*) AS n FROM companies WHERE kind='sample'").first<{n:number}>():{n:0};
  return {sandbox:{withKeys:slugs.sandbox.size,exist:typeof samples?.n==='number'?samples.n:null},mailbox:{withKeys:slugs.mailbox.size,exist:null}};
 } catch {return null;}
}
const plural=(n:number,one:string,many:string)=>`${words(n)} ${n===1?one:many}`;
const juryLabel=(juryClass:JuryClass)=>juryClass==='sandbox'?'fictional':'real';
/**
 * 'at least three other real employers', 'at least one fictional employer': the employers whose juror keys a case of the
 * class needs, as moderation.ts staffable() counts them (the case's own employer counts unless ownEmployerExcluded).
 */
const employersWithKeys=(juryClass:JuryClass,n:number)=>{const noun=`${ownEmployerExcluded(juryClass)?'other ':''}${juryLabel(juryClass)} employer`;return `at least ${plural(n,noun,`${noun}s`)}`;};
/** Why no jury of a class can form: the requirement from the policy, and whether more juror keys could meet it. */
function whyNoJury(juryClass:JuryClass,capacity:JuryCapacity|null) {
 const need=employersNeeded(juryClass,'initial'),cap=seatsPerEmployer(juryClass),excluded=ownEmployerExcluded(juryClass),label=juryLabel(juryClass);
 const requirement=`a case needs juror keys of ${employersWithKeys(juryClass,need)}${cap===null?'':` under the ${words(cap)}-seat limit`}`;
 const c=capacity?.[juryClass];
 if(!c)return `${requirement}.`;
 if(c.exist!==null&&c.exist-(excluded?1:0)<need)return `${requirement}, and ${c.exist===0?`no ${label} employer exists`:`only ${plural(c.exist,`${label} employer exists`,`${label} employers exist`)}`}, so publishing more keys cannot change this until ${c.exist===0?`a ${label} employer is`:`more ${label} employers are`} added.`;
 const community=juryClass==='mailbox'&&typeof (policy.jury as {communitySeatsPerCase?:unknown}).communitySeatsPerCase==='number'?' Employers added by the community do not count toward this.':'';
 return `${requirement}, and ${c.withKeys===0?`no ${label} employer publishes them yet`:`${plural(c.withKeys,`${label} employer publishes`,`${label} employers publish`)} them${excluded?', counting the case’s own employer':''}`}.${community}`;
}
/**
 * The jury, appeal, challenge and trustee switches as they stand. A jury class that is switched on is described as
 * running only when a jury of it can form now (moderationStatus); otherwise the line says it is switched on but cannot
 * form, and why, so no page says a jury decides when none can.
 */
export function statusLine(configured:LegalConfig,live:Awaited<ReturnType<typeof moderationStatus>>|null,capacity:JuryCapacity|null=null) {
 const state=(kind:string,juryClass:JuryClass,on:boolean|undefined,can:boolean|undefined)=>!on?'off.':live?(can?`switched on, and a ${kind} jury can form right now.`:`switched on, but no ${kind} jury can form right now: ${whyNoJury(juryClass,capacity)}`):`switched on. Whether a ${kind} jury can form right now is stated at <a href="/api/config">/api/config</a>.`;
 const onClasses=([['mailbox',configured.juryEnabled],['sandbox',configured.practiceJuriesEnabled]] as const).filter(([,on])=>on===true).map(([c])=>c);
 const appealNeed=(juryClass:JuryClass)=>employersWithKeys(juryClass,employersNeeded(juryClass,'appeal'));
 const appeals=!live||!onClasses.length?'':` Appeals: ${live.appealsEnabled?'an appeal jury can form right now.':`none can form right now; an appeal needs juror keys of ${onClasses.map(appealNeed).join(', or of ')}.`}`;
 const challenges=live?.challengesEnabled??configured.challengesEnabled;
 const practice=configured.sampleEmployers===false?'Practice juries: not available, because this site shows no fictional demonstration employers.':`Practice juries for the fictional demonstration employers: ${state('practice','sandbox',configured.practiceJuriesEnabled,live?.sandboxJuryEnabled)}`;
 return `Juries for real employers: ${state('real-employer','mailbox',configured.juryEnabled,live?.juryEnabled)} ${practice}${appeals} Challenges to published accounts: ${challenges!==false?'open to anyone':'not open, because the server secret that keys the daily challenge budget is not set'}. Trustee exceptions: ${(live?.trusteeExceptionsEnabled??configured.trusteesEnabled)?'active':'not active'}. The same facts are published as data at <a href="/api/config">/api/config</a>.`;
}

/** What each published moderation count means (worker/src/moderation.ts moderationCounts). Unknown keys fall back to their name. */
export const MODERATION_STAT_DEFINITIONS:Record<string,string>={
 submitted:'Contributions submitted this quarter. Revisions are not counted again.',
 publishedAutomatically:'Accounts published this quarter whose words were cleared by automated screening alone, with no jury.',
 repairs:'Automated requests to repair a draft or revision, plus published accounts withheld for repair after a challenge.',
 jury:'First-jury cases opened this quarter, from screening or from challenges. Appeals are counted separately.',
 rejected:'Challenges answered this quarter without any change to the account.',
 practice:'Challenges to seeded fictional sample accounts, recorded as practice cases. They can never withhold those accounts.',
 legal:'Entries written this quarter to the public trustee exception log.',
 appeals:'Appealed decisions this quarter, one per appeal whatever the number of rules.',
 overturned:'Appeals decided this quarter in which every appealed rule was cleared.',
};
/**
 * Where no fictional employers are shown (SAMPLE_EMPLOYERS not 'on', as in production), the policy's sentences about
 * sandbox tokens and practice juries describe nothing that runs: flags.ts hides the fictional employers, moderation.ts
 * juryActive() runs no sandbox jury, the verifier lists and signs no sandbox key, and a hidden account cannot be challenged.
 */
export const NO_PRACTICE_NOTE='This site shows no fictional employers, so the parts of the policy above about sandbox tokens, practice juries and fictional-employer cases do not apply here: no sandbox token can be obtained and no practice jury runs. Every jury on this site is about a real employer.';
/** Appended to the definition of the practice count where no fictional employers are shown. */
export const NO_PRACTICE_CASES='This site shows no fictional employers now, so no new practice case can be recorded.';
export const HELD_LABELS:Record<string,string>={jury:'Held for a jury',jury_no_quorum:'A jury reached no decision',jury_upheld:'A jury upheld a rule',privacy_rescan:'Held by the identifier check before publication',challenge_repair:'Withheld for repair after a challenge',exception:'Withheld by a trustee exception'};
export const OUTCOME_LABELS:Record<string,string>={upheld:'Upheld',cleared:'Not upheld',no_quorum:'No decision (no quorum)',moot:'Ended without a decision (the words changed or were withdrawn)',open:'Open now'};
const coarseCell=(value:unknown)=>`<span class="num">${escapeHtml(String(value))}</span>`;
/** The kinds and reasons of the public listing correction log (community.ts CORRECTION_ACTIONS, CORRECTION_REASONS; migration 0011). */
export const CORRECTION_ACTION_LABELS:Record<string,string>={detach:'Community-added domain detached',withdraw:'Community listing removed',rename:'Community listing renamed'};
export const CORRECTION_REASON_LABELS:Record<string,string>={wrong_organization:'Named the wrong organization',wrong_domain:'The domain is not the employer’s',duplicate:'Duplicated another listing',content_rules:'Broke the content rules',legal_order:'A legal order',verifier_withdrawn:'Taken down at the verifier, then mirrored here'};

async function moderationPage(env:Env) {
 const {configured,live,capacity}=await liveConfig(env);
 const p=policy as unknown as {version:string;status:string;principles:readonly string[];uncertainty:Record<string,{default:string;statement:string}>;rules:readonly {id:string;category:string;name:string;text:string;repairAt?:number;juryRange?:readonly number[]}[];protections:readonly {id:string;name:string;text:string}[];jury:Record<string,unknown>&{stages:{initial:{jurors:number;upheldAt:number};appeal:{jurors:number;upheldAt:number}};appeals:Record<string,string>;activation:Record<string,string>;assignmentHours:number};challenges:Record<string,unknown>&{hostedChecksPerDay:{relevance:number;recheck:number;urgentRecheck?:number};urgentRules?:readonly string[];relevance:Record<string,unknown>};publicStatistics?:string;exceptions:Record<string,unknown>&{requiredSignatures:number;trustees:number;maxDays:Record<string,number>}};
 const versions=await Promise.all(Object.keys(policyVersions).map(async version=>({version,digest:(await policyDocument(version))?.digest??''})));
 const current=versions.find(v=>v.version===p.version);
 const outcome=(r:typeof p.rules[number])=>[r.repairAt!==undefined?`Repair at ${r.repairAt} or more`:'',r.juryRange?`anonymous jury from ${r.juryRange[0]} to ${r.juryRange[1]}`:''].filter(Boolean).join('; ')||'None';
 const {initial,appeal}=p.jury.stages;
 let stats:Awaited<ReturnType<typeof moderationStats>>|null=null;
 try {stats=await moderationStats(env);} catch {stats=null;}
 const counts=stats?Object.entries(stats.counts as Record<string,unknown>):[];
 const trusteesActive=live?.trusteeExceptionsEnabled??configured.trusteesEnabled===true;
 return [
  '<h1>Repair first.<br>Rules over discretion.</h1><p class="lede">Jev answers narrow policy questions with probabilities. Published, versioned code turns them into the next step. Nobody at the operator has a moderator dashboard, and negative opinions are not violations.</p>',
  '<div class="process-row"><span>Local privacy check</span><span>Approved Jev screening</span><span>Clear, repair or jury</span><span>Delayed, batched release</span></div>',
  section('The executable policy',`Policy ${escapeHtml(p.version)}: ${escapeHtml(p.status)}. Its digest is ${code(current?.digest??'')} (SHA-256 of its canonical JSON). Every decision records the version and digest it was made under. <a href="/moderation/v${escapeHtml(p.version)}.json">Read the executable policy (JSON)</a>, or fetch <a href="/moderation/current.json">/moderation/current.json</a>, which always points to the current version.`,'policy'),
  `<p>Every version stays published verbatim, so a receipt can always be checked against the policy it names:</p>${bullets(versions.map(v=>`<a href="/moderation/v${escapeHtml(v.version)}.json">Version ${escapeHtml(v.version)}</a>, digest ${code(v.digest)}`))}`,
  `<h2 id="principles">Protected principles</h2>${bullets(p.principles.map(escapeHtml))}${trusteesActive?'':'<p class="notice">The trustee process these principles rely on is not active yet. Until it is, valid legal orders and other removals the law requires are handled through direct administrative access, as described under <a href="#exceptions">Exceptions</a>. A person’s judgment that an account breaks a content rule is never a reason for such a removal: that goes through a challenge under the published rules.</p>'}`,
  `<h2 id="uncertainty">What happens when the model is unsure</h2><p>Each rule belongs to a category, and the category decides what uncertainty leads to.</p>${headed(['Category','When unsure','Rule'],Object.entries(p.uncertainty).map(([category,u])=>[escapeHtml(statLabel(category)),escapeHtml(statLabel(u.default)),escapeHtml(u.statement)]))}`,
  `<h2 id="rules">Rules</h2><p>Each rule asks Jev one narrow question. The thresholds are model probabilities, applied by the policy code; they are provisional until evaluated on labeled cases.</p>${headed(['Rule','What it covers','Outcome'],p.rules.map(r=>[escapeHtml(r.id),`${escapeHtml(r.name)}. ${escapeHtml(r.text)}`,escapeHtml(outcome(r))]))}`,
  `<p>These protections can be cited, but they only ever protect: a challenge under one is answered and never acted on.</p>${headed(['Protection','Text'],p.protections.map(r=>[escapeHtml(r.id),`${escapeHtml(r.name)}. ${escapeHtml(r.text)}`]))}`,
  section('Only the author edits','Each suggested change needs the author’s individual approval. Allegations remain attributed testimony, never findings of fact by this site. No administrator can rewrite, release, shorten the delay of, or suppress a contribution through the application.'),
  `<h2 id="juries">Temporary juries and appeals</h2><p>${initial.jurors} randomly drawn anonymous jurors each answer one question about one rule: YES, NO or UNSURE. ${policyText(p.jury.upheld)} On a first jury that means at least ${initial.upheldAt} of ${initial.jurors}; on an appeal, ${appeal.upheldAt} of ${appeal.jurors}. UNSURE counts as an abstention.</p>${bullets([
   policyText(p.jury.question)?`The question: “${policyText(p.jury.question)}”`:'',
   policyText(p.jury.closing),
   `Seats last ${p.jury.assignmentHours} hours; an unused seat reopens.`,
   policyText(p.jury.eligibility),
   policyText(p.jury.tokens),
   policyText(p.jury.passage),
   policyText(p.jury.consent),
   policyText(p.jury.erasure),
   policyText(p.jury.scope),
   policyText(p.jury.blind),
   `Appeals: ${policyText(p.jury.appeals.by)} ${policyText(p.jury.appeals.stage)} ${policyText(p.jury.appeals.final)}`,
   `Limits: ${policyText(p.jury.limits)}`,
   `Activation: ${policyText(p.jury.activation.sandbox)} ${policyText(p.jury.activation.realEmployers)}`,
  ].filter(Boolean))}${configured.sampleEmployers===false?`<p class="notice">${NO_PRACTICE_NOTE}</p>`:''}<p><a href="/jury">Serve as a juror</a></p>`,
  `<p class="notice">${statusLine(configured,live,capacity)}</p>`,
  `<h2 id="challenges">Challenges</h2><p>${policyText(p.challenges.who)} ${policyText(p.challenges.grounds)} Every published account carries a challenge action.</p>${bullets([
   policyText(p.challenges.relevance.sent),
   policyText(p.challenges.relevance.fallback),
   policyText(p.challenges.rescreen),
   policyText(p.challenges.duplicates),
   `Hosted checks per UTC day: ${p.challenges.hostedChecksPerDay.relevance} relevance checks and ${p.challenges.hostedChecksPerDay.recheck} re-checks${typeof p.challenges.hostedChecksPerDay.urgentRecheck==='number'&&p.challenges.urgentRules?.length?`, plus ${p.challenges.hostedChecksPerDay.urgentRecheck} re-checks reserved for ${escapeHtml(p.challenges.urgentRules.join(', '))}`:''}. ${policyText(p.challenges.budgets)}`,
   policyText(p.challenges.queue),
   policyText(p.challenges.finality),
   configured.sampleEmployers===false?'':policyText(p.challenges.fixtures),
  ].filter(Boolean))}`,
  `<h2 id="exceptions">Exceptions</h2><p>Removals outside the published rules are limited to what the law requires, such as a valid legal order, and to credible imminent-safety issues. They need ${words(p.exceptions.requiredSignatures)} of ${words(p.exceptions.trustees)} independent trustees and last at most ${p.exceptions.maxDays.legal_order??''} days for a legal order and ${p.exceptions.maxDays.imminent_safety??''} for a safety issue. ${trusteesActive?'The process is active.':'The process is not active: no trustee keys are configured, so the exception route refuses every request. Until it is, we act on valid legal orders, and on other removals the law requires (such as a valid copyright notice, or an erasure request the law obliges us to grant), through direct administrative access to our infrastructure, limit the action to what the law requires, and record it in the <a href="/legal-requests">legal requests ledger</a> when the law allows. A report that an account breaks a content rule, and not the law, is decided by a challenge under the published rules, never by this route. Such a removal is not a trustee exception and does not appear in the exception log below.'}</p>${bullets([policyText(p.exceptions.signature),policyText(p.exceptions.effect),policyText(p.exceptions.renewal),policyText(p.exceptions.transparency),policyText(p.exceptions.order)].filter(Boolean))}<p>The public exception log is at <a href="/api/moderation/exceptions">/api/moderation/exceptions</a>. Control of the cloud account remains a separate limitation, described in the threat model.</p>`,
  `<h2 id="statistics">This quarter’s moderation counts</h2>${stats?`<p>Quarter ${escapeHtml(stats.period)}. ${policyText(p.publicStatistics)||'Counts are updated by the scheduled job, so they can be a few hours old. Any count below 5 is shown as “&lt;5”.'} The same data is at <a href="/api/moderation/stats">/api/moderation/stats</a>.</p>${headed(['Measure','Count','What it counts'],counts.map(([key,value])=>[escapeHtml(statLabel(key.replace(/([A-Z])/g,' $1').toLowerCase())),coarseCell(value),escapeHtml(`${MODERATION_STAT_DEFINITIONS[key]??''}${key==='practice'&&configured.sampleEmployers===false?` ${NO_PRACTICE_CASES}`:''}`)]))}${headed(['Held privately now, by reason','Count'],Object.entries(stats.heldByReason as Record<string,unknown>).map(([key,value])=>[escapeHtml(HELD_LABELS[key]??statLabel(key)),coarseCell(value)]))}${headed(['First-jury outcomes this quarter','Count'],Object.entries((stats as {juryOutcomes?:Record<string,unknown>}).juryOutcomes??{}).map(([key,value])=>[escapeHtml(OUTCOME_LABELS[key]??statLabel(key)),coarseCell(value)]))}`:'<p>The moderation counts could not be read right now. They are also published at <a href="/api/moderation/stats">/api/moderation/stats</a>.</p>'}`,
 ].join('');
}

/** The signed release manifest this build serves, parsed only for display; verification is tools/verify-deployment.mjs. */
function releaseSummary():{buildId?:string;releasedOn?:string;keyId?:string;policy?:string;legal?:string}|null {
 if(!RELEASE_MANIFEST)return null;
 try {
  const doc=JSON.parse(RELEASE_MANIFEST) as {manifest?:{buildId?:string;releasedOn?:string;policy?:{version?:string};legal?:{version?:string}|string};signature?:{keyId?:string}};
  const legal=doc.manifest?.legal;
  return {buildId:doc.manifest?.buildId,releasedOn:doc.manifest?.releasedOn,keyId:doc.signature?.keyId,policy:doc.manifest?.policy?.version,legal:typeof legal==='string'?legal:legal?.version};
 } catch {return {};}
}

async function transparencyPage(env:Env) {
 const {configured,live,capacity}=await liveConfig(env);
 const [corrections,link]=await Promise.all([correctionLog(env),configured.communityListings?verifierLinkState(env).catch(()=>null):Promise.resolve(null)]);
 const stats=await publicStats(env),archives=(await env.DB.prepare('SELECT id,digest,previous_digest FROM release_manifests ORDER BY created_at DESC LIMIT 12').all<{id:string;digest:string;previous_digest:string|null}>()).results;
 const release=releaseSummary(), verifier=(()=>{try {const u=new URL(env.VERIFIER_ORIGIN??'https://verify.shouldiworkthere.com');return u.protocol==='https:'||env.ENVIRONMENT==='development'?u.origin:null;} catch {return null;}})();
 const bands=ISSUANCE_POLICY.mailboxCredentialsByHeadcount.map(([min,cap],i,all)=>{const next=i>0?all[i-1]![0]-1:null;return [min===0?`Unknown, or under ${thousands(all[all.length-2]?.[0]??1001)}`:next===null?`${thousands(min)} or more`:`${thousands(min)} to ${thousands(next)}`,thousands(cap),thousands(cap*ISSUANCE_POLICY.jurorTokensPerCredential)];}).reverse();
 return [
  '<h1>Show the work.</h1><p class="lede">Live counts with small numbers withheld, a signed statement of what this deployment serves, archives anyone can recompute, and the tools to check them.</p>',
  `<h2 id="counts">Contribution counts</h2>${headed(['Measure','Count'],Object.entries(stats).map(([key,value])=>[statLabel(key),coarseCell(value)]))}<p class="small-note">Nonzero counts below 25 are shown as &lt;25; larger counts are rounded down to multiples of 25. They are computed at most once per UTC day. These are contributions, not unique people. Moderation counts, with their definitions, are on the <a href="/moderation#statistics">moderation page</a>.</p>`,
  `<h2 id="release">Signed release manifest</h2><p>${release?`This deployment serves a release manifest signed with the operator’s release key${release.buildId?`: build ${code(release.buildId)}`:''}${release.releasedOn?`, released ${escapeHtml(release.releasedOn)}`:''}${release.keyId?`, signed by key ${code(release.keyId)}`:''}${release.policy?`, moderation policy ${escapeHtml(release.policy)}`:''}${release.legal?`, legal version ${escapeHtml(release.legal)}`:''}.`:'This deployment does not serve a signed release manifest yet, so the checks below that need one report it as missing.'} It is published at <a href="/.well-known/siwt-release.json">/.well-known/siwt-release.json</a>, and every signed release is also kept as a record in the source repository, never overwritten.</p>${bullets([
   '<strong>What it covers.</strong> An Ed25519 signature over: the client script and stylesheet exactly as served; a SHA-256 digest of every worker, shared, database and Wrangler configuration source file and of the dependency lockfile; the fingerprint of every issuer key (contribution and juror) live when the release was built; the moderation policy version and digest; and the legal version.',
   '<strong>What it proves.</strong> If the served client, the source listing, the published issuer keys or the policy differ from what the operator signed, anyone comparing them can tell.',
   '<strong>Keys added after the release.</strong> When someone adds an employer, the verifier creates that employer’s keys on demand, so no release can list them in advance. They are published at both addresses marked as community keys, and a browser uses one only when this site and the verifier publish it identically, member for member; the contribution page labels such a key as added after this release. This site accepts such a key only while its employer still has a domain added by the community in the directory: once a wrong domain is detached, credentials made with that key and not yet used are refused. That agreement shows that the two services describe the key the same way; unlike a signature in the release, it does not show that every visitor is offered the same key. The publisher copies these keys into its key registry, which every transparency archive lists, so a key offered to only some visitors can be noticed by people who compare archives.',
   '<strong>What it does not prove.</strong> It cannot show which code the Workers actually execute, or what another visitor is served. There is one release key and no rotation process yet.',
  ])}`,
  `<h2 id="archives">Archives</h2><p>A scheduled job writes a transparency archive, at most one a day, to public storage. Each archive (format ${code(ARCHIVE_FORMAT)}) holds rounded contribution counts, this quarter’s decision counts and moderation statistics (rounded as on the moderation page: counts that follow contributions as “&lt;25” or multiples of 25, other counts below 5 as “&lt;5”), the public exception log, the finance ledger, the policy version and digest, and:</p>${bullets([
   'RFC 6962 Merkle roots over the published accounts and over the metric releases, with rounded counts. The leaf lists are not archived, so a withdrawn account leaves no permanent fingerprint here.',
   'The fingerprint of every issuer key in the publisher’s key registry, expired keys included, with a digest of the set, so a key served to one visitor and not others would show up. A key is removed from the registry only if the operator deletes it, for example after a leak; archives written before that keep its fingerprint, later ones omit it, and a reader comparing archives sees the set shrink.',
   'The digest of the release manifest served when it was written, and the digest of the previous archive, forming a chain.',
   'A method field that spells out every field and encoding, so anyone holding a snapshot can recompute the roots without our code.',
  ])}${archives.length?`<p>Recent archives:</p>${bullets(archives.map(a=>`<a href="/archives/${escapeHtml(a.id)}.json">${escapeHtml(a.id)}</a>, digest ${code(a.digest)}`))}`:'<p>The first scheduled archive is pending.</p>'}<p>Archives are not signed. The chain detects changes to archives that readers kept; it cannot, alone, stop an operator from rewriting every copy consistently. That is what keeping a history, below, is for.</p>`,
  `<h2 id="verify">Check it yourself</h2><p>From a copy of the source repository, run ${code('node tools/verify-deployment.mjs --state=.siwt-watch-state.json')}. It uses only Node’s built-in modules and plain public requests, and prints PASS, FAIL, WARN or SKIP for each check:</p>${bullets([
   'the manifest signature, and its signer against the release keys recorded in the repository (or one you pin with --release-key);',
   'the served client files byte for byte, and the published source files, against the signed digests;',
   'that this site and the verifier publish identical issuer keys, that each key from the release is signed in the manifest, that each community key added since agrees byte for byte between the two, and that no employer has more than four live keys of a purpose;',
   'the served moderation policy against its signed digest;',
   'every archive digest, the chain, the key registry and the release link, and that the verifier’s statistics stay coarse.',
  ])}<p>Keep the state file between runs. It pins the archives and releases you have seen, so a later rewrite of that history, or a fork, fails, and an older release than one seen before is flagged. Without a kept history, a consistent rewrite of every archive cannot be detected.</p>`,
  `<h2 id="issuance-limits">Verification limits</h2><p>To limit astroturfing, the verifier caps how many credentials and juror tokens it issues for each real employer per quarter, by the lower bound of the employer’s published headcount band. These numbers are provisional and have not been evaluated with real data.</p>${headed(['Headcount band','Credentials per quarter','Juror tokens per quarter'],bands)}${bullets([
   `A work mailbox can obtain one credential and ${typeof (policy.jury as {tokens?:unknown}).tokens==='string'?'one set of ':''}up to ${JUROR_QUOTA} juror tokens per employer and quarter.`,
   `Velocity limit: the larger of ${ISSUANCE_POLICY.minimumVelocity.contribution} credentials (${ISSUANCE_POLICY.minimumVelocity.juror} juror tokens) and ${Math.round(ISSUANCE_POLICY.velocityShareOfCap*100)}% of the cap within a rolling ${ISSUANCE_POLICY.windowHours} hours. A request that would exceed it is refused and pauses issuance for that employer for ${ISSUANCE_POLICY.pauseHours} hours: a contribution trip pauses credentials and juror tokens, a juror trip pauses juror tokens only.`,
   'A legitimate surge, such as a layoff day, also trips the pause, and an employer that controls many mailboxes can use up its own cap.',
   'Employers added by the community have no published headcount; the verifier gives their keys conservative default caps, shown with their state at its /stats address.',
   ...(samplesEnabled(env)?['Fictional sample employers have no cap, count or pause; only per-connection rate limits apply to them.']:[]),
  ])}<p>${verifier?`The verifier publishes the current state per employer, as coarse bands with no exact counts or times, at <a href="${escapeHtml(verifier)}/stats">${escapeHtml(verifier)}/stats</a>.`:'The verifier publishes the current state per employer, as coarse bands with no exact counts or times, at its /stats address.'}</p>`,
  `<h2 id="listing-corrections">Listing corrections</h2><p>Employer listings added by the community, and domains someone added to one of our listings, are corrected only on request, as the <a href="/terms#community-listings">terms</a> describe: a person reviews each request sent to <a href="mailto:${CONTACT.legal}">${CONTACT.legal}</a>, and the operator applies the outcome through a route only the operator can use. A correction can rename a community listing, detach a domain added by the community (its signing keys are deleted and this site stops accepting credentials made with them), or remove a community listing about which nothing is published, held or waiting. It never changes, withholds or removes an account. Every correction is logged here permanently, with its kind, its reason, the quarter and a digest of the listing’s page identifier (SHA-256 of ${code('siwt-listing-v1:')} and the identifier), never the listing’s name or who asked; the same log is published as data at <a href="/api/transparency">/api/transparency</a>.</p>${corrections.length?headed(['Quarter','Correction','Reason','Listing digest'],corrections.map(c=>[escapeHtml(c.period),escapeHtml(CORRECTION_ACTION_LABELS[c.action]??c.action),escapeHtml(CORRECTION_REASON_LABELS[c.reason]??c.reason),code(c.targetDigest)])):'<p>No listing has been corrected.</p>'}`,
  section('Release status',`Blind credentials (RFC 9474 blind RSA signatures): implemented, not independently reviewed. Work-mailbox verification: the verifier states whether it sends email for each key in its public key list${verifier?` at <a href="${escapeHtml(verifier)}/keys">${escapeHtml(verifier)}/keys</a>`:''}. Real-employer publication: ${env.REAL_PUBLICATION_ENABLED==='true'?`enabled, with written accounts in batches of at least ${testimonyBatchMin(env)} per employer and verification type and survey figures for groups of at least ${aggregateMinimum(env)}`:'paused'}. Fictional demonstration employers: ${samplesEnabled(env)?'shown, labeled as fictional':'none shown'}. Adding employers: ${configured.communityListings?`open to anyone${link?.state==='refused'?`, except that the verifier refused this site’s shared secret at the last scheduled check (${escapeHtml(link.day)}), so adding employers is reported closed until a later check finds it accepted`:''}`:'closed. It opens only while the main worker has the verifier and inference service bindings, the internal secret it shares with the verifier and the rate-limit secret, and one of them is missing'}. ${statusLine(configured,live,capacity)}`,'status'),
 ].join('');
}

export async function trustPage(name:string,env:Env,buildId:string) {
 let content='';
 if(name==='constitution') {
  const current=await policyDocument(policy.version);
  content=[
   `<h1>Structure before promises.</h1><p class="lede">Free access. No employer privileges. No business model built on the people who contribute.</p><p class="small-note">Covenant version ${COVENANT.version}, effective <time datetime="${COVENANT.effective}">${longDate(COVENANT.effective)}</time>.</p>`,
   `<ol class="covenant-list">${COVENANT.commitments.map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ol>`,
   section('Protected principles','No ads, sponsored companies, recruiting marketplace, premium tier, venture financing, reputation-management service or engagement-maximizing feed. Optional donations would convey no product or moderation privileges. Donation collection is not enabled.'),
   section('Executable moderation',`The content rules are code: <a href="/moderation/v${policy.version}.json">moderation policy ${policy.version}</a> (digest ${code(current?.digest??'')}) turns narrow model probabilities into clear, repair or jury outcomes. It never asks a model whether criticism is acceptable, and it applies to every organization the same way. See <a href="/moderation">how moderation works</a> for its rules, juries, challenges and this quarter’s counts.`),
   section('Changing the constitution',`Each change to this covenant gets a new version number and a row below, and every version stays listed. The moderation policy is versioned separately: every version stays published and decisions pin the one they were made under. The proposed governance rules require 90 days of public notice and a supermajority of independent trustees, with conflicts disclosed, and treat the privacy and no-influence principles as reserved provisions. This is a governance proposal: no nonprofit, legally binding board or independent trustees exist yet, and today the operator can change this text. The legal operator is named in the <a href="/terms">terms of use</a>.`),
   `<h2 id="history">Version history</h2>${headed(['Version','Effective','What changed'],COVENANT.history.map(h=>[escapeHtml(h.version),longDate(h.effective),escapeHtml(h.summary)]))}`,
  ].join('');
 }
 if(name==='privacy'||name==='terms'||name==='accessibility') {
  const {narrowed}=await liveConfig(env);
  content=name==='privacy'?privacyPolicyHtml(narrowed):name==='terms'?termsHtml(narrowed):accessibilityHtml();
 }
 if(name==='moderation')content=await moderationPage(env);
 if(name==='transparency')content=await transparencyPage(env);
 if(name==='legal-requests') {
  const rows=(await env.DB.prepare('SELECT received_on,kind,jurisdiction,scope_summary,responded,data_disclosed FROM legal_requests ORDER BY received_on DESC').all<Record<string,string>>()).results;
  // The challenge dialog sends people here for a legal notice, so the page says how to send one (legal.ts, same words as the terms).
  const {narrowed}=await liveConfig(env);
  content=`<h1>A public record of requests.</h1><p class="lede">Legal requests and our responses are recorded here when the law allows. A request we are legally barred from disclosing can require delayed or aggregated reporting. To send a legal notice, court order or subpoena, see <a href="#send">how to send a legal request</a>.</p><h2 id="ledger">Recorded requests</h2>${rows.length?headed(['Received','Kind','Jurisdiction','Scope','Responded','Data disclosed'],rows.map(r=>[r.received_on,r.kind,r.jurisdiction,r.scope_summary,r.responded,r.data_disclosed].map(v=>escapeHtml(String(v??''))))):'<p>No legal requests are recorded. This is a statement about this ledger, not about requests that cannot legally be disclosed.</p>'}${legalRequestsContactHtml(narrowed)}${section('How the ledger works','Entries are added by the operator through an authenticated ledger endpoint. The database refuses updates and deletions of existing entries, so a correction is a new entry. Trustee exceptions, when that process is active, are also written to the public exception log at <a href="/api/moderation/exceptions">/api/moderation/exceptions</a> before anything is withheld.')}${section('What we could be asked for','There is no stored link between the verifier’s records and any contribution. Email delivery and issuance limits stay with the verifier; contributions and withdrawal capabilities stay with the publisher. The <a href="/privacy#legal-requests">privacy policy</a> lists exactly what each holds and for how long. The three services share one cloud account, so control of that account and traffic correlation remain residual risks.')}`;
 }
 if(name==='source')content=[
  '<h1>Inspect the implementation.</h1><p class="lede">The interface, the proof protocol, the privacy detector, the moderation policy engine and the database schema ship with this release.</p><p><a class="primary-button" href="/api/source" download="shouldiworkthere-source.json">Download the source bundle</a></p><p><a href="https://github.com/eliseorobles/shouldiworkthere">Browse the repository and contribute on GitHub</a></p>',
  section('What is included','Original TypeScript and React code, SQL migrations, build tools, tests, documentation and license notices. Secrets, credentials, environment files, dependency caches and private records are excluded by an explicit allowlist in the build.'),
  section('Check it against the signed release','The signed <a href="/.well-known/siwt-release.json">release manifest</a> lists a SHA-256 digest of every worker, shared, database and configuration source file and of the dependency lockfile. <code>tools/verify-deployment.mjs</code> compares the files served here with those digests; see <a href="/transparency#verify">how to run it</a>.'),
  section('License and limits','Original code is MIT licensed. Cloudflare’s blind-signature library is Apache-2.0; its notice is included. Downloadable, signed source supports inspection, but it is not an independent security audit or a reproducible-build attestation, and it cannot prove which code the Workers execute.'),
  section('Roadmap transparency','The ticket record distinguishes working code from work that needs people, legal adoption or independent review, such as independent verifier operation, trustees and an audit.'),
 ].join('');
 if(name==='finances') {
  const entries=(await env.DB.prepare('SELECT period,kind,category,amount_cents,currency,note FROM financial_entries ORDER BY period DESC').all<{period:string;kind:string;category:string;amount_cents:number;currency:string;note:string}>()).results.filter(e=>e.amount_cents!==0);
  content=`<h1>Nothing to subscribe to.</h1><p class="lede">No employer revenue, advertising, paid reputation management or data sales. Donations are not enabled and would never buy privileges.</p>${entries.length?headed(['Period','Category','Amount','Note'],entries.map(e=>[escapeHtml(e.period),escapeHtml(e.category),`<span class="num">${escapeHtml(e.currency)} ${(e.amount_cents/100).toFixed(2)}</span>`,escapeHtml(e.note)])):'<div class="empty-state"><strong>Invoices have not been reconciled yet.</strong> Costs are unknown, not zero. This site uses an existing paid Cloudflare account and hosted inference. Runway and donation totals will never be invented.</div>'}${section('Append-only accounting','Entries are added through an authenticated ledger endpoint, and the database refuses updates and deletions of existing entries, so corrections are new entries. This is not an audited financial statement.')}${section('Independent operation','The product has its own technical addresses and branding. A separate legal entity for the product and independent governance have not been established; the legal operator is named in the <a href="/terms">terms of use</a>.')}`;
 }
 return frame(name,content,buildId);
}
