import {z} from 'zod';
import {scanText,identifies} from '../../shared/privacy.ts';
import {proofSchema,digest,decode,randomToken,quarter,recentQuarters,verifyAuthor,authorMessage} from '../../shared/proof.ts';
import {validateSurvey,aggregateAnswers,survey} from '../../shared/survey.ts';
import {inspectCredential} from './credentials.ts';
import type {Env} from './types.ts';
import {decide,policy,policyVersions,currentPolicyDigest,riskSignals,type PolicyDecision} from '../../shared/policy.ts';
import {LEGAL_EFFECTIVE} from '../../shared/brand.ts';
import {openScreeningCases,mootCases,countModeration,moderationContext,shuffled,forgetCases,finalResults,recheckWithheld,juryRuleIds} from './moderation.ts';
import {samplesEnabled,testimonyBatchMin,aggregateMinimum} from './flags.ts';

const HELD_DAYS=policy.retention.heldDays, APPROVED_DAYS=policy.retention.approvedUnbatchedDays, RERELEASE_CHANGES=policy.retention.aggregateRereleaseChanges, RECOVER_AFTER_MS=20*60000;
/** Questionnaire aggregates: groups and answers of at least MIN_COHORT_N (25). Written accounts batch by testimonyBatchMin (5). */
const minimum=(env:Env)=>aggregateMinimum(env);
const day=(date=new Date())=>date.toISOString().slice(0,10);
export const paused=(env:Env,verificationClass:string)=>verificationClass!=='demo' && env.REAL_PUBLICATION_ENABLED!=='true';
// Erasure keeps only what idempotent withdrawal and coarse counts need: no text, answers, author key, text hash, consents
// or exact dates. erased_month (a UTC month) starts the 12-month clock after which scrubErased removes the rest.
const ERASE="body='',answers_json='{}',privacy_json='[]',content_hash=NULL,author_key_json='{}',created_day=NULL,eligible_at=NULL,held_on=NULL,hold_reason=NULL,batch_id=NULL,public_meta=NULL,jury_consent=0,sensitive_consent=0,erased_month=strftime('%Y-%m','now')";
// At publication the public record holds the text; intake keeps only the answers (for aggregation) and the author key (for withdrawal).
const PUBLISHED_ERASE="body='',privacy_json='[]',content_hash=NULL,eligible_at=NULL,created_day=NULL,held_on=NULL,hold_reason=NULL,batch_id=NULL,public_meta=NULL";
/** Which model decided, when a decision outside submission screening (a challenge re-check) came from one. */
export interface Provenance {provider:string|null;providerFallback:string|null;keySource:string|null;model:string|null;promptVersion:string|null;}
/** A decision made outside automated screening (a jury, a challenge re-check, trustees) pins the policy it was made under, and the model if one decided. */
export interface Pin {policyVersion:string;policyDigest:string;rules:string[];provenance?:Provenance;}
/**
 * Every consent is an explicit field the server checks; none has a default, so a client that never showed the choice
 * cannot submit. adultConfirmed: the author confirmed they are 18 or older. juryReviewConsent: the author allows
 * anonymous jurors to read these words, masked, if screening holds them for a jury (true or false, never assumed).
 * sensitiveConsent: the author's explicit choice (GDPR Article 9(2)(a)) to publish sensitive information about
 * themselves, stored only as a boolean on this row and erased with it; false is a valid answer.
 */
export const submitSchema=z.object({companySlug:z.string().max(90),layer:z.enum(['experience','claim','opinion']),body:z.string().min(40).max(4000),period:z.string().regex(/^20\d{2}-Q[1-4]$/),proof:proofSchema,structured:z.record(z.string(),z.string()).default({}),publicationConsent:z.literal(true),screeningConsent:z.literal(true),adultConfirmed:z.literal(true),juryReviewConsent:z.boolean(),sensitiveConsent:z.boolean()}).strict();
export interface SubmissionRow {id:string;public_id:string|null;company_id:string;company_slug:string;body:string;layer:string;period:string;answers_json:string;author_key_json:string;capability_hash:string;content_hash:string|null;verification_class:string;status:string;eligible_at:string|null;publication_period:string;revision:number;privacy_json:string;created_day:string|null;held_on:string|null;hold_reason:string|null;batch_id:string|null;op_token:string|null;public_meta?:string|null;jury_consent?:number|null;sensitive_consent?:number|null;erased_month?:string|null;}
interface Group {company_id:string;period:string;verification_class:string;}
/**
 * Written accounts are batched per employer and verification type (policy 0.8.0), across reporting periods. An account
 * submitted before the current legal version took effect (legacy) keeps the rule it was accepted under (legal 1.1.0,
 * policy 0.7.0): it is batched only with other legacy accounts of the same reporting period too (period set).
 */
interface PublicationGroup {company_id:string;verification_class:string;period?:string|null;legacy?:boolean;}
/** selfHarmResources is transient: it only lets the site offer support resources to this author and is never logged, stored or used as a policy signal. */
export interface Screening {decision:PolicyDecision;provider:string|null;model:string|null;promptVersion:string|null;providerFallback:string|null;keySource:string|null;selfHarmResources?:true;}
export type AuthorResult={ok:boolean;error?:string;status?:string;revision?:number;decision?:PolicyDecision;repairable?:boolean;releasePolicy?:string;publicationPaused?:boolean;juryOpen?:boolean;selfHarmResources?:true};
/**
 * The inference worker's self-harm answer, passed beside a reply only so app.ts can offer support resources (withResources
 * strips it). It is never stored, logged, put in a decision or receipt, or used by decide().
 */
const resourcesFlag=(screened:Screening)=>screened.selfHarmResources===true?{selfHarmResources:true as const}:{};
/** The jury facts receipt copy depends on (see moderationContext), so every response describes the case's real state. */
export interface ReleaseContext {juryOpen?:boolean;juryPending?:boolean;juryDeclined?:boolean;juryRuleRetired?:boolean;appealAvailable?:boolean;appealOpen?:boolean;appealDecided?:boolean;}
export function eligibility(now:Date,random=crypto.getRandomValues(new Uint32Array(1))[0]!/4294967296) {
 const delayed=now.getTime()+(12+random*54)*3600000;
 return new Date(Math.ceil(delayed/(6*3600000))*6*3600000).toISOString();
}
/**
 * Receipt copy states exactly what will happen and why, for the case's real state: whether a jury is deciding, what a
 * decision means, whether an appeal is open to the author, and every time limit.
 */
export function releasePolicy(status:string,publicationPaused:boolean,holdReason:string|null='jury',context:ReleaseContext={},batch:number|BatchRule=policy.retention.minimumBatch) {
 const rule:BatchRule=typeof batch==='number'?{size:batch,legacy:false}:batch;
 const withdraw=' You can withdraw at any time with your capability.';
 const repair=`You can repair it by submitting revised words, which are screened again. Unrepaired held cases are erased after ${HELD_DAYS} days.${withdraw}`;
 const deciding=`If every rule is cleared, it rejoins publication with its original release time; if a rule is upheld, you can repair it or appeal once. If no jury decision is reached within ${policy.jury.noQuorumAfterDays} days, the case is erased like any unrepaired held case. You can repair it at any time: new words end this case and are screened again.${withdraw}`;
 if(status==='held' && holdReason==='privacy_rescan') return `A check just before publication found a detail in these words that could identify someone, so this case is held privately and will not be published as written. ${repair}`;
 if(status==='held' && holdReason==='challenge_repair') return `After a challenge, a re-check of this published account under the current policy found a detail that could identify someone or met a rule's threshold for repair (your receipt names which), so it is withheld privately and no longer published. A repaired version is published again only in a new batch. ${repair}`;
 if(status==='held' && holdReason==='exception') return `Two of three independent trustees signed a time-limited exception (a legal order or an imminent-safety issue) naming this account, so it is withheld until the exception expires. It is then restored under its original public id, or returns to the approved queue while real-employer publication is paused. It cannot be revised while the exception is active.${withdraw}`;
 if(status==='held' && holdReason==='jury_upheld') {
  const appeal=context.appealOpen?` An appeal is open: ${policy.jury.appeal} newly drawn jurors, who are not shown the first result, are deciding. Their decision is final.`:context.appealAvailable?` You can appeal once: ${policy.jury.appeal} newly drawn jurors, who are not shown the first result, decide again, and their decision is final.`:context.appealDecided?' Your appeal did not overturn this result, so it is final for these words.':'';
  return `An anonymous jury found that these words break a published rule, so this case is held privately and will not be published as written.${appeal} ${repair}`;
 }
 if(status==='held' && holdReason==='jury_no_quorum') return `An anonymous jury was drawn for this case but did not reach a decision within ${policy.jury.noQuorumAfterDays} days, so it is held privately and will not be published as written. Held cases are kept for at most ${HELD_DAYS} days, so it will be erased within about a day unless you repair it first by submitting revised words, which are screened again.${withdraw}`;
 if(status==='held' && context.juryOpen) return `An anonymous jury of ${policy.jury.initial} randomly drawn jurors is deciding whether these words break the rule or rules they were held under. Until it decides, the case is held privately and is not published. ${deciding}`;
 if(status==='held' && context.juryPending) return `This case is waiting for an anonymous jury of ${policy.jury.initial} randomly drawn jurors, which the scheduled job opens within about 6 hours. Until a jury decides, the case is held privately and is not published. ${deciding}`;
 if(status==='held' && context.juryRuleRetired) return `These words were held for an anonymous jury under a rule that does not go to a jury under the current policy (${policy.version}), so no jury will decide this case: it is held privately and will not be published as written. Revised words, or the same words submitted again, are screened under the current policy. ${repair}`;
 if(status==='held' && context.juryDeclined) return `You did not allow anonymous jurors to read these words, so no jury will decide this case: it is held privately and will not be published as written. To have a jury decide, submit the words again with juror review allowed. ${repair}`;
 if(status==='held') return `No anonymous jury is operational for this kind of case yet, so it is held privately and will not be published as written. ${repair}`;
 if(status==='published') return `Published as attributed testimony.${withdraw}`;
 if(status==='publishing') return `Being published in a batch now.${withdraw}`;
 if(status==='withdrawn') return 'Withdrawn and erased.';
 if(status==='expired') return 'Erased, because it was neither published nor repaired within the stated time limits.';
 if(publicationPaused) return `Accepted and held privately. Publication for real employers is paused, so this will not be published until publication is enabled. If it has not been published within ${APPROVED_DAYS} days of submission, the text and answers are erased.${withdraw}`;
 return `Eligible after screening and a random 12–72-hour window, then published only in a batch of at least ${rule.size} approved accounts ${rule.legacy?`submitted before ${longDay(LEGAL_EFFECTIVE)} for the same employer, reporting period and verification type, the rule it was accepted under`:'for the same employer and verification type'}. Questionnaire answers are published only as percentages for groups of at least ${policy.retention.aggregateMinimum}. If no batch forms within ${APPROVED_DAYS} days of submission, the text and answers are erased.${withdraw}`;
}
export async function submit(env:Env,unknownInput:unknown) {
 const input=submitSchema.parse(unknownInput);
 const now=new Date();
 if(!recentQuarters(12,now).includes(input.period)) return {accepted:false as const,error:'period_out_of_range'};
 const company=await env.DB.prepare('SELECT id,kind FROM companies WHERE slug=?').bind(input.companySlug).first<{id:string;kind:string}>();
 // A hidden fictional employer (SAMPLE_EMPLOYERS not 'on') takes no contributions: it is as unknown as any other slug.
 if(!company||(company.kind==='sample'&&!samplesEnabled(env))) throw new Error('unknown_company');
 const findings=scanText(input.body);
 if(findings.some(f=>f.severity==='high')) return {accepted:false as const,error:'remove_identifying_details',findings:findings.map(f=>({kind:f.kind,what:f.what}))};
 // Everything that can be checked without hosted screening is checked first, so an invalid or spent credential never spends screening budget.
 const credential=await inspectCredential(env,input.proof,input.companySlug);
 if(company.kind==='real' && credential.key.verificationClass!=='mailbox') return {accepted:false as const,error:'real_mailbox_proof_required'};
 if(await env.INTAKE.prepare('SELECT 1 AS spent FROM spent_proofs WHERE nullifier=?').bind(credential.nullifier).first()) return {accepted:false as const,error:'credential_already_redeemed'};
 const answers=validateSurvey(input.structured);
 const screened=await screenApprovedText(env,input.body);
 if(screened.decision.action==='repair') {await countRepair(env,screened);return {accepted:false as const,error:'repair_required',decision:screened.decision,...resourcesFlag(screened)};}
 const id=`sub_${randomToken(18)}`, capability=`cap_${randomToken()}`, status=screened.decision.action==='clear'?'approved':'held';
 const row:SubmissionRow={id,public_id:null,company_id:company.id,company_slug:input.companySlug,body:input.body,layer:input.layer,period:input.period,answers_json:JSON.stringify(answers),author_key_json:JSON.stringify(credential.authorKey),capability_hash:await digest(capability),content_hash:await digest(input.body),verification_class:credential.key.verificationClass,status,eligible_at:eligibility(now),publication_period:quarter(now),revision:0,privacy_json:'[]',created_day:day(now),held_on:status==='held'?day(now):null,hold_reason:status==='held'?'jury':null,batch_id:null,op_token:null,jury_consent:input.juryReviewConsent?1:0,sensitive_consent:input.sensitiveConsent?1:0};
 try {
  await env.INTAKE.batch([
   env.INTAKE.prepare('INSERT INTO spent_proofs(nullifier,expires_at) VALUES(?,?)').bind(credential.nullifier,credential.key.expiresAt),
   env.INTAKE.prepare(`INSERT INTO submissions(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).bind(...Object.values(row)),
   await logAction(env,{submissionId:id,action:'submit',rule:screened.decision.action,screening:screened}),
  ]);
 } catch(error) {
  if(String(error).includes('UNIQUE')) return {accepted:false as const,error:'credential_already_redeemed'};
  throw error;
 }
 // A jury decision opens one case per matched jury rule when juries run for this class and the author allowed juror
 // review; if opening fails the scheduled job opens it.
 let context:ReleaseContext={};
 if(status==='held') try {await openScreeningCases(env,row,screened.decision.rules);context=await moderationContext(env,row);} catch {}
 const publicationPaused=paused(env,credential.key.verificationClass);
 return {accepted:true as const,capability,status,decision:screened.decision,verificationClass:credential.key.verificationClass==='demo'?'Sandbox credential; employment not verified':`Work mailbox verified for ${credential.key.epoch}`,releasePolicy:releasePolicy(status,publicationPaused,row.hold_reason,context,batchRuleFor(env,row)),publicationPaused,repairable:status==='held',juryOpen:!!context.juryOpen,...resourcesFlag(screened)};
}
/** Counts automatic repair decisions per quarter for the public moderation statistics; an unavailable check is not a decision. */
async function countRepair(env:Env,screened:Screening) {
 if(screened.decision.rules[0]==='CHECKS-UNAVAILABLE')return;
 try {await countModeration(env,quarter(),'repair_requested');} catch {}
}

const screenResponse=z.object({signals:z.record(z.string(),z.number()),model:z.string().max(160).optional(),provider:z.string().max(40).optional(),promptVersion:z.string().max(120).optional(),providerFallback:z.string().max(40).nullable().optional(),keySource:z.string().max(40).nullable().optional(),selfHarmResources:z.boolean().optional()});
/** Applies this worker's pinned policy to the returned risk signals only; a decision computed elsewhere is never trusted and no signal leaves this function. */
export async function screenApprovedText(env:Env,text:string):Promise<Screening> {
 let signals:Record<string,number>|null=null,meta:z.infer<typeof screenResponse>|null=null;
 if(env.INFERENCE) try {
  const res=await env.INFERENCE.fetch('https://inference/screen',{method:'POST',body:JSON.stringify({approvedText:text,consent:true}),signal:AbortSignal.timeout(20000)});
  const parsed=res.ok?screenResponse.safeParse(await res.json()):null;
  if(parsed?.success) {const data=parsed.data;signals=Object.fromEntries(riskSignals.map(signal=>[signal,data.signals[signal] as number]));meta=data;}
 } catch {}
 const decision=decide(signals), screened=decision.rules[0]!=='CHECKS-UNAVAILABLE';
 const pick=(value:string|null|undefined)=>screened?value??null:null;
 return {decision:{...decision,policyDigest:await currentPolicyDigest()},provider:pick(meta?.provider),model:pick(meta?.model),promptVersion:pick(meta?.promptVersion),providerFallback:pick(meta?.providerFallback),keySource:pick(meta?.keySource),...(meta?.selfHarmResources===true?{selfHarmResources:true as const}:{})};
}
/** Append-only decision log. Screening decisions pin provider, fallback, key source, model, prompt, policy version and digest; other decisions pin the policy they were made under, and the model when one decided. */
export async function logAction(env:Env,entry:{submissionId:string;action:string;rule:string;screening?:Screening;pin?:Pin;guard?:string}) {
 const s=entry.screening,p=entry.pin,m=s??p?.provenance;
 const values=[randomToken(),entry.submissionId,entry.action,entry.rule,quarter(),s?.decision.policyVersion??p?.policyVersion??policy.version,s?.decision.policyDigest??p?.policyDigest??await currentPolicyDigest(),s?JSON.stringify(s.decision.rules):p?JSON.stringify(p.rules):null,m?.provider??null,m?.model??null,m?.promptVersion??null,m?.providerFallback??null,m?.keySource??null];
 const insert=`INSERT INTO actions(id,submission_id,action,rule,period,policy_version,policy_digest,rules_json,provider,model,prompt_version,provider_fallback,key_source)`;
 if(entry.guard===undefined) return env.INTAKE.prepare(`${insert} VALUES(${values.map(()=>'?').join(',')})`).bind(...values);
 return env.INTAKE.prepare(`${insert} SELECT ${values.map(()=>'?').join(',')} WHERE EXISTS(SELECT 1 FROM submissions WHERE id=? AND op_token=?)`).bind(...values,entry.submissionId,entry.guard);
}
const questionKeys:string[]=survey.map(question=>question.key);
const answeredKeys=(answersJson:string)=>{let answers:Record<string,unknown>={};try {answers=JSON.parse(answersJson) as Record<string,unknown>;} catch {}return questionKeys.filter(key=>typeof answers[key]==='string'&&answers[key]!=='');};
/** Counts one publication or withdrawal for the group and for each question the contributor answered; applied only if the guarded state change happened. */
function groupChange(env:Env,group:Group,suppress:boolean,guard:{id:string;token:string},answersJson:string) {
 const keys=answeredKeys(answersJson);
 const perQuestion=keys.length?`,question_changes=json_set(question_changes,${keys.map(()=>'?,COALESCE(json_extract(question_changes,?),0)+1').join(',')})`:'';
 return env.INTAKE.prepare(`INSERT INTO aggregate_groups(company_id,period,verification_class,changes,suppressed,version,question_changes) SELECT ?,?,?,1,?,1,? WHERE EXISTS(SELECT 1 FROM submissions WHERE id=? AND op_token=?) ON CONFLICT(company_id,period,verification_class) DO UPDATE SET changes=changes+1,suppressed=MAX(suppressed,excluded.suppressed),version=version+1${perQuestion}`).bind(group.company_id,group.period,group.verification_class,suppress?1:0,JSON.stringify(Object.fromEntries(keys.map(key=>[key,1]))),guard.id,guard.token,...keys.flatMap(key=>[`$.${key}`,`$.${key}`]));
}
const removeTestimony=(env:Env,id:string)=>[
 env.DB.prepare('DELETE FROM evidence_analysis WHERE testimony_id=?').bind(id),
 env.DB.prepare('DELETE FROM evidence_pairs WHERE left_id=? OR right_id=?').bind(id,id),
 env.DB.prepare('DELETE FROM testimony_topics WHERE testimony_id=?').bind(id),
 env.DB.prepare('DELETE FROM testimony WHERE id=?').bind(id),
];
const cellPrefix=(g:Group)=>`aggregate:${g.company_id}:${g.period}:${g.verification_class}:`;
const deleteCells=(env:Env,g:Group)=>[
 env.DB.prepare('DELETE FROM distribution_bands WHERE release_id IN (SELECT id FROM metric_releases WHERE substr(id,1,?)=?)').bind(cellPrefix(g).length,cellPrefix(g)),
 env.DB.prepare('DELETE FROM metric_releases WHERE substr(id,1,?)=?').bind(cellPrefix(g).length,cellPrefix(g)),
];
const deleteCell=(env:Env,id:string)=>[env.DB.prepare('DELETE FROM distribution_bands WHERE release_id=?').bind(id),env.DB.prepare('DELETE FROM metric_releases WHERE id=?').bind(id)];

const capabilityField=z.string().min(1).max(100);
const authorSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('status'),capability:capabilityField}).strict(),
 z.object({action:z.literal('withdraw'),capability:capabilityField,revision:z.number().int().nonnegative(),signature:z.string().max(300)}).strict(),
 // juryReviewConsent or sensitiveConsent omitted keeps the author's earlier choice for the new words; true or false replaces it.
 z.object({action:z.literal('revise'),capability:capabilityField,revision:z.number().int().nonnegative(),signature:z.string().max(300),body:z.string().min(40).max(4000),screeningConsent:z.literal(true),juryReviewConsent:z.boolean().optional(),sensitiveConsent:z.boolean().optional()}).strict(),
]);
const findByHash=(env:Env,capabilityHash:string)=>env.INTAKE.prepare('SELECT * FROM submissions WHERE capability_hash=?').bind(capabilityHash).first<SubmissionRow>();
export const findByCapability=async(env:Env,capability:string)=>findByHash(env,await digest(capability));
const REVISE_REPLAY_DAYS=APPROVED_DAYS+1;
/** Author actions are addressed by the capability (never a receipt or public id) and, except status, signed by the device key over digest(capability). */
export async function authorAction(env:Env,unknownInput:unknown):Promise<AuthorResult> {
 const input=authorSchema.parse(unknownInput);
 const row=await findByCapability(env,input.capability);
 if(!row) return {ok:false,error:'receipt_not_found_or_changed'};
 if(input.action==='status') {
  const publicationPaused=paused(env,row.verification_class);
  let context:ReleaseContext={};
  if(row.status==='held') try {context=await moderationContext(env,row);} catch {}
  return {ok:true,status:row.status,revision:row.revision,repairable:row.status==='held'&&row.hold_reason!=='exception',publicationPaused,...(row.status==='held'||row.status==='approved'?{releasePolicy:releasePolicy(row.status,publicationPaused,row.hold_reason,context,batchRuleFor(env,row))}:{})};
 }
 if(row.revision!==input.revision) return {ok:false,error:'receipt_not_found_or_changed'};
 if(row.status==='withdrawn'||row.status==='expired') return input.action==='withdraw'?{ok:true,status:row.status}:{ok:false,error:'already_erased'};
 if(input.action==='revise' && row.status==='publishing') return {ok:false,error:'publication_in_progress'};
 if(input.action==='revise' && row.status!=='held' && row.status!=='approved') return {ok:false,error:'withdraw_and_resubmit'};
 // A trustee exception names this account's words; revising cannot route around it before it expires. Withdrawal stays open.
 if(input.action==='revise' && row.hold_reason==='exception') return {ok:false,error:'exception_active'};
 const payloadHash=input.action==='revise'?await digest(input.body):'';
 if(!await verifyAuthor(JSON.parse(row.author_key_json),input.signature,authorMessage(row.capability_hash,input.action,row.revision,payloadHash,input.action==='revise'))) return {ok:false,error:'invalid_author_signature'};
 if(input.action==='withdraw') {await withdrawRow(env,row);return {ok:true,status:'withdrawn'};}
 if(scanText(input.body).some(f=>f.severity==='high')) return {ok:false,error:'remove_identifying_details'};
 // A repair outcome leaves the revision unchanged, so the same signed request stays valid. Each one is screened at most
 // once; it is keyed by the signature's r half because (r, s) and (r, n-s) both verify. The client signs every attempt anew.
 try {await env.INTAKE.prepare('INSERT INTO spent_proofs(nullifier,expires_at) VALUES(?,?)').bind(`revise:${await digest(decode(input.signature).slice(0,32))}`,new Date(Date.now()+REVISE_REPLAY_DAYS*86400000).toISOString()).run();}
 catch(error) {if(String(error).includes('UNIQUE')) return {ok:false,error:'request_already_used'};throw error;}
 // Words already decided under the current policy keep that decision (policy 0.6.0): identical words never re-roll a
 // final jury result or a challenge re-check, and draw no new jury. A jury's upheld result (final after an appeal, and
 // still appealable once if it has not been) and a re-check that withheld these published words are applied again.
 const finals=await finalResults(env,row.id,payloadHash,{revision:row.revision,body:row.body});
 const upheld=[...finals].filter(([,outcome])=>outcome==='upheld').map(([rule])=>rule);
 const withheld=upheld.length?null:row.public_id?await recheckWithheld(env,row.public_id,payloadHash):null;
 const unchangedWithheld=!upheld.length&&!withheld&&row.status==='held'&&row.hold_reason==='challenge_repair'&&!!row.body&&await digest(row.body)===payloadHash;
 let screened:Screening|null=null, settled:{rule:'final_upheld'|'final_withheld'|'final_cleared';rules:string[]}|null=null;
 if(upheld.length) settled={rule:'final_upheld',rules:upheld};
 else if(withheld||unchangedWithheld) settled={rule:'final_withheld',rules:withheld?.length?withheld:['CHALLENGE-REPAIR']};
 else {
  screened=await screenApprovedText(env,input.body);
  // Repair (including unavailable checks) stores nothing: the previously accepted revision stays exactly as it was.
  if(screened.decision.action==='repair') {await countRepair(env,screened);return {ok:false,error:'repair_required',decision:screened.decision,...resourcesFlag(screened)};}
  // Every jury rule these words fall under was already cleared for them by a final jury result: no new jury.
  const juryRules=screened.decision.action==='jury'?juryRuleIds(screened.decision.rules):[];
  if(juryRules.length&&juryRules.every(rule=>finals.get(rule)==='cleared')) settled={rule:'final_cleared',rules:screened.decision.rules};
 }
 const now=new Date(), token=randomToken(12), next=eligibility(now);
 const status=settled?(settled.rule==='final_cleared'?'approved':'held'):screened!.decision.action==='clear'?'approved':'held';
 const holdReason=status!=='held'?null:settled?.rule==='final_upheld'?'jury_upheld':settled?.rule==='final_withheld'?'challenge_repair':'jury';
 const eligibleAt=row.eligible_at && row.eligible_at>next?row.eligible_at:next;
 const heldOn=status==='held'?(row.status==='held'?row.held_on??row.created_day??day(now):day(now)):null;
 const juryConsent=input.juryReviewConsent===undefined?row.jury_consent??0:input.juryReviewConsent?1:0;
 const sensitiveConsent=input.sensitiveConsent===undefined?row.sensitive_consent??0:input.sensitiveConsent?1:0;
 const pin:Pin={policyVersion:policy.version,policyDigest:await currentPolicyDigest(),rules:settled?.rules??[]};
 // A withheld account keeps no path back to its old public id once its words change: a repaired version is a new publication.
 const [updated]=await env.INTAKE.batch([
  env.INTAKE.prepare("UPDATE submissions SET body=?,content_hash=?,status=?,held_on=?,hold_reason=?,eligible_at=?,created_day=COALESCE(created_day,?),public_meta=NULL,jury_consent=?,sensitive_consent=?,revision=revision+1,op_token=? WHERE id=? AND revision=? AND status IN ('held','approved')").bind(input.body,payloadHash,status,heldOn,holdReason,eligibleAt,day(now),juryConsent,sensitiveConsent,token,row.id,row.revision),
  await logAction(env,{submissionId:row.id,action:'revise',rule:settled?.rule??screened!.decision.action,...(screened?{screening:screened}:{pin}),guard:token}),
 ]);
 if(!updated?.meta.changes) return {ok:false,error:'receipt_not_found_or_changed'};
 // Cases about earlier words end without a decision; new jury rules open cases about the new words.
 const revised:SubmissionRow={...row,body:input.body,content_hash:payloadHash,status,held_on:heldOn,hold_reason:holdReason,revision:row.revision+1,jury_consent:juryConsent,sensitive_consent:sensitiveConsent};
 let context:ReleaseContext={};
 try {await mootCases(env,row.id,revised.revision);if(status==='held') {if(!settled) await openScreeningCases(env,revised,screened!.decision.rules);context=await moderationContext(env,revised);}} catch {}
 const publicationPaused=paused(env,row.verification_class);
 if(settled&&settled.rule!=='final_cleared') {
  const decision:PolicyDecision={action:'repair',policyVersion:pin.policyVersion,policyDigest:pin.policyDigest,rules:settled.rules,explanations:[settled.rule==='final_upheld'?'A jury already upheld a published rule for exactly these words under the current policy, so they stay held and no new jury is drawn.':'A challenge re-check already withheld exactly these words under the current policy, so they stay withheld.']};
  return {ok:true,status,revision:revised.revision,decision,repairable:true,releasePolicy:releasePolicy(status,publicationPaused,holdReason,context,batchRuleFor(env,{created_day:row.created_day??day(now)}))};
 }
 return {ok:true,status,revision:revised.revision,decision:screened!.decision,repairable:status==='held',releasePolicy:releasePolicy(status,publicationPaused,holdReason,context,batchRuleFor(env,{created_day:row.created_day??day(now)})),juryOpen:!!context.juryOpen,...resourcesFlag(screened!)};
}
export async function withdraw(env:Env,capability:string):Promise<{withdrawn:boolean;error?:string;status?:string}> {
 let row=await findByCapability(env,capability);
 if(!row) return {withdrawn:false,error:'not_found'};
 if(row.status==='withdrawn'||row.status==='expired') {
  // An erasure recorded by the earlier worker may still have a public tombstone under the private id.
  if(!row.public_id && !row.op_token) {await healLegacy(env,[row]);row=await findByHash(env,row.capability_hash)??row;}
  await cleanupPublic(env,row,false);return {withdrawn:true,status:row.status};
 }
 await withdrawRow(env,row);return {withdrawn:true,status:'withdrawn'};
}
/** Withdrawal always wins, including over an in-flight batch: intake is erased first, then public copies and the group's aggregate cells are removed. */
async function withdrawRow(env:Env,current:SubmissionRow) {
 let row:SubmissionRow|null=current;
 // A row the earlier worker published under its private id is re-keyed first, so its public copy is found and removed.
 if(row.status==='published' && !row.public_id) {await healLegacy(env,[row]);row=await findByHash(env,row.capability_hash);}
 for(let attempt=0;attempt<4&&row;attempt++) {
  if(row.status==='withdrawn'||row.status==='expired') {await cleanupPublic(env,row,false);return;}
  // Guarded on the status just read, so a row that became 'published' meanwhile is counted as a published withdrawal.
  const token=randomToken(12), published=row.status==='published';
  const [update]=await env.INTAKE.batch([
   env.INTAKE.prepare(`UPDATE submissions SET status='withdrawn',${ERASE},revision=revision+1,op_token=? WHERE id=? AND status=? AND revision=?`).bind(token,row.id,row.status,row.revision),
   await logAction(env,{submissionId:row.id,action:'withdraw',rule:'AUTHOR',guard:token}),
   ...(published?[groupChange(env,row,true,{id:row.id,token},row.answers_json)]:[]),
  ]);
  if(update?.meta.changes) {
   await cleanupPublic(env,row,published);
   // Withdrawal also ends any jury case about these words and erases the passage jurors could see; decided cases lose
   // their links to this contribution, its public id and the digest of its words.
   try {await mootCases(env,row.id);await forgetCases(env,row.id,row.public_id);} catch {}
   return;
  }
  row=await env.INTAKE.prepare('SELECT * FROM submissions WHERE id=?').bind(row.id).first<SubmissionRow>();
 }
 if(row) throw new Error('withdrawal_contended');
}
async function cleanupPublic(env:Env,row:SubmissionRow,suppressGroup:boolean) {
 if(row.public_id||suppressGroup) await env.DB.batch([...(row.public_id?removeTestimony(env,row.public_id):[]),...(suppressGroup?deleteCells(env,row):[])]);
 // A row claimed by a running batch keeps public_id so the publisher (or reconcile) can remove a copy inserted after this point.
 if(row.public_id && row.status!=='publishing') await env.INTAKE.prepare("UPDATE submissions SET public_id=NULL WHERE id=? AND status IN ('withdrawn','expired')").bind(row.id).run();
}

const revertBatch=(env:Env,batchId:string)=>env.INTAKE.prepare("UPDATE submissions SET status='approved',batch_id=NULL,public_id=NULL WHERE batch_id=? AND status='publishing'").bind(batchId).run();
/**
 * The batch an account submitted before the current legal version took effect (shared/brand.ts LEGAL_EFFECTIVE) still
 * needs: legal 1.1.0 promised such accounts a batch of at least 25 (policy 0.7.0 minimumBatch, restated in 0.8.0 as
 * retention.legacyBatch), and never less than the configured batch. A row without a submission day is treated as legacy.
 */
export const legacyBatchMin=(env:Pick<Env,'TESTIMONY_BATCH_MIN'>)=>Math.max(policyVersions['0.7.0'].retention.minimumBatch,policy.retention.legacyBatch.minimumBatch,testimonyBatchMin(env));
const LEGACY_ROW='(created_day IS NULL OR created_day<?)';
/** Whether a contribution was submitted before LEGAL_EFFECTIVE (the same test as LEGACY_ROW). */
export const isLegacy=(row:Pick<SubmissionRow,'created_day'>)=>!row.created_day||row.created_day<LEGAL_EFFECTIVE;
/** The batch a receipt states: its size, and whether it is the legacy rule (per employer, reporting period and type). */
export interface BatchRule {size:number;legacy:boolean;}
export const batchRuleFor=(env:Pick<Env,'TESTIMONY_BATCH_MIN'>,row:Pick<SubmissionRow,'created_day'>):BatchRule=>isLegacy(row)?{size:legacyBatchMin(env),legacy:true}:{size:testimonyBatchMin(env),legacy:false};
/** '2026-09-23' → 'September 23, 2026' (UTC, locale-independent). */
function longDay(iso:string) {
 const [y,m,d]=iso.split('-').map(Number);
 return `${['January','February','March','April','May','June','July','August','September','October','November','December'][m!-1]} ${d}, ${y}`;
}
/**
 * Publishes due groups: the approved accounts of one employer and verification type whose random delay has passed, once
 * at least testimonyBatchMin (5) of them are due. Accounts submitted before LEGAL_EFFECTIVE form their own groups, per
 * employer, reporting period and verification type, and publish only at legacyBatchMin (25): they are never mixed into a
 * batch of newer accounts. Rows are claimed atomically (revision-checked), all public rows are inserted in one batch
 * under fresh public ids, then marked published.
 */
export async function publishDue(env:Env):Promise<number> {
 const now=new Date().toISOString(), min=testimonyBatchMin(env), legacyMin=legacyBatchMin(env);
 const current=(await env.INTAKE.prepare(`SELECT company_id,verification_class,COUNT(*) AS n FROM submissions WHERE status='approved' AND eligible_at<=? AND NOT ${LEGACY_ROW} GROUP BY company_id,verification_class HAVING COUNT(*)>=?`).bind(now,LEGAL_EFFECTIVE,min).all<PublicationGroup>()).results;
 const legacy=(await env.INTAKE.prepare(`SELECT company_id,verification_class,period,COUNT(*) AS n FROM submissions WHERE status='approved' AND eligible_at<=? AND ${LEGACY_ROW} GROUP BY company_id,verification_class,period HAVING COUNT(*)>=?`).bind(now,LEGAL_EFFECTIVE,legacyMin).all<PublicationGroup>()).results.map(g=>({...g,legacy:true}));
 let count=0;
 for(const group of [...legacy,...current]) {
  if(group.verification_class!=='demo' && env.REAL_PUBLICATION_ENABLED!=='true') continue;
  // Sandbox contributions exist only for the fictional employers; nothing is published about them while they are hidden.
  if(group.verification_class==='demo' && !samplesEnabled(env)) continue;
  try {count+=await publishGroup(env,group,now,group.legacy?legacyMin:min);} catch {}
 }
 return count;
}
async function publishGroup(env:Env,group:PublicationGroup,now:string,min:number) {
 // The same era (and, for legacy accounts, reporting period) as the group, so a batch never mixes the two rules.
 const era=group.legacy?`${LEGACY_ROW} AND period=?`:`NOT ${LEGACY_ROW}`, eraArgs=group.legacy?[LEGAL_EFFECTIVE,group.period]:[LEGAL_EFFECTIVE];
 const candidates=(await env.INTAKE.prepare(`SELECT * FROM submissions WHERE status='approved' AND eligible_at<=? AND company_id=? AND verification_class=? AND ${era} ORDER BY eligible_at LIMIT 100`).bind(now,group.company_id,group.verification_class,...eraArgs).all<SubmissionRow>()).results;
 // Only a detail that identifies someone or somewhere holds approved words here (privacy_rescan); text addressed to the
 // checks (shared/privacy.ts SCREENING_ONLY_KINDS) is caught when a draft is submitted or revised.
 const flagged=candidates.filter(r=>scanText(r.body).some(identifies));
 for(const row of flagged) {
  const token=randomToken(12);
  await env.INTAKE.batch([
   env.INTAKE.prepare("UPDATE submissions SET status='held',held_on=?,hold_reason='privacy_rescan',op_token=? WHERE id=? AND status='approved' AND revision=?").bind(day(),token,row.id,row.revision),
   await logAction(env,{submissionId:row.id,action:'hold',rule:'PRIVACY-RESCAN',guard:token}),
  ]);
 }
 const rows=candidates.filter(r=>!flagged.includes(r));
 if(rows.length<min) return 0;
 const batchId=`${Date.now().toString(36)}.${randomToken(9)}`;
 const claims=await env.INTAKE.batch(rows.map(r=>env.INTAKE.prepare("UPDATE submissions SET status='publishing',batch_id=?,public_id=? WHERE id=? AND status='approved' AND revision=?").bind(batchId,`t_${randomToken(18)}`,r.id,r.revision)));
 // Nothing downstream may follow submission order: without an ORDER BY, SQLite returns intake (insertion) order, and the
 // public insert order and the analysis queue would then show which account was submitted k-th. Members are ordered by
 // their random public ids and then shuffled with crypto randomness.
 const members=claims.some(c=>c.meta.changes)?shuffled((await env.INTAKE.prepare("SELECT * FROM submissions WHERE batch_id=? AND status='publishing' ORDER BY public_id").bind(batchId).all<SubmissionRow>()).results):[];
 if(members.length<min) {await revertBatch(env,batchId);return 0;}
 const stamp=quarter();
 // One atomic insert. If it fails the rows stay 'publishing' and reconcile finishes or reverts them by checking which public rows exist.
 await env.DB.batch(members.map(m=>env.DB.prepare('INSERT INTO testimony(id,company_id,cohort_id,layer,body,period,verification_class,release_batch,published_at,withdrawn_at,created_at) VALUES(?,?,NULL,?,?,?,?,?,?,NULL,?)').bind(m.public_id,m.company_id,m.layer,m.body,m.period,m.verification_class==='demo'?'Sandbox contribution; not employment-verified':'Work mailbox verified; relationship self-reported',stamp,stamp,stamp)));
 return finishBatch(env,batchId,members);
}
/** Most a batch's analysis messages are spread over, so readings do not appear in any order a publisher chose. */
export const ANALYSIS_SPREAD_SECONDS=6*3600;
/** A uniformly random delay in [0, ANALYSIS_SPREAD_SECONDS) seconds, from crypto randomness. */
export const analysisDelay=()=>crypto.getRandomValues(new Uint32Array(1))[0]!%ANALYSIS_SPREAD_SECONDS;
async function finishBatch(env:Env,batchId:string,members:SubmissionRow[],rule='BATCH') {
 const statements:D1PreparedStatement[]=[], PER_MEMBER=4;
 for(const member of members) {
  const token=randomToken(12);
  statements.push(
   env.INTAKE.prepare(`UPDATE submissions SET status='published',${PUBLISHED_ERASE},op_token=? WHERE id=? AND batch_id=? AND status='publishing'`).bind(token,member.id,batchId),
   await logAction(env,{submissionId:member.id,action:'publish',rule,guard:token}),
   groupChange(env,member,false,{id:member.id,token},member.answers_json),
   // Jury decisions about these exact words now name the published account, so a challenge cannot re-hear a decided rule.
   env.INTAKE.prepare("UPDATE jury_cases SET public_id=? WHERE subject_id=? AND subject_revision=? AND state<>'open' AND public_id IS NULL AND COALESCE(outcome,'moot')<>'moot' AND EXISTS(SELECT 1 FROM submissions WHERE id=? AND op_token=?)").bind(member.public_id,member.id,member.revision,member.id,token),
  );
 }
 const results=await env.INTAKE.batch(statements);
 const published=members.filter((_,index)=>results[index*PER_MEMBER]?.meta.changes);
 const lost=members.filter(m=>!published.includes(m));
 if(lost.length) {
  await env.DB.batch(lost.flatMap(m=>removeTestimony(env,m.public_id!)));
  await env.INTAKE.batch(lost.map(m=>env.INTAKE.prepare("UPDATE submissions SET public_id=NULL WHERE id=? AND status IN ('withdrawn','expired')").bind(m.id)));
 }
 // Each account's analysis (and so its public reading) is queued in shuffled order with its own random delay; the hourly
 // backfill also takes unanalysed accounts in a rotating hash order. Neither follows submission order.
 if(env.ANALYSIS_QUEUE && published.length) try {await env.ANALYSIS_QUEUE.sendBatch(shuffled(published).map(m=>({body:{id:m.public_id!},delaySeconds:analysisDelay()})));} catch {}
 return published.length;
}

const chunks=<T>(items:T[],size=80)=>Array.from({length:Math.ceil(items.length/size)},(_,index)=>items.slice(index*size,index*size+size));
// The earlier worker published under the private id and never wrote op_token, including after the migrations if it was
// still running then. A published row is re-keyed so its id moves to public_id; an erased row's id moves to public_id
// so the sweep below removes any public tombstone under it. Each row is healed once (public_id or op_token is then set).
const LEGACY="public_id IS NULL AND (status='published' OR (status IN ('withdrawn','expired','rejected') AND op_token IS NULL))";
async function healLegacy(env:Env,rows:SubmissionRow[]) {
 for(const part of chunks(rows,20)) {
  const statements:D1PreparedStatement[]=[];
  for(const row of part) {
   const id=`sub_${randomToken(18)}`, token=randomToken(12), published=row.status==='published';
   statements.push(env.INTAKE.prepare(`UPDATE submissions SET id=?,public_id=?,op_token=?,${published?PUBLISHED_ERASE:ERASE} WHERE id=? AND status=? AND public_id IS NULL`).bind(id,row.id,token,row.id,row.status));
   if(published) statements.push(groupChange(env,row,false,{id,token},row.answers_json));
  }
  await env.INTAKE.batch(statements);
 }
 return rows.length;
}
const ORPHAN_SCAN=400;
/** Up to `limit` public ids with a prefix, from a random starting point with wraparound, so successive runs cover every id. */
async function sampleIds(env:Env,table:'testimony'|'metric_releases',prefix:string,limit:number) {
 const start=`${prefix}${randomToken(3)}`;
 const scan=async(op:'>='|'<',max:number)=>(await env.DB.prepare(`SELECT id FROM ${table} WHERE substr(id,1,?)=? AND id${op}? ORDER BY id LIMIT ?`).bind(prefix.length,prefix,start,max).all<{id:string}>()).results.map(r=>r.id);
 const after=await scan('>=',limit);
 return after.length<limit?[...after,...await scan('<',limit-after.length)]:after;
}
/** Makes the public database agree with intake after interrupted runs: withdrawals win, stalled batches finish or revert, legacy pending copies are resolved. */
export async function reconcile(env:Env):Promise<number> {
 let fixed=await healLegacy(env,(await env.INTAKE.prepare(`SELECT * FROM submissions WHERE ${LEGACY} LIMIT 200`).all<SubmissionRow>()).results);
 const gone=(await env.INTAKE.prepare("SELECT * FROM submissions WHERE status IN ('withdrawn','expired','rejected') AND public_id IS NOT NULL LIMIT 200").all<SubmissionRow>()).results;
 for(const part of chunks(gone,20)) {
  await env.DB.batch(part.flatMap(r=>removeTestimony(env,r.public_id!)));
  await env.INTAKE.batch(part.map(r=>env.INTAKE.prepare("UPDATE submissions SET public_id=NULL WHERE id=? AND status IN ('withdrawn','expired','rejected')").bind(r.id)));
  fixed+=part.length;
 }
 const inFlight=(await env.INTAKE.prepare("SELECT * FROM submissions WHERE status='publishing'").all<SubmissionRow>()).results;
 for(const batchId of new Set(inFlight.map(r=>r.batch_id!))) {
  if(Date.now()-parseInt(batchId.split('.')[0]!,36)<RECOVER_AFTER_MS) continue;
  const members=inFlight.filter(r=>r.batch_id===batchId), present=new Set<string>();
  for(const part of chunks(members)) for(const r of (await env.DB.prepare(`SELECT id FROM testimony WHERE id IN (${part.map(()=>'?').join(',')})`).bind(...part.map(m=>m.public_id)).all<{id:string}>()).results) present.add(r.id);
  if(present.size===members.length) await finishBatch(env,batchId,members);
  else {
   if(present.size) await env.DB.batch([...present].flatMap(id=>removeTestimony(env,id)));
   await revertBatch(env,batchId);
  }
  fixed+=members.length;
 }
 const pending=(await env.DB.prepare("SELECT id FROM testimony WHERE withdrawn_at='__pending__' LIMIT 200").all<{id:string}>()).results.map(r=>r.id);
 for(const part of chunks(pending)) {
  const released=new Set((await env.INTAKE.prepare(`SELECT public_id FROM submissions WHERE status='published' AND public_id IN (${part.map(()=>'?').join(',')})`).bind(...part).all<{public_id:string}>()).results.map(r=>r.public_id));
  await env.DB.batch(part.flatMap(id=>released.has(id)?[env.DB.prepare("UPDATE testimony SET withdrawn_at=NULL WHERE id=? AND withdrawn_at='__pending__'").bind(id)]:removeTestimony(env,id)));
  fixed+=part.length;
 }
 // The earlier worker copied each contributor's answers into this legacy public table at publication; none belong there.
 fixed+=(await env.DB.prepare('DELETE FROM structured_responses').run()).meta.changes??0;
 // A public row under a new-style id must belong to a row that is publishing or published. Anything else was left by a
 // publisher that stopped after its row was withdrawn, expired or reverted.
 for(const part of chunks(await sampleIds(env,'testimony','t_',ORPHAN_SCAN))) {
  const live=new Set((await env.INTAKE.prepare(`SELECT public_id FROM submissions WHERE status IN ('publishing','published') AND public_id IN (${part.map(()=>'?').join(',')})`).bind(...part).all<{public_id:string}>()).results.map(r=>r.public_id));
  const orphans=part.filter(id=>!live.has(id));
  if(orphans.length) {await env.DB.batch(orphans.flatMap(id=>removeTestimony(env,id)));fixed+=orphans.length;}
 }
 return fixed;
}
/**
 * Held cases are erased after 30 days on hold; approved cases that never joined a batch after 180 days. Recorded as
 * 'expired', never as author withdrawals. Erasure is deferred (the clock is not paused) while a jury case about the held
 * words is open, so a case that ends without a decision after 30 days is erased at the next run; a trustee exception
 * ends at its own expiry instead.
 */
export async function expireStale(env:Env,now=new Date()):Promise<number> {
 const cutoff=(days:number)=>day(new Date(now.getTime()-days*86400000));
 const due=(await env.INTAKE.prepare("SELECT id,status,revision,public_id FROM submissions WHERE (status='held' AND COALESCE(hold_reason,'')<>'exception' AND COALESCE(held_on,created_day)<? AND NOT EXISTS(SELECT 1 FROM jury_cases c WHERE c.subject_id=submissions.id AND c.state='open')) OR (status='approved' AND created_day<?) LIMIT 400").bind(cutoff(HELD_DAYS),cutoff(APPROVED_DAYS)).all<{id:string;status:string;revision:number;public_id:string|null}>()).results;
 let expired=0;
 for(const part of chunks(due,40)) {
  const statements:D1PreparedStatement[]=[];
  for(const row of part) {
   const token=randomToken(12);
   statements.push(
    env.INTAKE.prepare(`UPDATE submissions SET status='expired',${ERASE},revision=revision+1,op_token=? WHERE id=? AND status=? AND revision=?`).bind(token,row.id,row.status,row.revision),
    await logAction(env,{submissionId:row.id,action:'expire',rule:row.status==='held'?'HELD-30D':'UNBATCHED-180D',guard:token}),
   );
  }
  const results=await env.INTAKE.batch(statements);
  const erased=part.filter((_,index)=>results[index*2]?.meta.changes);
  expired+=erased.length;
  // Erased words: their decided jury cases lose every link to this contribution (open ones were mooted first).
  for(const row of erased) try {await mootCases(env,row.id);await forgetCases(env,row.id,row.public_id);} catch {}
 }
 return expired;
}

/** Fictional sample employers (companies.kind 'sample'); their seeded accounts have no author row. */
export const isSampleEmployer=async(env:Pick<Env,'DB'>,companyId:string)=>(await env.DB.prepare('SELECT kind FROM companies WHERE id=?').bind(companyId).first<{kind:string}>())?.kind==='sample';
const SCRUB_MONTHS=policy.retention.erasedRecordsMonths;
const monthsBefore=(date:Date,months:number)=>new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-months,1)).toISOString().slice(0,7);
/**
 * A withdrawn or expired record keeps its status, verification type, revision and kind of account, plus the employer,
 * periods and capability hash that idempotent withdrawal needs. At the first run once 12 full months have passed after
 * its erasure month (so from the first day of the 13th month: at least 12 months after the erasure itself) those go
 * too: the capability hash becomes a random unguessable value (the column is NOT NULL and UNIQUE), so the capability no
 * longer finds the record, and the employer and periods are blanked (NOT NULL columns). Rows erased before erased_month
 * existed start their 12 months at the first run after this change. A row whose public copy is still being removed waits.
 */
export async function scrubErased(env:Env,now=new Date()):Promise<number> {
 await env.INTAKE.prepare("UPDATE submissions SET erased_month=? WHERE status IN ('withdrawn','expired','rejected') AND erased_month IS NULL AND capability_hash NOT LIKE 'scrubbed:%'").bind(now.toISOString().slice(0,7)).run();
 const scrubbed=await env.INTAKE.prepare("UPDATE submissions SET capability_hash='scrubbed:'||lower(hex(randomblob(24))),company_id='',company_slug='',period='',publication_period='',erased_month=NULL WHERE status IN ('withdrawn','expired','rejected') AND erased_month IS NOT NULL AND erased_month<? AND public_id IS NULL AND op_token IS NOT NULL AND capability_hash NOT LIKE 'scrubbed:%'").bind(monthsBefore(now,SCRUB_MONTHS)).run();
 return scrubbed.meta.changes??0;
}

type TestimonyRow={id:string;company_id:string;cohort_id:string|null;layer:string;body:string;period:string|null;event_id:string|null;verification_class:string;release_batch:string;published_at:string};
const WITHHOLD_RULE={challenge_repair:'CHALLENGE-REPAIR',jury_upheld:'JURY-UPHELD',exception:'EXCEPTION'} as const;
export type WithholdReason=keyof typeof WITHHOLD_RULE;
/**
 * Takes a published account out of public view for repair. Its words move back into the private intake row (held, with
 * a fresh 30-day repair clock), its public copy and derived rows are deleted, and its group's aggregates are suppressed
 * as for a withdrawal. The original public fields are kept only so an overturned decision can restore it. An account with
 * no author row is hidden instead, because nobody could repair it, except a seeded fictional sample account: a challenge
 * or a jury can never withhold one (its outcome is a practice case, 'practice'); only a trustee exception hides it.
 */
export async function withholdPublished(env:Env,publicId:string,reason:WithholdReason,pin?:Pin):Promise<'withheld'|'hidden'|'practice'|'gone'> {
 const item=await env.DB.prepare('SELECT id,company_id,cohort_id,layer,body,period,event_id,verification_class,release_batch,published_at FROM testimony WHERE id=? AND withdrawn_at IS NULL').bind(publicId).first<TestimonyRow>();
 if(!item) return 'gone';
 const row=await env.INTAKE.prepare('SELECT * FROM submissions WHERE public_id=?').bind(publicId).first<SubmissionRow>();
 if(!row && reason!=='exception' && await isSampleEmployer(env,item.company_id)) return 'practice';
 if(!row) return (await env.DB.prepare("UPDATE testimony SET withdrawn_at='__withheld__' WHERE id=? AND withdrawn_at IS NULL").bind(publicId).run()).meta.changes?'hidden':'gone';
 if(row.status!=='published') return 'gone';
 const token=randomToken(12), today=day();
 const meta=JSON.stringify({layer:item.layer,period:item.period,cohort_id:item.cohort_id,event_id:item.event_id,verification_class:item.verification_class,release_batch:item.release_batch,published_at:item.published_at});
 const [updated]=await env.INTAKE.batch([
  env.INTAKE.prepare("UPDATE submissions SET status='held',body=?,content_hash=?,hold_reason=?,held_on=?,created_day=?,public_meta=?,revision=revision+1,op_token=? WHERE id=? AND status='published' AND revision=?").bind(item.body,await digest(item.body),reason,today,today,meta,token,row.id,row.revision),
  await logAction(env,{submissionId:row.id,action:'withhold',rule:WITHHOLD_RULE[reason],guard:token,...(pin?{pin}:{})}),
  groupChange(env,row,true,{id:row.id,token},row.answers_json),
 ]);
 if(!updated?.meta.changes) return 'gone';
 await env.DB.batch([...removeTestimony(env,publicId),...deleteCells(env,row)]);
 return 'withheld';
}
/**
 * Ends a withholding (an overturned jury decision or a lapsed trustee exception). The account returns under its original
 * public id as a one-member batch through the normal claim/finish path, so an interrupted restore is finished or reverted
 * by reconcile. Without a stored public form, or while its class may not be published, it rejoins the approved queue.
 */
export async function restoreWithheld(env:Env,id:string,reason:WithholdReason,entry:{action:string;rule:string;pin?:Pin},revision?:number):Promise<'restored'|'approved'|'gone'> {
 const row=await env.INTAKE.prepare("SELECT * FROM submissions WHERE id=? AND status='held' AND hold_reason=?").bind(id,reason).first<SubmissionRow>();
 if(!row||(revision!==undefined&&row.revision!==revision)) return 'gone';
 const meta=(()=>{try {return row.public_meta?JSON.parse(row.public_meta) as Omit<TestimonyRow,'id'|'company_id'|'body'>:null;} catch {return null;}})();
 const now=new Date(), token=randomToken(12);
 if(!meta||!row.public_id||paused(env,row.verification_class)) {
  const [updated]=await env.INTAKE.batch([
   env.INTAKE.prepare("UPDATE submissions SET status='approved',hold_reason=NULL,held_on=NULL,public_meta=NULL,eligible_at=COALESCE(eligible_at,?),created_day=COALESCE(created_day,?),op_token=? WHERE id=? AND status='held' AND revision=? AND hold_reason=?").bind(eligibility(now),day(now),token,row.id,row.revision,reason),
   await logAction(env,{submissionId:row.id,action:entry.action,rule:entry.rule,guard:token,...(entry.pin?{pin:entry.pin}:{})}),
  ]);
  return updated?.meta.changes?'approved':'gone';
 }
 const batchId=`${now.getTime().toString(36)}.${randomToken(9)}`;
 const [claim]=await env.INTAKE.batch([
  env.INTAKE.prepare("UPDATE submissions SET status='publishing',batch_id=?,hold_reason=NULL,held_on=NULL,eligible_at=COALESCE(eligible_at,?),created_day=COALESCE(created_day,?),op_token=? WHERE id=? AND status='held' AND revision=? AND hold_reason=?").bind(batchId,eligibility(now),day(now),token,row.id,row.revision,reason),
  await logAction(env,{submissionId:row.id,action:entry.action,rule:entry.rule,guard:token,...(entry.pin?{pin:entry.pin}:{})}),
 ]);
 if(!claim?.meta.changes) return 'gone';
 await env.DB.prepare('INSERT INTO testimony(id,company_id,cohort_id,layer,body,period,event_id,verification_class,release_batch,published_at,withdrawn_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,NULL,?)').bind(row.public_id,row.company_id,meta.cohort_id,meta.layer,row.body,meta.period,meta.event_id,meta.verification_class,meta.release_batch,meta.published_at,meta.published_at).run();
 return await finishBatch(env,batchId,[{...row,status:'publishing',batch_id:batchId}],'RESTORE')?'restored':'gone';
}
/** A jury cleared every rule a held case was held under: it rejoins the approved queue with its original release time. */
export async function approveAfterJury(env:Env,id:string,revision:number,entry:{action:string;rule:string;pin:Pin}):Promise<boolean> {
 const token=randomToken(12);
 const [updated]=await env.INTAKE.batch([
  env.INTAKE.prepare("UPDATE submissions SET status='approved',hold_reason=NULL,held_on=NULL,eligible_at=COALESCE(eligible_at,?),created_day=COALESCE(created_day,?),op_token=? WHERE id=? AND revision=? AND status='held' AND hold_reason IN ('jury','jury_upheld')").bind(eligibility(new Date()),day(),token,id,revision),
  await logAction(env,{submissionId:id,action:entry.action,rule:entry.rule,pin:entry.pin,guard:token}),
 ]);
 return !!updated?.meta.changes;
}
/** Records a jury result on a held case. holdReason null keeps the current reason; restartClock gives the author a full repair window. */
export async function holdAfterJury(env:Env,id:string,revision:number,entry:{action:string;rule:string;pin:Pin},holdReason:string|null,restartClock:boolean):Promise<boolean> {
 const token=randomToken(12);
 const [updated]=await env.INTAKE.batch([
  env.INTAKE.prepare("UPDATE submissions SET hold_reason=COALESCE(?,hold_reason),held_on=COALESCE(?,held_on),op_token=? WHERE id=? AND revision=? AND status='held'").bind(holdReason,restartClock?day():null,token,id,revision),
  await logAction(env,{submissionId:id,action:entry.action,rule:entry.rule,pin:entry.pin,guard:token}),
 ]);
 return !!updated?.meta.changes;
}
const methodFor=(verificationClass:string)=>verificationClass==='demo'?'Sandbox responses from fictional-employer credentials; not unique people and not employment-verified.':'One work-mailbox credential per employer and issuance quarter; not a census.';
type GroupState=Group&{changes:number;suppressed:number;version:number;question_changes:string|null;question_released:string|null};
const counters=(text:string|null|undefined)=>{try {return JSON.parse(text||'{}') as Record<string,number>;} catch {return {} as Record<string,number>;}};
/** Cells whose group has no release state in intake were computed by earlier code from data that no longer exists; they are removed. */
async function removeOrphanCells(env:Env) {
 const ids=await sampleIds(env,'metric_releases','aggregate:',2000);
 if(!ids.length) return;
 const known=new Set((await env.INTAKE.prepare('SELECT company_id,period,verification_class FROM aggregate_groups').all<Group>()).results.map(cellPrefix));
 for(const part of chunks(ids.filter(id=>!known.has(id.slice(0,id.lastIndexOf(':')+1))),40)) await env.DB.batch(part.flatMap(id=>deleteCell(env,id)));
}
/**
 * Aggregates come only from intake rows with status 'published' and are written only here. A group is considered only
 * after at least 5 publications/withdrawals since its last release and with at least 25 published contributions. Each
 * question is then decided on its own counts, because questions are optional: a question released before is replaced
 * only after at least 5 answer-level changes to it (or none at all), and a visible cell stays only while counted
 * publications fully explain the difference. Two consecutive releases of one question therefore never differ by 1–4
 * answers. This does not stop someone who controls several of those changes, for example by withdrawing contributions
 * of their own, from isolating the others by comparing releases.
 */
export async function releaseAggregates(env:Env):Promise<number> {
 const min=minimum(env), stamp=quarter(); let released=0;
 try {await removeOrphanCells(env);} catch {}
 const groups=(await env.INTAKE.prepare('SELECT * FROM aggregate_groups WHERE changes>0 OR suppressed=1 LIMIT 200').all<GroupState>()).results;
 for(const group of groups) try {
  const rows=(await env.INTAKE.prepare("SELECT answers_json FROM submissions WHERE status='published' AND company_id=? AND period=? AND verification_class=?").bind(group.company_id,group.period,group.verification_class).all<{answers_json:string}>()).results;
  // Below the batch size no question can reach n >= 25, so any cell still visible is stale and is removed.
  if(rows.length<min) {await env.DB.batch(deleteCells(env,group));continue;}
  if(group.changes<RERELEASE_CHANGES) {if(group.suppressed) await env.DB.batch(deleteCells(env,group));continue;}
  const prefix=cellPrefix(group), pending=counters(group.question_changes), releasedBefore=counters(group.question_released);
  const visible=new Map((await env.DB.prepare('SELECT id,n FROM metric_releases WHERE substr(id,1,?)=?').bind(prefix.length,prefix).all<{id:string;n:number}>()).results.map(r=>[r.id.slice(prefix.length),r.n]));
  const metrics=new Map(aggregateAnswers(rows.map(r=>JSON.parse(r.answers_json) as Record<string,string>),min).map(metric=>[metric.key,metric]));
  const statements:D1PreparedStatement[]=[];
  for(const key of questionKeys) {
   const metric=metrics.get(key), shown=visible.get(key), counted=pending[key]??0, id=`${prefix}${key}`;
   if(!metric) {if(shown!==undefined) statements.push(...deleteCell(env,id));continue;}
   const drift=shown===undefined?0:metric.n-shown;
   const first=!releasedBefore[key] && shown===undefined;
   // counted 0 means the answers are unchanged, so the cell must match what is visible; any other drift is unexplained.
   if(first || (counted===0?drift===0:counted>=RERELEASE_CHANGES)) {
    const metricId=`survey-${metric.key}`;
    statements.push(
     ...deleteCell(env,id),
     env.DB.prepare('INSERT OR IGNORE INTO metric_definitions(id,key,label,question,response_type,unit,direction,method_note,verification_method) VALUES(?,?,?,?,?,?,?,?,?)').bind(metricId,`survey_${metric.key}`,metric.label,metric.label,metric.responseType,metric.agreement?'percent':'category','neutral','Explicit optional questionnaire answers; missing answers excluded from the denominator.','Recorded on each release.'),
     // value is NOT NULL in the schema; for distribution questions it is a placeholder and only the bands carry data.
     env.DB.prepare('INSERT INTO metric_releases(id,company_id,metric_id,cohort_id,period,value,n,release_batch,published_at,created_at,verification_method) VALUES(?,?,?,NULL,?,?,?,?,?,?,?)').bind(id,group.company_id,metricId,group.period,metric.value??0,metric.n,stamp,stamp,stamp,methodFor(group.verification_class)),
     ...metric.distribution.map((band,index)=>env.DB.prepare('INSERT INTO distribution_bands(release_id,band,share,sort_order) VALUES(?,?,?,?)').bind(id,band.band,band.share,index)),
    );
    delete pending[key];releasedBefore[key]=1;
    continue;
   }
   // Not re-released. A visible cell may stay only if it is the previous release plus exactly the counted publications
   // (a withdrawal always removes every cell of the group); otherwise it could hold a withdrawn answer, so it goes.
   if(shown!==undefined && drift!==counted) {statements.push(...deleteCell(env,id));pending[key]=Math.max(counted,Math.abs(drift));}
  }
  if(statements.length) await env.DB.batch(statements);
  const reset=await env.INTAKE.prepare('UPDATE aggregate_groups SET changes=0,suppressed=0,released_period=?,question_changes=?,question_released=? WHERE company_id=? AND period=? AND verification_class=? AND version=?').bind(stamp,JSON.stringify(pending),JSON.stringify(releasedBefore),group.company_id,group.period,group.verification_class,group.version).run();
  // A withdrawal or publication landed while computing: withdraw the just-written cells and let the next run decide.
  if(!reset.meta.changes) await env.DB.batch(deleteCells(env,group)); else released++;
 } catch {}
 return released;
}
/** Every scheduled intake/publication task. Each phase is isolated so one failure never stops erasure or cleanup. */
export async function housekeeping(env:Env):Promise<Record<string,number>> {
 const counts:Record<string,number>={errors:0};
 const phases:[string,()=>Promise<number>][]=[
  ['reconciled',()=>reconcile(env)],
  ['expired',()=>expireStale(env)],
  ['published',()=>publishDue(env)],
  ['aggregatesReleased',()=>releaseAggregates(env)],
  ['spentProofsRemoved',async()=>(await env.INTAKE.prepare('DELETE FROM spent_proofs WHERE expires_at<?').bind(new Date().toISOString()).run()).meta.changes??0],
  ['erasedRecordsScrubbed',()=>scrubErased(env)],
 ];
 for(const [name,run] of phases) try {counts[name]=await run();} catch {counts[name]=0;counts.errors=(counts.errors??0)+1;}
 return counts;
}
