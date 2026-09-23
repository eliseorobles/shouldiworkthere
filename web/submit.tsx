import {useState,useEffect,useMemo,useRef,useLayoutEffect,useDeferredValue,type ReactNode} from 'react';
import {z} from 'zod';
import {fetchDirectory,shownDirectory,samplesOn,employerLabel,communitySupplied,publicationRules,accountsRule,aggregatesRule,listingName,isCommunity,domainOf,listingOpen,listingPowBits,COMMUNITY_LABEL,type DirectoryCompany} from './api.ts';
import {scanText,SCREENING_ONLY_KINDS,type Finding} from '../shared/privacy.ts';
import {powSubject,type PowBinding} from '../shared/pow.ts';
import {withPow,POW_ERRORS,POW_NOTE} from './pow-client.ts';
import {isCommunityKey,sameCommunityKey,chooseIssuerKey,curatedMailboxKey,verifierProblem,COMMUNITY_KEY_NOTE} from './community-keys.ts';
export {isCommunityKey,sameCommunityKey,canonicalJson,chooseIssuerKey,pinnedVerifier,verifierProblem,COMMUNITY_KEY_NOTE} from './community-keys.ts';
import {AddEmployer} from './add-employer.tsx';
import {detectCrisis,crisisCopyFor,crisisResourcesFor,CRISIS_COPY,type CrisisKind} from '../shared/safety.ts';
import {MINIMUM_AGE} from '../shared/brand.ts';
import {prepareProof,finalizeBlinding,recentQuarters,sameIssuerKey,reusableIssuance,digest,keyPurpose,keySource,issuerKeyFingerprint,type Proof,type IssuerKey,type BlindingState} from '../shared/proof.ts';
import type {PolicyDecision} from '../shared/policy.ts';
import {survey} from '../shared/survey.ts';
import {createAuthor,saveAuthor,forgetAuthor,signAction,savePendingProof,deletePendingProof,listPendingProofs,deviceHoldings,forgetDevice,saveIssuance,deleteIssuance,listIssuances,type Author,type PendingProof,type PendingIssuance} from './vault.ts';

// juryOpen says whether a jury was drawn; an older server may omit it, and the heading then leaves the details to releasePolicy.
interface Receipt {capability:string;status:string;verificationClass:string;releasePolicy:string;decision:PolicyDecision;publicationPaused:boolean;repairable:boolean;revision:number;juryOpen?:boolean;juryReviewConsent:boolean;sensitiveConsent:boolean;}
export interface AuthorReply {ok:boolean;error?:string;status?:string;revision?:number;decision?:PolicyDecision;repairable?:boolean;releasePolicy?:string;publicationPaused?:boolean;juryOpen?:boolean;resources?:unknown;}
interface Issuing {challengeId:string;keyId:string;identity:Author;prepared:{blinded:string;state:BlindingState;finalize:(blindSignature:string)=>Promise<Proof>};handle?:string|null;}
interface Screening {decision:PolicyDecision;provider?:string|null;model?:string|null;promptVersion?:string|null;resources?:unknown;}
export const DEVICE_WARNING='Anyone who can open this browser profile, including an employer that manages this device, could find it. Only choose this on a personal device you control.';
// Held and approved cases use the server's releasePolicy, which states the actual hold reason and any publication pause.
export const STATUS_TEXT:Record<string,string>={held:'Held privately and not published as written. It can be repaired with revised words; unrepaired held cases are erased after 30 days.',approved:'Accepted and not yet published. If it is not published within 180 days of submission, it is erased.',publishing:'Being published in a batch right now.',published:'Published.',withdrawn:'Withdrawn. Its text and answers were erased.',expired:'Expired. Its text and answers were erased.',rejected:'Not accepted. Its text was erased.'};
/** Verifier refusals made before anything is signed for this mailbox: a pause, or the employer's quarterly limit. */
const PAUSED=['issuance_paused','issuance_cap_reached'];
/** Verifier refusals, shared by contribution credentials and juror tokens. */
export const ISSUE_ERRORS:Record<string,string>={
 invalid_or_expired_code:'The verifier did not accept this code. It may be mistyped, expired (codes last 15 minutes), tried too often, or already used for a different request. Check it and try again, or request a new code.',
 credential_already_issued_this_period:'A credential was already issued for this mailbox and employer this quarter, so no new one can be issued.',
 signing_unavailable:'The verifier could not sign right now. Nothing was issued; try the same code again shortly.',
 verification_required:'Enter the code from your mailbox first.',
 rate_limited:'Too many verification requests from this network. Wait a minute and try the same code again.',
 use_approved_work_domain:'Use an address on one of this employer’s approved work domains. No code was sent.',
 mailbox_verification_unavailable:'The verifier is not sending email yet, so no code can be sent.',
 issuance_paused:'Verification for this employer is paused for up to 24 hours because unusually many credentials or tokens were requested; nothing was issued.',
 issuance_cap_reached:'This employer’s limit for this quarter is used up. Nothing was issued.',
 issuer_key_unavailable:'The verifier no longer lists this key. Reload the page to get the current one; nothing was issued.',
 verification_unavailable:'The verifier could not complete this right now. Nothing was issued; try again shortly.',
 wrong_key_purpose:'That key cannot issue this kind of credential, so nothing was issued.',
 invalid_blinded_message:'The verifier could not read the request, so nothing was issued. Reload the page and try again.',
 verification_failed:'The verifier could not read the request, so nothing was issued. Reload the page and try again.',
};
/** Where this deployment has fictional sample employers (never in production), a refusal may name them. */
const SAMPLE_ERRORS:Record<string,string>={real_mailbox_proof_required:'Real employers need a work-mailbox proof, so nothing was accepted. A sandbox proof works only for the fictional example employers.'};
const UNAVAILABLE='The check is unavailable right now. Nothing was decided, and these words were not kept; they stay on this device. Try again later.';
export const checksUnavailable=(decision:{rules?:readonly string[]|null}|null|undefined)=>decision?.rules?.[0]==='CHECKS-UNAVAILABLE';
const ERRORS:Record<string,string>={
 rate_limited:'Too many requests from this network. Wait a minute and try again.',
 remove_identifying_details:'The server’s identifier check found a detail that the on-device checks mark as “must change”. Change it and try again; nothing was kept.',
 credential_already_redeemed:'This proof was already used. Each proof submits one contribution; get a new one to submit again.',
 real_mailbox_proof_required:'Real employers need a work-mailbox proof, so nothing was accepted. Verify with your work email in step 5 and submit again.',
 period_out_of_range:'Choose a reporting period from the list: the current quarter or one of the 11 before it.',
 credential_expired:'This proof has expired. Get a new one.',
 credential_employer_mismatch:'This proof belongs to a different employer.',
 invalid_signature:'The proof’s signature did not verify, so nothing was accepted.',
 unknown_issuer_key:'The credential key for this proof is no longer published, so nothing was accepted.',
 invalid_author_signature:'The signing key on this device does not match this contribution, so nothing changed.',
 request_already_used:'That signed request was already used. Try again; each attempt is signed anew.',
 receipt_not_found_or_changed:'No contribution matches this capability, or it changed since you last checked. Check its status again.',
 already_erased:'This contribution was already erased.',
 publication_in_progress:'It is being published in a batch right now. Try again in a few minutes.',
 withdraw_and_resubmit:'Published words cannot be edited. Withdraw the contribution and submit new words instead.',
 invalid_request:'The request was not accepted as sent. Reload the page and try again.',
 request_failed:'The service could not complete this request. Nothing changed; try again shortly.',
 origin_not_allowed:'This request came from another site, so it was refused.',
 repair_required:'The screening asked for a repair before these words can be accepted:',
 network_unavailable:'The connection failed before an answer came back. Try again.',
 not_found:'No contribution matches this capability. Check that you copied all of it.',
 ...POW_ERRORS,
};
/**
 * A refused request, carrying the server's error code, the policy rules and explanations it gave, any remaining quota,
 * and whether the refusal still carried support resources for the words that were sent.
 */
export class ServiceError extends Error {
 code:string;status:number;explanations:string[];rules:string[];remaining:number|null;resources:boolean;
 /** The refusal's whole JSON body, for the few fields a flow reads itself (a proof-of-work hint, an existing listing). */
 detail:Record<string,unknown>;
 constructor(code:string,status:number,explanations:string[]=[],rules:string[]=[],remaining:number|null=null,resources=false,detail:Record<string,unknown>={}) {super(explanations.join(' ')||code);this.code=code;this.status=status;this.explanations=explanations;this.rules=rules;this.remaining=remaining;this.resources=resources;this.detail=detail;}
}
const strings=(value:unknown)=>Array.isArray(value)?value.filter((e):e is string=>typeof e==='string'):[];
/** POSTs JSON and surfaces the exact error code, so each contribution, jury and status flow can say precisely what happened. */
export async function send<T>(url:string,body:unknown):Promise<T> {
 let response:Response;
 try {response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});}
 catch {throw new ServiceError('network_unavailable',0);}
 const data=await response.json().catch(()=>({})) as {error?:unknown;remaining?:unknown;resources?:unknown;decision?:{explanations?:unknown;rules?:unknown}};
 if(!response.ok) {
  const remaining=typeof data.remaining==='number'&&Number.isInteger(data.remaining)&&data.remaining>=0?data.remaining:null;
  throw new ServiceError(typeof data.error==='string'?data.error:'request_failed',response.status,strings(data.decision?.explanations),strings(data.decision?.rules),remaining,Boolean(data.resources),data&&typeof data==='object'&&!Array.isArray(data)?data as Record<string,unknown>:{});
 }
 return data as T;
}
/** Server error codes become plain sentences; an unknown code is shown as a code rather than guessed at. */
export function plainError(error:unknown,extra:Record<string,string>={}) {
 if(error instanceof ServiceError) {
  if(checksUnavailable(error))return UNAVAILABLE;
  const text=extra[error.code]??ERRORS[error.code];
  if(error.explanations.length)return `${text??'The screening did not accept these words as written:'} ${error.explanations.map(e=>e.trim().replace(/\.+$/,'')).join('; ')}.`;
  return text??`The request was refused (${error.code}). Nothing changed.`;
 }
 return error instanceof Error?error.message:String(error);
}

// sampleEmployers, minimumCohort, publication and employerListing: see SiteConfig in api.ts. An older server omits them.
const configSchema=z.object({verifierOrigin:z.string().default(''),realPublicationEnabled:z.boolean().optional(),sampleEmployers:z.boolean().optional(),minimumCohort:z.number().int().positive().optional(),publication:z.object({accountBatch:z.number().int().positive(),aggregateMinimum:z.number().int().positive()}).partial().nullish(),employerListing:z.object({open:z.boolean(),perClientPerDay:z.number().int().optional(),pow:z.object({version:z.number(),bits:z.number().int(),windowMinutes:z.number(),worker:z.string()}).partial().nullish()}).nullish(),moderation:z.object({juryEnabled:z.boolean(),sandboxJuryEnabled:z.boolean(),appealsEnabled:z.boolean(),challengesEnabled:z.boolean(),policyVersion:z.string(),policyDigest:z.string()}).partial().nullish()});
export type SiteConfig=z.infer<typeof configSchema>;
export async function loadConfig():Promise<SiteConfig> {const response=await fetch('/api/config');if(!response.ok)throw new Error('config_unavailable');return configSchema.parse(await response.json());}
/**
 * An issuer key as the publisher and the verifier list it (the verifier adds mailboxEnabled, which is not part of the key).
 * source 'community': created on demand by the verifier for an employer a visitor listed, after this release was built,
 * so it cannot be in the pinned registry.
 */
export type ListedKey=IssuerKey&{mailboxEnabled?:boolean};
export async function loadKeys():Promise<ListedKey[]> {const response=await fetch('/api/proof/keys');if(!response.ok)throw new Error('keys_unavailable');return ((await response.json()) as {keys:ListedKey[]}).keys;}
export const isJurorKey=(key:IssuerKey)=>keyPurpose(key)==='juror';
/** The stamp binding every proof-of-work request on these pages uses: this site's origin, the action and the key. */
export const powBinding=async(action:'start'|'issue-juror',keyId:string,subject:Promise<string>):Promise<PowBinding>=>({origin:location.origin,action,keyId,subject:await subject});
/**
 * Fingerprints of the issuer keys in the registry this build was released with (tools/build.mjs defines it from the
 * signed registry). Absent or empty when the build pins none; then the publisher-and-verifier cross-check stands alone.
 */
declare const __SIWT_ISSUER_FINGERPRINTS__:string[]|null|undefined;
declare const __SIWT_ISSUER_REGISTRY_DIGEST__:string|null|undefined;
export const PINNED_FINGERPRINTS:readonly string[]=typeof __SIWT_ISSUER_FINGERPRINTS__!=='undefined'&&Array.isArray(__SIWT_ISSUER_FINGERPRINTS__)?__SIWT_ISSUER_FINGERPRINTS__.filter(f=>typeof f==='string'):[];
/** SHA-256 of the pinned fingerprints (the transparency archives' issuerKeysDigest form), for comparing with a signed release. */
export const PINNED_REGISTRY_DIGEST:string|null=typeof __SIWT_ISSUER_REGISTRY_DIGEST__==='string'&&PINNED_FINGERPRINTS.length?__SIWT_ISSUER_REGISTRY_DIGEST__:null;
/** The sentence after a key fingerprint when this build pins a registry. */
export const registryNote=()=>PINNED_FINGERPRINTS.length?`, and it is in the key registry this release was built with${PINNED_REGISTRY_DIGEST?` (registry digest ${PINNED_REGISTRY_DIGEST.slice(0,12)})`:''}`:'';
/** Whether a key is in the pinned registry; null when this build pins none. */
export async function pinnedKey(key:IssuerKey,pinned:readonly string[]=PINNED_FINGERPRINTS):Promise<boolean|null> {return pinned.length?pinned.includes(await issuerKeyFingerprint(key)):null;}
/**
 * Blind only against a key the publisher and the verifier describe identically; a mismatch could be a per-visitor tagging
 * key. The verifier must be the one this release names (pinnedVerifier), checked before anything is sent to it. A curated
 * key must also be in the registry this build pins: a key both services agree on but nobody released could still be a
 * tagging key served to everyone. A community key (created on demand for an employer a visitor listed, after this release
 * was built) cannot be pinned, so both services must publish it identically, member for member, both calling it a
 * community key; and it is refused for an employer and purpose the verifier holds a curated work-mailbox key for, so a key
 * nobody released never replaces one a release pinned.
 */
export async function crossCheckKey(verifier:string,key:ListedKey,needsMail=false) {
 const wrongVerifier=verifierProblem(verifier);if(wrongVerifier)throw new Error(wrongVerifier);
 if(keySource(key)===null)throw new Error('This key’s declared source does not match its id, so it cannot be used and nothing was sent.');
 const community=isCommunityKey(key);
 if(!community&&await pinnedKey(key)===false)throw new Error('This key is not in the key registry this release was built with, so nothing was sent. Do not continue; reload later, and compare the key fingerprint on another device or network.');
 let listed:ListedKey[];
 try {
  // Only this employer's keys (the verifier's ?company= filter): the request that follows names the key anyway, and the
  // curated-key check below needs no other employer's.
  const response=await fetch(`${verifier}/keys?company=${encodeURIComponent(key.companySlug)}`);if(!response.ok)throw new Error('keys');
  const data=(await response.json()) as {keys:ListedKey[];pow?:{bits?:unknown}};listed=data.keys;if(!Array.isArray(listed))throw new Error('keys');
  if(typeof data.pow?.bits==='number')VERIFIER_POW_BITS.set(verifier,data.pow.bits);
 }
 catch {throw new Error('The verifier key list is unavailable, so nothing was sent. Try again later.');}
 const verifierKey=listed.find(k=>k.id===key.id);
 if(!verifierKey)throw new Error('The verifier does not list this credential key yet, so nothing was sent.');
 if(!sameIssuerKey(key,verifierKey)||community!==isCommunityKey(verifierKey)||(community&&!sameCommunityKey(key,verifierKey)))throw new Error('The verifier and this site disagree about this credential key, so nothing was sent. Do not continue; this is what a tagging attempt would look like.');
 if(community&&curatedMailboxKey(listed,key.companySlug,keyPurpose(key)??'contribution'))throw new Error('The verifier holds a key from this release’s key registry for this employer, so a key added after this release is not used for it, and nothing was sent. Reload the page; if this persists, do not continue.');
 if(needsMail&&verifierKey.mailboxEnabled===false)throw new Error('The verifier is not sending email yet, so no code can be sent. Nothing was sent.');
 return key;
}
/** The proof-of-work difficulty each verifier's key list announced (its /keys `pow.bits`), read with the keys it checks. */
const VERIFIER_POW_BITS=new Map<string,number>();
export const verifierPowBits=(verifier:string)=>VERIFIER_POW_BITS.get(verifier)??null;
/** The sentence after a key fingerprint: why this key is trusted. `what` names it ('key', 'juror key'). */
export const keyTrust=(key:ListedKey,what='key')=>isCommunityKey(key)?COMMUNITY_KEY_NOTE:`The verifier and this site published the same ${what}${registryNote()}.`;
/** The start of the key's public fingerprint, so two devices or networks can compare the key they were given. */
export async function keyFingerprint(key:IssuerKey) {return (await issuerKeyFingerprint(key)).slice(0,16).match(/.{4}/g)!.join(' ');}
/** A wrong or mistyped capability must never be reported as a withdrawal. A confirmed withdrawal also forgets this device's signing key. */
export async function withdrawByCapability(capability:string):Promise<{status:'withdrawn'|'expired';message:string}> {
 let result:{withdrawn:boolean;status?:string};
 try {result=await send<{withdrawn:boolean;status?:string}>('/api/withdraw',{capability:capability.trim()});}
 catch(e){if(!(e instanceof ServiceError)||e.code!=='not_found')throw e;result={withdrawn:false};}
 if(!result.withdrawn)throw new Error('No contribution matches this capability, so nothing was withdrawn. Check that you copied all of it.');
 try {await forgetAuthor(capability.trim());}catch{}
 const status=result.status==='expired'?'expired':'withdrawn';
 return {status,message:STATUS_TEXT[status]!};
}
/** Revises held words. Both permissions are sent explicitly every time, so the author decides them for these words. */
export async function revise(capability:string,revision:number,text:string,choices:{juryReviewConsent:boolean;sensitiveConsent:boolean},key?:CryptoKey) {
 const signature=await signAction(capability,'revise',revision,await digest(text),key);
 return send<AuthorReply>('/api/author',{action:'revise',capability,revision,signature,body:text,screeningConsent:true,juryReviewConsent:choices.juryReviewConsent,sensitiveConsent:choices.sensitiveConsent});
}
/** After a repair, the server's releasePolicy (shown with the status) says why a case is still held; this never guesses. */
export const repairNotice=(status:string|undefined)=>status==='held'?'The revised words were screened again and are still held privately. The explanation above says why and what happens next.':'The revised words were accepted and replace the held version.';
/** The author's permission for juror review, worded the same wherever words are submitted or revised. */
export const JURY_REVIEW_LABEL='If screening holds these words for a jury, let anonymous jurors read them, with detected identifying details masked.';
export const JURY_REVIEW_OFF='Off by default. Without it, words held for a jury are never shown to jurors: they stay held privately until you repair or withdraw them, and unrepaired held words are erased after 30 days.';
/** A juror-review checkbox. It is never pre-checked by this page; the author's earlier choice is shown only where it is known. */
export function JuryReviewConsent({checked,onChange}:{checked:boolean;onChange:(value:boolean)=>void}) {
 return <label className="cx-check"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span><b>{JURY_REVIEW_LABEL}</b> {JURY_REVIEW_OFF}</span></label>;
}
/** The explicit statement for special-category information about the author (GDPR Article 9(2)(a)); never pre-checked by this page. */
export const SENSITIVE_LABEL='My account may reveal sensitive information about me, such as health or union membership, and I choose to publish it.';
export function SensitiveConsent({checked,onChange}:{checked:boolean;onChange:(value:boolean)=>void}) {
 return <label className="cx-check"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span><b>{SENSITIVE_LABEL}</b> Check it only if that is true. It is kept only as a yes-or-no with these words and is erased with them. It does not cover information about other people.</span></label>;
}
/** A real employer whose work-mailbox verification is not configured: nothing about it can be verified or submitted yet. */
export const VERIFICATION_NOT_SET_UP='Verification for this employer isn’t set up yet, so no work-mailbox proof can be issued for it and nothing can be submitted about it. Your draft stays on this device.';
export const opensNewTab=<span className="cx-sr">(opens in a new tab)</span>;
/** The calm note while the proof of work runs, with a way to stop it (nothing has been sent while it runs). */
export function PowNote({onStop}:{onStop:()=>void}) {
 return <div className="cx-pow-row"><p className="cx-note cx-pow" role="status"><i className="cx-pow-dot" aria-hidden="true"/>{POW_NOTE}</p><button type="button" className="cx-link" onClick={onStop}>Stop the calculation</button></div>;
}
const clip=(text:string,length=56)=>text.length>length?`${text.slice(0,length-1)}…`:text;

/* The privacy editor. Everything here runs on this device: nothing is sent, stored or logged, and nothing is rewritten
   without the author approving that one edit. */
type Tone='high'|'medium'|'coach';
/**
 * One detail to review. `target`, when present, is the wider text the suggestion replaces (a sentence that only offers
 * contact details, removed whole so no broken sentence is left); "Write it my way" still replaces only the excerpt.
 * `removed` names what an empty suggestion removes. `removal` is the sentence a phrase to make specific sits in, which the
 * author may remove whole instead of rewording it (`start` is where `target` begins).
 */
export interface ReviewItem {key:string;kind:string;tone:Tone;title:string;excerpt:string;start:number;end:number;count:number;explanation:string;prompt?:string;suggestion?:string;reason?:string;target?:string;removed?:string;removal?:{target:string;start:number;sentence:string};}
export interface ApprovedEdit {label:string;after:string;spans:{start:number;length:number;original:string}[];}
const WHO=String.raw`(?:he|she|they|my\s+(?:manager|boss|director|lead|supervisor|skip-level|ceo|founder|vp|colleague|coworker|co-worker|teammate)|our\s+(?:manager|boss|director|lead|supervisor|ceo|founder|vp)|the\s+(?:manager|boss|director|lead|supervisor|ceo|founder|vp|owner|recruiter))`;
const LABEL=String.raw`(?:idiot|moron|psycho(?:path)?|sociopath|narcissist|liar|crook|creep|pig|clown|jerk|monster|snake|lunatic|scumbag|bastard|asshole|bitch|loser|fraud|prick|tyrant|dictator)`;
const TRAIT=String.raw`(?:psychotic|narcissistic|sociopathic|psychopathic|evil|insane|crazy|stupid|dumb|brainless|incompetent|useless|worthless|pathetic|disgusting)`;
const SO=String.raw`(?:(?:so|such|completely|totally|absolutely|clinically|basically|just|really|a|an|the|real|complete|total|utter|pure)\s+){0,3}`;
const COACHING=[
 {kind:'characterization',title:'Personal characterization',
  pattern:new RegExp(String.raw`\b${WHO}\s+(?:is|was|are|were|seems|seemed)\s+${SO}(?:${LABEL}s?|${TRAIT})\b|\b(?:he's|she's|they're|he’s|she’s|they’re)\s+${SO}(?:${LABEL}|${TRAIT})\b|\b(?:piece\s+of\s+(?:shit|garbage|trash|work)|lying\s+(?:bastard|snake)|pathological\s+liar|scumbag|asshole|dickhead)\b`,'gi'),
  explanation:'Criticism is welcome. A label about a person is not evidence, though, and the published policy asks authors to repair a clear personal attack before it is published. The behavior you saw is what readers can weigh.',
  prompt:'What did the person do? Describe the behavior you saw and how it affected your work.'},
 {kind:'broad_allegation',title:'Broad allegation',
  pattern:new RegExp(String.raw`\b(?:everyone|everybody|all\s+(?:the\s+|of\s+the\s+)?(?:managers|executives|leaders|leadership|employees|women|men|staff|recruiters|engineers|salespeople|directors)|the\s+whole\s+(?:company|leadership|team|management|department|org))\s+(?:here\s+)?(?:always|never|constantly|routinely)\s+[a-z]+|\b(?:always|constantly|routinely)\s+(?:steals?|stole|lies|lied|cheats?|cheated|retaliates?|retaliated|harass(?:es|ed)?)\b|\bst(?:eals?|ole)\s+(?:from\s+)?everyone\b|\beveryone(?:'|’)s\s+(?:commissions?|pay|wages|bonus(?:es)?|credit|tips|overtime)\b|\b(?:are|is|were|was)\s+(?:all\s+)?(?:crooks|criminals|thieves|liars|frauds|corrupt|a\s+scam|a\s+cult)\b|\bcommit(?:s|ted|ting)?\s+(?:fraud|crimes?|wage\s+theft|tax\s+evasion)\b(?!\s+(?:by|when|in|on|during|against|through)\b)`,'gi'),
  explanation:'A sweeping claim speaks for people who did not write it, so readers cannot weigh it. What you saw yourself, told as your own account, is what they can weigh.',
  prompt:'What specifically happened? Say what you saw or experienced yourself, roughly when, and what explanation or records you were given.'},
] as const;
const PROMPTS:Record<string,string>={named_person:'Who is this person in the story? Describe their role, not who they are.'};
const occurrences=(text:string,needle:string)=>{const at:number[]=[];if(!needle)return at;for(let i=text.indexOf(needle);i>=0;i=text.indexOf(needle,i+needle.length))at.push(i);return at;};
// A sentence that asks readers to get in touch ("Call me at …", "My email is …"): its contact detail cannot be generalized
// into a readable sentence, so the suggestion removes the sentence.
const CONTACT_KINDS=['email','phone','url'];
const CONTACT_CUE=/\b(?:call|text|ring|phone|e-?mail|message|contact|reach|ping|dm|whatsapp|write\s+to)\s+(?:me|us)\b|\b(?:my|our)\s+(?:personal\s+|work\s+|cell\s+|mobile\s+|direct\s+)?(?:e-?mail|number|phone|cell|mobile|handle|contact)\b/i;
/**
 * The sentence holding [start,end): where it starts and ends, and `target`, the sentence with the space that separates it
 * from its neighbours, so removing `target` leaves exactly one separator (the spaces after it, or at the end of a
 * paragraph the spaces before it). `at` is where `target` begins.
 */
function sentenceAround(text:string,start:number,end:number):{from:number;to:number;target:string;at:number} {
 let from=0;for(const m of text.slice(0,start).matchAll(/[.!?]["'”’)\]]*\s+|\n/g))from=m.index+m[0].length;
 const stop=/[.!?]["'”’)\]]*(?=\s|$)|\n/.exec(text.slice(end)),to=stop?end+stop.index+(stop[0]==='\n'?0:stop[0].length):text.length;
 const sentence=text.slice(from,to);
 const after=/^[ \t]+/.exec(text.slice(to))?.[0]??'',before=/[ \t]+$/.exec(text.slice(0,from))?.[0]??'',rest=text.slice(to+after.length);
 const trailing=!!after&&!!rest&&!rest.startsWith('\n');
 return {from,to,target:trailing?sentence+after:before+sentence+after,at:trailing?from:from-before.length};
}
/** The sentence holding [start,end), with its separator, when it is a request to get in touch. */
function contactSentence(text:string,start:number,end:number):string|null {
 const s=sentenceAround(text,start,end);
 return CONTACT_CUE.test(text.slice(s.from,s.to))?s.target:null;
}
/** Whether an edit at `start` begins a sentence, where a replacement keeps the capital the author wrote. */
const sentenceStart=(text:string,start:number)=>/(?:^|[.!?]["'”’)\]]*\s+|\n\s*)$/.test(text.slice(0,start));
/** A suggested replacement as it will read at `start`: capitalized where the author's words began a sentence with a capital. */
export function casedAt(text:string,start:number,excerpt:string,replacement:string) {
 return /^[a-z]/.test(replacement)&&/^[A-Z]/.test(excerpt)&&sentenceStart(text,start)?replacement[0]!.toUpperCase()+replacement.slice(1):replacement;
}
/** Everything worth reviewing in a draft, in review order: identifier findings (must-change first), then phrases to make specific. */
export function reviewItems(text:string,findings:Finding[]=scanText(text)):ReviewItem[] {
 const items:ReviewItem[]=[],taken:[number,number][]=[];
 const ordered=[...findings].sort((a,b)=>Number(b.severity==='high')-Number(a.severity==='high'));
 for(const f of ordered) {
  // A note addressed to the checks is not part of the account: the whole sentence it sits in is the detail, marked in
  // the draft and proposed for removal, so rewording it replaces the note rather than a few of its words.
  if(SCREENING_ONLY_KINDS.includes(f.kind)) {
   for(const found of occurrences(text,f.excerpt)) {
    const s=sentenceAround(text,found,found+f.excerpt.length),note=text.slice(s.from,s.to),key=`${f.kind}:${note}`;
    if(items.some(i=>i.key===key))continue;
    for(const at of occurrences(text,note))taken.push([at,at+note.length]);
    items.push({key,kind:f.kind,tone:f.severity,title:f.what,excerpt:note,start:s.from,end:s.to,count:occurrences(text,s.target).length,explanation:f.explanation,
     suggestion:'',target:s.target,removed:'Note removed',reason:'Removes the note addressed to the checks; the rest of the account stays as written',prompt:'This sentence is addressed to the checks, not to readers. Removing it keeps the rest of your account as written.'});
   }
   continue;
  }
  const key=`${f.kind}:${f.excerpt}`;if(items.some(i=>i.key===key))continue;
  const at=occurrences(text,f.excerpt);if(!at.length)continue;
  for(const s of at)taken.push([s,s+f.excerpt.length]);
  const suggestion=f.suggestions[0],target=CONTACT_KINDS.includes(f.kind)?contactSentence(text,at[0]!,at[0]!+f.excerpt.length):null;
  const offer=target?{suggestion:'',target,removed:'Sentence removed',reason:'Removes a request to contact you; the rest of the account stays as written',prompt:'This sentence asks readers to contact you. Removing it keeps your account and drops the contact details.',count:occurrences(text,target).length}
   :{...(PROMPTS[f.kind]?{prompt:PROMPTS[f.kind]}:{}),...(suggestion?{suggestion:suggestion.to,reason:suggestion.reason}:{}),count:at.length};
  items.push({key,kind:f.kind,tone:f.severity,title:f.what,excerpt:f.excerpt,start:at[0]!,end:at[0]!+f.excerpt.length,explanation:f.explanation,...offer});
 }
 for(const rule of COACHING) {
  const seen=new Map<string,number>();
  for(const match of text.matchAll(new RegExp(rule.pattern.source,rule.pattern.flags))) {
   const start=match.index,end=start+match[0].length,lower=match[0].toLowerCase(),nth=(seen.get(lower)??0)+1;seen.set(lower,nth);
   if(taken.some(([a,b])=>start<b&&end>a))continue;taken.push([start,end]);
   const s=sentenceAround(text,start,end);
   items.push({key:`${rule.kind}:${lower}#${nth}`,kind:rule.kind,tone:'coach',title:rule.title,excerpt:match[0],start,end,count:1,explanation:rule.explanation,prompt:rule.prompt,removal:{target:s.target,start:s.at,sentence:text.slice(s.from,s.to)}});
  }
 }
 return items;
}
/**
 * Applies one approved edit. Identifier findings change every identical occurrence (the count is shown first); a coached
 * phrase changes only its own span. With `suggested`, the edit is the detector's own suggestion: it replaces the item's
 * `target` when it has one, and keeps a capital where the author's words began a sentence. With `remove`, a coached
 * phrase's whole sentence (`removal`) is removed. The author's own wording is applied exactly as written.
 */
export function applyEdit(text:string,item:ReviewItem,replacement:string,o:{suggested?:boolean;remove?:boolean}={}):{text:string;spans:ApprovedEdit['spans']}|null {
 const removal=o.remove?item.removal:undefined;
 if(o.remove&&!removal)return null;
 const words=removal?removal.target:o.suggested&&item.target!==undefined?item.target:item.excerpt;
 const starts=removal?[removal.start]:item.tone==='coach'?[item.start]:occurrences(text,words);
 if(!starts.length||starts.some(s=>text.slice(s,s+words.length)!==words))return null;
 let out='',cursor=0;const spans:ApprovedEdit['spans']=[];
 for(const s of starts){const rep=removal?'':o.suggested?casedAt(text,s,words,replacement):replacement;out+=text.slice(cursor,s);spans.push({start:out.length,length:rep.length,original:words});out+=rep;cursor=s+words.length;}
 return {text:out+text.slice(cursor),spans};
}
/**
 * What the meter counts: identifying details only. A note addressed to the checks (SCREENING_ONLY_KINDS) is not an
 * identifying detail; it is counted apart, one per sentence it sits in (as it is reviewed), and it must still be removed
 * before the draft can leave the device.
 */
export function meterCounts(text:string,findings:readonly Finding[]=scanText(text)):{identifying:number;high:number;medium:number;notes:number} {
 const identifying=findings.filter(f=>!SCREENING_ONLY_KINDS.includes(f.kind)),high=identifying.filter(f=>f.severity==='high').length;
 const notes=new Set(findings.filter(f=>SCREENING_ONLY_KINDS.includes(f.kind)).flatMap(f=>occurrences(text,f.excerpt).map(at=>{const s=sentenceAround(text,at,at+f.excerpt.length);return `${s.from}:${s.to}`;})));
 return {identifying:identifying.length,high,medium:identifying.length-high,notes:notes.size};
}
const notesLine=(notes:number)=>notes?`${notes===1?'A note':`${notes} notes`} addressed to the checks must be removed.`:'';
/** The message after an approved edit, from the on-device checks of the words as they now stand. */
export function approvedMessage(text:string,findings:readonly Finding[]=scanText(text)):string {
 const {identifying,notes}=meterCounts(text,findings);
 const left=identifying?`${identifying} identifying ${identifying===1?'detail remains':'details remain'}.`:'No identifying details are recognised now.';
 return `Edit approved. ${left}${notes?` ${notes===1?'A note':`${notes} notes`} addressed to the checks ${notes===1?'remains':'remain'}.`:''}`;
}
/** Reverses an approved edit even after later typing elsewhere; refuses (null) when the typing touched the edited words, so nothing the author wrote is lost. */
export function revertEdit(current:string,edit:ApprovedEdit):string|null {
 const after=edit.after,limit=Math.min(after.length,current.length);
 let prefix=0;while(prefix<limit&&after[prefix]===current[prefix])prefix++;
 let suffix=0;while(suffix<limit-prefix&&after[after.length-1-suffix]===current[current.length-1-suffix])suffix++;
 const changedEnd=after.length-suffix,shift=current.length-after.length;
 let out=current;
 for(const span of [...edit.spans].sort((a,b)=>b.start-a.start)) {
  const end=span.start+span.length;
  const at=current===after||end<=prefix?span.start:span.start>=changedEnd?span.start+shift:-1;
  if(at<0)return null;
  out=out.slice(0,at)+span.original+out.slice(at+span.length);
 }
 return out;
}
function markSpans(text:string,items:ReviewItem[]) {
 const out:{start:number;end:number;tone:Tone;key:string}[]=[];
 for(const item of items)for(const start of item.tone==='coach'?[item.start]:occurrences(text,item.excerpt)) {
  const end=start+item.excerpt.length;if(!out.some(o=>start<o.end&&end>o.start))out.push({start,end,tone:item.tone,key:item.key});
 }
 return out.sort((a,b)=>a.start-b.start);
}
function context(text:string,start:number,end:number) {
 const from=Math.max(0,text.lastIndexOf(' ',Math.max(0,start-44))),to=text.indexOf(' ',Math.min(text.length,end+44));
 const stop=to<0?text.length:to;
 return {before:`${from>0?'…':''}${text.slice(from,start).trimStart()}`,match:text.slice(start,end),after:`${text.slice(end,stop)}${stop<text.length?'…':''}`};
}
const TONE_LABEL:Record<Tone,string>={high:'Must change before this draft can leave the device',medium:'Worth generalizing',coach:'Worth making specific'};
const TONE_SHORT:Record<Tone,string>={high:'must change',medium:'worth generalizing',coach:'make specific'};
function CrisisNote({kind,copy,privacy,onHide}:{kind:CrisisKind;copy:{heading:string;body:string};privacy:string;onHide:()=>void}) {
 return <aside className="cx-crisis" aria-label="Support resources"><h3>{copy.heading}</h3><p>{copy.body}</p><ul>{crisisResourcesFor(kind).map(r=><li key={r.id}><strong>{r.name}</strong><span className="cx-crisis-region">{r.region}</span><p>{r.detail}</p><div className="cx-crisis-links">{r.links.map(l=><a key={l.href} href={l.href} {...(l.href.startsWith('http')?{target:'_blank',rel:'noopener noreferrer'}:{})}>{l.label}{l.href.startsWith('http')&&opensNewTab}</a>)}</div></li>)}</ul><p className="cx-note">{privacy}</p><button type="button" className="cx-link" onClick={onHide}>Hide this note</button></aside>;
}
function CrisisCard({text}:{text:string}) {
 const deferred=useDeferredValue(text),match=useMemo(()=>detectCrisis(deferred),[deferred]),[hidden,setHidden]=useState('');
 if(!match||hidden===match.excerpt)return null;
 return <CrisisNote kind={match.kind} copy={crisisCopyFor(match)} privacy={CRISIS_COPY.privacy} onHide={()=>setHidden(match.excerpt)}/>;
}
const CHECK_PRIVACY='This note was added to the site’s answer to the words you sent. Only you see it: nothing about it is stored, logged or reported, it is not a moderation signal, and it does not change what you can write or submit.';
/**
 * Support resources a screening, submit or revise reply carried. The links always come from shared/safety.ts, never from the
 * reply. Words the on-device check already matched show the on-device card instead, so the same note never appears twice.
 */
export function CheckedCrisisNote({resources,text}:{resources:unknown;text:string}) {
 const [hidden,setHidden]=useState(false);
 if(!resources||hidden||detectCrisis(text))return null;
 return <CrisisNote kind="self_harm" copy={CRISIS_COPY.self_harm} privacy={CHECK_PRIVACY} onHide={()=>setHidden(true)}/>;
}
/* Browser spelling and writing services can send text off the device, so drafts opt out of them. */
export const PRIVATE_TEXT={spellCheck:false,autoComplete:'off','data-gramm':'false','data-gramm_editor':'false','data-enable-grammarly':'false','data-lt-active':'false'} as const;
/** The draft with inline risk marks, the identifying-details meter, the sequential “Make safer” review and undo. */
export function PrivacyEditor({id,label,value,onChange,placeholder,description}:{id:string;label:string;value:string;onChange:(text:string)=>void;placeholder?:string;description?:ReactNode}) {
 const findings=useMemo(()=>scanText(value),[value]);
 const items=useMemo(()=>reviewItems(value,findings),[value,findings]);
 const [kept,setKept]=useState<string[]>([]),[focus,setFocus]=useState<string|null>(null),[own,setOwn]=useState<string|null>(null),[edits,setEdits]=useState<ApprovedEdit[]>([]),[message,setMessage]=useState('');
 const text=useRef<HTMLTextAreaElement>(null),back=useRef<HTMLDivElement>(null),panel=useRef<HTMLElement>(null);
 useLayoutEffect(()=>{const el=text.current;if(!el)return;el.style.height='auto';el.style.height=`${el.scrollHeight+el.offsetHeight-el.clientHeight}px`;},[value]);
 const queue=items.filter(i=>!kept.includes(i.key)),current=queue.find(i=>i.key===focus)??queue[0],index=current?queue.indexOf(current):-1;
 useEffect(()=>{setOwn(null);},[current?.key]);
 // The meter counts identifying details only; a note addressed to the checks is named apart (see meterCounts).
 const {identifying,high,medium,notes}=meterCounts(value,findings),keptLive=items.filter(i=>kept.includes(i.key)).length,coached=items.filter(i=>i.tone==='coach').length;
 const identifyingFindings=findings.filter(f=>!SCREENING_ONLY_KINDS.includes(f.kind));
 const marks=useMemo(()=>markSpans(value,items),[value,items]);
 // Approving, keeping, undoing or stepping replaces the card whose button had focus. Focus then moves to the next thing
 // to act on, never to the page body: the card's primary action (its wording box when that action needs words first),
 // the matching Previous/Next button, or the draft once no card is left.
 const refocus=useRef<'card'|'own'|'prev'|'next'|null>(null);
 useEffect(()=>{
  const want=refocus.current;if(!want)return;refocus.current=null;
  const card=panel.current?.querySelector<HTMLElement>('.cx-proposal'),find=(selector:string)=>card?.querySelector<HTMLElement>(selector)??null;
  const step=want==='prev'||want==='next'?find(`.cx-steps button:nth-child(${want==='prev'?1:2}):not(:disabled)`)??find('.cx-steps button:not(:disabled)'):null;
  const target=step??(want==='own'?find('.cx-own'):null)??find('.cx-actions .cx-btn-primary:not(:disabled)')??find('.cx-own')??find('.cx-actions button:not(:disabled)');
  (target??text.current)?.focus();
 });
 function approve(item:ReviewItem,replacement:string,how:{suggested?:boolean;remove?:boolean}={}) {
  const result=applyEdit(value,item,replacement,how);if(!result){setMessage('The words changed before this edit was approved. Review it again.');return;}
  const replaced=how.remove&&item.removal?item.removal.sentence:how.suggested&&item.target!==undefined?item.target.trim():item.excerpt,shown=result.text.slice(result.spans[0]!.start,result.spans[0]!.start+result.spans[0]!.length);
  setEdits(list=>[...list,{label:shown?`“${clip(replaced,32)}” to “${clip(shown,32)}”`:`removing “${clip(replaced,32)}”`,after:result.text,spans:result.spans}]);
  setOwn(null);setFocus(null);onChange(result.text);refocus.current='card';
  setMessage(approvedMessage(result.text));
 }
 function undo() {
  const last=edits.at(-1);if(!last)return;
  const restored=revertEdit(value,last);
  if(restored===null){setMessage('This edit can’t be undone automatically because the words around it changed since. Edit them directly.');return;}
  setEdits(list=>list.slice(0,-1));onChange(restored);refocus.current='card';setMessage(`Undone: ${last.label}.`);
 }
 function keep(item:ReviewItem) {setKept(list=>[...list,item.key]);setFocus(null);refocus.current='card';setMessage(`Kept as written: “${clip(item.excerpt,32)}”.`);}
 function jump(key:string) {setKept(list=>list.filter(k=>k!==key));setFocus(key);panel.current?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});}
 const parts:ReactNode[]=[];let cursor=0;
 for(const m of marks){if(m.start>cursor)parts.push(value.slice(cursor,m.start));parts.push(<mark key={m.start} className={`cx-mark cx-mark-${m.tone}${m.key===current?.key?' cx-mark-current':''}`}>{value.slice(m.start,m.end)}</mark>);cursor=m.end;}
 parts.push(`${value.slice(cursor)}\n`);
 const ctx=current&&context(value,current.start,current.end),ownText=own??'',writing=current&&(current.tone==='coach'||own!==null);
 return <div className="cx-editor">
  <label className="cx-editor-label" htmlFor={id}>{label}</label>
  {description&&<p className="cx-editor-description">{description}</p>}
  <div className="cx-draft">
   <div className="cx-backdrop" ref={back} aria-hidden="true">{parts}</div>
   <textarea id={id} ref={text} rows={7} value={value} maxLength={4000} placeholder={placeholder} {...PRIVATE_TEXT} onChange={e=>onChange(e.target.value)} onScroll={e=>{if(back.current)back.current.scrollTop=e.currentTarget.scrollTop;}} aria-describedby={`${id}-meter ${id}-local`}/>
  </div>
  <div className="cx-draft-foot"><span id={`${id}-local`}><i className="cx-local-dot" aria-hidden="true"/><span>Draft stays on this device. Browser spell check is off here, so it cannot send your words to a spelling service.</span></span><span className="cx-num">{value.length.toLocaleString('en-US')} / 4,000</span></div>
  <CrisisCard text={value}/>
  <div className="cx-meter" id={`${id}-meter`}>
   <div className="cx-meter-head"><span className="cx-meter-count cx-num" aria-hidden="true">{identifying}</span><div><strong>{identifying?`identifying ${identifying===1?'detail':'details'} recognised on this device`:'No identifying details recognised on this device'}</strong><span className="cx-sr">{identifying?`${identifying} identifying ${identifying===1?'detail':'details'} recognised.`:''}</span><p>{identifying?`${high} must change, ${medium} worth generalizing.`:notes?'':'The on-device checks found none of the patterns they look for.'}{notes?`${identifying?' ':''}${notesLine(notes)}`:''}{coached?` ${coached} ${coached===1?'phrase':'phrases'} could be made more specific.`:''}</p></div></div>
   <div className="cx-meter-bar" aria-hidden="true">{identifyingFindings.slice(0,16).map(f=><i key={f.id} className={`cx-seg cx-seg-${f.severity}`}/>)}{edits.slice(0,Math.max(0,16-identifying)).map((_,n)=><i key={`e${n}`} className="cx-seg cx-seg-done"/>)}{!identifying&&!edits.length&&<i className="cx-seg cx-seg-empty"/>}</div>
   <p className="cx-meter-facts">{edits.length} {edits.length===1?'edit':'edits'} approved, {keptLive} kept as written.</p>
   <p className="cx-note">This counts only what the on-device checks recognise. It is not an anonymity guarantee: details they miss, and context such as your role, team, timing or writing style, can still identify you.</p>
  </div>
  {items.length>0&&<ul className="cx-details" aria-label="Details to review">{items.map(i=><li key={i.key}><button type="button" className={i.key===current?.key?'is-current':''} aria-current={i.key===current?.key?'true':undefined} onClick={()=>jump(i.key)}><i className={`cx-dot cx-dot-${i.tone}`} aria-hidden="true"/><span>{i.title}</span><span className="cx-details-excerpt">{clip(i.excerpt,40)}</span>{kept.includes(i.key)&&<em>kept</em>}</button></li>)}</ul>}
  <section className="cx-safer" ref={panel} aria-labelledby={`${id}-safer`}>
   <header><h3 id={`${id}-safer`}>Make safer</h3><span className="cx-num">{current?`Detail ${index+1} of ${queue.length}`:items.length?'All details reviewed':'Nothing to review'}</span></header>
   {current&&ctx?<article key={current.key} className={`cx-proposal cx-tone-${current.tone}`}>
    <p className="cx-kicker">{`${current.title}: ${TONE_SHORT[current.tone]}`}</p>
    <blockquote className="cx-context">{ctx.before}<mark className={`cx-mark cx-mark-${current.tone}`}>{ctx.match}</mark>{ctx.after}</blockquote>
    {current.prompt&&<p className="cx-prompt">{current.prompt}</p>}
    <p className="cx-why">{current.explanation}{current.count>1?` It appears ${current.count} times; approving changes every one.`:''}</p>
    {writing?<>
     <label className="cx-field" htmlFor={`${id}-own`}>{current.tone==='coach'?'Your words, in place of the highlighted phrase':'Your wording instead'}</label>
     <textarea className="cx-own" id={`${id}-own`} rows={3} maxLength={600} value={ownText} {...PRIVATE_TEXT} onChange={e=>setOwn(e.target.value)}/>
     {ownText.trim()&&<div className="cx-diff"><del>{clip(current.excerpt,120)}</del><span aria-hidden="true">→</span><ins>{clip(ownText.trim(),160)}</ins></div>}
    </>:current.suggestion!==undefined&&<div className="cx-diff"><del>{clip((current.target??current.excerpt).trim(),160)}</del><span aria-hidden="true">→</span>{current.suggestion?<ins>{casedAt(value,current.start,current.excerpt,current.suggestion)}</ins>:<em className="cx-diff-removed">{current.removed??'Sentence removed'}</em>}</div>}
    {writing&&current.removal&&!ownText.trim()&&<div className="cx-diff cx-diff-alt"><p className="cx-diff-lead">Or remove the whole sentence:</p><del>{clip(current.removal.sentence,160)}</del><span aria-hidden="true">→</span><em className="cx-diff-removed">Sentence removed</em></div>}
    <div className="cx-actions">
     {!writing&&current.suggestion!==undefined&&<button type="button" className="cx-btn cx-btn-primary" onClick={()=>approve(current,current.suggestion!,{suggested:true})}>Approve this edit</button>}
     {!writing&&<button type="button" className="cx-btn" onClick={()=>{setOwn('');refocus.current='own';}}>Write it my way</button>}
     {writing&&<button type="button" className="cx-btn cx-btn-primary" disabled={!ownText.trim()} onClick={()=>approve(current,ownText.trim())}>Approve my wording</button>}
     {writing&&current.removal&&!ownText.trim()&&<button type="button" className="cx-btn" onClick={()=>approve(current,'',{remove:true})}>Remove the sentence</button>}
     {writing&&current.tone!=='coach'&&<button type="button" className="cx-link" onClick={()=>{setOwn(null);refocus.current='card';}}>Use the suggestion instead</button>}
     {current.tone!=='high'&&<button type="button" className="cx-link" onClick={()=>keep(current)}>Keep as written</button>}
    </div>
    {current.tone==='high'&&<p className="cx-hint">{TONE_LABEL.high}. It is never sent while it remains.</p>}
    {queue.length>1&&<nav className="cx-steps" aria-label="Review order"><button type="button" className="cx-link" disabled={index<=0} onClick={()=>{setFocus(queue[index-1]!.key);refocus.current='prev';}}>Previous</button><button type="button" className="cx-link" disabled={index>=queue.length-1} onClick={()=>{setFocus(queue[index+1]!.key);refocus.current='next';}}>Next</button></nav>}
   </article>:<p className="cx-calm">{items.length?'Every detail has been changed or kept as written. You can reopen any of them from the list above.':'When the on-device checks recognise a detail that could identify you or someone else, it is marked in your draft and explained here, one at a time.'}</p>}
   <p className="cx-safer-message" role="status">{message}</p>
   <footer><span>Nothing changes until you approve it.</span>{edits.length>0&&<button type="button" className="cx-link" onClick={undo}>Undo {edits.at(-1)!.label}</button>}</footer>
  </section>
 </div>;
}
const RULE_HINTS:Record<string,string>={
 'PRIV-04':'Someone other than you may be identifiable. Look for names, relationships or roles that point at one person.',
 'PRIV-05':'Details together could identify you: your role, team size, timing or location. Generalizing one or two of them usually helps.',
 'SAFE-01':'Words that read as a threat or as targeting a person are not published. Describe what happened instead.',
 'SAFE-02':'Private contact or location information is not published.',
 'ABUSE-02':'Describe the behavior you saw rather than the person.',
 'SPAM-01':'Promotion or solicitation unrelated to the workplace is not published.',
 'SPAM-02':'The text may read as coordinated, fabricated or written as someone else.',
 'CHECKS-UNAVAILABLE':'Nothing was decided. Your draft stays on this device; try again later.',
};
export const PROVIDERS:Record<string,string>={'workers-ai':'Workers AI','typesafe-api':'TypeSafe API'};
export const OUTCOME_LABEL:Record<string,string>={clear:'Clear',repair:'Repair needed',jury:'Jury question'};
const LAYERS=[['experience','Experience','What you lived through'],['claim','Claim','A specific allegation'],['opinion','Opinion','Your judgment or feeling']] as const;
export function PolicyLine({decision}:{decision:{policyVersion:string;policyDigest?:string}}) {
 return <>Policy {decision.policyVersion}{decision.policyDigest?<>, digest <code className="cx-code">{decision.policyDigest.slice(0,12)}</code></>:null}. <a href={`/moderation/v${decision.policyVersion}.json`} target="_blank" rel="noopener">Inspect the rules{opensNewTab}</a></>;
}
function ScreeningResult({screening,juryOn,juryConsent,text,batch}:{screening:Screening;juryOn:boolean;juryConsent:boolean;text:string;batch:number}) {
 const d=screening.decision;
 if(checksUnavailable(d))return <div className="cx-result cx-result-idle" role="status"><strong>The check is unavailable right now</strong><p>Nothing was decided and nothing was kept. Your draft stays on this device; try the check again later.</p><CheckedCrisisNote resources={screening.resources} text={text}/></div>;
 const title=d.action==='clear'?'Clear for delayed publication':d.action==='repair'?'A repair would help':!juryOn?'This would need an anonymous jury, which is not operational yet':juryConsent?'This would go to an anonymous jury':'This would need an anonymous jury, which you have not allowed to read it';
 return <div className={`cx-result cx-result-${d.action}`} role="status">
  <strong>{title}</strong>
  {d.rules.length>0&&<ul>{d.rules.map((rule,index)=><li key={rule}><span className="cx-rule-id">{rule}</span><span>{d.explanations[index]}</span>{RULE_HINTS[rule]&&<p>{RULE_HINTS[rule]}</p>}</li>)}</ul>}
  {d.action==='clear'&&<p>No rule in the published policy matched. Publication still waits for a random delay and a batch of at least {batch} accounts about this employer.</p>}
  {d.action==='jury'&&<p>{juryOn&&juryConsent?'If you submit it as written, it is held privately while randomly drawn anonymous jurors each answer one question about the rule, reading these words with detected identifying details masked. A jury is drawn once enough eligible jurors are available; until then it stays held, and your receipt says whether a jury was drawn. You can repair or withdraw it at any time.'
  :juryOn?'If you submit it as written, it is held privately and not published, and no juror reads it, because you have not allowed juror review (step 6). You can repair it afterwards on the receipt page; unrepaired held cases are erased after 30 days. You can also change the wording now and check again.'
  :'If you submit it as written, it is held privately and not published. You can repair it afterwards on the receipt page; unrepaired held cases are erased after 30 days. You can also change the wording now and check again.'}</p>}
  <p className="cx-meta">{screening.model?`Checked by ${screening.model}${screening.provider?` via ${PROVIDERS[screening.provider]??screening.provider}`:''}${screening.promptVersion?`, prompt ${screening.promptVersion}`:''}. `:''}<PolicyLine decision={d}/></p>
  <CheckedCrisisNote resources={screening.resources} text={text}/>
 </div>;
}
const sentenceCase=(text:string)=>text.charAt(0).toUpperCase()+text.slice(1);
/** The server's verification label, without middle-dot separators. */
export const verificationLabel=(label:string)=>sentenceCase(label.replace(/\s*\u00b7\s*/g,' for '));
interface Holdings {keys:number;pending:number;jurors:number;issuing:number;}
function describeHoldings(h:Holdings) {
 return [h.keys&&`${h.keys} signing ${h.keys===1?'key':'keys'}`,h.pending&&`${h.pending} unused ${h.pending===1?'proof':'proofs'}`,h.jurors&&`${h.jurors} juror ${h.jurors===1?'token':'tokens'}`,h.issuing&&`${h.issuing} unfinished ${h.issuing===1?'verification':'verifications'}`].filter(Boolean).join(', ');
}
export function SubmitPage() {
 // No employer is chosen for the author, except the fictional example where this deployment has sample employers (the
 // local demonstration). An address such as /submit?employer=<slug> (from a record or a new listing) preselects one.
 const [directory,setDirectory]=useState<DirectoryCompany[]>([]),[keys,setKeys]=useState<ListedKey[]>([]),[config,setConfig]=useState<SiteConfig|null>(null),[slug,setSlug]=useState('');
 // The proof of work before a verification code is sent runs while this is set; the page says so calmly.
 const [working,setWorking]=useState(false),[adding,setAdding]=useState(false),powStop=useRef<AbortController|null>(null);
 useEffect(()=>()=>powStop.current?.abort(),[]);
 const [body,setBody]=useState(''),[layer,setLayer]=useState('experience'),[period,setPeriod]=useState(recentQuarters()[0]!),[answers,setAnswers]=useState<Record<string,string>>({}),[consent,setConsent]=useState(false),[adult,setAdult]=useState(false);
 // Two further permissions, both off until the author checks them: juror review of held words, and publishing sensitive information about themselves.
 const [juryConsent,setJuryConsent]=useState(false),[sensitive,setSensitive]=useState(false);
 const [email,setEmail]=useState(''),[challenge,setChallenge]=useState(''),[code,setCode]=useState(''),[proof,setProof]=useState<Proof|null>(null),[author,setAuthor]=useState<Author|null>(null),[fingerprint,setFingerprint]=useState('');
 const [busy,setBusy]=useState(''),[error,setError]=useState(''),[errorAt,setErrorAt]=useState(''),[screening,setScreening]=useState<Screening|null>(null),[receipt,setReceipt]=useState<Receipt|null>(null),[notice,setNotice]=useState(''),[copied,setCopied]=useState(false),[confirm,setConfirm]=useState('');
 const [keepKey,setKeepKey]=useState(false),[keepProof,setKeepProof]=useState(false),[saved,setSaved]=useState<PendingProof[]>([]),[pendingHandle,setPendingHandle]=useState<string|null>(null);
 const [repairBody,setRepairBody]=useState(''),[repairConsent,setRepairConsent]=useState(false),[repairJury,setRepairJury]=useState(false),[repairSensitive,setRepairSensitive]=useState(false),[keySaved,setKeySaved]=useState(false),[issuing,setIssuing]=useState<Issuing|null>(null),[holdings,setHoldings]=useState<Holdings|null>(null);
 // Opt-in: keep an unfinished mailbox verification on this device, so a reload or a lost reply cannot use up the quarter's credential.
 const [keepIssuing,setKeepIssuing]=useState(false),[unfinished,setUnfinished]=useState<PendingIssuance[]>([]),[resume,setResume]=useState<PendingIssuance|null>(null);
 // Support resources a reply carried (including a refusal), with the words they were for and where on the page they belong.
 const [support,setSupport]=useState<{resources:unknown;text:string;at:'check'|'submit'|'receipt'}|null>(null);
 useEffect(()=>{void Promise.all([fetchDirectory(),loadKeys(),loadConfig()]).then(([companies,list,site])=>{
  const listed=shownDirectory(site,companies),wanted=new URLSearchParams(location.search).get('employer');
  setDirectory(listed);setKeys(list);setConfig(site);
  setSlug(current=>current||(wanted&&listed.some(c=>c.slug===wanted)?wanted:listed.find(c=>c.kind==='sample')?.slug??''));
 }).catch(()=>{setErrorAt('load');setError('Configuration is temporarily unavailable. Your draft stays on this device.');});},[]);
 useEffect(()=>{let live=true;listPendingProofs(slug).then(list=>{if(live)setSaved(list);}).catch(()=>{if(live)setSaved([]);});return ()=>{live=false;};},[slug]);
 useEffect(()=>{let live=true;setResume(null);listIssuances(slug,'contribution').then(list=>{if(live)setUnfinished(list);}).catch(()=>{if(live)setUnfinished([]);});return ()=>{live=false;};},[slug]);
 useEffect(()=>{let live=true;deviceHoldings().then(h=>{if(live)setHoldings(h);}).catch(()=>{if(live)setHoldings(null);});return ()=>{live=false;};},[saved,pendingHandle,keySaved,unfinished,issuing]);
 // A community key never replaces a curated work-mailbox key of the same employer (see chooseIssuerKey).
 const keyChoice=useMemo(()=>{try {return {key:chooseIssuerKey(keys,slug),problem:''};} catch {return {key:undefined,problem:'This employer has more credential keys than the published limit, which could be used to tag visitors. Verification is disabled for it.'};}},[keys,slug]);
 const key=keyChoice.key,company=directory.find(c=>c.slug===slug),verifier=config?.verifierOrigin??'',realEnabled=config?.realPublicationEnabled===true;
 // A real employer needs a work-mailbox key, which exists only once its work domains are configured; a sandbox key never proves employment.
 const unconfigured=company?.kind==='real'&&key?.verificationClass!=='mailbox';
 // An unfinished verification can be finished only with the key it was blinded for.
 const resumable=unfinished.find(u=>key&&u.keyId===key.id&&u.author)??null;
 // Fictional employers are staffed by sandbox juries and real employers by work-mailbox juries; each is switched on separately.
 const juryOn=Boolean(company?.kind==='sample'?config?.moderation?.sandboxJuryEnabled:config?.moderation?.juryEnabled);
 const high=useMemo(()=>scanText(body).some(f=>f.severity==='high'),[body]);
 const repairHigh=useMemo(()=>scanText(repairBody).some(f=>f.severity==='high'),[repairBody]);
 async function run(label:string,work:()=>Promise<void>,extra?:Record<string,string>) {setBusy(label);setError('');setErrorAt(label);setNotice('');try {await work();}catch(e){setError(plainError(e,extra));}finally{setBusy('');}}
 const feedback=(...labels:string[])=><>{error&&labels.includes(errorAt)&&<p role="alert" className="cx-error">{error}</p>}{notice&&labels.includes(errorAt)&&<p role="status" className="cx-notice">{notice}</p>}</>;
 /** Support resources travel with successful replies and with refusals alike; either way they are shown, never stored. */
 async function withSupport<T extends {resources?:unknown}>(at:'check'|'submit'|'receipt',text:string,work:()=>Promise<T>):Promise<T> {
  try {const result=await work();setSupport(result.resources?{resources:result.resources,text,at}:null);return result;}
  catch(e){setSupport(e instanceof ServiceError&&e.resources?{resources:true,text,at}:null);throw e;}
 }
 async function checkedKey(needsMail=false) {
  if(!key)throw new Error('No issuer key is available for this employer yet.');
  if(!verifier)throw new Error('The verifier address is unavailable, so nothing was sent. Reload the page and try again.');
  const checked=await crossCheckKey(verifier,key,needsMail);setFingerprint(await keyFingerprint(checked));return checked;
 }
 async function startMailbox() {
  const issuer=await checkedKey(true);
  // The stamp binds this origin, the key and a digest of the address; the address itself goes only to the verifier.
  // "Stop" beside the calculation's note aborts it before anything is sent.
  const controller=new AbortController();powStop.current=controller;
  try {
   const response=await withPow(()=>powBinding('start',issuer.id,powSubject.email(email)),pow=>send<{challengeId:string}>(`${verifier}/start`,{action:'start',keyId:issuer.id,email,pow}),{bits:verifierPowBits(verifier),working:setWorking,signal:controller.signal});
   setChallenge(response.challengeId);
  } finally {if(powStop.current===controller)powStop.current=null;}
 }
 /** Choosing another employer starts its verification from nothing: no proof, key or code carries over. */
 function chooseEmployer(next:string) {setSlug(next);setProof(null);setAuthor(null);setPendingHandle(null);setIssuing(null);setChallenge('');setCode('');setEmail('');setFingerprint('');}
 /** A listing just added: reload the directory and keys (its keys are created on demand), then choose it. */
 async function chooseListing(company:DirectoryCompany) {
  const [companies,list]=await Promise.all([fetchDirectory().catch(()=>null),loadKeys().catch(()=>null)]);
  const next=shownDirectory(config,companies??[]);
  setDirectory(next.some(c=>c.slug===company.slug)?next:[...(companies?next:directory),company]);
  if(list)setKeys(list);
  chooseEmployer(company.slug);
 }
 async function forgetUnfinished(handle:string|null|undefined) {
  if(!handle)return;
  await deleteIssuance(handle).catch(()=>undefined);
  setUnfinished(list=>list.filter(u=>u.handle!==handle));setResume(r=>r?.handle===handle?null:r);
 }
 async function issueProof() {
  const issuer=await checkedKey(),mailbox=issuer.verificationClass==='mailbox';
  // A retry for the same challenge (for example after a lost response) resends the identical blinded message, which
  // the verifier re-signs; a fresh one would be refused for the rest of the quarter. A verification kept on this device
  // is resent the same way with a new code, since the verifier re-signs the identical message for the same mailbox.
  const kept=mailbox&&resume?.keyId===issuer.id&&resume.author&&resume.states[0]&&resume.blinded[0]?resume:null;
  const retry=mailbox?reusableIssuance(issuing,challenge,issuer.id)??(kept?{challengeId:challenge,keyId:issuer.id,identity:kept.author!,handle:kept.handle,prepared:{blinded:kept.blinded[0]!,state:kept.states[0]!,finalize:(signature:string)=>finalizeBlinding(issuer,kept.states[0]!,signature)}}:null):null;
  // Every new proof binds a fresh signing key: reusing one could link two contributions through the stored author key.
  const identity=retry?.identity??await createAuthor();setAuthor(identity);
  const prepared=retry?.prepared??await prepareProof(issuer,identity.publicKey);
  let handle=retry?.handle??null;
  if(mailbox&&keepIssuing&&!handle) {
   try {handle=await saveIssuance({purpose:'contribution',companySlug:slug,keyId:issuer.id,challengeId:challenge,blinded:[prepared.blinded],states:[prepared.state],author:identity,expiresAt:issuer.expiresAt});}
   catch {throw new Error('The unfinished verification could not be kept on this device, so nothing was sent. Uncheck that option or try again.');}
  }
  if(mailbox)setIssuing({challengeId:challenge,keyId:issuer.id,identity,prepared,handle});
  let result:{blindSignature:string};
  try {result=await send<{blindSignature:string}>(`${verifier}/issue`,{action:'issue',keyId:issuer.id,blinded:prepared.blinded,...(mailbox?{challengeId:challenge,code}:{})});}
  catch(e) {
   // Another request was already signed for this mailbox this quarter, so this one can never be finished.
   if(e instanceof ServiceError&&e.code==='credential_already_issued_this_period'){setIssuing(null);await forgetUnfinished(handle);}
   // A pause or a used-up employer limit refuses before anything is signed. A request made just now was never signed
   // for anyone, so it is not worth keeping; one resumed from this device may have been signed earlier, so it stays.
   else if(e instanceof ServiceError&&PAUSED.includes(e.code)&&!retry){setIssuing(null);await forgetUnfinished(handle);}
   throw e;
  }
  const finished=await prepared.finalize(result.blindSignature);
  setIssuing(null);setProof(finished);setEmail('');setCode('');
  await forgetUnfinished(handle);
  if(keepProof)try {setPendingHandle(await savePendingProof({companySlug:slug,keyId:issuer.id,expiresAt:issuer.expiresAt,proof:finished,author:identity}));setNotice('The proof is kept on this device until you submit it or delete it.');}catch{setError('The proof is ready but could not be kept on this device. Submit it before leaving this page.');}
 }
 async function keepCurrentProof() {
  if(!proof||!author||!key)return;
  setPendingHandle(await savePendingProof({companySlug:slug,keyId:proof.keyId,expiresAt:key.expiresAt,proof,author}));
  setNotice('The proof is kept on this device. You can close this page and submit later, before the proof expires.');
 }
 function applySavedProof(entry:PendingProof) {setProof(entry.proof);setAuthor(entry.author);setPendingHandle(entry.handle);}
 async function discardSavedProof(entry:PendingProof) {await deletePendingProof(entry.handle);setSaved(list=>list.filter(p=>p.handle!==entry.handle));if(pendingHandle===entry.handle){setPendingHandle(null);setProof(null);setAuthor(null);}}
 async function screen() {const text=body;setScreening(await withSupport('check',text,()=>send<Screening>('/api/screen',{approvedText:text,consent:true})));}
 async function contribute() {
  if(!proof||!author||!adult)return;
  let result:Receipt&{accepted:boolean;resources?:unknown};
  // adultConfirmed and the two permissions are sent exactly as the author set them; the server enforces the first.
  try {result=await withSupport('submit',body,()=>send<Receipt&{accepted:boolean;resources?:unknown}>('/api/submit',{companySlug:slug,layer,body,period,proof,structured:answers,publicationConsent:true,screeningConsent:true,adultConfirmed:true,juryReviewConsent:juryConsent,sensitiveConsent:sensitive}));}
  catch(e){
   // A spent proof is useless, and its signing key may already be bound to an accepted contribution: drop both.
   if(e instanceof ServiceError&&e.code==='credential_already_redeemed'){if(pendingHandle){const handle=pendingHandle;await deletePendingProof(handle).catch(()=>undefined);setSaved(list=>list.filter(p=>p.handle!==handle));}setPendingHandle(null);setProof(null);setAuthor(null);}
   throw e;
  }
  setReceipt({...result,revision:0,juryReviewConsent:juryConsent,sensitiveConsent:sensitive});setRepairJury(juryConsent);setRepairSensitive(sensitive);setSupport(result.resources?{resources:result.resources,text:body,at:'receipt'}:null);setRepairBody(body);setBody('');setProof(null);
  if(pendingHandle){const handle=pendingHandle;await deletePendingProof(handle).catch(()=>undefined);setPendingHandle(null);setSaved(list=>list.filter(p=>p.handle!==handle));}
  if(keepKey)try {await saveAuthor(result.capability,author.privateKey);setKeySaved(true);}catch{setError('Your contribution was accepted, but the signing key could not be kept on this device. Keep the withdrawal capability below.');}
 }
 async function repairReceipt() {
  if(!receipt||!author)return;
  const result=await withSupport('receipt',repairBody,()=>revise(receipt.capability,receipt.revision,repairBody,{juryReviewConsent:repairJury,sensitiveConsent:repairSensitive},author.privateKey));
  setReceipt({...receipt,status:result.status??receipt.status,revision:result.revision??receipt.revision,decision:result.decision??receipt.decision,repairable:Boolean(result.repairable),releasePolicy:result.releasePolicy??receipt.releasePolicy,publicationPaused:result.publicationPaused??receipt.publicationPaused,juryOpen:result.juryOpen,juryReviewConsent:repairJury,sensitiveConsent:repairSensitive});
  setRepairConsent(false);
  setNotice(repairNotice(result.status));
 }
 async function withdrawReceipt() {
  if(!receipt)return;
  const result=await withdrawByCapability(receipt.capability);
  // Erasure resets both permissions with the words, so the receipt no longer states them.
  setReceipt({...receipt,status:result.status,juryReviewConsent:false,sensitiveConsent:false});setKeySaved(false);setConfirm('');setNotice(result.message);
 }
 async function forgetEverything() {
  await forgetDevice();
  setSaved([]);setPendingHandle(null);setKeySaved(false);setUnfinished([]);setResume(null);setHoldings({keys:0,pending:0,jurors:0,issuing:0});setConfirm('');
  setNotice('The signing keys, proofs, unfinished verifications and juror tokens this site kept on this device were deleted, along with the browser database that held them.');
 }
 // The receipt replaces the form: it opens at the top, and focus moves to its heading so the outcome is announced.
 const receiptTitle=useRef<HTMLHeadingElement>(null),receiptShown=receipt?.capability??null;
 useEffect(()=>{
  if(!receiptShown)return;
  // 'instant': the site scrolls smoothly by default, and the new page should simply start at its top.
  window.scrollTo({top:0,left:0,behavior:'instant'});
  receiptTitle.current?.focus({preventScroll:true});
 },[receiptShown]);
 const setDraft=(value:string)=>{setBody(value);setScreening(null);};
 const unavailable=checksUnavailable(screening?.decision);
 const rules=publicationRules(config);
 const needs=[!company&&'choosing the employer (step 1)',body.length<40&&'at least 40 characters in your account',high&&'changing the details marked “must change”',!consent&&'your approval for the Jev check (step 4)',unavailable?'a completed check (the last one was unavailable)':screening?.decision.action==='repair'&&'a repair, then a new check',!proof&&(unconfigured?'verification for this employer, which isn’t set up yet':'a proof of your relationship (step 5)'),!adult&&`confirming you are ${MINIMUM_AGE} or older`].filter((n):n is string=>Boolean(n));
 if(receipt){
  const erased=receipt.status==='withdrawn'||receipt.status==='expired',held=receipt.status==='held'&&!erased;
  // The server says whether a jury was drawn (juryOpen); without that fact the heading claims neither, and releasePolicy explains.
  const heading=erased?(receipt.status==='expired'?'Expired and erased.':'Withdrawn and erased.'):held?(receipt.juryOpen===true?'Held privately for an anonymous jury.':receipt.juryOpen===false?(juryOn&&receipt.juryReviewConsent&&receipt.decision.action==='jury'?'Held privately until a jury can be drawn.':'Held privately: no jury is operational.'):'Held privately.'):receipt.publicationPaused?'Accepted and held: real-employer publication is paused.':'Accepted for a delayed batch release.';
  return <main id="main" className="page contribute"><a className="cx-back" href="/">Back to the evidence</a><section className="cx-receipt" aria-labelledby="receipt-title">
   <p className="cx-overline">Your private receipt</p><h1 id="receipt-title" ref={receiptTitle} tabIndex={-1}>{heading}</h1>{!erased&&<p className="cx-lede">{receipt.releasePolicy}</p>}
   {support?.at==='receipt'&&<CheckedCrisisNote key={`${receipt.revision}`} resources={support.resources} text={support.text}/>}
   <dl className="cx-facts"><div><dt>Verification</dt><dd>{verificationLabel(receipt.verificationClass)}</dd></div><div><dt>Screening outcome</dt><dd>{OUTCOME_LABEL[receipt.decision.action]??receipt.decision.action}{receipt.decision.rules.length?` (${receipt.decision.rules.join(', ')})`:''}</dd></div><div><dt>Rules applied</dt><dd><PolicyLine decision={receipt.decision}/></dd></div>{erased?<div><dt>Your permissions</dt><dd>Erased with the words: juror review and the statement about sensitive information no longer apply.</dd></div>:<><div><dt>Juror review</dt><dd>{receipt.juryReviewConsent?'Allowed: if these words are held for a jury, anonymous jurors may read them with detected identifying details masked.':'Not allowed: held words are never shown to jurors.'}</dd></div><div><dt>Sensitive information about you</dt><dd>{receipt.sensitiveConsent?'You stated these words may reveal it and chose to publish it.':'Not stated.'}</dd></div></>}</dl>
   {held&&<section className="cx-card cx-repair" aria-labelledby="repair-title"><h2 id="repair-title">Repair this case</h2><p>Change the wording and resubmit. The new words are checked on this device and screened again; if they are clear, they replace the held version. {keySaved?'This device keeps the signing key, so you can also repair it later from the status page.':'Repair is possible only while this page is open, because no signing key was kept on this device.'}</p>
    <PrivacyEditor id="repair-draft" label="Repaired words" value={repairBody} onChange={setRepairBody}/>
    <label className="cx-check"><input type="checkbox" checked={repairConsent} onChange={e=>setRepairConsent(e.target.checked)}/><span>I approve sending these revised words to hosted Jev for the same narrow checks.</span></label>
    <JuryReviewConsent checked={repairJury} onChange={setRepairJury}/>
    <SensitiveConsent checked={repairSensitive} onChange={setRepairSensitive}/>
    <button type="button" className="cx-btn cx-btn-primary" disabled={!!busy||!repairConsent||repairHigh||repairBody.length<40||!author} onClick={()=>void run('Repairing',repairReceipt)}>{busy==='Repairing'?'Screening…':'Screen and resubmit the repaired words'}</button>{feedback('Repairing')}</section>}
   <h2>Keep your withdrawal capability.</h2><p>It is shown once. There is no account and no email recovery. {keySaved?'This device also keeps a signing key for this contribution, stored under a value derived from the capability.':'No receipt, id or key for this contribution was stored on this device.'}</p>
   <code className="cx-capability">{receipt.capability}</code>
   <div className="cx-actions"><button type="button" className="cx-btn cx-btn-primary" onClick={()=>void navigator.clipboard.writeText(receipt.capability).then(()=>setCopied(true),()=>{setErrorAt('Copy');setError('The browser blocked copying. Select the capability and copy it yourself.');})}>{copied?'Copied':'Copy capability'}</button>
    {!erased&&(confirm==='withdraw'?<><button type="button" className="cx-btn cx-btn-danger" disabled={!!busy} onClick={()=>void run('Withdrawing',withdrawReceipt)}>{busy==='Withdrawing'?'Withdrawing…':'Withdraw and erase it'}</button><button type="button" className="cx-link" onClick={()=>setConfirm('')}>Keep it</button></>:<button type="button" className="cx-link" onClick={()=>setConfirm('withdraw')}>Withdraw this contribution</button>)}</div>
   {confirm==='withdraw'&&!erased&&<p className="cx-hint">Withdrawing erases its text and survey answers, and removes it from the public record if it was published. Copies other people made cannot be recalled.</p>}
   {feedback('Withdrawing','Copy')}
   <p className="cx-note">To check it later, open the <a href="/status" target="_blank" rel="noopener">status page{opensNewTab}</a> and paste the capability. It shows the status and receipts, and lets you repair, appeal or withdraw.</p>
  </section></main>;
 }
 return <main id="main" className="page contribute"><a className="cx-back" href="/">Back to the evidence</a>
  <header className="cx-hero"><h1>Say what happened.{' '}<span>Keep who you are private.</span></h1><p>Write on this device. On-device checks mark details that could identify you or someone else, and nothing is changed unless you approve that edit. Nothing leaves this browser until you ask for a check or submit, and your email goes only to the separate verifier.</p></header>
  {feedback('load')}
  <div className="cx-layout"><div className="cx-flow">
  <section className="cx-card" aria-labelledby="step-1"><div className="cx-step"><span className="cx-step-n" aria-hidden="true">1</span><h2 id="step-1">The workplace</h2></div>
   <label className="cx-field" htmlFor="employer">Employer</label>
   <select id="employer" className="cx-select" value={slug} onChange={event=>chooseEmployer(event.target.value)}>{!company&&<option value="" disabled>Choose the employer</option>}{[...directory].sort((a,b)=>(a.kind===b.kind?0:a.kind==='real'?-1:1)||a.name.localeCompare(b.name,'en',{sensitivity:'base',numeric:true})).map(c=><option key={c.slug} value={c.slug}>{c.kind==='sample'?`${c.name} (fictional example)`:employerLabel(c)}</option>)}</select>
   {adding?<AddEmployer directory={directory} powBits={listingPowBits(config)} rules={publicationRules(config)} onListed={company=>void chooseListing(company)} onClose={()=>setAdding(false)} context="contribute"/>
   :listingOpen(config)&&<p className="cx-note">Not listed? <button type="button" className="cx-link cx-inline-link" onClick={()=>setAdding(true)}>Add your employer</button> with its work-email domain. Anyone can list an employer; listing it reveals nothing about you.</p>}
   {isCommunity(company)&&<p className="cx-note">{listingName(company!)} was {COMMUNITY_LABEL.toLowerCase()}. Verification accepts work mailboxes at {domainOf(company)??'its listed domain'} only.</p>}
   {!isCommunity(company)&&communitySupplied(company,domainOf(company))&&<p className="cx-note">{company!.name}’s work-email domain, {domainOf(company)}, was {COMMUNITY_LABEL.toLowerCase()}.</p>}
   {company?.kind==='sample'&&<p className="cx-fiction">Fictional example employer. It exercises the protocol with sandbox credentials and is labeled fictional wherever it appears.</p>}
   {company?.kind==='real'&&unconfigured&&!keyChoice.problem&&<p className="cx-notice">{VERIFICATION_NOT_SET_UP}</p>}
   {company?.kind==='real'&&!unconfigured&&!realEnabled&&<p className="cx-notice">Real-employer publication is paused. You may verify a work mailbox and submit; accepted cases are held privately, cannot be published by an admin override, and are erased if not published within 180 days.</p>}
   <div className="cx-layers" role="group" aria-label="Type of testimony">{LAYERS.map(([id,title,hint])=><button type="button" key={id} className={layer===id?'is-selected':''} aria-pressed={layer===id} onClick={()=>setLayer(id)}><strong>{title}</strong><span>{hint}</span></button>)}</div>
  </section>
  <section className="cx-card cx-card-editor" aria-labelledby="step-2"><div className="cx-step"><span className="cx-step-n" aria-hidden="true">2</span><h2 id="step-2">Your account</h2></div>
   <PrivacyEditor id="testimony-draft" label="What happened?" value={body} onChange={setDraft} placeholder="Describe the workplace behavior you experienced. Avoid names, exact dates and details that single you out." description="Checked on this device as you type. Marked words are explained below, one at a time, and change only when you approve."/>
   <label className="cx-field" htmlFor="period">Broad reporting period</label>
   <select id="period" className="cx-select" value={period} onChange={e=>setPeriod(e.target.value)}>{recentQuarters().map(p=><option key={p}>{p}</option>)}</select>
  </section>
  <section className="cx-card" aria-labelledby="step-3"><div className="cx-step"><span className="cx-step-n" aria-hidden="true">3</span><h2 id="step-3">A few optional structured answers</h2></div>
   <p className="cx-note">Answers count toward an employer’s record only in a privacy-safe release. {aggregatesRule(rules)} Skipped questions are left out of the denominator.</p>
   <div className="cx-survey">{survey.map(item=><label key={item.key} className="cx-field-inline"><span>{item.label}</span><select className="cx-select" value={answers[item.key]??''} onChange={e=>setAnswers(previous=>{const next={...previous};if(e.target.value)next[item.key]=e.target.value;else delete next[item.key];return next;})}><option value="">Prefer not to answer</option>{item.options.map(option=><option key={option}>{option}</option>)}</select></label>)}</div>
  </section>
  <section className="cx-card" aria-labelledby="step-4"><div className="cx-step"><span className="cx-step-n" aria-hidden="true">4</span><h2 id="step-4">Contextual check by Jev</h2></div>
   <p>The on-device checks recognise patterns. Jev, the hosted model, reads the words you approved for what patterns miss: combinations of details that could identify you or someone else, threats, attacks and spam. It answers narrow questions from the published policy. It does not rewrite your words or write anything for you.</p>
   <label className="cx-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I approve sending this locally checked draft to hosted Jev for these checks. Detectors can miss contextual clues. My email, proof and signing key are never included.</span></label>
   <button type="button" className="cx-btn" disabled={!consent||high||body.length<40||!!busy} onClick={()=>void run('Checking',screen)}>{busy==='Checking'?'Checking policy conditions…':'Check the approved draft'}</button>
   {high&&<p className="cx-hint">Change the details marked “must change” first. They never leave this device.</p>}
   {feedback('Checking')}
   {!screening&&support?.at==='check'&&<CheckedCrisisNote resources={support.resources} text={support.text}/>}
   {screening&&<ScreeningResult screening={screening} juryOn={juryOn} juryConsent={juryConsent} text={body} batch={rules.batch}/>}
  </section>
  <section className="cx-card" aria-labelledby="step-5"><div className="cx-step"><span className="cx-step-n" aria-hidden="true">5</span><h2 id="step-5">Prove the relationship, not your identity</h2></div>
   <p className="cx-note">Getting a proof and submitting within the same minute, from the same network, lets anyone who can see traffic to both services pair the two. You can keep the finished proof on this device and submit later, before it expires, ideally from a different network. <a href="/privacy" target="_blank" rel="noopener">How timing is handled{opensNewTab}</a></p>
   {saved.length>0&&!proof&&<div className="cx-proof"><span className="cx-proof-icon" aria-hidden="true"/><div><strong>A proof kept on this device is available for this employer.</strong><p>It is single use and expires {saved[0]!.expiresAt.slice(0,10)}.</p><div className="cx-actions"><button type="button" className="cx-btn" disabled={!!busy} onClick={()=>applySavedProof(saved[0]!)}>Use the kept proof</button><button type="button" className="cx-link" disabled={!!busy} onClick={()=>void run('Deleting',()=>discardSavedProof(saved[0]!))}>Delete it from this device</button></div></div></div>}
   {keyChoice.problem?<p className="cx-notice">{keyChoice.problem}</p>
   :unconfigured?<p className="cx-notice">Verification for this employer isn’t set up yet, so no proof can be issued for it.</p>
   :!key?<p className="cx-notice">No issuer key is available for this employer yet.</p>
   :proof?<div className="cx-proof is-ready"><span className="cx-proof-icon" aria-hidden="true">✓</span><div><strong>{key.verificationClass==='demo'?'Sandbox proof ready':'Work-mailbox proof ready'}</strong><p>Blind-signed and single use. The publisher checks it without contacting the verifier.{pendingHandle?' It is kept on this device until you submit it or delete it.':''}</p>{fingerprint&&<p className="cx-note">Key fingerprint <code className="cx-code">{fingerprint}</code>. {keyTrust(key)} Everyone should see the same fingerprint, so you can compare it on another device or network.</p>}{!pendingHandle&&<button type="button" className="cx-link" disabled={!!busy} onClick={()=>void run('Keeping proof',keepCurrentProof)}>Keep this proof on this device and submit later</button>}</div></div>
   :<>
    <label className="cx-check"><input type="checkbox" checked={keepProof} onChange={e=>setKeepProof(e.target.checked)}/><span><b>Keep the finished proof on this device so I can submit later.</b> Off by default. {DEVICE_WARNING}</span></label>
    {key.verificationClass==='mailbox'&&resumable&&resume?.handle!==resumable.handle&&<div className="cx-proof"><span className="cx-proof-icon" aria-hidden="true"/><div><strong>An unfinished verification is kept on this device for this employer.</strong><p>If the verifier signed it but the answer never arrived, finishing it gets the same credential, so this quarter’s is not used twice. Use the same work email as before; a new code works.</p><div className="cx-actions"><button type="button" className="cx-btn" disabled={!!busy} onClick={()=>{setResume(resumable);setIssuing(null);setChallenge('');setCode('');}}>Finish it</button><button type="button" className="cx-link" disabled={!!busy} onClick={()=>void run('Deleting',()=>forgetUnfinished(resumable.handle))}>Delete it from this device</button></div></div></div>}
    {key.verificationClass==='mailbox'&&resume&&<p className="cx-notice">Finishing the verification kept on this device. The verifier is sent the same request as before.</p>}
    {key.verificationClass==='mailbox'&&!resume&&<label className="cx-check"><input type="checkbox" checked={keepIssuing} onChange={e=>setKeepIssuing(e.target.checked)}/><span><b>Keep this verification on this device until the proof is finished, so a reload or a lost connection cannot use up this quarter’s credential.</b> Off by default. It links the verifier’s request to your finished proof, so it is deleted as soon as the proof is finished, and it never holds your email or code. {DEVICE_WARNING}</span></label>}
    {key.verificationClass==='demo'?<><p>This fictional employer uses a sandbox credential. It exercises the cryptographic protocol but does not prove employment.</p><button type="button" className="cx-btn" disabled={!!busy||!verifier} onClick={()=>void run('Creating proof',issueProof,ISSUE_ERRORS)}>{busy==='Creating proof'?'Creating…':'Create a sandbox proof'}</button></>
    :<><p>A message goes to your work mailbox, and employers may monitor it. The proof shows mailbox access, not current employment or unique identity. Each mailbox can receive one credential per employer per quarter.</p>
     {!challenge?<><label className="cx-field" htmlFor="work-email">Work email, sent only to the verifier</label><input id="work-email" className="cx-input" type="email" value={email} autoComplete="off" spellCheck={false} onChange={e=>setEmail(e.target.value)} placeholder="you@employer.com"/><button type="button" className="cx-btn" disabled={!!busy||!email.includes('@')||!verifier} onClick={()=>void run('Sending code',startMailbox,ISSUE_ERRORS)}>{busy==='Sending code'?(working?'Preparing the request…':'Sending…'):'Send verification code'}</button>{working&&<PowNote onStop={()=>powStop.current?.abort()}/>}</>
     :<><p className="cx-note">A code is on its way. It lasts 15 minutes. If a credential was already issued to this mailbox this quarter, the code cannot produce another one. Requests for one mailbox pause for 15 minutes after three, whoever sends them, so if nothing arrives, wait 15 minutes before asking again.</p><label className="cx-field" htmlFor="mail-code">Code from your mailbox</label><input id="mail-code" className="cx-input cx-mono" inputMode="numeric" autoComplete="one-time-code" spellCheck={false} value={code} maxLength={6} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/><button type="button" className="cx-btn" disabled={!!busy||code.length!==6} onClick={()=>void run('Verifying',issueProof,ISSUE_ERRORS)}>{busy==='Verifying'?'Verifying…':'Verify and receive a blind credential'}</button></>}</>}
   </>}
   {feedback('Deleting','Keeping proof','Creating proof','Sending code','Verifying')}
  </section>
  <section className="cx-card cx-submit" aria-labelledby="step-6"><div className="cx-step"><span className="cx-step-n" aria-hidden="true">6</span><h2 id="step-6">Submit your approved words</h2></div>
   <fieldset className="cx-permissions"><legend>Optional permissions, each off until you check it</legend>
    <label className="cx-check"><input type="checkbox" checked={keepKey} onChange={e=>setKeepKey(e.target.checked)}/><span><b>Keep this contribution’s signing key on this device so I can repair a held case later.</b> {DEVICE_WARNING} Withdrawal with the capability works either way.</span></label>
    <JuryReviewConsent checked={juryConsent} onChange={setJuryConsent}/>
    <SensitiveConsent checked={sensitive} onChange={setSensitive}/>
   </fieldset>
   <label className="cx-check cx-check-strong"><input type="checkbox" checked={adult} onChange={e=>setAdult(e.target.checked)}/><span>I am {MINIMUM_AGE} or older and I agree to the <a href="/terms" target="_blank" rel="noopener">Terms of Use{opensNewTab}</a>. The <a href="/privacy" target="_blank" rel="noopener">Privacy Policy{opensNewTab}</a> explains what is kept and for how long.</span></label>
   <button type="button" className="cx-btn cx-btn-primary cx-btn-large" disabled={needs.length>0||!!busy} onClick={()=>void run('Submitting',contribute,samplesOn(config,directory)?SAMPLE_ERRORS:undefined)}>{busy==='Submitting'?'Submitting…':'Submit my approved words'}</button>
   {needs.length>0&&<p className="cx-hint">Still needed: {needs.join('; ')}.</p>}
   <p className="cx-note">Nothing publishes instantly, and the published policy applies. {accountsRule(rules)} {aggregatesRule(rules)}</p>
   {feedback('Submitting')}
   {support?.at==='submit'&&<CheckedCrisisNote resources={support.resources} text={support.text}/>}
  </section>
  {holdings&&holdings.keys+holdings.pending+holdings.jurors+holdings.issuing>0&&<section className="cx-card cx-device" aria-labelledby="device-title"><h2 id="device-title">Kept on this device</h2><p>This browser keeps {describeHoldings(holdings)} for this site, because you chose to keep them. {DEVICE_WARNING}</p>
   {confirm==='forget'?<div className="cx-actions"><button type="button" className="cx-btn cx-btn-danger" disabled={!!busy} onClick={()=>void run('Forgetting',forgetEverything)}>Delete them from this device</button><button type="button" className="cx-link" onClick={()=>setConfirm('')}>Keep them</button></div>:<button type="button" className="cx-link" onClick={()=>setConfirm('forget')}>Remove everything this site kept on this device</button>}
   {confirm==='forget'&&<p className="cx-hint">Without a kept signing key, a held case can no longer be repaired from this device. Withdrawal with the capability still works.</p>}
  </section>}
  {feedback('Forgetting')}
 </div><aside className="cx-rail" aria-label="How this works">
  <div><h2>Proof, without a profile.</h2><ol><li><strong>Your browser</strong><p>Your draft and every edit you approve. Keys and proofs stay in memory unless you choose to keep them on this device.</p></li><li><strong>The verifier</strong><p>Mailbox challenge and a blind signature. No testimony.</p></li><li><strong>The record</strong><p>Approved words and a proof. No email or issuance request.</p></li></ol><a href="/privacy" target="_blank" rel="noopener">Inspect the limits{opensNewTab}</a></div>
  <div><h2>Criticism is not a violation.</h2><p>Claims remain attributed accounts. Positive or negative sentiment never selects a moderation action.</p><a href="/moderation" target="_blank" rel="noopener">Read the executable policy{opensNewTab}</a></div>
  <div><h2>Already contributed?</h2><p>Check the status and receipts, repair, appeal or withdraw with your capability.</p><a href="/status" target="_blank" rel="noopener">Open the status page{opensNewTab}</a></div>
 </aside></div></main>;
}
