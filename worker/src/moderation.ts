import {z} from 'zod';
import {randomInt} from '../../shared/random.ts';
import {digest,encode,randomToken,quarter,networkKey,readCapped} from '../../shared/proof.ts';
import {scanText,identifies} from '../../shared/privacy.ts';
import {policy,policyVersions,currentPolicyDigest,citableRule,juryStage,quorumFor,groundsMatch,employersNeeded,seatsPerEmployer,communitySeatsPerCase,ownEmployerExcluded,URGENT_CHALLENGE_RULES,type JuryStage,type JuryClass,type PolicyVersion,type CitableRule} from '../../shared/policy.ts';
import {parseTrustees,verifyExceptionAction,actionDigest} from '../../shared/trustees.ts';
import {CANONICAL_ORIGIN} from '../../shared/brand.ts';
import {inspectJurorToken,jurorProtocolAvailable,publicIssuerKeys,type JurorCredential} from './credentials.ts';
import {findByCapability,releasePolicy,batchRuleFor,paused,screenApprovedText,withholdPublished,restoreWithheld,approveAfterJury,holdAfterJury,isSampleEmployer,logAction,type SubmissionRow,type Pin,type Provenance,type ReleaseContext} from './submissions.ts';
import type {Env} from './types.ts';
import {samplesEnabled,visibleCompanySql} from './flags.ts';

type Limiter={limit(input:{key:string}):Promise<{success:boolean}>};
/** Moderation settings read from the worker environment (declared here so the shared Env type needs no change). */
export type ModerationEnv=Env&{JURY_ENABLED?:string;TRUSTEE_KEYS?:string;CHALLENGE_LIMIT?:Limiter};
const settings=(env:Env)=>env as ModerationEnv;
/** A published count: '<5' (a moderation count below 5), '<25' (a contribution-derived count from 1 to 24), or a number. */
export type Coarse=number|'<5'|'<25';
export interface ModerationStats {period:string;counts:{submitted:Coarse;publishedAutomatically:Coarse;repairs:Coarse;jury:Coarse;rejected:Coarse;practice:Coarse;legal:Coarse;appeals:Coarse;overturned:Coarse};heldByReason:Record<string,Coarse>;juryOutcomes:Record<string,Coarse>;}
export interface CaseRow {id:string;stage:JuryStage;parent_id:string|null;origin:'screening'|'challenge'|'appeal';subject_id:string|null;subject_revision:number;public_id:string|null;company_id:string;jury_class:JuryClass;rule_id:string;policy_version:string;policy_digest:string;passage:string;required:number;upheld_at:number;state:'open'|'closed'|'expired';outcome:'upheld'|'cleared'|'no_quorum'|'moot'|null;yes:number;no:number;unsure:number;opened_at:string;period:string;closed_period:string|null;close_token:string|null;applied:number;content_hash?:string|null;}
/** model/provider/promptVersion name the model that decided (for a challenge, the re-check of the published words); relevance names what judged a challenge's reason. */
export interface Receipt {id:string;kind:'screening'|'rescan'|'publication'|'withhold'|'restore'|'jury'|'appeal'|'challenge'|'erasure';ruleIds:string[];policyVersion:string|null;policyDigest:string|null;model:string|null;provider:string|null;promptVersion:string|null;relevance?:string|null;path:string;outcome:string;votes?:{yes:number;no:number;unsure:number;required:number};period:string;}
type ChallengeOutcome='rejected'|'jury'|'withheld_for_repair'|'merged';

const DAY=86400000, HOUR=3600000;
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const coarse=(n:number):Coarse=>n<5?'<5':n;
/** Contribution counts: 0 stays 0, 1–24 is '<25', larger counts are rounded down to a multiple of 25. */
export function publicCount(n:number|null|undefined):0|'<25'|number {return !n?0:n<25?'<25':Math.floor(n/25)*25;}
/** No request body larger than this is ever buffered (moderation routes take small JSON objects). */
const MAX_BODY_BYTES=8000;
async function readJson(request:Request):Promise<unknown> {
 const raw=await readCapped(request,MAX_BODY_BYTES);
 try {return JSON.parse(raw);} catch {throw new Error('invalid_json');}
}
/** A uniformly random permutation from crypto randomness. */
export function shuffled<T>(items:readonly T[]):T[] {
 const out=[...items];
 for(let i=out.length-1;i>0;i--) {const j=randomInt(i+1);[out[i],out[j]]=[out[j]!,out[i]!];}
 return out;
}
/** Only the UTC day a case opened is kept: the start of the next UTC day (or now, exactly at midnight), so no exact time is stored and no deadline counted from it comes early. */
export function caseOpenedAt(now=new Date()):string {
 const midnight=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
 return new Date(midnight===now.getTime()?midnight:midnight+DAY).toISOString();
}
/** HMAC under the worker secret RATE_LIMIT_SECRET; without it, a plain digest that anyone can recompute from the same inputs. */
async function keyedDigest(env:Env,message:string) {
 if(!env.RATE_LIMIT_SECRET) return digest(message);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.RATE_LIMIT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message))));
}
/**
 * Same derivation as the site limiter: a daily digest of scope and connecting network (networkKey: an IPv6 address counts
 * as its /64, so rotating addresses inside one network buys no fresh budget). Passed only to the limiter, never stored.
 */
const limiterKey=(env:Env,request:Request,scope:string)=>keyedDigest(env,`siwt-limit-v1:${scope}:${new Date().toISOString().slice(0,10)}:${networkKey(request.headers.get('cf-connecting-ip'))}`);
/** Consumes `cost` slots of the client's short-window (burst) limiter, when one is bound; false once it is spent. */
async function spendBurst(env:Env,request:Request,cost:number) {
 const limiter=settings(env).CHALLENGE_LIMIT??env.INFER_LIMIT;
 if(!limiter) return true;
 const key=await limiterKey(env,request,'challenge');
 let ok=true;
 for(let i=0;i<cost;i++) ok=(await limiter.limit({key})).success&&ok;
 return ok;
}
/**
 * Challenges are open only with RATE_LIMIT_SECRET: the daily budget is stored, and without the secret its key could only
 * be an unkeyed digest of the address, which anyone holding the table could reverse by enumerating addresses.
 */
export const challengesOpen=(env:Env)=>typeof env.RATE_LIMIT_SECRET==='string'&&env.RATE_LIMIT_SECRET.length>0;
/**
 * HMAC(RATE_LIMIT_SECRET, UTC day, purpose, SHA-256 of the connecting network: an IPv4 address, or an IPv6 address's
 * /64). Only this value and a count are stored.
 */
async function dailyDigest(env:Env,request:Request,scope:string,day:string) {
 const address=await digest(`siwt-address-v1:${networkKey(request.headers.get('cf-connecting-ip'))}`);
 return keyedDigest(env,`siwt-daily-v1:${day}:${scope}:${address}`);
}
/** Spends one of the client's challenges for this UTC day; false once the day's budget is used. */
async function spendDaily(env:Env,request:Request) {
 const day=today(), key=await dailyDigest(env,request,'challenge',day);
 return !!await env.INTAKE.prepare('INSERT INTO daily_budgets(day,digest,used) VALUES(?,?,1) ON CONFLICT(day,digest) DO UPDATE SET used=used+1 WHERE used<? RETURNING used').bind(day,key,policy.challenges.budget.perClientPerDay).first();
}
/**
 * Changes the client's use of today's budget: extra challenges for a reason that does not fit its rule (capped at the
 * day's budget), or a refund (-1, floored at 0) for a challenge refused before it was considered. Best effort.
 */
async function chargeDaily(env:Env,request:Request,extra:number) {
 const day=today(), key=await dailyDigest(env,request,'challenge',day);
 try {await env.INTAKE.prepare('UPDATE daily_budgets SET used=MAX(0,MIN(?,used+?)) WHERE day=? AND digest=?').bind(policy.challenges.budget.perClientPerDay,extra,day,key).run();} catch {}
}
/** Aggregate counters only (no identifiers). With a cap, the increment happens only below it and the result says whether it did. */
export async function countModeration(env:Env,period:string,metric:string,cap?:number):Promise<boolean> {
 if(cap===undefined) {await env.INTAKE.prepare('INSERT INTO moderation_counters(period,metric,count) VALUES(?,?,1) ON CONFLICT(period,metric) DO UPDATE SET count=count+1').bind(period,metric).run();return true;}
 return !!await env.INTAKE.prepare('INSERT INTO moderation_counters(period,metric,count) VALUES(?,?,1) ON CONFLICT(period,metric) DO UPDATE SET count=count+1 WHERE count<? RETURNING count').bind(period,metric,cap).first();
}
const today=()=>new Date().toISOString().slice(0,10);
// Relevance checks and re-checks have separate daily caps, so spending one (for example with a flood of irrelevant
// challenges) never blocks the other. Challenges under the urgent (privacy and safety) rules have re-checks of their own.
type HostedCheck='relevance'|'recheck'|'urgentRecheck';
const hostedCheck=(env:Env,kind:HostedCheck)=>countModeration(env,today(),`challenge_${kind}_checks`,policy.challenges.hostedChecksPerDay[kind]);
/** Gives back a hosted check whose call failed, so a failing provider never uses up the day's capacity. Best effort. */
async function releaseHostedCheck(env:Env,kind:HostedCheck) {
 try {await env.INTAKE.prepare('UPDATE moderation_counters SET count=MAX(0,count-1) WHERE period=? AND metric=?').bind(today(),`challenge_${kind}_checks`).run();} catch {}
}
const isUrgent=(ruleId:string)=>(URGENT_CHALLENGE_RULES as readonly string[]).includes(ruleId);
const RELEVANCE_DOWN='relevance_unavailable_until', minuteNow=()=>Math.floor(Date.now()/60000);
async function relevanceDown(env:Env) {
 const row=await env.INTAKE.prepare('SELECT count FROM moderation_counters WHERE period=? AND metric=?').bind(today(),RELEVANCE_DOWN).first<{count:number}>();
 return !!row&&row.count>minuteNow();
}
/** After a failed hosted relevance call, skip it (and spend no budget on it) for a while; the ground terms decide meanwhile. */
async function markRelevanceDown(env:Env) {
 try {await env.INTAKE.prepare('INSERT INTO moderation_counters(period,metric,count) VALUES(?,?,?) ON CONFLICT(period,metric) DO UPDATE SET count=MAX(count,excluded.count)').bind(today(),RELEVANCE_DOWN,minuteNow()+policy.challenges.relevance.retryAfterMinutes).run();} catch {}
}

/**
 * Real-employer juries run only when the operator enables them; sandbox (practice) juries run whenever the juror token
 * protocol exists and the fictional employers are shown (SAMPLE_EMPLOYERS 'on'; policy 0.8.0).
 */
export function juryActive(env:Env,juryClass:JuryClass):boolean {
 return jurorProtocolAvailable()&&(juryClass==='sandbox'?samplesEnabled(env):settings(env).JURY_ENABLED==='true');
}
/** Fictional employers' cases are sandbox cases; everything else, including an unknown employer, is a real-employer case. */
export async function juryClassOf(env:Env,companyId:string):Promise<JuryClass> {
 const company=await env.DB.prepare('SELECT kind FROM companies WHERE id=?').bind(companyId).first<{kind:string}>();
 return company?.kind==='sample'?'sandbox':'mailbox';
}
/**
 * Employers with a live curated juror key, per class. A community key (created by the verifier for a domain someone
 * listed) never counts: anyone who controls a few domains could otherwise make real-employer juries formable and then
 * fill them (policy 0.8.0 communitySeatsPerCase). Community tokens still take their one shared seat where a jury forms.
 */
async function jurorEmployers(env:Env):Promise<Record<JuryClass,Set<string>>> {
 const out:Record<JuryClass,Set<string>>={sandbox:new Set(),mailbox:new Set()};
 for(const k of await publicIssuerKeys(env,'juror')) if(k.source!=='community') out[k.verificationClass==='mailbox'?'mailbox':'sandbox'].add(k.companySlug);
 return out;
}
/**
 * The keyed seat group of a juror on a case, and how many live seats that group may hold (null: no limit, no group).
 * Every community-source token, whichever listing it names, shares one group per case capped at communitySeatsPerCase;
 * other tokens are grouped by their employer under the class's seatsPerEmployer. The community label contains '=',
 * which no employer slug can (EMPLOYER_SLUG), so it never coincides with an employer's group.
 */
async function seatGroup(env:Env,caseId:string,juror:Pick<JurorCredential,'companySlug'|'jurorClass'|'source'>):Promise<{group:string|null;cap:number|null}> {
 // Keyed, because employer slugs are a small public set: a plain digest beside the vote would name the juror's employer.
 if(juror.source==='community') return {group:await keyedDigest(env,`siwt-seat-v2:${caseId}:source=community`),cap:communitySeatsPerCase()};
 const cap=policy.jury.seatsPerEmployer[juror.jurorClass];
 return cap===null?{group:null,cap:null}:{group:await keyedDigest(env,`siwt-seat-v2:${caseId}:${juror.companySlug}`),cap};
}
/**
 * Enough employers hold juror keys to reach the stage's 7-day quorum when each fills at most its seat limit. Where the
 * class keeps jurors off their own employer's cases (real employers), only other employers count: slug names the case's
 * employer (null: an employer with no key), and undefined asks about any case, whose own employer is assumed to hold a key
 * and so cannot staff it. Practice juries (policy 0.7.0) count every fictional employer with a key, the case's own too.
 */
const staffable=(employers:Set<string>,juryClass:JuryClass,stage:JuryStage,slug:string|null|undefined)=>(!ownEmployerExcluded(juryClass)?employers.size:slug===undefined?employers.size-1:[...employers].filter(s=>s!==slug).length)>=employersNeeded(juryClass,stage);
/**
 * A jury can form only if juries run for the class AND live juror keys of that class exist for enough employers (other
 * than the case's own, for real employers) to reach a decision under the per-employer seat limit
 * (policy.jury.seatsPerEmployer); otherwise the case could never close with a decision, and no receipt may say a jury is
 * deciding.
 */
export async function juryCanForm(env:Env,juryClass:JuryClass,companyId?:string|null,stage:JuryStage='initial'):Promise<boolean> {
 if(!juryActive(env,juryClass)) return false;
 const slug=companyId?(await env.DB.prepare('SELECT slug FROM companies WHERE id=?').bind(companyId).first<{slug:string}>())?.slug??null:undefined;
 return staffable((await jurorEmployers(env))[juryClass],juryClass,stage,slug);
}
/** Jurors see the account text with every locally detected identifier masked. */
export function maskPassage(text:string) {
 let masked=text;
 for(const finding of scanText(text)) masked=masked.split(finding.excerpt).join('[…]');
 return masked;
}
const loadCase=(env:Env,id:string)=>env.INTAKE.prepare('SELECT * FROM jury_cases WHERE id=?').bind(id).first<CaseRow>();

/**
 * Opens a case. opened_at keeps only the day (caseOpenedAt), never the time: a screening case opens inside submit, so a
 * time would be the submission time. content_hash is a digest of the unmasked words decided, so a final result follows
 * those exact words (finalResults); it is removed with the link to the contribution when the words are erased.
 */
async function openCase(env:Env,o:{stage:JuryStage;origin:CaseRow['origin'];parentId?:string|null;subjectId:string|null;subjectRevision:number;publicId:string|null;companyId:string;ruleId:string;passage:string}):Promise<string|null> {
 const seats=juryStage(o.stage), id=`case_${randomToken(12)}`;
 const inserted=await env.INTAKE.prepare('INSERT OR IGNORE INTO jury_cases(id,stage,parent_id,origin,subject_id,subject_revision,public_id,company_id,jury_class,rule_id,policy_version,policy_digest,passage,required,upheld_at,state,opened_at,period,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,o.stage,o.parentId??null,o.origin,o.subjectId,o.subjectRevision,o.publicId,o.companyId,await juryClassOf(env,o.companyId),o.ruleId,policy.version,await currentPolicyDigest(),maskPassage(o.passage),seats.jurors,seats.upheldAt,'open',caseOpenedAt(),quarter(),await digest(o.passage)).run();
 return inserted.meta.changes?id:null;
}
/**
 * The final jury results for these exact words of one contribution under the current policy, per rule: a first jury's
 * result (upheld or cleared; no quorum decides nothing), replaced by an appeal round's where one was decided (every
 * appealed rule cleared overturns the first result; otherwise the first result, upheld, stands).
 */
export async function finalResults(env:Env,subjectId:string,contentHash:string,current?:{revision:number;body:string}):Promise<Map<string,'upheld'|'cleared'>> {
 // Cases opened before intake 0005 carry no digest; those about the current revision decided the current words.
 const legacy=current&&current.body&&await digest(current.body)===contentHash?current.revision:-1;
 const cases=(await env.INTAKE.prepare("SELECT stage,rule_id,outcome,subject_revision FROM jury_cases WHERE subject_id=? AND (content_hash=? OR (content_hash IS NULL AND subject_revision=?)) AND policy_digest=? AND state<>'open' AND outcome IN ('upheld','cleared','no_quorum') ORDER BY rowid").bind(subjectId,contentHash,legacy,await currentPolicyDigest()).all<Pick<CaseRow,'stage'|'rule_id'|'outcome'|'subject_revision'>>()).results;
 const out=new Map<string,'upheld'|'cleared'>();
 for(const c of cases) if(c.stage==='initial'&&(c.outcome==='upheld'||c.outcome==='cleared')) out.set(c.rule_id,c.outcome);
 const rounds=new Map<number,typeof cases>();
 for(const c of cases) if(c.stage==='appeal') rounds.set(c.subject_revision,[...(rounds.get(c.subject_revision)??[]),c]);
 for(const round of rounds.values()) {const overturned=round.every(c=>c.outcome==='cleared');for(const c of round) out.set(c.rule_id,overturned?'cleared':'upheld');}
 return out;
}
/** The rules a challenge re-check withheld these exact published words under, under the current policy, or null. */
export async function recheckWithheld(env:Env,publicId:string,contentHash:string):Promise<string[]|null> {
 const row=await env.INTAKE.prepare("SELECT rules_json FROM rescreens WHERE public_id=? AND policy_digest=? AND action='repair' AND content_hash=?").bind(publicId,await currentPolicyDigest(),contentHash).first<{rules_json:string}>();
 if(!row) return null;
 try {const rules:unknown=JSON.parse(row.rules_json);return Array.isArray(rules)?rules.filter((r):r is string=>typeof r==='string'):[];} catch {return [];}
}
/**
 * Words withdrawn or expired: their decided cases lose every link to the contribution (the subject becomes one random
 * alias, so the quarter's counts are unchanged), to its public id and to the digest of the words, and any re-check of the
 * published words is deleted. Open cases are mooted first by the caller. Finality is moot once the words are gone.
 */
export async function forgetCases(env:Env,subjectId:string,publicId:string|null):Promise<void> {
 await env.INTAKE.batch([
  env.INTAKE.prepare("UPDATE jury_cases SET subject_id=?,public_id=NULL,content_hash=NULL,passage='' WHERE subject_id=? AND state<>'open'").bind(`erased:${randomToken(12)}`,subjectId),
  ...(publicId?[env.INTAKE.prepare('DELETE FROM rescreens WHERE public_id=?').bind(publicId)]:[]),
 ]);
}
/** The rules of a decision that go to a jury under the current policy (from 0.5.0, ABUSE-02 never does). */
export const juryRuleIds=(rules:readonly string[])=>rules.filter(id=>policy.rules.some(rule=>rule.id===id&&'juryRange' in rule));
/** The rules of the latest screening decision that held these words for a jury (submit or revise), or [] if none is logged. */
async function heldJuryRules(env:Env,row:Pick<SubmissionRow,'id'>):Promise<string[]> {
 const decision=await env.INTAKE.prepare("SELECT rules_json FROM actions WHERE submission_id=? AND action IN ('submit','revise') AND rule='jury' ORDER BY rowid DESC LIMIT 1").bind(row.id).first<{rules_json:string|null}>();
 try {const rules:unknown=decision?.rules_json?JSON.parse(decision.rules_json):[];return Array.isArray(rules)?rules.filter((r):r is string=>typeof r==='string'):[];} catch {return [];}
}
/**
 * Opens one initial case per jury rule of a held screening decision, when juries run for its class and the author allowed
 * anonymous jurors to read these unpublished words. True if a jury is deciding.
 */
export async function openScreeningCases(env:Env,row:Pick<SubmissionRow,'id'|'revision'|'company_id'|'body'|'jury_consent'>,rules:readonly string[]):Promise<boolean> {
 if(row.jury_consent!==1) return false;
 if(!await juryCanForm(env,await juryClassOf(env,row.company_id),row.company_id)) return false;
 // A rule a jury already decided for these exact words under this policy is never heard again (policy 0.6.0).
 const finals=await finalResults(env,row.id,await digest(row.body),{revision:row.revision,body:row.body});
 for(const ruleId of juryRuleIds(rules).filter(r=>!finals.has(r)))
  await openCase(env,{stage:'initial',origin:'screening',subjectId:row.id,subjectRevision:row.revision,publicId:null,companyId:row.company_id,ruleId,passage:row.body});
 return !!await env.INTAKE.prepare("SELECT 1 AS open FROM jury_cases WHERE subject_id=? AND subject_revision=? AND origin='screening' AND state='open'").bind(row.id,row.revision).first();
}
async function mootCase(env:Env,id:string) {
 await env.INTAKE.batch([
  env.INTAKE.prepare("UPDATE jury_cases SET state='closed',outcome='moot',passage='',closed_period=?,applied=1 WHERE id=? AND state='open'").bind(quarter(),id),
  env.INTAKE.prepare('DELETE FROM jury_assignments WHERE case_id=?').bind(id),
 ]);
}
/** Once an account is withheld, its other open challenge cases have nothing left to decide. */
async function mootItem(env:Env,publicId:string) {
 for(const c of (await env.INTAKE.prepare("SELECT id FROM jury_cases WHERE public_id=? AND state='open'").bind(publicId).all<{id:string}>()).results) await mootCase(env,c.id);
}
/** Ends, without a decision, the open cases about a subject whose words changed or were erased; their passages are erased. */
export async function mootCases(env:Env,subjectId:string,keepRevision?:number):Promise<number> {
 const open=(await env.INTAKE.prepare("SELECT id,subject_revision FROM jury_cases WHERE subject_id=? AND state='open'").bind(subjectId).all<{id:string;subject_revision:number}>()).results.filter(c=>keepRevision===undefined||c.subject_revision!==keepRevision);
 for(const c of open) await mootCase(env,c.id);
 return open.length;
}

/**
 * Closes a case atomically: tallies, outcome and state are computed from the stored votes inside one UPDATE, and the seats
 * (with their votes) are deleted in the same transaction. Only the caller whose token was written applies the outcome.
 * YES upholds only at the stage's strict majority of required seats; UNSURE abstains.
 */
async function closeCase(env:Env,c:CaseRow,now:Date):Promise<boolean> {
 const age=now.getTime()-Date.parse(c.opened_at), pastQuorumDay=age>=policy.jury.quorumAfterDays*DAY?1:0, pastLimit=age>=policy.jury.noQuorumAfterDays*DAY?1:0;
 const quorum=quorumFor(c.required), token=randomToken(12);
 const votes='(SELECT COUNT(vote) FROM jury_assignments WHERE case_id=?)', count=(vote:string)=>`(SELECT COUNT(*) FROM jury_assignments WHERE case_id=? AND vote='${vote}')`;
 const decided=`(${votes}>=required OR (?=1 AND ${votes}>=?))`, decidedArgs=[c.id,pastQuorumDay,c.id,quorum];
 const sql=`UPDATE jury_cases SET yes=${count('YES')},no=${count('NO')},unsure=${count('UNSURE')},outcome=CASE WHEN ${decided} THEN CASE WHEN ${count('YES')}>=upheld_at THEN 'upheld' ELSE 'cleared' END ELSE 'no_quorum' END,state=CASE WHEN ${decided} THEN 'closed' ELSE 'expired' END,passage='',closed_period=?,close_token=? WHERE id=? AND state='open' AND (${decided} OR ?=1)`;
 await env.INTAKE.batch([
  env.INTAKE.prepare(sql).bind(c.id,c.id,c.id,...decidedArgs,c.id,...decidedArgs,quarter(now),token,c.id,...decidedArgs,pastLimit),
  env.INTAKE.prepare('DELETE FROM jury_assignments WHERE case_id=? AND EXISTS(SELECT 1 FROM jury_cases WHERE id=? AND close_token=?)').bind(c.id,c.id,token),
 ]);
 const closed=await loadCase(env,c.id);
 if(!closed||closed.close_token!==token) return false;
 await applyCase(env,closed);
 return true;
}
/** Closes the case if every seat voted, if quorum was reached after 7 days, or with no quorum after 30 days. */
export async function settleCase(env:Env,id:string,now=new Date()):Promise<boolean> {
 const c=await loadCase(env,id);
 if(!c||c.state!=='open') return false;
 const votes=(await env.INTAKE.prepare('SELECT COUNT(vote) AS n FROM jury_assignments WHERE case_id=?').bind(id).first<{n:number}>())?.n??0;
 const age=now.getTime()-Date.parse(c.opened_at);
 if(votes>=c.required||(age>=policy.jury.quorumAfterDays*DAY&&votes>=quorumFor(c.required))||age>=policy.jury.noQuorumAfterDays*DAY) return closeCase(env,c,now);
 return false;
}
const pinOf=(c:CaseRow,rules=[c.rule_id]):Pin=>({policyVersion:c.policy_version,policyDigest:c.policy_digest,rules});
/** Applies a closed case to its subject. Every transition is guarded by the subject's status and revision, so re-applying is harmless. */
async function applyCase(env:Env,c:CaseRow) {
 if(c.outcome&&c.outcome!=='moot') {
  if(c.origin==='challenge') {
   // A challenged account stays published unless the jury upholds the rule; cleared and no-quorum change nothing.
   if(c.outcome==='upheld'&&c.public_id) {await withholdPublished(env,c.public_id,'jury_upheld',pinOf(c));await mootItem(env,c.public_id);}
  } else if(c.subject_id) await settleSubject(env,c);
 }
 await env.INTAKE.prepare('UPDATE jury_cases SET applied=1 WHERE id=?').bind(c.id).run();
}
/**
 * A held case can be under several rules at once (one case each). Any upheld rule holds it for repair (and ends the rest);
 * it is approved only when every rule is cleared; otherwise (no quorum on a rule) it is marked jury_no_quorum and the
 * ordinary hold expiry applies. After an appeal, cleared on every rule overturns the first result; an upheld or undecided
 * appeal leaves the first result final.
 */
async function settleSubject(env:Env,c:CaseRow) {
 const round=(await env.INTAKE.prepare("SELECT * FROM jury_cases WHERE subject_id=? AND subject_revision=? AND origin=? AND COALESCE(outcome,'')<>'moot'").bind(c.subject_id,c.subject_revision,c.origin).all<CaseRow>()).results;
 const appeal=c.origin==='appeal', action=appeal?'appeal':'jury', id=c.subject_id!;
 const upheld=round.filter(r=>r.outcome==='upheld');
 if(upheld.length) {
  for(const r of round) if(r.state==='open') await mootCase(env,r.id);
  await holdAfterJury(env,id,c.subject_revision,{action,rule:appeal?'APPEAL-UPHELD':'JURY-UPHELD',pin:pinOf(c,upheld.map(r=>r.rule_id))},'jury_upheld',true);
  return;
 }
 if(round.some(r=>r.state==='open')) return;
 const pin=pinOf(c,round.map(r=>r.rule_id));
 if(round.every(r=>r.outcome==='cleared')) {
  if(appeal) {
   const restored=await restoreWithheld(env,id,'jury_upheld',{action,rule:'APPEAL-OVERTURNED',pin},c.subject_revision);
   if(restored==='gone') await approveAfterJury(env,id,c.subject_revision,{action,rule:'APPEAL-OVERTURNED',pin});
  } else await approveAfterJury(env,id,c.subject_revision,{action,rule:'JURY-CLEARED',pin});
  return;
 }
 if(appeal) await holdAfterJury(env,id,c.subject_revision,{action,rule:'APPEAL-NO-QUORUM',pin},null,true);
 else await holdAfterJury(env,id,c.subject_revision,{action,rule:'JURY-NO-QUORUM',pin},'jury_no_quorum',false);
}

// ---- Jurors ----
/**
 * A juror token staffs a case only with the jury page's 18+ confirmation (adultConfirmed:true); anything else is refused
 * with adult_confirmation_required before the token is read or spent. Nothing about the confirmation is stored.
 */
// A missing token is answered like any other non-token (invalid_token), so token is optional here and checked by inspectJurorToken.
const tokenInput=z.object({token:z.unknown().optional(),adultConfirmed:z.unknown().optional()}).strict();
/** What a juror sees: one rule, one question, the masked passage. Never the stage, the author, other votes or an earlier result. */
function jurorView(c:CaseRow,expiresAt:string) {
 const rule=citableRule(c.rule_id,c.policy_version), document=policyVersions[c.policy_version as PolicyVersion] as {jury?:{question?:string}}|undefined;
 return {id:c.id,ruleId:c.rule_id,ruleName:rule?.name??c.rule_id,ruleText:rule?.text??'',question:document?.jury?.question??policy.jury.question,passage:c.passage,options:['YES','NO','UNSURE'] as const,policyVersion:c.policy_version,policyDigest:c.policy_digest,expiresAt};
}
async function assignJuror(env:Env,input:unknown):Promise<Response> {
 const {token,adultConfirmed}=tokenInput.parse(input);
 if(adultConfirmed!==true) return reply({error:'adult_confirmation_required'},400);
 let juror:JurorCredential;
 try {juror=await inspectJurorToken(env,token);}
 catch(error) {
  const message=error instanceof Error?error.message:'';
  if(message==='juror_tokens_unavailable') return reply({error:message},503);
  return reply({error:['unknown_issuer_key','credential_expired','invalid_signature'].includes(message)?message:'invalid_token'},400);
 }
 if(!juryActive(env,juror.jurorClass)) return reply({available:false,reason:'Juries for this kind of case are not active yet. Your token was not used.'});
 if(await env.INTAKE.prepare('SELECT 1 AS spent FROM spent_proofs WHERE nullifier=?').bind(`juror:${juror.nullifier}`).first()) return reply({error:'token_already_used'},409);
 const own=await env.DB.prepare('SELECT id FROM companies WHERE slug=?').bind(juror.companySlug).first<{id:string}>();
 const now=new Date(), nowIso=now.toISOString(), openSince=new Date(now.getTime()-policy.jury.noQuorumAfterDays*DAY).toISOString();
 const seated='(SELECT COUNT(*) FROM jury_assignments a WHERE a.case_id=c.id AND (a.vote IS NOT NULL OR a.expires_at>?))';
 // Class must match, and a work-mailbox juror never sits on a case about their own employer; a practice juror may (policy
 // 0.7.0: a fictional employer has no staff to protect, and anyone can hold its sandbox tokens). The draw is uniform over
 // eligible cases.
 const excluded=ownEmployerExcluded(juror.jurorClass)?own?.id??'':'';
 const candidates=(await env.INTAKE.prepare(`SELECT c.* FROM jury_cases c WHERE c.state='open' AND c.jury_class=? AND c.company_id<>? AND c.opened_at>? AND ${seated}<c.required ORDER BY random() LIMIT 200`).bind(juror.jurorClass,excluded,openSince,nowIso).all<CaseRow>()).results;
 const expiresAt=new Date(now.getTime()+policy.jury.assignmentHours*HOUR).toISOString();
 for(const c of shuffled(candidates).slice(0,20)) {
  // The seat limit is enforced inside the INSERT, so concurrent tokens of one group can never exceed it.
  const {group,cap}=await seatGroup(env,c.id,juror);
  const secret=`asg_${randomToken()}`, id=await digest(`siwt-assignment-v1:${secret}`);
  const live='(vote IS NOT NULL OR expires_at>?)';
  try {
   const [seat]=await env.INTAKE.batch([
    env.INTAKE.prepare(`INSERT INTO jury_assignments(id,case_id,seat_group,expires_at,vote) SELECT ?,?,?,?,NULL WHERE EXISTS(SELECT 1 FROM jury_cases WHERE id=? AND state='open') AND (SELECT COUNT(*) FROM jury_assignments WHERE case_id=? AND ${live})<? AND (? IS NULL OR (SELECT COUNT(*) FROM jury_assignments WHERE case_id=? AND seat_group=? AND ${live})<?)`).bind(id,c.id,group,expiresAt,c.id,c.id,nowIso,c.required,group,c.id,group,nowIso,cap??0),
    // The token is spent only together with a seat, and its nullifier is stored apart from the seat.
    env.INTAKE.prepare('INSERT INTO spent_proofs(nullifier,expires_at) SELECT ?,? WHERE EXISTS(SELECT 1 FROM jury_assignments WHERE id=?)').bind(`juror:${juror.nullifier}`,juror.expiresAt,id),
   ]);
   if(!seat?.meta.changes) continue;
  } catch(error) {
   if(String(error).includes('UNIQUE')) return reply({error:'token_already_used'},409);
   throw error;
  }
  return reply({available:true,assignment:secret,case:jurorView(c,expiresAt)});
 }
 // A class whose juror keys cannot staff any case to a decision under the seat limit gets the prerequisite, not "later".
 if(!await juryCanForm(env,juror.jurorClass)) {
  const cap=seatsPerEmployer(juror.jurorClass),kind=juror.jurorClass==='sandbox'?'fictional':'real',need=employersNeeded(juror.jurorClass,'initial');
  const employers=`${ownEmployerExcluded(juror.jurorClass)?'other ':''}${kind} employer${need===1?'':'s'}`;
  const community=juror.source==='community'?` Employers added by the community do not count toward this, and their tokens together fill at most ${communitySeatsPerCase()} seat${communitySeatsPerCase()===1?'':'s'} on a case.`:'';
  return reply({available:false,reason:`No ${juror.jurorClass==='sandbox'?'practice ':''}jury can form yet: a case needs live juror keys of at least ${need} ${employers} (${employersNeeded(juror.jurorClass,'appeal')} for an appeal)${cap===null?'':`, because tokens of one employer fill at most ${cap} seats on a case`}.${community} Your token was not used.`});
 }
 return reply({available:false,reason:`No case needs a juror with this token right now.${juror.source==='community'?` Tokens of employers added by the community together fill at most ${communitySeatsPerCase()} seat${communitySeatsPerCase()===1?'':'s'} on a case, so open cases may already have theirs.`:''} Your token was not used; try again later.`});
}
const voteInput=z.object({assignment:z.string().regex(/^asg_[A-Za-z0-9_-]{43}$/),vote:z.enum(['YES','NO','UNSURE'])}).strict();
async function castVote(env:Env,input:unknown):Promise<Response> {
 const data=voteInput.parse(input), id=await digest(`siwt-assignment-v1:${data.assignment}`), nowIso=new Date().toISOString();
 const seat=await env.INTAKE.prepare('SELECT a.case_id,a.vote,a.expires_at,c.state FROM jury_assignments a JOIN jury_cases c ON c.id=a.case_id WHERE a.id=?').bind(id).first<{case_id:string;vote:string|null;expires_at:string;state:string}>();
 if(!seat) return reply({recorded:false,error:'assignment_not_found'},404);
 if(seat.vote) return reply({recorded:false,error:'already_voted'},409);
 if(seat.state!=='open') return reply({recorded:false,error:'case_closed'},409);
 if(seat.expires_at<=nowIso) return reply({recorded:false,error:'assignment_expired'},410);
 const updated=await env.INTAKE.prepare("UPDATE jury_assignments SET vote=? WHERE id=? AND vote IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM jury_cases WHERE id=? AND state='open')").bind(data.vote,id,nowIso,seat.case_id).run();
 if(!updated.meta.changes) return reply({recorded:false,error:'already_voted'},409);
 await settleCase(env,seat.case_id);
 return reply({recorded:true});
}

// ---- Challenges ----
const challengeInput=z.object({testimonyId:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),ruleId:z.string().regex(/^[A-Z]{2,8}-\d{2}$/),reason:z.string().trim().min(10).max(policy.challenges.reasonMaxChars)}).strict();
const relevanceReply=z.object({mapsToRule:z.number().min(0).max(1),reputationalOnly:z.number().min(0).max(1),model:z.string().max(160).optional(),provider:z.string().max(40).optional(),promptVersion:z.string().max(120).optional()});
/**
 * Does the reason describe how the account breaks the cited rule? Jev answers two narrow questions and this code applies
 * the published thresholds; any failure, malformed reply or spent budget falls back to the published ground terms. The
 * reason reaches Jev only after the identifier scan and with every remaining detected detail masked; only it and the
 * public rule are sent. A failing endpoint is skipped for a while so it cannot drain the daily relevance budget.
 */
async function relevance(env:Env,rule:CitableRule,reason:string):Promise<{relevant:boolean;source:string}> {
 const fallback=()=>({relevant:groundsMatch(rule.id,reason),source:'published ground terms'});
 if(!env.INFERENCE||await relevanceDown(env)||!await hostedCheck(env,'relevance')) return fallback();
 try {
  const response=await env.INFERENCE.fetch('https://inference/relevance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({rule:{id:rule.id,name:rule.name,text:rule.text},reason:maskPassage(reason)}),signal:AbortSignal.timeout(9000)});
  if(!response.ok) {await markRelevanceDown(env);return fallback();}
  const parsed=relevanceReply.safeParse(await response.json());
  if(!parsed.success) return fallback();
  const thresholds=policy.challenges.relevance;
  return {relevant:parsed.data.mapsToRule>=thresholds.mapsToRuleAt&&parsed.data.reputationalOnly<thresholds.reputationalOnlyBelow,source:`Jev${parsed.data.model?` (${parsed.data.model})`:''}`};
 } catch {await markRelevanceDown(env);return fallback();}
}
type Recheck={action:string;rules:string[];provenance:Provenance};
type RescreenRow={action:string;rules_json:string;provider:string|null;provider_fallback:string|null;key_source:string|null;model:string|null;prompt_version:string|null};
const provenanceOf=(r:Pick<RescreenRow,'provider'|'provider_fallback'|'key_source'|'model'|'prompt_version'>):Provenance=>({provider:r.provider,providerFallback:r.provider_fallback,keySource:r.key_source,model:r.model,promptVersion:r.prompt_version});
/**
 * One re-check per account and policy version, reused afterwards so repeated challenges cannot re-roll the model. Stores
 * the decision, which model made it and a digest of the words it decided, never signals. A challenge under an urgent
 * (privacy or safety) rule draws on its own daily re-checks first. null when no re-check could run: no capacity is left,
 * or the hosted check failed (and is then not counted).
 */
async function rescreen(env:Env,item:{id:string;body:string},urgent=false):Promise<Recheck|null> {
 const policyDigest=await currentPolicyDigest();
 const cached=await env.INTAKE.prepare('SELECT action,rules_json,provider,provider_fallback,key_source,model,prompt_version FROM rescreens WHERE public_id=? AND policy_digest=?').bind(item.id,policyDigest).first<RescreenRow>();
 if(cached) return {action:cached.action,rules:JSON.parse(cached.rules_json) as string[],provenance:provenanceOf(cached)};
 let decision:{action:string;rules:string[]},provenance:Provenance;
 // A direct identifier is found locally and never sent to a hosted model.
 if(scanText(item.body).some(identifies)) {decision={action:'repair',rules:['PRIVACY-SCAN']};provenance={provider:'local identifier scan',providerFallback:null,keySource:null,model:null,promptVersion:null};}
 else {
  if(!env.INFERENCE) return null;
  const kind:HostedCheck|null=urgent&&await hostedCheck(env,'urgentRecheck')?'urgentRecheck':await hostedCheck(env,'recheck')?'recheck':null;
  if(!kind) return null;
  const screened=await screenApprovedText(env,item.body);
  if(screened.decision.rules[0]==='CHECKS-UNAVAILABLE') {await releaseHostedCheck(env,kind);return null;}
  decision={action:screened.decision.action,rules:screened.decision.rules};
  provenance={provider:screened.provider,providerFallback:screened.providerFallback,keySource:screened.keySource,model:screened.model,promptVersion:screened.promptVersion};
 }
 await env.INTAKE.prepare('INSERT OR IGNORE INTO rescreens(public_id,policy_digest,policy_version,action,rules_json,provider,provider_fallback,key_source,model,prompt_version,period,content_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(item.id,policyDigest,policy.version,decision.action,JSON.stringify(decision.rules),provenance.provider,provenance.providerFallback,provenance.keySource,provenance.model,provenance.promptVersion,quarter(),await digest(item.body)).run();
 return {...decision,provenance};
}
/**
 * A jury decision about the same published words, rule and policy version is final: any appeal, a first jury that did
 * not uphold the rule, or one that reached no decision. Cases name the published account when the challenge opened them,
 * when an appeal copies it from the first case, or when held words that a jury decided are published.
 */
async function decidedFor(env:Env,publicId:string,ruleId:string,policyDigest:string) {
 return env.INTAKE.prepare("SELECT id,stage,outcome FROM jury_cases WHERE public_id=? AND rule_id=? AND policy_digest=? AND state<>'open' AND COALESCE(outcome,'moot')<>'moot' AND (stage='appeal' OR outcome IN ('cleared','no_quorum')) ORDER BY stage='appeal' DESC LIMIT 1").bind(publicId,ruleId,policyDigest).first<{id:string;stage:string;outcome:string}>();
}
function decidedExplanation(decided:{stage:string;outcome:string},ruleId:string,version:string) {
 if(decided.stage==='appeal') return `An appeal jury already decided ${ruleId} for these published words under policy ${version}. Appeal decisions are final until the policy changes, so this challenge was merged into it.`;
 if(decided.outcome==='cleared') return `A jury already heard ${ruleId} for these published words under policy ${version} and did not uphold it. That decision stands until the policy changes, so this challenge was merged into it.`;
 return `A jury was convened under ${ruleId} for these published words under policy ${version} but reached no decision within ${policy.jury.noQuorumAfterDays} days. The account stays published, and ${ruleId} is not heard again for these words until the policy changes.`;
}
type ChallengeItem={id:string;body:string;company_id:string};
type ChallengeAuthor={id:string;revision:number;status:string};
/** How one challenge is answered: its decision path, outcome and the explanation its sender reads. */
interface Resolution {path:string;outcome:ChallengeOutcome;explanation:string;caseId?:string|null;relevance?:string|null}
/** A challenge already settled for this account and rule before any re-check: merged into an open or decided case, or answered by an earlier clear re-check. */
async function settledBefore(env:Env,item:ChallengeItem,rule:CitableRule,version:string,policyDigest:string):Promise<Resolution|null> {
 const open=await env.INTAKE.prepare("SELECT id FROM jury_cases WHERE public_id=? AND rule_id=? AND state='open'").bind(item.id,rule.id).first<{id:string}>();
 if(open) return {path:'duplicate_open',outcome:'merged',explanation:`A jury case under ${rule.id} is already open for this account, so this challenge was merged into it. The account stays published while the jury decides.`,caseId:open.id};
 const decided=await decidedFor(env,item.id,rule.id,policyDigest);
 if(decided) return {path:'duplicate_decided',outcome:'merged',explanation:decidedExplanation(decided,rule.id,version),caseId:decided.id};
 const cached=await env.INTAKE.prepare('SELECT action,rules_json FROM rescreens WHERE public_id=? AND policy_digest=?').bind(item.id,policyDigest).first<{action:string;rules_json:string}>();
 if(cached?.action==='clear') return {path:'rescreen_clear',outcome:'rejected',explanation:`This account was already re-checked under policy ${version} and meets no rule's threshold, including ${rule.id}.`};
 return null;
}
/**
 * Re-checks the published words of a relevant challenge and applies the published rules. null when no re-check can run
 * now (the challenge is then queued, never refused); 'gone' when the account stopped being public meanwhile.
 */
async function resolveRelevant(env:Env,item:ChallengeItem,author:ChallengeAuthor|null,rule:CitableRule,source:string|null,version:string,policyDigest:string):Promise<Resolution|'gone'|null> {
 const decision=await rescreen(env,item,isUrgent(rule.id));
 if(!decision) return null;
 if(decision.action==='repair') {
  const result=await withholdPublished(env,item.id,'challenge_repair',{policyVersion:version,policyDigest,rules:decision.rules,provenance:decision.provenance});
  if(result==='gone'||result==='practice') return 'gone';
  await mootItem(env,item.id);
  // What the re-check found could help identify the author, so only the author's receipt names the rule and the model.
  return {path:'rescreen_repair',outcome:'withheld_for_repair',explanation:`Re-checked under policy ${version}, this account is withheld from publication under the published rules${result==='withheld'?' while its author can repair it. Only its author is told which rule applied':''}.`,relevance:source};
 }
 if(decision.action==='jury'&&decision.rules.includes(rule.id)) {
  const juryClass=await juryClassOf(env,item.company_id);
  if(!await juryCanForm(env,juryClass,item.company_id)) return {path:'jury_unavailable',outcome:'rejected',explanation:`Re-checked under policy ${version}, this account falls in the jury range of ${rule.id}, but juries for this kind of account are not active yet. Nothing changes: the account stays published as attributed testimony.`,relevance:source};
  const caseId=await openCase(env,{stage:'initial',origin:'challenge',subjectId:author?.id??null,subjectRevision:author?.revision??0,publicId:item.id,companyId:item.company_id,ruleId:rule.id,passage:item.body});
  if(!caseId) {
   const raced=await env.INTAKE.prepare("SELECT id FROM jury_cases WHERE public_id=? AND rule_id=? AND state='open'").bind(item.id,rule.id).first<{id:string}>();
   return {path:'duplicate_open',outcome:'merged',explanation:`A jury case under ${rule.id} is already open for this account, so this challenge was merged into it.`,caseId:raced?.id??null};
  }
  return {path:'jury',outcome:'jury',explanation:`Re-checked under policy ${version}, this account falls in the jury range of ${rule.id}. ${policy.jury.initial} randomly drawn anonymous jurors will decide; the account stays published meanwhile.`,caseId,relevance:source};
 }
 return {path:'rescreen_clear',outcome:'rejected',explanation:`Re-checked under policy ${version}, this account does not meet ${rule.id}'s threshold, so it stays published.`,relevance:source};
}
/**
 * Why a reason that does not describe how an account breaks the cited rule changes nothing, quoted from the current
 * policy rather than restated: what a challenge needs (reputational discomfort, disagreement and a claim that an
 * allegation is untrue are not grounds) and each protection that keeps such an account published.
 */
export function notGroundsNote():string {
 return [policy.challenges.grounds,...policy.protections.map(p=>`${p.id} (${p.name}): ${p.text}`)].join(' ');
}
const insertChallenge=(env:Env,id:string,publicId:string,ruleId:string,version:string,policyDigest:string,period:string,r:Resolution)=>env.INTAKE.prepare('INSERT INTO challenges(id,public_id,rule_id,policy_version,policy_digest,path,outcome,relevance,case_id,period) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,publicId,ruleId,version,policyDigest,r.path,r.outcome,r.relevance??null,r.caseId??null,period);
/**
 * Anyone may challenge a published account under one cited rule, on equal terms: the request carries no identity and no
 * organization can be given different handling. Outcomes are decided by published rules and the pinned policy, never by
 * the reason text: a reason can at most trigger one re-check of the published words; it cannot remove anything itself.
 * A challenge refused before it is considered (an identifying reason, an account that is not public) costs no daily
 * budget, and a relevant challenge that cannot be re-checked now is queued with a receipt rather than refused.
 */
async function challenge(env:Env,input:unknown,request:Request):Promise<Response> {
 if(!challengesOpen(env)) return reply({error:'challenges_disabled'},503);
 const data=challengeInput.parse(input);
 const rule=citableRule(data.ruleId);
 if(!rule) return reply({error:'unknown_rule'},400);
 // limit names which budget ran out (the client's own), so the reply can say when to try again.
 if(!await spendBurst(env,request,1)) return reply({error:'rate_limited',limit:'burst'},429);
 // A reason that identifies someone is refused; text addressed to the checks is masked before Jev reads it (maskPassage).
 if(scanText(data.reason).some(identifies)) return reply({error:'remove_identifying_details'},422);
 if(!await spendDaily(env,request)) return reply({error:'rate_limited',limit:'daily'},429);
 // An account of a hidden fictional employer is as absent as any other unpublished id.
 const item=await env.DB.prepare(`SELECT t.id,t.body,t.company_id FROM testimony t JOIN companies c ON c.id=t.company_id WHERE t.id=? AND t.withdrawn_at IS NULL AND ${visibleCompanySql(env,'c')}`).bind(data.testimonyId).first<ChallengeItem>();
 if(!item) {await chargeDaily(env,request,-1);return reply({error:'not_found'},404);}
 const author=await env.INTAKE.prepare('SELECT id,revision,status FROM submissions WHERE public_id=?').bind(item.id).first<ChallengeAuthor>();
 if(author&&author.status!=='published') {await chargeDaily(env,request,-1);return reply({error:'not_challengeable_now'},409);}
 const version=policy.version, policyDigest=await currentPolicyDigest(), period=quarter();
 const record=async(r:Resolution)=>{
  const id=`chr_${randomToken(12)}`;
  await insertChallenge(env,id,item.id,rule.id,version,policyDigest,period,r).run();
  return reply({outcome:r.outcome,explanation:r.explanation,receipt:{id,ruleId:rule.id,policyVersion:version,policyDigest,path:r.path,outcome:r.outcome,period}});
 };
 // A protection (no risk signal) only ever protects.
 if(rule.signal===null) return record({path:'protected_rule',outcome:'rejected',explanation:`${rule.id} protects accounts; it is never a ground for removal. ${rule.text}`});
 // A seeded fictional sample account has no author and cannot be withheld by a challenge or a jury. The challenge is
 // recorded as a practice case: no hosted check, no re-check and no jury; only the published ground terms are applied.
 if(!author&&await isSampleEmployer(env,item.company_id)) {
  const relevant=groundsMatch(rule.id,data.reason);
  return record({path:'practice_fixture',outcome:'rejected',explanation:`This is a seeded fictional sample account, so a challenge or a jury can never withhold it. Your challenge was recorded as a practice case: nothing was re-checked, no jury was drawn and the account stays published. Under the published ground terms, your reason ${relevant?'would':'would not'} count as relevant to ${rule.id} (${rule.name}).${relevant?'':` ${notGroundsNote()}`} For a contributed account, Jev (or these ground terms when Jev is unavailable) judges relevance, and a relevant challenge re-checks the published words.`,relevance:'published ground terms (practice)'});
 }
 const before=await settledBefore(env,item,rule,version,policyDigest);
 if(before) return record(before);
 const check=await relevance(env,rule,data.reason);
 if(!check.relevant) {
  // Friction for rejected challenges: they cost more of the client's budgets.
  await spendBurst(env,request,2);await chargeDaily(env,request,policy.challenges.budget.notRelevantExtra);
  return record({path:'not_relevant',outcome:'rejected',explanation:`The reason does not describe how this account breaks ${rule.id} (${rule.name}). ${notGroundsNote()}`,relevance:check.source});
 }
 const resolved=await resolveRelevant(env,item,author,rule,check.source,version,policyDigest);
 if(resolved==='gone') return reply({error:'not_found'},404);
 if(resolved) return record(resolved);
 // No re-check could run now: queued under the receipt id given here, never refused (policy 0.6.0 challenges.queue).
 const id=`chr_${randomToken(12)}`, urgent=isUrgent(rule.id);
 const queued=await env.INTAKE.prepare('INSERT OR IGNORE INTO challenge_queue(id,public_id,rule_id,urgent,policy_version,policy_digest,relevance,period) VALUES(?,?,?,?,?,?,?,?)').bind(id,item.id,rule.id,urgent?1:0,version,policyDigest,check.source,period).run();
 if(!queued.meta.changes) return record({path:'duplicate_queued',outcome:'merged',explanation:`A challenge under ${rule.id} to this account is already queued for its re-check, so this challenge was merged into it. The account stays published meanwhile.`,relevance:check.source});
 return reply({outcome:'queued',explanation:`The published words could not be re-checked right now (today's re-checks are used up, or the check is unavailable), so nothing has changed yet. Your challenge was not refused: it is queued under this receipt, and the scheduled job re-checks queued challenges${urgent?', those under the privacy and safety rules like this one first,':', those under the privacy and safety rules first,'} as capacity returns, then applies the published rules. The account stays published meanwhile. The result is recorded under this receipt id; nobody is notified.`,receipt:{id,ruleId:rule.id,policyVersion:version,policyDigest,path:'queued_recheck',outcome:'queued',period}});
}
type QueuedChallenge={id:string;public_id:string;rule_id:string;urgent:number;relevance:string|null};
/**
 * Re-checks queued challenges, urgent (privacy and safety) rules first and then in arrival order, while re-check capacity
 * lasts, applying the published rules exactly as an immediate re-check would. Each is recorded in challenges under the
 * receipt id its sender holds. It stops at the first challenge that still cannot be re-checked.
 */
async function recheckQueued(env:Env):Promise<number> {
 const queued=(await env.INTAKE.prepare('SELECT id,public_id,rule_id,urgent,relevance FROM challenge_queue ORDER BY urgent DESC,rowid LIMIT 50').all<QueuedChallenge>()).results;
 const version=policy.version, policyDigest=await currentPolicyDigest(), period=quarter();
 let done=0;
 for(const q of queued) {
  const rule=citableRule(q.rule_id);
  const item=await env.DB.prepare('SELECT id,body,company_id FROM testimony WHERE id=? AND withdrawn_at IS NULL').bind(q.public_id).first<ChallengeItem>();
  const author=item?await env.INTAKE.prepare('SELECT id,revision,status FROM submissions WHERE public_id=?').bind(item.id).first<ChallengeAuthor>():null;
  if(author?.status==='publishing') continue;
  let resolution:Resolution|'gone'|null;
  if(!item||(author&&author.status!=='published')) resolution='gone';
  else if(!rule||rule.signal===null) resolution={path:'rule_retired',outcome:'rejected',explanation:'',relevance:q.relevance};
  else resolution=await settledBefore(env,item,rule,version,policyDigest)??await resolveRelevant(env,item,author,rule,q.relevance,version,policyDigest);
  if(resolution===null) break;
  if(resolution==='gone') resolution={path:'account_gone',outcome:'rejected',explanation:'',relevance:q.relevance};
  await env.INTAKE.batch([insertChallenge(env,q.id,q.public_id,q.rule_id,version,policyDigest,period,resolution),env.INTAKE.prepare('DELETE FROM challenge_queue WHERE id=?').bind(q.id)]);
  done++;
 }
 return done;
}

// ---- Authors ----
const capabilityInput=z.object({capability:z.string().min(1).max(100)}).strict();
/**
 * Revisions whose words are exactly words already decided under the current policy (submissions.ts authorAction): the
 * decision is applied again instead of re-screening or drawing a new jury. The logged rule names which.
 */
export const FINAL_RULES:Record<string,{path:string;outcome:string}>={
 final_upheld:{path:'final jury result for these exact words',outcome:'held: a jury upheld a rule for these words'},
 final_withheld:{path:'challenge re-check of these exact words',outcome:'held: a challenge re-check withheld these words'},
 final_cleared:{path:'automated screening of revised words; final jury result for these exact words',outcome:'approved: a jury already cleared these words'},
};
const ACTION_RECEIPTS:Record<string,{kind:Receipt['kind'];path:(rule:string)=>string;outcome:(rule:string)=>string}>={
 submit:{kind:'screening',path:()=>'automated screening',outcome:rule=>rule==='clear'?'approved':rule==='jury'?'held for a jury':rule},
 revise:{kind:'screening',path:rule=>FINAL_RULES[rule]?.path??'automated screening of revised words',outcome:rule=>FINAL_RULES[rule]?.outcome??(rule==='clear'?'approved':rule==='jury'?'held for a jury':rule)},
 hold:{kind:'rescan',path:()=>'identifier re-scan before publication',outcome:()=>'held for repair'},
 publish:{kind:'publication',path:rule=>rule==='RESTORE'?'restored under its original public id':'batch publication',outcome:()=>'published'},
 withhold:{kind:'withhold',path:rule=>rule==='CHALLENGE-REPAIR'?'challenge re-check':rule==='EXCEPTION'?'trustee exception':rule==='EXCEPTION-RENEWED'?'trustee exception renewed':'jury decision',outcome:rule=>rule==='EXCEPTION-RENEWED'?'still withheld':'withheld for repair'},
 restore:{kind:'restore',path:rule=>rule,outcome:()=>'returned to the approved queue'},
 withdraw:{kind:'erasure',path:()=>'author withdrawal',outcome:()=>'withdrawn and erased'},
 expire:{kind:'erasure',path:rule=>rule==='HELD-30D'?'held case not repaired in time':'no batch formed in time',outcome:()=>'expired and erased'},
};
type ActionRow={id:string;action:string;rule:string;period:string;policy_version:string|null;policy_digest:string|null;rules_json:string|null;provider:string|null;model:string|null;prompt_version:string|null};
async function receiptsFor(env:Env,row:SubmissionRow,cases:CaseRow[]):Promise<Receipt[]> {
 const actions=(await env.INTAKE.prepare('SELECT id,action,rule,period,policy_version,policy_digest,rules_json,provider,model,prompt_version FROM actions WHERE submission_id=? ORDER BY rowid').bind(row.id).all<ActionRow>()).results;
 const receipts:Receipt[]=[];
 for(const a of actions) {
  const map=ACTION_RECEIPTS[a.action];if(!map) continue;
  let rules:string[]=[];try {rules=a.rules_json?JSON.parse(a.rules_json) as string[]:[];} catch {}
  receipts.push({id:a.id,kind:map.kind,ruleIds:rules,policyVersion:a.policy_version,policyDigest:a.policy_digest,model:a.model,provider:a.provider,promptVersion:a.prompt_version,path:map.path(a.rule),outcome:map.outcome(a.rule),period:a.period});
 }
 const challenges=row.public_id?(await env.INTAKE.prepare('SELECT id,rule_id,policy_version,policy_digest,path,outcome,relevance,period FROM challenges WHERE public_id=? ORDER BY rowid').bind(row.public_id).all<{id:string;rule_id:string;policy_version:string;policy_digest:string;path:string;outcome:string;relevance:string|null;period:string}>()).results:[];
 // A challenge that reached the re-check names the model that re-checked the published words.
 const rechecks=new Map(row.public_id?(await env.INTAKE.prepare('SELECT policy_digest,provider,provider_fallback,key_source,model,prompt_version FROM rescreens WHERE public_id=?').bind(row.public_id).all<RescreenRow&{policy_digest:string}>()).results.map(r=>[r.policy_digest,provenanceOf(r)]):[]);
 const RECHECKED=['rescreen_clear','rescreen_repair','jury','jury_unavailable'];
 for(const ch of challenges) {
  const recheck=RECHECKED.includes(ch.path)?rechecks.get(ch.policy_digest):undefined;
  receipts.push({id:ch.id,kind:'challenge',ruleIds:[ch.rule_id],policyVersion:ch.policy_version,policyDigest:ch.policy_digest,model:recheck?.model??null,provider:recheck?.provider??null,promptVersion:recheck?.promptVersion??null,relevance:ch.relevance,path:`challenge: ${ch.path.replace(/_/g,' ')}`,outcome:ch.outcome,period:ch.period});
 }
 for(const c of cases) if(c.outcome!=='moot') receipts.push({id:c.id,kind:c.stage==='appeal'?'appeal':'jury',ruleIds:[c.rule_id],policyVersion:c.policy_version,policyDigest:c.policy_digest,model:null,provider:null,promptVersion:null,path:`${c.required} randomly drawn anonymous jurors`,outcome:c.state==='open'?'open':c.outcome??'open',...(c.state!=='open'?{votes:{yes:c.yes,no:c.no,unsure:c.unsure,required:c.required}}:{}),period:c.state==='open'?c.period:c.closed_period??c.period});
 return receipts.sort((a,b)=>a.period.localeCompare(b.period));
}
/**
 * Upheld initial cases at the subject's latest upheld round; the author may appeal them once, as long as the words are
 * unchanged. An appeal about these exact words under the current policy counts at any revision, so revising back to the
 * same words never opens a second appeal.
 */
async function appealState(env:Env,row:SubmissionRow,cases:CaseRow[]):Promise<{available:boolean;state?:string;upheld:CaseRow[]}> {
 const currentDigest=await currentPolicyDigest(), words=row.body?await digest(row.body):null;
 const sameWords=(c:CaseRow)=>!!words&&c.content_hash===words&&c.policy_digest===currentDigest;
 const appeals=cases.filter(c=>c.stage==='appeal'&&(c.subject_revision===row.revision||sameWords(c))&&c.outcome!=='moot');
 if(appeals.length) return {available:false,state:appeals.some(c=>c.state==='open')?'open':'decided',upheld:[]};
 if(row.status!=='held'||row.hold_reason!=='jury_upheld') return {available:false,upheld:[]};
 const initial=cases.filter(c=>c.stage==='initial'&&c.outcome==='upheld'&&(!words||!c.content_hash||c.content_hash===words));
 const latest=Math.max(-1,...initial.map(c=>c.subject_revision));
 const upheld=initial.filter(c=>c.subject_revision===latest);
 return {available:upheld.length>0&&await juryCanForm(env,upheld[0]!.jury_class,row.company_id,'appeal'),upheld};
}
const casesOf=async(env:Env,subjectId:string)=>(await env.INTAKE.prepare('SELECT * FROM jury_cases WHERE subject_id=? ORDER BY opened_at DESC,rowid DESC').bind(subjectId).all<CaseRow>()).results;
async function juryContext(env:Env,row:SubmissionRow,cases:CaseRow[]):Promise<ReleaseContext> {
 const appeal=await appealState(env,row,cases);
 const screening=cases.filter(c=>c.origin==='screening'&&c.subject_revision===row.revision), juryOpen=screening.some(c=>c.state==='open');
 // Held for a jury with no case for these words: a case is still to be opened (only for a rule that goes to a jury
 // under the current policy, since the scheduled job opens no other), the author did not allow juror review, or the words
 // were held under an earlier policy for a rule that no longer goes to a jury (ABUSE-02 before 0.5.0).
 let juryPending=false,juryDeclined=false,juryRuleRetired=false;
 if(row.status==='held'&&row.hold_reason==='jury'&&!screening.length) {
  const held=await heldJuryRules(env,row),current=juryRuleIds(held);
  if(held.length&&!current.length) juryRuleRetired=true;
  else if(current.length&&await juryCanForm(env,await juryClassOf(env,row.company_id),row.company_id)) {if(row.jury_consent===1) juryPending=true; else juryDeclined=true;}
 }
 return {juryOpen,juryPending,juryDeclined,juryRuleRetired,appealAvailable:appeal.available,appealOpen:appeal.state==='open',appealDecided:appeal.state==='decided'};
}
/** The jury facts an author's receipt copy depends on, so every status response describes the case's real state. */
export async function moderationContext(env:Env,row:SubmissionRow):Promise<ReleaseContext> {return juryContext(env,row,await casesOf(env,row.id));}
async function authorStatus(env:Env,input:unknown):Promise<Response> {
 const {capability}=capabilityInput.parse(input);
 const row=await findByCapability(env,capability);
 if(!row) return reply({error:'not_found'},404);
 const cases=await casesOf(env,row.id), latest=cases.find(c=>c.outcome!=='moot'), appeal=await appealState(env,row,cases), context=await juryContext(env,row,cases);
 const decisionRow=await env.INTAKE.prepare("SELECT rule,policy_version,policy_digest,rules_json FROM actions WHERE submission_id=? AND action IN ('submit','revise') ORDER BY rowid DESC LIMIT 1").bind(row.id).first<{rule:string;policy_version:string|null;policy_digest:string|null;rules_json:string|null}>();
 const publicationPaused=paused(env,row.verification_class);
 // revision lets a repair sign without a second capability round trip; repairable and juryOpen mirror the revise reply.
 return reply({
  status:row.status,
  revision:row.revision,
  repairable:row.status==='held'&&row.hold_reason!=='exception',
  juryOpen:!!context.juryOpen,
  ...(row.hold_reason?{holdReason:row.hold_reason}:{}),
  ...(decisionRow?{decision:{action:decisionRow.rule,policyVersion:decisionRow.policy_version,policyDigest:decisionRow.policy_digest,rules:decisionRow.rules_json?JSON.parse(decisionRow.rules_json) as string[]:[]}}:{}),
  ...(latest?{case:{stage:latest.stage,state:latest.state,ruleId:latest.rule_id,...(latest.state!=='open'&&latest.outcome?{outcome:latest.outcome}:{})}}:{}),
  appeal:{available:appeal.available,...(appeal.state?{state:appeal.state}:{})},
  receipts:await receiptsFor(env,row,cases),
  publicationPaused,
  releasePolicy:releasePolicy(row.status,publicationPaused,row.hold_reason,context,batchRuleFor(env,row)),
 });
}
/** Appeals are automatic for the author: no argument is needed. A new, larger jury is drawn and is never shown the first result. */
async function appeal(env:Env,input:unknown):Promise<Response> {
 const {capability}=capabilityInput.parse(input);
 const row=await findByCapability(env,capability);
 if(!row) return reply({error:'not_found'},404);
 const cases=await casesOf(env,row.id), state=await appealState(env,row,cases);
 if(state.state) return reply({error:'appeal_already_made',state:state.state},409);
 if(!state.upheld.length) return reply({error:'appeal_not_available'},409);
 if(!state.available) return reply({error:'jury_not_active'},409);
 let first:string|null=null;
 for(const upheld of state.upheld) {
  // The appeal names the same published account as the first case (if any), so its result is final for those words.
  const id=await openCase(env,{stage:'appeal',origin:'appeal',parentId:upheld.id,subjectId:row.id,subjectRevision:row.revision,publicId:upheld.public_id,companyId:row.company_id,ruleId:upheld.rule_id,passage:row.body});
  first??=id;
 }
 if(!first) return reply({error:'appeal_already_made'},409);
 return reply({caseId:first,stage:'appeal',state:'open'});
}

// ---- Trustee exceptions (break-glass; disabled while TRUSTEE_KEYS is unset) ----
async function exception(env:Env,request:Request):Promise<Response> {
 const trustees=parseTrustees(settings(env).TRUSTEE_KEYS);
 if(!trustees) return reply({error:'exceptions_disabled'},503);
 const verdict=await verifyExceptionAction(await readJson(request),trustees,Date.now(),{has:async nonce=>!!await env.INTAKE.prepare('SELECT 1 AS seen FROM exception_nonces WHERE nonce=?').bind(nonce).first()},env.PUBLIC_ORIGIN||CANONICAL_ORIGIN);
 if(!verdict.ok) return reply({error:verdict.error},verdict.error==='replayed'?409:403);
 const {action,signers}=verdict;
 const item=await env.DB.prepare('SELECT id,withdrawn_at FROM testimony WHERE id=?').bind(action.target).first<{id:string;withdrawn_at:string|null}>();
 const author=await env.INTAKE.prepare('SELECT id,status,hold_reason FROM submissions WHERE public_id=?').bind(action.target).first<{id:string;status:string;hold_reason:string|null}>();
 // A renewal: an active exception already withholds this account (a contributed account held for it, or a seeded one
 // hidden by it). It is recorded with its own log entry and the account stays withheld without a gap (policy 0.6.0).
 const inForce=!!await env.INTAKE.prepare("SELECT 1 AS active FROM exceptions WHERE public_id=? AND state='active' AND expires_at>?").bind(action.target,new Date().toISOString()).first();
 const renewal=inForce&&(author?author.status==='held'&&author.hold_reason==='exception':item?.withdrawn_at==='__withheld__');
 if(!renewal&&(!item||item.withdrawn_at!==null)) return reply({error:'not_found'},404);
 const period=quarter(), entry=`exc_${randomToken(12)}`, pin=exceptionPin(action.kind,policy.version,await currentPolicyDigest());
 // The nonce and the expiry are recorded together first, so no withholding can exist without an end date.
 try {await env.INTAKE.batch([
  env.INTAKE.prepare('INSERT INTO exception_nonces(nonce,expires_at) VALUES(?,?)').bind(action.nonce,action.expiresAt),
  env.INTAKE.prepare('INSERT INTO exceptions(id,public_id,submission_id,kind,expires_at,state,period) VALUES(?,?,?,?,?,?,?)').bind(entry,action.target,author?.id??null,action.kind,action.expiresAt,'active',period),
 ]);}
 catch(error) {if(String(error).includes('UNIQUE')) return reply({error:'replayed'},409);throw error;}
 // The public transparency entry is written before anything is withheld; housekeeping completes an interrupted withholding.
 await env.DB.prepare('INSERT INTO exception_log(id,period,kind,scope,target_digest,expires_on,signers_json,action_digest,policy_version,policy_digest) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(entry,period,action.kind,action.scope,await digest(`siwt-exception-target-v1:${action.target}`),action.expiresAt.slice(0,10),JSON.stringify(signers),await actionDigest(action),pin.policyVersion,pin.policyDigest).run();
 if(renewal) {
  // The author's receipts say the exception was renewed; nothing else changes.
  if(author) try {await (await logAction(env,{submissionId:author.id,action:'withhold',rule:'EXCEPTION-RENEWED',pin})).run();} catch {}
  return reply({executed:true,renewal:true,entry:{id:entry,period,kind:action.kind,scope:action.scope,expiresOn:action.expiresAt.slice(0,10),signers}});
 }
 const result=await withholdPublished(env,action.target,'exception',pin);
 return reply({executed:result!=='gone',entry:{id:entry,period,kind:action.kind,scope:action.scope,expiresOn:action.expiresAt.slice(0,10),signers}});
}
const exceptionPin=(kind:string,policyVersion:string,policyDigest:string):Pin=>({policyVersion,policyDigest,rules:[`EXCEPTION-${kind.toUpperCase().replace('_','-')}`]});
/** Completes exceptions interrupted after their public log entry was written; one without a log entry is never applied. */
async function applyPendingExceptions(env:Env,now=new Date()):Promise<number> {
 const active=(await env.INTAKE.prepare("SELECT id,public_id FROM exceptions WHERE state='active' AND expires_at>? LIMIT 50").bind(now.toISOString()).all<{id:string;public_id:string}>()).results;
 let applied=0;
 for(const e of active) {
  const logged=await env.DB.prepare('SELECT kind,policy_version,policy_digest FROM exception_log WHERE id=?').bind(e.id).first<{kind:string;policy_version:string;policy_digest:string}>();
  if(!logged) continue;
  if(await withholdPublished(env,e.public_id,'exception',exceptionPin(logged.kind,logged.policy_version,logged.policy_digest))!=='gone') applied++;
 }
 return applied;
}
/** The public exception log: every executed trustee exception, newest quarter first. Never the account text or a requester. */
export async function exceptionLog(env:Env) {
 const rows=(await env.DB.prepare('SELECT id,period,kind,scope,target_digest,expires_on,signers_json,action_digest,policy_version,policy_digest FROM exception_log ORDER BY period DESC,id LIMIT 200').all<{id:string;period:string;kind:string;scope:string;target_digest:string;expires_on:string;signers_json:string;action_digest:string;policy_version:string;policy_digest:string}>()).results;
 return {enabled:parseTrustees(settings(env).TRUSTEE_KEYS)!==null,entries:rows.map(r=>({id:r.id,period:r.period,kind:r.kind,scope:r.scope,targetDigest:r.target_digest,expiresOn:r.expires_on,signers:JSON.parse(r.signers_json) as string[],actionDigest:r.action_digest,policyVersion:r.policy_version,policyDigest:r.policy_digest}))};
}
/** Ends exceptions at their expiry. The account is restored only when no other exception naming it is still in force (a renewal). */
async function lapseExceptions(env:Env,now=new Date()):Promise<number> {
 const nowIso=now.toISOString();
 const due=(await env.INTAKE.prepare("SELECT * FROM exceptions WHERE state='active' AND expires_at<=? LIMIT 50").bind(nowIso).all<{id:string;public_id:string;submission_id:string|null}>()).results;
 for(const e of due) {
  const renewed=await env.INTAKE.prepare("SELECT 1 AS active FROM exceptions WHERE public_id=? AND state='active' AND expires_at>? AND id<>?").bind(e.public_id,nowIso,e.id).first();
  if(!renewed) {
   if(e.submission_id) await restoreWithheld(env,e.submission_id,'exception',{action:'restore',rule:'EXCEPTION-LAPSED'});
   else await env.DB.prepare("UPDATE testimony SET withdrawn_at=NULL WHERE id=? AND withdrawn_at='__withheld__'").bind(e.public_id).run();
  }
  await env.INTAKE.prepare("UPDATE exceptions SET state='lapsed' WHERE id=?").bind(e.id).run();
 }
 await env.INTAKE.prepare('DELETE FROM exception_nonces WHERE expires_at<?').bind(now.toISOString()).run();
 return due.length;
}

// ---- Status, statistics and housekeeping ----
/**
 * What can run right now. A jury (or an appeal) is reported only when enough other employers hold juror keys to reach its
 * quorum under the per-employer seat limit; challenges only while RATE_LIMIT_SECRET keys their daily budget.
 */
export async function moderationStatus(env:Env):Promise<{juryEnabled:boolean;sandboxJuryEnabled:boolean;appealsEnabled:boolean;challengesEnabled:boolean;trusteeExceptionsEnabled:boolean;policyVersion:string;policyDigest:string}> {
 const employers=await jurorEmployers(env);
 const can=(juryClass:JuryClass,stage:JuryStage)=>juryActive(env,juryClass)&&staffable(employers[juryClass],juryClass,stage,undefined);
 return {juryEnabled:can('mailbox','initial'),sandboxJuryEnabled:can('sandbox','initial'),appealsEnabled:can('sandbox','appeal')||can('mailbox','appeal'),challengesEnabled:challengesOpen(env),trusteeExceptionsEnabled:parseTrustees(settings(env).TRUSTEE_KEYS)!==null,policyVersion:policy.version,policyDigest:await currentPolicyDigest()};
}
const HOLD_REASONS=['jury','jury_no_quorum','jury_upheld','privacy_rescan','challenge_repair','exception'] as const;
const JURY_OUTCOMES=['upheld','cleared','no_quorum','moot','open'] as const;
/**
 * Every published count, computed from the outcome records themselves, for one quarter. publishedAutomatically counts
 * publications whose words were cleared by automated screening alone (no jury); appeals counts appealed decisions (one
 * per appeal, whatever the number of rules) and overturned those whose every appealed rule was cleared.
 */
export async function moderationCounts(env:Env,period=quarter()):Promise<Record<string,number>> {
 const n=async(sql:string,...args:unknown[])=>(await env.INTAKE.prepare(sql).bind(...args).first<{n:number}>())?.n??0;
 const counts:Record<string,number>={
  submitted:await n("SELECT COUNT(*) AS n FROM actions WHERE action='submit' AND period=?",period),
  published_automatically:await n("SELECT COUNT(*) AS n FROM actions p WHERE p.action='publish' AND p.rule='BATCH' AND p.period=? AND (SELECT a.rule FROM actions a WHERE a.submission_id=p.submission_id AND a.action IN ('submit','revise') AND a.rowid<p.rowid ORDER BY a.rowid DESC LIMIT 1)='clear'",period),
  repairs:await n("SELECT COALESCE(SUM(count),0) AS n FROM moderation_counters WHERE period=? AND metric='repair_requested'",period)+await n("SELECT COUNT(*) AS n FROM challenges WHERE outcome='withheld_for_repair' AND period=?",period),
  jury:await n("SELECT COUNT(*) AS n FROM jury_cases WHERE stage='initial' AND period=?",period),
  // Practice cases (challenges to seeded fictional sample accounts) are counted apart, never as rejected challenges.
  rejected:await n("SELECT COUNT(*) AS n FROM challenges WHERE outcome='rejected' AND path<>'practice_fixture' AND period=?",period),
  practice:await n("SELECT COUNT(*) AS n FROM challenges WHERE path='practice_fixture' AND period=?",period),
  // From the public exception log, so an exception interrupted before its transparency entry (which never acts) is not counted.
  legal:(await env.DB.prepare('SELECT COUNT(*) AS n FROM exception_log WHERE period=?').bind(period).first<{n:number}>())?.n??0,
  appeals:await n("SELECT COUNT(DISTINCT subject_id||':'||subject_revision) AS n FROM jury_cases WHERE stage='appeal' AND period=?",period),
  overturned:await n("SELECT COUNT(*) AS n FROM (SELECT 1 FROM jury_cases WHERE stage='appeal' GROUP BY subject_id,subject_revision HAVING SUM(outcome='cleared')=COUNT(*) AND MAX(closed_period)=?)",period),
 };
 for(const reason of HOLD_REASONS) counts[`held:${reason}`]=await n("SELECT COUNT(*) AS n FROM submissions WHERE status='held' AND hold_reason=?",reason);
 for(const outcome of JURY_OUTCOMES) counts[`jury_outcome:${outcome}`]=outcome==='open'?await n("SELECT COUNT(*) AS n FROM jury_cases WHERE stage='initial' AND state='open'"):await n("SELECT COUNT(*) AS n FROM jury_cases WHERE stage='initial' AND outcome=? AND closed_period=?",outcome,period);
 return counts;
}
/**
 * Counts that follow contributions (policy.publicStatistics): each moves when someone submits, is screened, held or
 * published, so they are rounded like contribution counts; otherwise successive snapshots would give the exact number
 * of submissions in each window. The others (challenges, exceptions, appeals) keep the '<5' rule.
 */
export const roundedMetric=(metric:string)=>['submitted','published_automatically','repairs','jury'].includes(metric)||metric.startsWith('held:')||metric.startsWith('jury_outcome:');
/** The stored form of one count: rounded (0, suppressed below 25, else a multiple of 25) or coarse (suppressed below 5). Never a small exact count. */
export function storedCount(metric:string,value:number):{value:number;suppressed:0|1} {
 if(roundedMetric(metric)) {const shown=publicCount(value);return shown==='<25'?{value:0,suppressed:1}:{value:shown,suppressed:0};}
 return value<5?{value:0,suppressed:1}:{value,suppressed:0};
}
const utcDay=(now:Date)=>now.toISOString().slice(0,10);
/**
 * Writes a quarter's counts to the public database, at most once per UTC day (the first scheduled run of the day; force
 * skips that check). The quarter the previous day belonged to is completed too, so a quarter's last day is counted.
 */
export async function publishModerationStats(env:Env,period=quarter(),now=new Date(),force=false):Promise<number> {
 const day=utcDay(now), name=`moderation_stats:${period}`;
 if(!force&&(await env.INTAKE.prepare('SELECT day FROM stats_snapshots WHERE name=?').bind(name).first<{day:string}>())?.day===day) return 0;
 const counts=await moderationCounts(env,period);
 await env.DB.batch(Object.entries(counts).map(([metric,value])=>{const stored=storedCount(metric,value);return env.DB.prepare('INSERT INTO moderation_stats(id,period,metric,value,suppressed) VALUES(?,?,?,?,?) ON CONFLICT(period,metric) DO UPDATE SET value=excluded.value,suppressed=excluded.suppressed').bind(`${period}:${metric}`,period,metric,stored.value,stored.suppressed);}));
 await env.INTAKE.prepare('INSERT INTO stats_snapshots(name,day,payload) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET day=excluded.day').bind(name,day,'{}').run();
 return Object.keys(counts).length;
}
/** The daily refresh: today's quarter and, on the first day of a quarter, the quarter just ended. */
async function refreshModerationStats(env:Env,now=new Date()):Promise<number> {
 const periods=[...new Set([quarter(now),quarter(new Date(now.getTime()-DAY))])];
 let written=0;
 for(const period of periods) written+=await publishModerationStats(env,period,now);
 return written;
}
export async function moderationStats(env:Env):Promise<ModerationStats> {
 const period=quarter();
 const read=async()=>(await env.DB.prepare('SELECT metric,value,suppressed FROM moderation_stats WHERE period=?').bind(period).all<{metric:string;value:number;suppressed:number}>()).results;
 let rows=await read();
 // Rows written before the 0.6.0 rounding (no refresh marker) are rewritten once, so no count is shown under the old rule.
 const marked=await env.INTAKE.prepare('SELECT 1 AS ok FROM stats_snapshots WHERE name=?').bind(`moderation_stats:${period}`).first();
 if(!rows.length||!marked) {await publishModerationStats(env,period,new Date(),true);rows=await read();}
 const get=(metric:string):Coarse=>{
  const row=rows.find(r=>r.metric===metric);
  if(roundedMetric(metric)) return !row?0:row.suppressed?'<25':row.value;
  return !row||row.suppressed?'<5':coarse(row.value);
 };
 return {
  period,
  counts:{submitted:get('submitted'),publishedAutomatically:get('published_automatically'),repairs:get('repairs'),jury:get('jury'),rejected:get('rejected'),practice:get('practice'),legal:get('legal'),appeals:get('appeals'),overturned:get('overturned')},
  heldByReason:Object.fromEntries(HOLD_REASONS.map(reason=>[reason,get(`held:${reason}`)])),
  juryOutcomes:Object.fromEntries(JURY_OUTCOMES.map(outcome=>[outcome,get(`jury_outcome:${outcome}`)])),
 };
}
/** Open cases whose subject changed or disappeared end without a decision. */
async function mootStale(env:Env):Promise<number> {
 const open=(await env.INTAKE.prepare("SELECT * FROM jury_cases WHERE state='open' LIMIT 500").all<CaseRow>()).results;
 let mooted=0;
 for(const c of open) {
  let stale:boolean;
  if(c.subject_id) {
   const row=await env.INTAKE.prepare('SELECT status,revision FROM submissions WHERE id=?').bind(c.subject_id).first<{status:string;revision:number}>();
   stale=!row||row.revision!==c.subject_revision||row.status!==(c.origin==='challenge'?'published':'held');
  } else stale=!await env.DB.prepare('SELECT 1 AS live FROM testimony WHERE id=? AND withdrawn_at IS NULL').bind(c.public_id).first();
  if(stale) {await mootCase(env,c.id);mooted++;}
 }
 return mooted;
}
/**
 * Seeded fictional sample accounts can never be withheld by a challenge or a jury (policy 0.5.0). Open challenge cases
 * about them (a sandbox case with no author row) end without a decision, and a sample account hidden by an earlier
 * challenge or jury is shown again unless an active trustee exception names it.
 */
async function protectFixtures(env:Env):Promise<number> {
 let changed=0;
 for(const c of (await env.INTAKE.prepare("SELECT id FROM jury_cases WHERE state='open' AND subject_id IS NULL AND jury_class='sandbox' LIMIT 200").all<{id:string}>()).results) {await mootCase(env,c.id);changed++;}
 const hidden=(await env.DB.prepare("SELECT t.id FROM testimony t JOIN companies c ON c.id=t.company_id WHERE t.withdrawn_at='__withheld__' AND c.kind='sample' LIMIT 200").all<{id:string}>()).results.map(r=>r.id);
 for(const id of hidden) {
  if(await env.INTAKE.prepare("SELECT 1 AS active FROM exceptions WHERE public_id=? AND state='active'").bind(id).first()) continue;
  changed+=(await env.DB.prepare("UPDATE testimony SET withdrawn_at=NULL WHERE id=? AND withdrawn_at='__withheld__'").bind(id).run()).meta.changes??0;
 }
 return changed;
}
/** Held jury cases whose author allowed juror review and that have no case yet (held before juries ran, or an interrupted open) get their cases now. */
async function openMissing(env:Env):Promise<number> {
 const rows=(await env.INTAKE.prepare("SELECT * FROM submissions s WHERE s.status='held' AND s.hold_reason='jury' AND s.jury_consent=1 AND NOT EXISTS(SELECT 1 FROM jury_cases c WHERE c.subject_id=s.id AND c.subject_revision=s.revision AND c.origin='screening') ORDER BY random() LIMIT 100").all<SubmissionRow>()).results;
 let opened=0;
 for(const row of rows) {
  const rules=juryRuleIds(await heldJuryRules(env,row));
  if(rules.length&&await openScreeningCases(env,row,rules)) opened++;
 }
 return opened;
}
export async function moderationHousekeeping(env:Env):Promise<Record<string,number>> {
 const counts:Record<string,number>={errors:0}, now=new Date(), nowIso=now.toISOString();
 const retention=quarter(new Date(now.getTime()-policy.retention.moderationRecordsQuarters*92*DAY));
 const phases:[string,()=>Promise<number>][]=[
  ['casesMooted',()=>mootStale(env)],
  ['casesClosed',async()=>{let closed=0;for(const c of (await env.INTAKE.prepare("SELECT id FROM jury_cases WHERE state='open' LIMIT 500").all<{id:string}>()).results) if(await settleCase(env,c.id,now)) closed++;return closed;}],
  ['outcomesApplied',async()=>{const pending=(await env.INTAKE.prepare("SELECT * FROM jury_cases WHERE state<>'open' AND applied=0 LIMIT 100").all<CaseRow>()).results;for(const c of pending) await applyCase(env,c);return pending.length;}],
  ['casesOpened',()=>openMissing(env)],
  ['seatsExpired',async()=>(await env.INTAKE.prepare('DELETE FROM jury_assignments WHERE vote IS NULL AND expires_at<=?').bind(nowIso).run()).meta.changes??0],
  // Queued challenges are re-checked after the day's re-check caps reset, urgent rules first (policy 0.6.0).
  ['challengesRechecked',()=>recheckQueued(env)],
  ['exceptionsApplied',()=>applyPendingExceptions(env,now)],
  ['exceptionsLapsed',()=>lapseExceptions(env,now)],
  ['countersPruned',async()=>(await env.INTAKE.prepare("DELETE FROM moderation_counters WHERE period LIKE '____-__-__' AND period<?").bind(new Date(now.getTime()-2*DAY).toISOString().slice(0,10)).run()).meta.changes??0],
  // Daily challenge budgets are kept only for their UTC day.
  ['budgetsPruned',async()=>(await env.INTAKE.prepare('DELETE FROM daily_budgets WHERE day<?').bind(nowIso.slice(0,10)).run()).meta.changes??0],
  ['fixturesProtected',()=>protectFixtures(env)],
  ['recordsPruned',async()=>{
   // Decisions that make a challenge final (a re-check, or a jury decision about published words) are kept while their
   // policy version is current, so "decided once per account, rule and policy version" stays true; everything else goes
   // after the retention period.
   const current=await currentPolicyDigest();
   let pruned=0;
   pruned+=(await env.INTAKE.prepare("DELETE FROM jury_cases WHERE state<>'open' AND applied=1 AND COALESCE(closed_period,period)<? AND (public_id IS NULL OR COALESCE(outcome,'moot')='moot' OR policy_digest<>?)").bind(retention,current).run()).meta.changes??0;
   pruned+=(await env.INTAKE.prepare('DELETE FROM rescreens WHERE policy_digest<>?').bind(current).run()).meta.changes??0;
   // A lapsed exception's private row (which names the account) goes too; the public exception log keeps the record.
   for(const sql of ['DELETE FROM challenges WHERE period<?','DELETE FROM challenge_queue WHERE period<?',"DELETE FROM stats_snapshots WHERE name LIKE 'moderation_stats:%' AND substr(name,18)<?","DELETE FROM moderation_counters WHERE period LIKE '____-Q_' AND period<?","DELETE FROM exceptions WHERE state='lapsed' AND period<?"]) pruned+=(await env.INTAKE.prepare(sql).bind(retention).run()).meta.changes??0;
   return pruned;
  }],
  ['statsPublished',()=>refreshModerationStats(env,now)],
 ];
 for(const [name,run] of phases) try {counts[name]=await run();} catch {counts[name]=0;counts.errors=(counts.errors??0)+1;}
 return counts;
}

/** Moderation API. Returns null for any other path. No route accepts an organization, a priority or a moderator override. */
export async function moderationRoutes(request:Request,env:Env,path:string):Promise<Response|null> {
 const routes:Record<string,'GET'|'POST'>={'/api/jury/assign':'POST','/api/jury/vote':'POST','/api/challenge':'POST','/api/author/status':'POST','/api/appeal':'POST','/api/moderation/stats':'GET','/api/moderation/exceptions':'GET','/api/exception':'POST'};
 const method=routes[path];
 if(!method) return null;
 // RFC 9110: a 405 names the methods the route accepts (a HEAD is answered as a GET by the main worker).
 if(request.method!==method) return Response.json({error:'method_not_allowed'},{status:405,headers:{'cache-control':'no-store',allow:method==='GET'?'GET, HEAD':'POST'}});
 try {
  switch(path) {
   case '/api/moderation/stats': return reply(await moderationStats(env));
   case '/api/moderation/exceptions': return reply(await exceptionLog(env));
   case '/api/exception': return await exception(env,request);
   case '/api/jury/assign': return await assignJuror(env,await readJson(request));
   case '/api/jury/vote': return await castVote(env,await readJson(request));
   case '/api/challenge': return await challenge(env,await readJson(request),request);
   case '/api/author/status': return await authorStatus(env,await readJson(request));
   default: return await appeal(env,await readJson(request));
  }
 } catch(error) {
  if(error instanceof z.ZodError) return reply({error:'invalid_request'},400);
  const message=error instanceof Error?error.message:'';
  if(message==='invalid_json') return reply({error:'invalid_request'},400);
  if(message==='request_too_large') return reply({error:message},413);
  throw error;
 }
}
