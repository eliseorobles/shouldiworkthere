import {useEffect,useMemo,useRef,useState,useId} from 'react';
import {z} from 'zod';
import {fetchDirectory,shownDirectory,employerLabel,type DirectoryCompany} from './api.ts';
import {powSubject} from '../shared/pow.ts';
import {withPow} from './pow-client.ts';
import {chooseIssuerKey,isCommunityKey} from './community-keys.ts';
import {scanText} from '../shared/privacy.ts';
import {MINIMUM_AGE} from '../shared/brand.ts';
import {policy,communitySeatsPerCase} from '../shared/policy.ts';
import {prepareJurorToken,finalizeBlinding,reusableIssuance,keyPurpose,jurorClass,JUROR_BATCH_MAX,JUROR_QUOTA,type IssuerKey,type JurorProof,type BlindingState} from '../shared/proof.ts';
import {hasAuthor,saveJurorTokens,listJurorTokens,deleteJurorToken,saveIssuance,deleteIssuance,listIssuances,type PendingIssuance} from './vault.ts';
import {send,ServiceError,PrivacyEditor,PolicyLine,CheckedCrisisNote,JuryReviewConsent,PowNote,SensitiveConsent,PRIVATE_TEXT,keyTrust,powBinding,verifierPowBits,withdrawByCapability,revise,repairNotice,loadConfig,loadKeys,crossCheckKey,keyFingerprint,plainError,opensNewTab,STATUS_TEXT,ISSUE_ERRORS,DEVICE_WARNING,OUTCOME_LABEL,PROVIDERS,type SiteConfig,type AuthorReply} from './submit.tsx';

/* The published constitution's own wording, so this page cannot drift from the rules the server runs. */
type JuryText={yesMeans?:string;upheld?:string;closing?:string;eligibility?:string;passage?:string;limits?:string;consent?:string;appeals?:{stage?:string;final?:string};assignmentHours?:number;activation?:{sandbox?:string;realEmployers?:string;live?:string}};
const JURY=((policy as unknown as {jury?:JuryText}).jury??{}) as JuryText;
const sentence=(text:string)=>text.charAt(0).toUpperCase()+text.slice(1);
const MODERATION_ERRORS:Record<string,string>={
 already_voted:'A vote was already recorded for this seat.',
 assignment_expired:'This seat expired before the vote arrived, so it reopened for another juror. Nothing was counted.',
 assignment_not_found:'This seat is no longer assigned to you. Nothing was counted.',
 case_closed:'The case closed before the vote arrived. Nothing was counted.',
 token_already_used:'That juror token was already used, so it cannot staff another case.',
 replayed:'That request was already used.',
 appeal_already_made:'An appeal was already made for this decision.',
 appeal_not_available:'There is no jury decision to appeal.',
 jury_not_active:'Juries for this kind of case are not active yet, so no appeal can be drawn.',
 unknown_rule:'That rule is not in the published policy.',
 not_challengeable_now:'This account cannot be challenged right now.',
 checks_unavailable:'The relevance check is unavailable right now. Nothing was decided; try again later.',
 juror_tokens_unavailable:'Juror tokens cannot be checked right now. Your token was not used; try again later.',
 // The service reads the 18+ confirmation before the token, so a refusal here leaves the token unspent.
 adult_confirmation_required:'Cases go only to jurors who confirm they are 18 or older, and the service did not accept the confirmation as sent. No case was assigned and your token was not used; reload the page and try again.',
};
const friendly=(error:unknown,extra?:Record<string,string>)=>error instanceof z.ZodError?'The server’s answer was not in the expected form, so nothing is shown. Try again later.':plainError(error,{...MODERATION_ERRORS,...extra});
const JUROR_ERRORS:Record<string,string>={...ISSUE_ERRORS,
 juror_quota_exceeded:`This mailbox already received the most juror tokens it can for this employer this quarter (${JUROR_QUOTA}). Nothing was issued.`,
 issuance_paused:'Verification for this employer is paused for up to 24 hours because unusually many credentials or tokens were requested; nothing was issued.',
 issuance_cap_reached:'This employer’s limit for this quarter is used up. Nothing was issued.',
 wrong_key_purpose:'That key is not a juror key, so nothing was issued.',
 rate_limited:'Too many requests from this network. Wait a while and try again.',
 // The verifier checks the 18+ confirmation before it reads the key or the code, so nothing is signed or used up.
 adult_confirmation_required:'Juror tokens go only to people who confirm they are 18 or older, and the verifier did not accept the confirmation as sent. Nothing was issued; reload the page and try again.',
};
const ADULT_FIRST=`Confirm that you are ${MINIMUM_AGE} or older first. Nothing was sent.`;
// A definitive refusal where the verifier signed and recorded nothing: the challenge is unused, so a new batch may follow.
const NOTHING_ISSUED=['juror_quota_exceeded','issuance_paused','issuance_cap_reached'];
// Refusals that mean a token can never staff a case. It is discarded so it cannot block the tokens behind it.
const UNUSABLE_TOKEN:Record<string,string>={
 token_already_used:'That juror token was already used, so it cannot staff another case.',
 invalid_token:'The service could not read that juror token, so it cannot staff a case.',
 credential_expired:'That juror token has expired.',
 invalid_signature:'That juror token’s signature did not verify.',
 unknown_issuer_key:'The key that signed that juror token is no longer published.',
};

/* Juror page */
type Vote='YES'|'NO'|'UNSURE';
// Exactly what the server shows a juror. It never includes the stage (initial or appeal), the author or any earlier result.
const caseSchema=z.object({id:z.string(),ruleId:z.string(),ruleName:z.string(),ruleText:z.string(),question:z.string(),passage:z.string(),options:z.array(z.enum(['YES','NO','UNSURE'])).min(1),policyVersion:z.string(),policyDigest:z.string(),expiresAt:z.string()});
type JuryCase=z.infer<typeof caseSchema>;
const assignSchema=z.discriminatedUnion('available',[z.object({available:z.literal(true),assignment:z.string(),case:caseSchema}),z.object({available:z.literal(false),reason:z.string()})]);
interface Held {handle?:string;keyId:string;companySlug:string;verificationClass:string;expiresAt:string;token:JurorProof;}
interface JurorIssuing {challengeId:string;keyId:string;prepared:Array<{blinded:string;state:BlindingState;finalize:(blindSignature:string)=>Promise<JurorProof>}>;handle?:string|null;}
const VOTES:Record<Vote,{label:string;hint:string}>={YES:{label:'Yes',hint:JURY.yesMeans??'The passage breaks the rule.'},NO:{label:'No',hint:'The passage does not break the rule.'},UNSURE:{label:'Unsure',hint:'Abstain. It counts as neither yes nor no.'}};
function CaseView({assignment,jury,onDone}:{assignment:string;jury:JuryCase;onDone:()=>void}) {
 const [vote,setVote]=useState<Vote|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[recorded,setRecorded]=useState(false);
 const expires=new Date(jury.expiresAt);
 async function cast() {
  if(!vote)return;setBusy(true);setError('');
  try {const reply=z.object({recorded:z.boolean()}).parse(await send('/api/jury/vote',{assignment,vote}));if(!reply.recorded)throw new Error('The vote was not recorded. Nothing was counted.');setRecorded(true);}
  catch(e){setError(friendly(e));}finally{setBusy(false);}
 }
 return <section className="cx-card cx-case" aria-labelledby="case-question">
  <p className="cx-overline">Case <code className="cx-code">{jury.id}</code></p>
  <h2 id="case-question">{jury.question}</h2>
  <div className="cx-rule-card"><p className="cx-kicker">{`Rule ${jury.ruleId}: ${jury.ruleName}`}</p><p>{jury.ruleText}</p></div>
  <figure className="cx-passage"><figcaption>The passage under review</figcaption><blockquote>{jury.passage}</blockquote></figure>
  <fieldset className="cx-vote" disabled={recorded||busy}><legend>Your answer</legend>{jury.options.map(option=><label key={option} className={`cx-vote-option${vote===option?' is-selected':''}`}><input type="radio" name={`vote-${assignment}`} value={option} checked={vote===option} onChange={()=>setVote(option)}/><strong>{VOTES[option].label}</strong><span>{VOTES[option].hint}</span></label>)}</fieldset>
  {!recorded&&<button type="button" className="cx-btn cx-btn-primary" disabled={!vote||busy} onClick={()=>void cast()}>{busy?'Recording…':'Cast my sealed vote'}</button>}
  {error&&<p role="alert" className="cx-error">{error}</p>}
  {recorded?<div role="status" className="cx-result cx-result-clear"><strong>Your vote is recorded.</strong><p>It stays sealed until the case closes. The token you used staffed this case and cannot be used again.</p><button type="button" className="cx-btn" onClick={onDone}>Done</button></div>
  :<p className="cx-note">{JURY.upheld?`${JURY.upheld} `:''}This seat is yours until {expires.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'})}; if you have not voted by then, it reopens for another juror. <PolicyLine decision={{policyVersion:jury.policyVersion,policyDigest:jury.policyDigest}}/></p>}
 </section>;
}
export function JuryPage() {
 const [config,setConfig]=useState<SiteConfig|null>(null),[directory,setDirectory]=useState<DirectoryCompany[]>([]),[keys,setKeys]=useState<IssuerKey[]>([]),[loaded,setLoaded]=useState(false),[working,setWorking]=useState(false);
 // Aborts a proof of work still running ("Stop the calculation"); nothing is sent while it runs.
 const powStop=useRef<AbortController|null>(null);
 useEffect(()=>()=>powStop.current?.abort(),[]);
 const stoppable=()=>{const controller=new AbortController();powStop.current=controller;return controller;};
 const [slug,setSlug]=useState(''),[count,setCount]=useState(1),[keepTokens,setKeepTokens]=useState(false),[adult,setAdult]=useState(false),[email,setEmail]=useState(''),[challenge,setChallenge]=useState(''),[code,setCode]=useState(''),[issuing,setIssuing]=useState<JurorIssuing|null>(null),[fingerprint,setFingerprint]=useState('');
 const [tokens,setTokens]=useState<Held[]>([]),[current,setCurrent]=useState<{assignment:string;jury:JuryCase}|null>(null),[idle,setIdle]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState(''),[errorAt,setErrorAt]=useState(''),[notice,setNotice]=useState('');
 // Opt-in: keep an unfinished mailbox token request on this device, so a reload within the code's 15 minutes can finish it.
 const [keepIssuing,setKeepIssuing]=useState(false),[unfinished,setUnfinished]=useState<PendingIssuance[]>([]),[resume,setResume]=useState<PendingIssuance|null>(null);
 useEffect(()=>{void Promise.all([loadConfig(),fetchDirectory(),loadKeys()]).then(([site,companies,list])=>{setConfig(site);setDirectory(shownDirectory(site,companies));setKeys(list);}).catch(()=>{setErrorAt('load');setError('Configuration is temporarily unavailable.');}).finally(()=>setLoaded(true));},[]);
 useEffect(()=>{let live=true;listJurorTokens().then(list=>{if(live)setTokens(t=>[...t,...list.flatMap(k=>{const token=k.token as JurorProof;return t.some(x=>x.handle===k.handle)?[]:[{handle:k.handle,keyId:k.keyId,companySlug:k.companySlug,verificationClass:k.verificationClass,expiresAt:k.expiresAt,token}];})]);}).catch(()=>undefined);return ()=>{live=false;};},[]);
 // Practice cases on fictional employers exist only where this deployment has sample employers (never in production).
 const samples=config?.sampleEmployers!==false,juryOn=Boolean(config?.moderation?.juryEnabled),sandboxOn=samples&&Boolean(config?.moderation?.sandboxJuryEnabled),verifier=config?.verifierOrigin??'';
 const jurorKeys=useMemo(()=>keys.filter(k=>keyPurpose(k)==='juror'&&Date.parse(k.expiresAt)>Date.now()&&(jurorClass(k)==='mailbox'?juryOn:sandboxOn)),[keys,juryOn,sandboxOn]);
 const employers=useMemo(()=>directory.filter(c=>jurorKeys.some(k=>k.companySlug===c.slug)),[directory,jurorKeys]);
 useEffect(()=>{if(!slug&&employers[0])setSlug(employers[0].slug);},[employers,slug]);
 useEffect(()=>{let live=true;setResume(null);if(slug)listIssuances(slug,'juror').then(list=>{if(live)setUnfinished(list);}).catch(()=>{if(live)setUnfinished([]);});return ()=>{live=false;};},[slug]);
 // A community juror key never replaces a curated work-mailbox juror key of the same employer (see chooseIssuerKey).
 const choice=useMemo(()=>{try {return {key:slug?chooseIssuerKey(jurorKeys,slug,Date.now(),'juror'):undefined,problem:''};} catch {return {key:undefined,problem:'This employer has more juror keys than the published limit, which could be used to tag jurors. Tokens are disabled for it.'};}},[jurorKeys,slug]);
 const key=choice.key,mailbox=key?jurorClass(key)==='mailbox':false,company=directory.find(c=>c.slug===slug);
 // A mailbox never receives more than the quarterly quota, so no batch asks for more.
 const batchMax=mailbox?Math.min(JUROR_BATCH_MAX,JUROR_QUOTA):JUROR_BATCH_MAX;
 useEffect(()=>{if(count>batchMax)setCount(batchMax);},[count,batchMax]);
 const resumable=unfinished.find(u=>key&&u.keyId===key.id&&u.challengeId)??null;
 async function run(label:string,work:()=>Promise<void>,extra?:Record<string,string>) {setBusy(label);setError('');setErrorAt(label);setNotice('');try {await work();}catch(e){setError(friendly(e,extra));}finally{setBusy('');}}
 const feedback=(...labels:string[])=><>{error&&labels.includes(errorAt)&&<p role="alert" className="cx-error">{error}</p>}{notice&&labels.includes(errorAt)&&<p role="status" className="cx-notice">{notice}</p>}</>;
 async function checkedKey(needsMail=false) {
  if(!key)throw new Error('No juror key is available for this employer.');
  if(!verifier)throw new Error('The verifier address is unavailable, so nothing was sent. Reload the page and try again.');
  const checked=await crossCheckKey(verifier,key,needsMail);setFingerprint(await keyFingerprint(checked));return checked;
 }
 async function startMailbox() {
  const issuer=await checkedKey(true);
  const controller=stoppable();
  try {
   const reply=await withPow(()=>powBinding('start',issuer.id,powSubject.email(email)),pow=>send(`${verifier}/start`,{action:'start',keyId:issuer.id,email,pow}),{bits:verifierPowBits(verifier),working:setWorking,signal:controller.signal});
   setChallenge(z.object({challengeId:z.string()}).parse(reply).challengeId);
  } finally {if(powStop.current===controller)powStop.current=null;}
 }
 async function forgetUnfinished(handle:string|null|undefined) {
  if(!handle)return;
  await deleteIssuance(handle).catch(()=>undefined);
  setUnfinished(list=>list.filter(u=>u.handle!==handle));setResume(r=>r?.handle===handle?null:r);
 }
 async function getTokens() {
  if(!adult)throw new Error(ADULT_FIRST);
  const issuer=await checkedKey(),isMailbox=jurorClass(issuer)==='mailbox';
  // As with credentials, a retry for the same challenge resends the identical blinded batch; any other batch is refused.
  // A batch kept on this device is resent the same way, on the challenge it was made for.
  const kept=isMailbox&&resume?.keyId===issuer.id&&resume.challengeId===challenge&&resume.states.length===resume.blinded.length?resume:null;
  const retry=isMailbox?reusableIssuance(issuing,challenge,issuer.id)??(kept?{challengeId:challenge,keyId:issuer.id,handle:kept.handle,prepared:kept.states.map((state,i)=>({blinded:kept.blinded[i]!,state,finalize:(signature:string)=>finalizeBlinding(issuer,state,signature)}))}:null):null;
  const prepared=retry?.prepared??await Promise.all(Array.from({length:Math.min(Math.max(1,count),batchMax)},()=>prepareJurorToken(issuer)));
  let handle=retry?.handle??null;
  if(isMailbox&&keepIssuing&&!handle) {
   // The code's challenge lasts 15 minutes from when it was sent, so the kept batch is useless after that.
   try {handle=await saveIssuance({purpose:'juror',companySlug:issuer.companySlug,keyId:issuer.id,challengeId:challenge,blinded:prepared.map(p=>p.blinded),states:prepared.map(p=>p.state),expiresAt:new Date(Date.now()+15*60000).toISOString()});}
   catch {throw new Error('The unfinished request could not be kept on this device, so nothing was sent. Uncheck that option or try again.');}
  }
  if(isMailbox)setIssuing({challengeId:challenge,keyId:issuer.id,prepared,handle});
  let raw:unknown;
  // The 18+ confirmation travels with the request; the verifier refuses to sign without it.
  // The stamp is bound to exactly these blinded messages, in order, so it cannot be spent on another batch.
  const blinded=prepared.map(p=>p.blinded);
  const controller=stoppable();
  try {raw=await withPow(()=>powBinding('issue-juror',issuer.id,powSubject.blinded(blinded)),pow=>send(`${verifier}/issue-juror`,{keyId:issuer.id,blinded,...(isMailbox?{challengeId:challenge,code}:{}),adultConfirmed:true,pow}),{bits:verifierPowBits(verifier),working:setWorking,signal:controller.signal});}
  catch(e) {
   if(powStop.current===controller)powStop.current=null;
   if(!(e instanceof ServiceError)||!NOTHING_ISSUED.includes(e.code))throw e;
   // Nothing was signed and the code is still unused, so the next attempt may send a smaller batch.
   setIssuing(null);await forgetUnfinished(handle);
   const left=e.remaining;
   if(e.code==='juror_quota_exceeded'&&left!==null&&left>0)throw new Error(`This mailbox can receive ${left} more juror ${left===1?'token':'tokens'} for this employer this quarter, so nothing was issued. Choose ${left} or fewer and verify again with the same code while it is valid.`);
   throw e;
  }
  if(powStop.current===controller)powStop.current=null;
  const reply=z.object({blindSignatures:z.array(z.string())}).parse(raw);
  if(reply.blindSignatures.length!==prepared.length)throw new Error('The verifier returned a different number of signatures, so no token was kept.');
  const finished=await Promise.all(prepared.map((p,i)=>p.finalize(reply.blindSignatures[i]!)));
  const fresh:Held[]=finished.map(token=>({keyId:issuer.id,companySlug:issuer.companySlug,verificationClass:issuer.verificationClass,expiresAt:issuer.expiresAt,token}));
  setIssuing(null);setEmail('');setCode('');setChallenge('');
  await forgetUnfinished(handle);
  if(keepTokens) {
   try {const handles=await saveJurorTokens(fresh);fresh.forEach((t,i)=>{t.handle=handles[i];});}
   catch {setError('The tokens are ready but could not be kept on this device. Use them before leaving this page.');}
  }
  setTokens(list=>[...list,...fresh]);
  setNotice(`${fresh.length} juror ${fresh.length===1?'token is':'tokens are'} ready${keepTokens?' and kept on this device':' in this tab only'}.`);
 }
 /** Forgets tokens in this tab and on this device. */
 async function forget(list:Held[]) {setTokens(all=>all.filter(t=>!list.includes(t)));for(const t of list)if(t.handle)await deleteJurorToken(t.handle).catch(()=>undefined);}
 async function takeCase() {
  if(!adult)throw new Error(ADULT_FIRST);
  const now=Date.now(),expired=tokens.filter(t=>Date.parse(t.expiresAt)<=now),next=tokens.find(t=>!expired.includes(t));
  if(expired.length)await forget(expired);
  if(!next){if(expired.length)throw new Error('Your juror tokens expired, so they were discarded. Get new ones to serve.');return;}
  setIdle('');
  let raw:unknown;
  // So does each case request: the service assigns no case without it.
  try {raw=await send('/api/jury/assign',{token:next.token,adultConfirmed:true});}
  catch(e) {
   const reason=e instanceof ServiceError?UNUSABLE_TOKEN[e.code]:undefined;
   if(!reason)throw e;
   await forget([next]);
   throw new Error(`${reason} It was discarded${tokens.length>1?'; your other tokens are unaffected':''}.`);
  }
  const reply=assignSchema.safeParse(raw);
  if(!reply.success) {
   // A seat was assigned, so the token is spent even though the case cannot be shown here.
   if((raw as {available?:unknown}|null)?.available===true){await forget([next]);throw new Error(`A case was assigned, but the server’s answer was not in the expected form, so it cannot be shown. That token is spent and was discarded; the seat reopens for another juror after ${JURY.assignmentHours??48} hours.`);}
   throw reply.error;
  }
  if(!reply.data.available){setIdle(reply.data.reason);return;}
  // The token is spent once a case is assigned; forget it everywhere.
  await forget([next]);
  setCurrent({assignment:reply.data.assignment,jury:reply.data.case});
 }
 async function discardTokens() {await forget(tokens);setNotice('Your unused juror tokens were discarded.');}
 const available=juryOn||sandboxOn;
 // The 18+ confirmation is sent with every token request and every case request, and the services refuse both without it.
 // It is one box: in step 1 while that step can issue tokens, otherwise beside "Take a case" for tokens already held.
 const adultBox=<label className="cx-check cx-check-strong"><input type="checkbox" checked={adult} onChange={e=>setAdult(e.target.checked)}/><span>I am {MINIMUM_AGE} or older and I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Use{opensNewTab}</a>, which say jurors are volunteers.</span></label>;
 const adultInStepOne=employers.length>0&&!!key;
 return <main id="main" className="page contribute cx-jury">
  <header className="cx-hero"><h1>One question. One rule.{' '}<span>Anonymous jurors, drawn at random.</span></h1><p>When the published rules cannot settle a case automatically, randomly drawn jurors each answer one yes-or-no question about one rule, reading only the passage under review. There are no permanent moderators and no reputation scores. Jurors are volunteers.</p></header>
  {feedback('load')}
  {!loaded?<p className="cx-note" role="status">Loading the jury’s status…</p>
  :current?<CaseView assignment={current.assignment} jury={current.jury} onDone={()=>setCurrent(null)}/>
  :!available?<section className="cx-card cx-empty" aria-labelledby="jury-off"><h2 id="jury-off">Juries are not operational yet.</h2><p>No jury can be seated right now. Until one can, a case that would need a jury is held privately, and its author can repair or withdraw it; unrepaired held cases are erased after 30 days.</p>
   {(JURY.activation?.realEmployers||(samples&&JURY.activation?.sandbox))&&<ul className="cx-plain">{JURY.activation?.realEmployers&&<li><strong>Real employers.</strong> {JURY.activation.realEmployers}</li>}{samples&&JURY.activation?.sandbox&&<li><strong>Fictional employers.</strong> {JURY.activation.sandbox}</li>}</ul>}
   <p className="cx-note">This page lets you volunteer as soon as a jury can form. <a href="/moderation" target="_blank" rel="noopener">Read the published rules{opensNewTab}</a></p></section>
  :<div className="cx-layout cx-layout-single"><div className="cx-flow">
   {!juryOn&&<p className="cx-notice">Real-employer juries are not operational yet. You can serve on fictional practice cases with a sandbox token.</p>}
   <section className="cx-card" aria-labelledby="tokens-title"><div className="cx-step"><span className="cx-step-n" aria-hidden="true">1</span><h2 id="tokens-title">Get juror tokens</h2></div>
    {employers.length===0?<p className="cx-notice">No juror keys are published for any employer yet, so no tokens can be issued.</p>:<>
    <label className="cx-field" htmlFor="juror-employer">Where you work</label>
    <select id="juror-employer" className="cx-select" value={slug} onChange={e=>{setSlug(e.target.value);setChallenge('');setCode('');setEmail('');setIssuing(null);setFingerprint('');}}>{employers.map(c=><option key={c.slug} value={c.slug}>{c.kind==='sample'?`${c.name} (fictional, practice cases)`:employerLabel(c)}</option>)}</select>
    <p className="cx-note">{JURY.eligibility??'Jurors never serve on a case about their own employer.'} The token names this employer for that reason.</p>
    {company?.kind==='sample'&&<p className="cx-fiction">Fictional employer. Sandbox tokens do not prove employment and staff only fictional practice cases.</p>}
    {!key?<p className="cx-notice">{choice.problem||'No juror key is available for this employer.'}</p>:<>
     <label className="cx-field" htmlFor="juror-count">How many cases you are willing to serve on</label>
     <select id="juror-count" className="cx-select" value={count} onChange={e=>setCount(Number(e.target.value))}>{Array.from({length:batchMax},(_,i)=>i+1).map(n=><option key={n} value={n}>{n}</option>)}</select>
     {mailbox&&<p className="cx-note">A work mailbox can receive up to {JUROR_QUOTA} juror tokens per employer each quarter.</p>}
     {/* worker/src/moderation.ts seats every community-source token in one shared group per case (policy communitySeatsPerCase). */}
     {isCommunityKey(key)&&<p className="cx-note">This employer’s juror key was created for a domain added by the community, so its tokens and those of every other such employer together fill at most {communitySeatsPerCase()} {communitySeatsPerCase()===1?'seat':'seats'} on a case, and never count toward whether a jury can form.</p>}
     <p className="cx-note">Getting tokens and taking a case within the same minute, from the same network, lets anyone who can see traffic to both services link the two. Keeping the tokens on this device lets you serve later, ideally from a different network.</p>
     <label className="cx-check"><input type="checkbox" checked={keepTokens} onChange={e=>setKeepTokens(e.target.checked)}/><span><b>Keep unused tokens on this device so I can serve later.</b> Off by default. {DEVICE_WARNING}</span></label>
     {adultBox}
     {mailbox&&resumable&&resume?.handle!==resumable.handle&&<div className="cx-proof"><span className="cx-proof-icon" aria-hidden="true"/><div><strong>An unfinished token request is kept on this device for this employer.</strong><p>If the verifier signed it but the answer never arrived, finishing it with the same code gets the same tokens, so none of this quarter’s are used twice. It works until the code expires, 15 minutes after it was sent.</p><div className="cx-actions"><button type="button" className="cx-btn" disabled={!!busy} onClick={()=>{setResume(resumable);setIssuing(null);setChallenge(resumable.challengeId??'');setCode('');}}>Finish it</button><button type="button" className="cx-link" disabled={!!busy} onClick={()=>void run('Deleting',()=>forgetUnfinished(resumable.handle))}>Delete it from this device</button></div></div></div>}
     {mailbox&&!resume&&!challenge&&<label className="cx-check"><input type="checkbox" checked={keepIssuing} onChange={e=>setKeepIssuing(e.target.checked)}/><span><b>Keep this token request on this device until the tokens are finished, so reloading within the code’s 15 minutes does not lose them.</b> Off by default. It links the verifier’s request to your tokens, so it is deleted as soon as they are finished, and it never holds your email or code. {DEVICE_WARNING}</span></label>}
     {mailbox?(!challenge?<><label className="cx-field" htmlFor="juror-email">Work email, sent only to the verifier</label><input id="juror-email" className="cx-input" type="email" value={email} autoComplete="off" spellCheck={false} onChange={e=>setEmail(e.target.value)} placeholder="you@employer.com"/><button type="button" className="cx-btn" disabled={!!busy||!adult||!email.includes('@')} onClick={()=>void run('Sending code',startMailbox,JUROR_ERRORS)}>{busy==='Sending code'?(working?'Preparing the request…':'Sending…'):'Send verification code'}</button></>
     :<><p className="cx-note">{resume?'Enter the code from the email you already received. It lasts 15 minutes from when it was sent.':'A code is on its way. It lasts 15 minutes. If this mailbox already received its juror tokens for this employer this quarter, the code cannot produce more.'} Requests for one mailbox pause for 15 minutes after three, whoever sends them.</p><label className="cx-field" htmlFor="juror-code">Code from your mailbox</label><input id="juror-code" className="cx-input cx-mono" inputMode="numeric" autoComplete="one-time-code" spellCheck={false} value={code} maxLength={6} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/><button type="button" className="cx-btn cx-btn-primary" disabled={!!busy||!adult||code.length!==6} onClick={()=>void run('Issuing',getTokens,JUROR_ERRORS)}>{busy==='Issuing'?(working?'Preparing the request…':'Verifying…'):'Verify and receive blind tokens'}</button></>)
     :<button type="button" className="cx-btn cx-btn-primary" disabled={!!busy||!adult} onClick={()=>void run('Issuing',getTokens,JUROR_ERRORS)}>{busy==='Issuing'?(working?'Preparing the request…':'Creating…'):`Get ${count===1?'a practice token':`${count} practice tokens`}`}</button>}
     {working&&<PowNote onStop={()=>powStop.current?.abort()}/>}
     {fingerprint&&key&&<p className="cx-note">Key fingerprint <code className="cx-code">{fingerprint}</code>. {keyTrust(key,'juror key')}</p>}
    </>}
    {feedback('Sending code','Issuing','Deleting')}
    </>}
   </section>
   <section className="cx-card" aria-labelledby="serve-title"><div className="cx-step"><span className="cx-step-n" aria-hidden="true">2</span><h2 id="serve-title">Serve on a case</h2></div>
    {tokens.length>0?<><p>You hold {tokens.length} unused juror {tokens.length===1?'token':'tokens'}{tokens.some(t=>t.handle)?`, ${tokens.filter(t=>t.handle).length} kept on this device`:''}. Each staffs one case.</p>
     {!adultInStepOne?adultBox:!adult&&<p className="cx-note">Confirm in step 1 that you are {MINIMUM_AGE} or older to take a case. The confirmation is sent with each case request.</p>}
     <div className="cx-actions"><button type="button" className="cx-btn cx-btn-primary" disabled={!!busy||!adult} onClick={()=>void run('Taking',takeCase)}>{busy==='Taking'?'Looking for a case…':'Take a case'}</button><button type="button" className="cx-link" disabled={!!busy} onClick={()=>void run('Discarding',discardTokens)}>Discard my tokens</button></div>
     {idle&&(()=>{
      // A prose reason from the server is shown word for word; a bare code gets the narrow, token-specific sentence.
      const prose=/\s/.test(idle.trim());
      return <div role="status" className="cx-result cx-result-idle"><strong>No case was assigned to this token.</strong><p>{prose?idle:'No case needs a juror with this token right now.'}{prose&&/not (been )?used/i.test(idle)?'':' Your token was not used, so you can try again later.'}</p></div>;
     })()}
    </>:<p>You need a juror token first. Tokens are anonymous: the verifier signs them blind, so the service that assigns cases cannot tell which mailbox a token came from.</p>}
    {feedback('Taking','Discarding')}
   </section>
   <section className="cx-card cx-honesty" aria-labelledby="limits-title"><h2 id="limits-title">What a juror token does and does not prove</h2><ul>
    <li>{JURY.limits??'Token holders are not proven unique people.'}</li>
    <li>{JURY.passage??'Jurors see only the passage under review, the rule and the question.'}</li>
    {JURY.upheld&&<li>{JURY.upheld}</li>}
    {JURY.closing&&<li>{JURY.closing}</li>}
    {JURY.appeals?.stage&&<li>Appeals: {JURY.appeals.stage} {JURY.appeals.final??''}</li>}
   </ul><p className="cx-note">Quoted from the published policy {policy.version}. <a href={`/moderation/v${policy.version}.json`} target="_blank" rel="noopener">Read it in full{opensNewTab}</a></p></section>
  </div></div>}
 </main>;
}

/* Author status page */
const decisionSchema=z.object({action:z.string().nullish(),policyVersion:z.string().nullish(),policyDigest:z.string().nullish(),rules:z.array(z.string()).nullish(),explanations:z.array(z.string()).nullish()});
const receiptSchema=z.object({id:z.string(),kind:z.string().nullish(),ruleIds:z.array(z.string()).nullish(),ruleId:z.string().nullish(),policyVersion:z.string().nullish(),policyDigest:z.string().nullish(),path:z.string().nullish(),outcome:z.string().nullish(),period:z.string().nullish(),model:z.string().nullish(),provider:z.string().nullish(),promptVersion:z.string().nullish(),relevance:z.string().nullish(),votes:z.object({yes:z.number(),no:z.number(),unsure:z.number(),required:z.number()}).partial().nullish()});
const RECEIPT_KIND:Record<string,string>={screening:'Screening',rescan:'Check before publication',publication:'Publication',withhold:'Withheld',restore:'Restored',jury:'Jury',appeal:'Appeal jury',challenge:'Challenge',erasure:'Erasure'};
const statusSchema=z.object({status:z.string(),revision:z.number().int().nonnegative().optional(),repairable:z.boolean().optional(),holdReason:z.string().nullish(),decision:decisionSchema.nullish(),case:z.object({stage:z.string(),state:z.string(),outcome:z.string().nullish()}).nullish(),appeal:z.object({available:z.boolean(),state:z.string().nullish()}).nullish(),receipts:z.array(receiptSchema).default([]),publicationPaused:z.boolean().default(false),releasePolicy:z.string().nullish()});
type AuthorStatus=z.infer<typeof statusSchema>;
const STATUS_HEAD:Record<string,string>={held:'Held privately.',approved:'Accepted, not yet published.',publishing:'Being published.',published:'Published.',withdrawn:'Withdrawn and erased.',expired:'Expired and erased.',rejected:'Not accepted.'};
/** What erasure left, for a withdrawn contribution: the explanation under the heading, never the heading again. */
export const ERASED_LEDE:Record<string,string>={withdrawn:'Its text, survey answers and permissions were erased, and it was removed from the public record if it had been published.'};
const sameWords=(a:string,b:string)=>a.trim().replace(/[.\s]+$/,'').toLowerCase()===b.trim().replace(/[.\s]+$/,'').toLowerCase();
/** The explanation under a status heading: the server's own, unless it only repeats the heading. */
export function statusLede(status:string,releasePolicy:string|null|undefined):string {
 const head=STATUS_HEAD[status]??'',own=releasePolicy&&!sameWords(releasePolicy,head)?releasePolicy:null;
 return own??ERASED_LEDE[status]??(STATUS_TEXT[status]&&!sameWords(STATUS_TEXT[status]!,head)?STATUS_TEXT[status]!:'Status unavailable.');
}
const HOLD_REASONS:Record<string,string>={jury:'It is held for an anonymous jury.',jury_no_quorum:'An anonymous jury was drawn but not enough jurors voted in time, so no decision was made. It is held privately, is not published as written, and is erased soon unless you repair it with revised words. You can also withdraw it.',challenge_repair:'After a challenge, a re-check of the published words found a detail that could identify someone or met a rule’s repair threshold, so it is withheld privately. You can repair it.',jury_upheld:'A jury found that these words break a rule, so they are held privately. You can repair them, withdraw them, or appeal once.',privacy_rescan:'A check just before publication found a detail in these words that could identify someone, so it was held on its own. You can repair it.',exception:'It is withheld under a trustee exception with a stated expiry.'};
const APPEAL_STATE:Record<string,string>={open:'An appeal is open: newly drawn jurors are deciding.',decided:'The appeal was decided, and its decision is final.'};
const CASE_STATE:Record<string,string>={open:'Jurors are answering. Votes stay sealed until the case closes.',closed:'The case is closed.',expired:'The case expired.'};
const CASE_OUTCOME:Record<string,string>={upheld:'The jury found that the words break the rule.',cleared:'The jury found that the words do not break the rule.',no_quorum:'Not enough jurors voted in time, so the jury made no decision.'};
const RECEIPT_OUTCOME:Record<string,string>={practice:'Recorded as a practice case',upheld:'Rule upheld',cleared:'Rule not upheld',no_quorum:'No decision: not enough jurors voted in time',open:'Open',moot:'Ended without a decision',rejected:'Challenge not accepted',merged:'Merged into an existing case',withheld_for_repair:'Withheld for repair',jury:'Sent to an anonymous jury',clear:'Clear',repair:'Repair needed'};
const receiptOutcome=(outcome:string)=>RECEIPT_OUTCOME[outcome]??sentence(outcome.replace(/_/g,' '));
/** A challenge to a seeded fictional account is a practice case (path practice_fixture), whatever outcome code it carries. */
export const PRACTICE_PATH='practice_fixture';
/**
 * The extended status route answers not_found both for an unknown capability and when the route does not exist, so the
 * original status action is asked only when this server does not describe its moderation (an older server). Otherwise a
 * wrong capability is sent once, not twice.
 */
async function fetchStatus(capability:string,extended:boolean):Promise<AuthorStatus> {
 try {return statusSchema.parse(await send('/api/author/status',{capability}));}
 catch(e) {
  if(!(e instanceof ServiceError)||e.code!=='not_found')throw e;
  if(extended)throw new Error('No contribution matches this capability. Check that you copied all of it.');
  return statusSchema.parse({...(await send<AuthorReply>('/api/author',{action:'status',capability})),receipts:[]});
 }
}
export function StatusPage() {
 const [capability,setCapability]=useState(''),[state,setState]=useState<AuthorStatus|null>(null),[checked,setChecked]=useState(''),[deviceKey,setDeviceKey]=useState(false),[config,setConfig]=useState<SiteConfig|null>(null);
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[errorAt,setErrorAt]=useState(''),[notice,setNotice]=useState(''),[repairBody,setRepairBody]=useState(''),[repairConsent,setRepairConsent]=useState(false),[repairJury,setRepairJury]=useState(false),[repairSensitive,setRepairSensitive]=useState(false),[confirm,setConfirm]=useState(false),[support,setSupport]=useState<{resources:unknown;text:string}|null>(null);
 const [ready,setReady]=useState(false);
 // Whether this server has the extended status route is read from its config, so checking waits for it (a few ms).
 useEffect(()=>{loadConfig().then(setConfig).catch(()=>setConfig(null)).finally(()=>setReady(true));},[]);
 const repairHigh=useMemo(()=>scanText(repairBody).some(f=>f.severity==='high'),[repairBody]);
 const cap=checked;
 async function run(label:string,work:()=>Promise<void>) {setBusy(label);setError('');setErrorAt(label);setNotice('');try {await work();}catch(e){setError(friendly(e));}finally{setBusy('');}}
 const feedback=(...labels:string[])=><>{error&&labels.includes(errorAt)&&<p role="alert" className="cx-error">{error}</p>}{notice&&labels.includes(errorAt)&&<p role="status" className="cx-notice">{notice}</p>}</>;
 async function check(value=capability.trim()) {
  setState(null);setConfirm(false);setSupport(null);
  const result=await fetchStatus(value,Boolean(config?.moderation));
  setState(result);setChecked(value);setDeviceKey(await hasAuthor(value));
 }
 async function appeal() {
  const reply=z.object({caseId:z.string(),stage:z.string(),state:z.string()}).parse(await send('/api/appeal',{capability:cap}));
  await check(cap);
  setErrorAt('Appealing');setNotice(`Appeal opened (case ${reply.caseId}). ${JURY.appeals?.stage??'New jurors are drawn and are not shown the first result.'}`);
 }
 async function repair() {
  if(!state)return;
  const revision=state.revision??(await send<AuthorReply>('/api/author',{action:'status',capability:cap})).revision??0;
  let result:AuthorReply;
  try {result=await revise(cap,revision,repairBody,{juryReviewConsent:repairJury,sensitiveConsent:repairSensitive});}
  catch(e){setSupport(e instanceof ServiceError&&e.resources?{resources:true,text:repairBody}:null);throw e;}
  setRepairConsent(false);await check(cap);setSupport({resources:result.resources,text:repairBody});
  setErrorAt('Repairing');setNotice(repairNotice(result.status));
 }
 async function withdrawIt() {
  const result=await withdrawByCapability(cap);
  // The heading and its explanation now describe the erased state; the notice only confirms the action.
  setState(s=>s&&{...s,status:result.status,appeal:null,releasePolicy:null,repairable:false});setDeviceKey(false);setConfirm(false);setNotice(result.status==='expired'?'It had already expired and been erased.':'Withdrawal confirmed.');
 }
 const s=state,erased=s?.status==='withdrawn'||s?.status==='expired',repairable=Boolean(s&&(s.repairable??s.status==='held')&&!erased);
 return <main id="main" className="page contribute cx-status-page">
  <header className="cx-hero"><h1>Your contribution.{' '}<span>Only your capability opens it.</span></h1><p>Paste the withdrawal capability you were shown once. It is sent only to check this contribution; it is not stored, put in the address bar, or linked to you.</p></header>
  <div className="cx-layout cx-layout-single"><div className="cx-flow">
   <form className="cx-card" onSubmit={e=>{e.preventDefault();if(ready)void run('Checking',()=>check());}}>
    <label className="cx-field" htmlFor="capability">Withdrawal capability</label>
    <input id="capability" className="cx-input cx-mono" value={capability} autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={e=>setCapability(e.target.value)}/>
    <button type="submit" className="cx-btn cx-btn-primary" disabled={!ready||!capability.trim()||!!busy}>{busy==='Checking'?'Checking…':'Check status'}</button>
    {feedback('Checking')}
   </form>
   {s&&<section className="cx-card cx-status" aria-labelledby="status-title">
    <h2 id="status-title">{STATUS_HEAD[s.status]??`Status: ${s.status}`}</h2>
    <p className="cx-lede">{statusLede(s.status,s.releasePolicy)}</p>
    {s.holdReason&&HOLD_REASONS[s.holdReason]&&!s.releasePolicy&&<p>{HOLD_REASONS[s.holdReason]}</p>}
    {s.decision?.action&&<dl className="cx-facts"><div><dt>Screening outcome</dt><dd>{OUTCOME_LABEL[s.decision.action]??sentence(s.decision.action)}{s.decision.rules?.length?` (${s.decision.rules.join(', ')})`:''}</dd></div>{s.decision.policyVersion&&<div><dt>Rules applied</dt><dd><PolicyLine decision={{policyVersion:s.decision.policyVersion,...(s.decision.policyDigest?{policyDigest:s.decision.policyDigest}:{})}}/></dd></div>}</dl>}
    {s.case&&<div className="cx-rule-card"><p className="cx-kicker">{s.case.stage==='appeal'?'Appeal jury':'Jury'}</p><p>{s.case.outcome?CASE_OUTCOME[s.case.outcome]??s.case.outcome:CASE_STATE[s.case.state]??s.case.state}</p></div>}
    {s.appeal?.available&&!erased&&<div className="cx-appeal"><h3>Appeal</h3><p>{JURY.appeals?.stage??'A new jury is drawn and is not shown the first result.'} {JURY.appeals?.final??''}</p><button type="button" className="cx-btn" disabled={!!busy} onClick={()=>void run('Appealing',appeal)}>{busy==='Appealing'?'Opening…':'Appeal this decision'}</button></div>}
    {!s.appeal?.available&&s.appeal?.state&&<p className="cx-note">{APPEAL_STATE[s.appeal.state]??`Appeal: ${s.appeal.state.replace(/_/g,' ')}.`}</p>}
    {feedback('Appealing')}
    {s.receipts.length>0&&<><h3>Receipts</h3><ol className="cx-receipts">{s.receipts.map(r=><li key={r.id}><dl className="cx-facts">
     <div><dt>{RECEIPT_KIND[r.kind??'']??'Receipt'}</dt><dd><code className="cx-code">{r.id}</code></dd></div>
     {r.outcome&&<div><dt>Outcome</dt><dd>{receiptOutcome(r.path===PRACTICE_PATH?'practice':r.outcome)}</dd></div>}
     {[...(r.ruleIds??[]),...(r.ruleId?[r.ruleId]:[])].length>0&&<div><dt>Rules</dt><dd>{[...(r.ruleIds??[]),...(r.ruleId?[r.ruleId]:[])].join(', ')}</dd></div>}
     {r.path&&<div><dt>Decision path</dt><dd>{sentence(r.path)}</dd></div>}
     {r.votes&&<div><dt>Votes</dt><dd>{r.votes.yes??0} yes, {r.votes.no??0} no, {r.votes.unsure??0} unsure{r.votes.required?` (${r.votes.required} seats)`:''}</dd></div>}
     {r.relevance&&<div><dt>Relevance checked by</dt><dd>{sentence(r.relevance)}</dd></div>}
     {(r.model||r.provider)&&<div><dt>{r.kind==='challenge'?'Words re-checked by':'Model'}</dt><dd>{r.model??''}{r.provider?`${r.model?' via ':''}${PROVIDERS[r.provider]??r.provider}`:''}{r.promptVersion?`, prompt ${r.promptVersion}`:''}</dd></div>}
     {r.policyVersion&&<div><dt>Policy</dt><dd><PolicyLine decision={{policyVersion:r.policyVersion,...(r.policyDigest?{policyDigest:r.policyDigest}:{})}}/></dd></div>}
     {r.period&&<div><dt>Period</dt><dd>{r.period}</dd></div>}
    </dl></li>)}</ol></>}
    {repairable&&(deviceKey?<div className="cx-repair"><h3>Repair it</h3><p>Change the wording. The new words are checked on this device, then screened again; if they are clear, they replace the held version.</p>
     <PrivacyEditor id="status-repair" label="Repaired words" value={repairBody} onChange={setRepairBody}/>
     <label className="cx-check"><input type="checkbox" checked={repairConsent} onChange={e=>setRepairConsent(e.target.checked)}/><span>I approve sending these revised words to hosted Jev for the same narrow checks.</span></label>
     <JuryReviewConsent checked={repairJury} onChange={setRepairJury}/>
     <SensitiveConsent checked={repairSensitive} onChange={setRepairSensitive}/>
     <p className="cx-note">These two choices replace your earlier ones for the revised words.</p>
     <button type="button" className="cx-btn cx-btn-primary" disabled={!!busy||!repairConsent||repairHigh||repairBody.length<40} onClick={()=>void run('Repairing',repair)}>{busy==='Repairing'?'Screening…':'Screen and resubmit the repaired words'}</button></div>
     :<p className="cx-note">This device does not hold the signing key for this contribution, so it cannot be repaired here. You can still withdraw it.</p>)}
    {feedback('Repairing')}
    {support&&<CheckedCrisisNote key={s.revision??0} resources={support.resources} text={support.text}/>}
    {!erased&&<div className="cx-withdraw">{confirm?<><p className="cx-hint">Withdrawing erases its text and survey answers, and removes it from the public record if it was published. Copies other people made cannot be recalled.</p><div className="cx-actions"><button type="button" className="cx-btn cx-btn-danger" disabled={!!busy} onClick={()=>void run('Withdrawing',withdrawIt)}>{busy==='Withdrawing'?'Withdrawing…':'Withdraw and erase it'}</button><button type="button" className="cx-link" onClick={()=>setConfirm(false)}>Keep it</button></div></>:<button type="button" className="cx-link" onClick={()=>setConfirm(true)}>Withdraw this contribution</button>}</div>}
    {feedback('Withdrawing')}
   </section>}
  </div></div>
 </main>;
}

/* Challenge dialog */
const publishedPolicySchema=z.object({version:z.string(),rules:z.array(z.object({id:z.string(),name:z.string(),text:z.string().optional()})),protections:z.array(z.object({id:z.string(),name:z.string(),text:z.string().optional()})).optional(),challenges:z.object({grounds:z.string().optional(),reasonMaxChars:z.number().optional(),who:z.string().optional(),relevance:z.object({fallback:z.string().optional()}).optional(),budget:z.object({perClientPerDay:z.number().int().positive(),notRelevantExtra:z.number().int().nonnegative()}).partial().optional(),fixtures:z.string().optional()}).optional()});
// The server accepts a reason of at least this many characters (after trimming).
const REASON_MIN=10;
// The outcome is read as text: a newer server may add outcomes (for example practice cases on fictional employers), which are shown in plain words.
const challengeReplySchema=z.object({outcome:z.string(),explanation:z.string(),receipt:z.object({id:z.string(),ruleId:z.string(),policyVersion:z.string(),policyDigest:z.string(),path:z.string(),outcome:z.string(),period:z.string()})});
const CHALLENGE_OUTCOME:Record<string,string>={rejected:'Not accepted',jury:'Sent to an anonymous jury',withheld_for_repair:'Withheld from publication',merged:'Joined an existing case',practice:'Recorded as a practice case'};
const challengeOutcome=(outcome:string)=>CHALLENGE_OUTCOME[outcome]??sentence(outcome.replace(/_/g,' '));
const CHALLENGE_PATH:Record<string,string>={practice_fixture:'Practice case: a fictional sample account is never withheld',protected_rule:'The cited rule protects accounts',not_relevant:'The reason does not fit the cited rule',duplicate_open:'Merged into an open jury case',duplicate_decided:'Merged into a decided jury case',rescreen_clear:'Re-checked: no rule threshold met',rescreen_repair:'Re-checked: withheld for repair',jury_unavailable:'Re-checked: jury range, but no jury can form yet',jury:'Re-checked: sent to an anonymous jury'};
const challengePath=(path:string)=>CHALLENGE_PATH[path]??sentence(path.replace(/_/g,' '));
const CHALLENGE_ERRORS:Record<string,string>={rate_limited:'This connection has used its challenges for today, or sent several within a few seconds. Nothing was sent for review. Try again later; the daily count starts over at midnight UTC.',remove_identifying_details:'Your reason contains a detail that could identify someone. Remove it and send again.',challenges_disabled:'Challenges are not open yet.',not_found:'This account could not be found. It may have been withdrawn.'};
/** `fixture` marks a seeded fictional sample account: a challenge to it is only ever recorded as a practice case. */
export function ChallengeDialog({testimonyId,onClose,fixture=false}:{testimonyId:string;onClose:()=>void;fixture?:boolean}) {
 const ref=useRef<HTMLDialogElement>(null),titleId=useId();
 const [published,setPublished]=useState<z.infer<typeof publishedPolicySchema>|null>(null),[config,setConfig]=useState<SiteConfig|null>(null),[loadError,setLoadError]=useState('');
 const [ruleId,setRuleId]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<z.infer<typeof challengeReplySchema>|null>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;const dialog=ref.current;if(dialog&&!dialog.open&&typeof dialog.showModal==='function')dialog.showModal();return ()=>{previous?.focus?.();};},[]);
 useEffect(()=>{
  loadConfig().then(setConfig).catch(()=>setConfig(null));
  fetch('/moderation/current.json').then(async r=>{if(!r.ok)throw new Error('policy');setPublished(publishedPolicySchema.parse(await r.json()));}).catch(()=>setLoadError('The published rules could not be loaded, so a challenge cannot be sent right now.'));
 },[]);
 const findings=useMemo(()=>scanText(reason),[reason]),high=findings.filter(f=>f.severity==='high'),limit=published?.challenges?.reasonMaxChars??500;
 const closed=config?.moderation?.challengesEnabled===false;
 const missing=[!ruleId&&'the published rule it breaks',reason.trim().length<REASON_MIN&&`a reason of at least ${REASON_MIN} characters`,high.length>0&&'removing the identifying details marked above'].filter((n):n is string=>Boolean(n));
 // A practice case is recorded, never decided: its receipt reads the same in the heading and the Outcome field.
 const practice=result?.receipt.path===PRACTICE_PATH;
 async function submitChallenge() {
  setBusy(true);setError('');
  try {setResult(challengeReplySchema.parse(await send('/api/challenge',{testimonyId,ruleId,reason:reason.trim()})));}
  catch(e){setError(friendly(e,CHALLENGE_ERRORS));}finally{setBusy(false);}
 }
 return <dialog ref={ref} className="cx-dialog contribute" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();onClose();}}>
  <div className="cx-dialog-head"><h2 id={titleId}>Challenge this account</h2><button type="button" className="cx-close" aria-label="Close" onClick={onClose}>×</button></div>
  <p className="cx-note">Account <code className="cx-code">{testimonyId}</code></p>
  {result?<div className="cx-challenge-result" role="status">
   <div className={`cx-result cx-result-${practice?'idle':result.outcome==='rejected'?'repair':result.outcome==='jury'?'jury':'clear'}`}><strong>{practice?CHALLENGE_OUTCOME.practice:challengeOutcome(result.outcome)}</strong><p>{result.explanation}</p></div>
   <dl className="cx-facts"><div><dt>Receipt</dt><dd><code className="cx-code">{result.receipt.id}</code></dd></div><div><dt>Rule</dt><dd>{result.receipt.ruleId}</dd></div><div><dt>Decision path</dt><dd>{challengePath(result.receipt.path)}</dd></div><div><dt>Outcome</dt><dd>{practice?CHALLENGE_OUTCOME.practice:challengeOutcome(result.receipt.outcome)}</dd></div><div><dt>Period</dt><dd>{result.receipt.period}</dd></div><div><dt>Policy</dt><dd><PolicyLine decision={result.receipt}/></dd></div></dl>
   <p className="cx-note">Keep the receipt id if you want to refer to this challenge. Nothing links it to you.</p>
   <button type="button" className="cx-btn" onClick={onClose}>Close</button>
  </div>
  :closed?<div className="cx-empty"><p><strong>Challenges are not open yet.</strong></p><p>For a legal notice, see <a href="/legal-requests" target="_blank" rel="noopener">legal requests{opensNewTab}</a>.</p><button type="button" className="cx-btn" onClick={onClose}>Close</button></div>
  :loadError?<><p role="alert" className="cx-error">{loadError}</p><button type="button" className="cx-btn" onClick={onClose}>Close</button></>
  :!published?<p className="cx-note" role="status">Loading the published rules…</p>
  :<form onSubmit={e=>{e.preventDefault();void submitChallenge();}}>
   <p>{published.challenges?.who??'Anyone can ask for an account to be reviewed, on equal terms.'} Jev, or the published ground terms when Jev is unavailable, checks that your reason fits the rule you cite; deterministic code applies the published policy from there.</p>
   {fixture&&<p className="cx-fiction">{published.challenges?.fixtures??'This is a fictional sample account. A challenge to it is recorded as a practice case and never withholds it.'}</p>}
   {published.challenges?.relevance?.fallback&&<p className="cx-note">{published.challenges.relevance.fallback}</p>}
   <p className="cx-note">{published.challenges?.grounds??'A challenge cites one published rule. Reputational discomfort and disagreement are not grounds.'}</p>
   <fieldset className="cx-rules"><legend>Which published rule does it break?</legend>{published.rules.map(r=><label key={r.id} className={`cx-rule-option${ruleId===r.id?' is-selected':''}`}><input type="radio" name={`${titleId}-rule`} value={r.id} checked={ruleId===r.id} onChange={()=>setRuleId(r.id)}/><span><strong>{r.name}</strong>{r.text&&<span>{r.text}</span>}<code className="cx-code">{r.id}</code></span></label>)}</fieldset>
   {published.protections&&published.protections.length>0&&<details className="cx-protections"><summary>What is never a ground</summary><ul>{published.protections.map(p=><li key={p.id}><strong>{p.name}.</strong> {p.text}</li>)}</ul></details>}
   <label className="cx-field" htmlFor={`${titleId}-reason`}>How does the account break that rule?</label>
   <textarea id={`${titleId}-reason`} className="cx-input cx-reason" rows={4} maxLength={limit} value={reason} {...PRIVATE_TEXT} onChange={e=>setReason(e.target.value)} aria-describedby={`${titleId}-reason-check`}/>
   <p id={`${titleId}-reason-check`} className={high.length?'cx-hint':'cx-note'}><span className="cx-num">{reason.length} / {limit}</span>. {high.length?`Checked on this device: remove ${high.map(f=>f.what.toLowerCase()).join(', ')} before sending. Your reason must not identify anyone.`:findings.length?'Checked on this device: consider generalizing the details it recognised. Your reason must not identify anyone.':'Checked on this device: no identifying details recognised.'}</p>
   <p className="cx-note">{published.challenges?.budget?.perClientPerDay?`Each connection may send ${published.challenges.budget.perClientPerDay} challenges a day${published.challenges.budget.notRelevantExtra?`, and a reason that does not fit the cited rule counts as ${1+published.challenges.budget.notRelevantExtra}`:''}. `:'Challenges are limited per connection to deter abuse. '}Nobody can pay for priority. By sending, you agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Use{opensNewTab}</a>.</p>
   {error&&<p role="alert" className="cx-error">{error}</p>}
   <div className="cx-actions"><button type="submit" className="cx-btn cx-btn-primary" disabled={busy||missing.length>0}>{busy?'Sending…':'Send the challenge'}</button><button type="button" className="cx-link" onClick={onClose}>Cancel</button></div>
   {missing.length>0&&<p className="cx-hint">Still needed: {missing.join('; ')}.</p>}
  </form>}
 </dialog>;
}
