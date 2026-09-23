import { z } from 'zod';
import { randomInt } from '../shared/random.ts';
import { decode, digest, encode, importIssuer, openIssuerKey, sealIssuerKey, quarter, quarterStart, randomToken, suite, keyPurpose, keySource, communityKeyId, issuerKeyExpiry, generateIssuerKeyPair, issuerKeyStarted, issuanceLimits, issuanceBand, networkKey, readCapped, EMPLOYER_SLUG, COMMUNITY_KEY_LIMITS, COMMUNITY_EMAIL_LIMITS, JUROR_BATCH_MAX, JUROR_QUOTA, ISSUANCE_POLICY, type IssuerKey, type IssuanceLimits, type KeyPurpose, type KeySource } from '../shared/proof.ts';
import { checkPow, powBits, powMinute, powSubject, POW_VERSION, POW_WINDOW_MINUTES } from '../shared/pow.ts';
import { domainProblem, normalizeDomain } from '../shared/domains.ts';

type Limiter = {limit(input:{key:string}):Promise<{success:boolean}>};
export interface IssuerEnv {
  VERIFIER: D1Database;
  ISSUER_MASTER_KEY: string;
  MAILBOX_PEPPER: string;
  EMAIL?: {send(message:{from:string;to:string;subject:string;text:string}):Promise<unknown>};
  ABUSE?: Limiter;
  /** Sandbox juror tokens need no mailbox, so each connection gets a tighter limit. Limiter keys are keyed hashes, never stored. */
  JUROR_LIMIT?: Limiter;
  ALLOWED_ORIGIN: string;
  EMAIL_FROM: string;
  EMAIL_ENABLED: string;
  ENVIRONMENT?: string;
  /**
   * Shared with the main worker only (a secret on both Workers, never sent to a browser): authenticates its employer
   * registrations at POST /internal/employers. Unset or shorter than 32 characters, that route answers 503.
   */
  INTERNAL_TOKEN?: string;
  /** Proof-of-work difficulty in leading zero bits for /start and /issue-juror (shared/pow.ts powBits: default 20, clamped to 8–32). */
  POW_BITS?: string;
  /**
   * Registrations accepted per minute (each can create two RSA keys). Keyed by a constant, so every caller shares it; a
   * Workers rate-limit binding counts per Cloudflare location, so this is a limit per location, not a global one.
   */
  REGISTER_LIMIT?: Limiter;
  /**
   * Owner decision 1 (2026-09-23): the fictional sample employers' sandbox ('demo') keys are listed and sign only while this
   * is exactly 'on' (locally and in tests), as the main worker shows those employers only then. Production sets 'off'
   * (issuer.wrangler.jsonc); unset also hides them. Hidden rows stay in issuer_keys until an operator deletes them:
   * tools/purge-samples.mjs --remote has a verifier step that lists them in its dry run and, with --apply and a
   * bookmark, records this database's Time Travel bookmark, exports it and deletes the sandbox keys with the
   * verification challenges made with them. tools/verify-deployment.mjs fails if this verifier serves any sandbox key
   * while the site hides the fictional employers.
   */
  SAMPLE_EMPLOYERS?: string;
}
interface KeyRow { id:string; company_slug:string; epoch:string; expires_at:string; verification_class:'demo'|'mailbox'; domains_json:string; public_key_json:string; sealed_private_key:string; purpose?:KeyPurpose|null; headcount_band?:string|null; issuance_cap?:number|null; velocity_limit?:number|null; source?:KeySource|null; }
/** The public columns of a key row: what /keys reads (never the sealed private key). */
type PublicKeyRow = Pick<KeyRow,'id'|'company_slug'|'epoch'|'expires_at'|'verification_class'|'public_key_json'|'purpose'|'source'>;
const PUBLIC_KEY_COLUMNS = 'k.id,k.company_slug,k.epoch,k.expires_at,k.verification_class,k.public_key_json,k.purpose,k.source';
const samplesShown = (env:Pick<IssuerEnv,'SAMPLE_EMPLOYERS'>) => env.SAMPLE_EMPLOYERS === 'on';
/**
 * The live keys this verifier lists (/keys, /stats, a registration's reply), as a WHERE clause over issuer_keys k: sandbox
 * keys only while the sample employers are shown, and a community key only while its employer's registry row still names
 * the key's one domain (a withdrawn or re-pointed registration's keys sign nothing, so they are not listed either).
 * Optionally one employer or one source. Built from fixed text, so the per-employer index serves `company`.
 */
function listedKeys(env:IssuerEnv,now:Date,filter:{company?:string|null;source?:KeySource|null}={}) {
  const where=['k.expires_at>?'],binds:unknown[]=[now.toISOString()];
  if(filter.company){where.push('k.company_slug=?');binds.push(filter.company);}
  if(filter.source){where.push('k.source=?');binds.push(filter.source);}
  if(!samplesShown(env))where.push("k.verification_class<>'demo'");
  where.push("(k.source<>'community' OR EXISTS (SELECT 1 FROM employer_domains d WHERE d.company_slug=k.company_slug AND json_array_length(k.domains_json)=1 AND json_extract(k.domains_json,'$[0]')=d.domain))");
  return {where:where.join(' AND '),binds};
}
/** Every request that makes the verifier send an email or sign a batch without a code carries a proof of work (shared/pow.ts), checked before any key is read. */
const startInput = z.object({action:z.literal('start'),keyId:z.string().max(120),email:z.email().max(254),pow:z.unknown().optional()}).strict();
const issueInput = z.object({action:z.literal('issue'),keyId:z.string().max(120),blinded:z.string().max(800),challengeId:z.string().max(64).optional(),code:z.string().max(12).optional()}).strict();
/**
 * Juror tokens go only to someone who confirmed they are 18 or older (the jury page's checkbox, sent as adultConfirmed:
 * true). Any other value is refused with adult_confirmation_required before a key is read or anything is signed; nothing
 * about the confirmation is stored.
 */
const jurorInput = z.object({keyId:z.string().max(120),blinded:z.array(z.string().max(800)).min(1).max(JUROR_BATCH_MAX),challengeId:z.string().max(64).optional(),code:z.string().max(12).optional(),adultConfirmed:z.unknown().optional(),pow:z.unknown().optional()}).strict();
/** POST /internal/employers (main worker only): register a work-email domain for an employer slug. */
const registerInput = z.object({slug:z.string().regex(EMPLOYER_SLUG),domain:z.string().min(3).max(253)}).strict();
/** DELETE /internal/employers (main worker or operator, with the same token): take a community registration down. */
const withdrawInput = z.object({slug:z.string().regex(EMPLOYER_SLUG)}).strict();
/** Each POST path accepts exactly one request shape; any other path is 404, before anything is read or counted. */
const ROUTES = {'/start':startInput,'/issue':issueInput,'/issue-juror':jurorInput} as const;
/** The largest request body any route accepts; nothing larger is buffered. (Not exported: this is a Worker entry module.) */
const MAX_BODY_BYTES = 4000;
const describe = (r: PublicKeyRow): IssuerKey => ({id:r.id,companySlug:r.company_slug,epoch:r.epoch,expiresAt:r.expires_at,verificationClass:r.verification_class,purpose:r.purpose??'contribution',source:r.source??'curated',publicKey:JSON.parse(r.public_key_json)});
async function keyedHash(env:IssuerEnv,text:string) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.MAILBOX_PEPPER),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text))));
}
const HOUR=3600000;
/**
 * Limits embedded at provisioning; a mailbox row provisioned before they existed gets the policy default (the smallest
 * cap). null for sandbox keys: fictional employers are never capped, counted or paused.
 */
export function keyLimits(r:Pick<KeyRow,'verification_class'|'purpose'|'headcount_band'|'issuance_cap'|'velocity_limit'>):IssuanceLimits|null {
  const fallback=issuanceLimits(r.headcount_band,r.verification_class,r.purpose??'contribution');
  if(!fallback)return null;
  return {cap:r.issuance_cap&&r.issuance_cap>0?r.issuance_cap:fallback.cap,velocity:r.velocity_limit&&r.velocity_limit>0?r.velocity_limit:fallback.velocity};
}
/** Employer-wide state only (public at /stats), so refusing here reveals nothing about any mailbox. */
async function blocked(env:IssuerEnv,slug:string,purpose:KeyPurpose,limits:IssuanceLimits|null,now:number) {
  if(!limits)return null;
  if(await env.VERIFIER.prepare('SELECT 1 AS p FROM issuance_pauses WHERE company_slug=? AND purpose=? AND paused_until>?').bind(slug,purpose,new Date(now).toISOString()).first())return 'issuance_paused';
  const count=await env.VERIFIER.prepare('SELECT issued FROM issuance_counts WHERE company_slug=? AND purpose=? AND epoch=?').bind(slug,purpose,quarter(new Date(now))).first<{issued:number}>();
  return count&&count.issued>=limits.cap?'issuance_cap_reached':null;
}
// The cap is a CHECK constraint and the velocity breaker a trigger, so a batch that would exceed either is rolled back
// whole. Each write carries the signing key's current provisioned limits, so re-provisioning can raise or lower them.
const counted=(env:IssuerEnv,slug:string,purpose:KeyPurpose,limits:IssuanceLimits|null,n:number,now:number)=>!limits?[]:[
  env.VERIFIER.prepare('INSERT INTO issuance_counts(company_slug,purpose,epoch,issued,cap) VALUES(?,?,?,?,?) ON CONFLICT(company_slug,purpose,epoch) DO UPDATE SET issued=issued+excluded.issued,cap=excluded.cap').bind(slug,purpose,quarter(new Date(now)),n,limits.cap),
  env.VERIFIER.prepare('INSERT INTO issuance_hours(company_slug,purpose,hour,n,velocity_limit) VALUES(?,?,?,?,?) ON CONFLICT(company_slug,purpose,hour) DO UPDATE SET n=n+excluded.n,velocity_limit=excluded.velocity_limit').bind(slug,purpose,Math.floor(now/HOUR),n,limits.velocity),
];
const uncounted=(env:IssuerEnv,slug:string,purpose:KeyPurpose,limits:IssuanceLimits|null,n:number,now:number)=>!limits?[]:[
  env.VERIFIER.prepare('UPDATE issuance_counts SET issued=MAX(0,issued-?) WHERE company_slug=? AND purpose=? AND epoch=?').bind(n,slug,purpose,quarter(new Date(now))),
  env.VERIFIER.prepare('UPDATE issuance_hours SET n=MAX(0,n-?) WHERE company_slug=? AND purpose=? AND hour=?').bind(n,slug,purpose,Math.floor(now/HOUR)),
];
// 'juror_quota' covers both the juror_quota_limit trigger and the primary key of the mailbox's one batch per quarter.
const failureOf=(error:unknown)=>{const m=error instanceof Error?error.message:String(error);return m.includes('issuance_velocity')?'velocity':m.includes('issuance_cap')?'cap':m.includes('juror_quota')?'juror_quota':m.includes('challenge_used')?'challenge_used':'other';};
/**
 * A tripped breaker pauses that employer for 24 hours: a contribution trip pauses both purposes, a juror trip juror tokens
 * only, so juror demand never shuts off contributions. The pause is recorded outside the rolled-back batch.
 */
async function limitRefusal(env:IssuerEnv,slug:string,purpose:KeyPurpose,failure:string,now:number) {
  if(failure==='velocity') {
    const until=new Date(now+ISSUANCE_POLICY.pauseHours*HOUR).toISOString();
    await env.VERIFIER.batch(ISSUANCE_POLICY.pausedByTrip[purpose].map(paused=>env.VERIFIER.prepare('INSERT INTO issuance_pauses(company_slug,purpose,paused_until) VALUES(?,?,?) ON CONFLICT(company_slug,purpose) DO UPDATE SET paused_until=MAX(paused_until,excluded.paused_until)').bind(slug,paused,until)));
    return 'issuance_paused';
  }
  return failure==='cap'?'issuance_cap_reached':null;
}
async function signAll(env:IssuerEnv,keyRow:KeyRow,blinded:Uint8Array<ArrayBuffer>[]) {
  const privateKey=await importIssuer(await openIssuerKey(env.ISSUER_MASTER_KEY,keyRow.id,keyRow.sealed_private_key),true);
  const signatures:string[]=[];
  for(const message of blinded) signatures.push(encode(await suite().blindSign(privateKey,message)));
  return signatures;
}
// ---- Community keys (owner decision 4, 2026-09-23) ----
// The main worker lists employers anyone adds, with their work-email domain, and registers the domain here. This worker
// holds that registry and creates the employer's contribution and juror keys on demand (RSA-2048 through the same blind
// signature suite, sealed under ISSUER_MASTER_KEY, with COMMUNITY_KEY_LIMITS), for the current issuance quarter at
// registration and at each quarter's start (the scheduled job). They are served at /keys with source 'community': no
// release can pin them, so the browser uses one only when the site's copy and this copy agree exactly.
/** Constant-time comparison of a presented secret with the configured one (both are hashed first, so lengths do not leak). */
async function sameSecret(presented:string,expected:string) {
  const [a,b]=await Promise.all([digest(`siwt-internal-v1:${presented}`),digest(`siwt-internal-v1:${expected}`)]);
  let difference=a.length^b.length;
  for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
/**
 * A community key signs only while its employer's registered domain is still the key's one domain and shared/domains.ts
 * still accepts it (not free-mail, disposable or reserved: its lists may grow after registration).
 */
async function communityDomainActive(env:IssuerEnv,keyRow:KeyRow) {
  const registered=await env.VERIFIER.prepare('SELECT domain FROM employer_domains WHERE company_slug=?').bind(keyRow.company_slug).first<{domain:string}>();
  let domains:unknown;try {domains=JSON.parse(keyRow.domains_json);} catch {return false;}
  return !!registered && Array.isArray(domains) && domains.length===1 && domains[0]===registered.domain && !domainProblem(registered.domain);
}
/** Live keys as /keys serves them (public columns only), in a stable order. */
async function servedKeys(env:IssuerEnv,filter:{company?:string|null;source?:KeySource|null}={},now=new Date()) {
  const {where,binds}=listedKeys(env,now,filter);
  const rows=(await env.VERIFIER.prepare(`SELECT ${PUBLIC_KEY_COLUMNS} FROM issuer_keys k WHERE ${where} ORDER BY k.company_slug,k.epoch,k.id`).bind(...binds).all<PublicKeyRow>()).results;
  return rows.map(r=>({...describe(r),mailboxEnabled:env.EMAIL_ENABLED==='true'}));
}
/** The live community keys of one employer, as /keys serves them. */
const communityKeys=(env:IssuerEnv,slug:string,now=new Date())=>servedKeys(env,{company:slug,source:'community'},now);
/**
 * Spends one of today's (UTC) verification emails for a community employer: its own budget and the one all community
 * employers share (COMMUNITY_EMAIL_LIMITS). False once either is used up, and when the budget cannot be read (fail
 * closed: no email). The caller answers identically either way.
 */
async function communityEmailAllowed(env:IssuerEnv,slug:string,now:Date) {
  const day=now.toISOString().slice(0,10);
  const spend=(scope:string,max:number)=>env.VERIFIER.prepare('INSERT INTO email_budget(day,scope,sent) VALUES(?,?,1) ON CONFLICT(day,scope) DO UPDATE SET sent=sent+1 WHERE sent<? RETURNING sent').bind(day,scope,max).first();
  try { return !!(await spend(slug,COMMUNITY_EMAIL_LIMITS.perEmployerPerDay)) && !!(await spend('*',COMMUNITY_EMAIL_LIMITS.allCommunityPerDay)); }
  catch { return false; }
}
/**
 * Creates whichever of the employer's two community keys for the current quarter is missing. INSERT OR IGNORE: when two
 * requests race, the first stored key is the key, and the other freshly generated pair is discarded unused.
 */
async function ensureCommunityKeys(env:IssuerEnv,slug:string,domain:string,now=new Date()) {
  const epoch=quarter(now);
  for(const purpose of ['contribution','juror'] as const) {
    const id=communityKeyId(slug,epoch,purpose);
    if(await env.VERIFIER.prepare('SELECT 1 AS present FROM issuer_keys WHERE id=?').bind(id).first())continue;
    const pair=await generateIssuerKeyPair(),limits=COMMUNITY_KEY_LIMITS[purpose];
    await env.VERIFIER.prepare("INSERT OR IGNORE INTO issuer_keys(id,company_slug,epoch,expires_at,verification_class,domains_json,public_key_json,sealed_private_key,purpose,headcount_band,issuance_cap,velocity_limit,source) VALUES(?,?,?,?,'mailbox',?,?,?,?,NULL,?,?,'community')")
      .bind(id,slug,epoch,issuerKeyExpiry(epoch),JSON.stringify([domain]),JSON.stringify(pair.publicKey),await sealIssuerKey(env.ISSUER_MASTER_KEY,id,pair.privateKey),purpose,limits.cap,limits.velocity).run();
  }
}
/**
 * Creates the current quarter's community keys for up to `limit` registered employers still missing one (each key is an
 * RSA key generation). Skipped: an employer that has curated keys after all, and a domain shared/domains.ts now refuses.
 * The registry is read in slug order a page at a time, and a skipped row never takes one of the `limit` places, so
 * however many refused registrations sort first, every acceptable employer is reached. One employer's failure never stops
 * the others; a master key that cannot seal stops the run before any key is generated. Returns the employers handled.
 */
async function ensureRegisteredKeys(env:IssuerEnv,now=new Date(),limit=10,page=200,maxPages=50) {
  try { await sealIssuerKey(env.ISSUER_MASTER_KEY,'siwt-seal-probe',{}); } catch { return 0; }
  const epoch=quarter(now);
  let after='',handled=0;
  for(let n=0;n<maxPages&&handled<limit;n++) {
    const rows=(await env.VERIFIER.prepare("SELECT d.company_slug,d.domain FROM employer_domains d WHERE d.company_slug>? AND (SELECT COUNT(*) FROM issuer_keys k WHERE k.company_slug=d.company_slug AND k.epoch=? AND k.source='community')<2 AND NOT EXISTS (SELECT 1 FROM issuer_keys c WHERE c.company_slug=d.company_slug AND c.source!='community') ORDER BY d.company_slug LIMIT ?").bind(after,epoch,page).all<{company_slug:string;domain:string}>()).results;
    for(const row of rows) {
      after=row.company_slug;
      if(domainProblem(row.domain))continue;
      try { await ensureCommunityKeys(env,row.company_slug,row.domain,now); handled++; } catch {}
      if(handled>=limit)break;
    }
    if(rows.length<page)break;
  }
  return handled;
}
/**
 * The shared-token check of both internal routes (null when it passes). The token is compared in constant time; unset or
 * shorter than 32 characters, the routes answer 503; a wrong or missing token is 401 and counts against the caller's network.
 */
async function internalRefusal(request:Request,env:IssuerEnv,reply:(body:unknown,status?:number)=>Response,network:string) {
  const expected=env.INTERNAL_TOKEN??'';
  if(expected.length<32) return reply({error:'internal_unavailable'},503);
  const presented=/^Bearer ([^\s]+)$/.exec(request.headers.get('authorization')??'')?.[1]??'';
  if(!(await sameSecret(presented,expected))) {
    if(env.ABUSE && !(await env.ABUSE.limit({key:await keyedHash(env,`${Math.floor(Date.now()/HOUR)}:${network}`)})).success) return reply({error:'rate_limited'},429);
    return reply({error:'unauthorized'},401);
  }
  return null;
}
/**
 * POST /internal/employers {slug, domain}, from the main worker over its service binding with
 * `authorization: Bearer <INTERNAL_TOKEN>`. Registers the domain for the employer and returns its live community keys.
 * Idempotent: the same pair again only creates whatever key is missing. Refused: a domain shared/domains.ts refuses (400
 * domain_not_allowed with its reason: invalid, reserved, a public suffix, free-mail or disposable; re-checked here, and
 * the main worker also requires MX records), a domain registered to another employer or verified by a curated key, or a
 * subdomain or parent domain of one (409 domain_taken), an employer with another registered domain or with curated keys
 * (409 employer_has_domain), a fictional sample employer (409 sample_employer), a slug or domain taken down earlier, or a
 * subdomain of such a domain (409 withdrawn). A wrong or missing token is 401 and counts against the caller's network
 * limit. Send it to an https:// URL: plain HTTP is redirected like any other request.
 */
async function registerEmployer(request:Request,env:IssuerEnv,reply:(body:unknown,status?:number)=>Response,network:string) {
  const refused=await internalRefusal(request,env,reply,network);
  if(refused) return refused;
  if(env.REGISTER_LIMIT && !(await env.REGISTER_LIMIT.limit({key:'register'})).success) return reply({error:'rate_limited'},429);
  let raw:string;
  try { raw=await readCapped(request,MAX_BODY_BYTES); } catch { return reply({error:'too_large'},413); }
  let input:z.infer<typeof registerInput>;
  try { input=registerInput.parse(JSON.parse(raw)); } catch { return reply({error:'invalid_request'},400); }
  const slug=input.slug,domain=normalizeDomain(input.domain),problem=domainProblem(domain);
  if(problem) return reply({error:'domain_not_allowed',reason:problem},400);
  const db=env.VERIFIER,now=new Date();
  if(await db.prepare("SELECT 1 AS gone FROM withdrawn_employers WHERE company_slug=? OR domain=? OR (domain IS NOT NULL AND substr(?,-(length(domain)+1))='.'||domain) LIMIT 1").bind(slug,domain,domain).first()) return reply({error:'withdrawn'},409);
  // A domain a curated key verifies belongs to that employer, and so does every subdomain of it; a parent domain of it
  // would claim that employer's organization, so it is refused too. The same holds for a domain registered for another
  // slug (below). Domains are letters, digits, hyphens and dots only, so no LIKE is needed.
  if(await db.prepare("SELECT 1 AS taken FROM issuer_keys k, json_each(k.domains_json) d WHERE k.source!='community' AND (d.value=? OR substr(?,-(length(d.value)+1))='.'||d.value OR substr(d.value,-(length(?)+1))='.'||?) LIMIT 1").bind(domain,domain,domain,domain).first()) return reply({error:'domain_taken'},409);
  const own=(await db.prepare("SELECT verification_class,source FROM issuer_keys WHERE company_slug=?").bind(slug).all<{verification_class:string;source:string|null}>()).results;
  if(own.some(k=>k.verification_class==='demo')) return reply({error:'sample_employer'},409);
  if(own.some(k=>(k.source??'curated')!=='community')) return reply({error:'employer_has_domain'},409);
  const conflict=async()=>{
    const byDomain=await db.prepare('SELECT company_slug FROM employer_domains WHERE domain=?').bind(domain).first<{company_slug:string}>();
    if(byDomain && byDomain.company_slug!==slug) return reply({error:'domain_taken'},409);
    const related=await db.prepare("SELECT company_slug FROM employer_domains WHERE (substr(?,-(length(domain)+1))='.'||domain OR substr(domain,-(length(?)+1))='.'||?) AND company_slug!=? LIMIT 1").bind(domain,domain,domain,slug).first<{company_slug:string}>();
    if(related) return reply({error:'domain_taken'},409);
    const bySlug=await db.prepare('SELECT domain FROM employer_domains WHERE company_slug=?').bind(slug).first<{domain:string}>();
    if(bySlug && bySlug.domain!==domain) return reply({error:'employer_has_domain'},409);
    return byDomain?false:null;
  };
  const before=await conflict();
  if(before) return before;
  let created=false;
  if(before===null) {
    try { await db.prepare('INSERT INTO employer_domains(domain,company_slug,registered_quarter) VALUES(?,?,?)').bind(domain,slug,quarter(now)).run(); created=true; }
    catch { const raced=await conflict(); if(raced) return raced; if(raced===null) return reply({error:'registration_unavailable'},503); }
  }
  try { await ensureCommunityKeys(env,slug,domain,now); } catch { return reply({error:'key_creation_unavailable',registered:true},503); }
  return reply({registered:true,created,companySlug:slug,domain,keys:await communityKeys(env,slug,now)});
}
/**
 * DELETE /internal/employers {slug}, with the same bearer token (the main worker's service binding, or an operator taking
 * a listing down): deletes the employer's registry row and its community keys at once, so nothing more is signed or
 * listed for it, and records the slug and domain in withdrawn_employers so neither can be registered again (a key id is
 * never reused for other key material). Idempotent. An employer with curated or sandbox keys is refused (409
 * not_community_employer): this route only takes down what the community added. The main worker must also withdraw its
 * listing and its own copies of the keys; credentials issued before stay valid wherever such a copy remains.
 */
async function withdrawEmployer(request:Request,env:IssuerEnv,reply:(body:unknown,status?:number)=>Response,network:string) {
  const refused=await internalRefusal(request,env,reply,network);
  if(refused) return refused;
  let raw:string;
  try { raw=await readCapped(request,MAX_BODY_BYTES); } catch { return reply({error:'too_large'},413); }
  let input:z.infer<typeof withdrawInput>;
  try { input=withdrawInput.parse(JSON.parse(raw)); } catch { return reply({error:'invalid_request'},400); }
  const db=env.VERIFIER,slug=input.slug;
  const own=(await db.prepare('SELECT source FROM issuer_keys WHERE company_slug=?').bind(slug).all<{source:string|null}>()).results;
  if(own.some(k=>(k.source??'curated')!=='community')) return reply({error:'not_community_employer'},409);
  const registered=await db.prepare('SELECT domain FROM employer_domains WHERE company_slug=?').bind(slug).first<{domain:string}>();
  const [keys]=await db.batch([
    db.prepare("DELETE FROM issuer_keys WHERE company_slug=? AND source='community'").bind(slug),
    db.prepare('DELETE FROM employer_domains WHERE company_slug=?').bind(slug),
    db.prepare('INSERT INTO withdrawn_employers(company_slug,domain,withdrawn_quarter) VALUES(?,?,?) ON CONFLICT(company_slug) DO UPDATE SET domain=COALESCE(excluded.domain,withdrawn_employers.domain)').bind(slug,registered?.domain??null,quarter()),
  ]);
  const recorded=await db.prepare('SELECT domain FROM withdrawn_employers WHERE company_slug=?').bind(slug).first<{domain:string|null}>();
  return reply({withdrawn:true,companySlug:slug,domain:recorded?.domain??null,keysRemoved:keys?.meta?.changes??0});
}
/**
 * GET /stats[?company=<slug>]: coarse bands per employer for the current issuance quarter only; no finer time, no exact
 * counts. Covers the employers whose keys /keys lists (so no sandbox employer while the samples are hidden).
 */
async function issuanceStats(env:IssuerEnv,now=new Date(),company:string|null=null) {
  const epoch=quarter(now),iso=now.toISOString(),{where,binds}=listedKeys(env,now,{company});
  const keys=(await env.VERIFIER.prepare(`SELECT k.company_slug,k.verification_class,k.purpose,k.headcount_band,k.issuance_cap,k.velocity_limit,k.source FROM issuer_keys k WHERE ${where} ORDER BY k.company_slug`).bind(...binds).all<Pick<KeyRow,'company_slug'|'verification_class'|'purpose'|'headcount_band'|'issuance_cap'|'velocity_limit'|'source'>>()).results;
  const one=company?' AND company_slug=?':'',also=company?[company]:[];
  const counts=new Map((await env.VERIFIER.prepare(`SELECT company_slug,purpose,issued FROM issuance_counts WHERE epoch=?${one}`).bind(epoch,...also).all<{company_slug:string;purpose:string;issued:number}>()).results.map(r=>[`${r.company_slug}|${r.purpose}`,r.issued]));
  const paused=new Set((await env.VERIFIER.prepare(`SELECT company_slug,purpose FROM issuance_pauses WHERE paused_until>?${one}`).bind(iso,...also).all<{company_slug:string;purpose:string}>()).results.map(r=>`${r.company_slug}|${r.purpose}`));
  type Entry={issued:string|null;cap:number|null;velocityLimit:number|null;capReached:boolean;paused:boolean};
  const employers:{company:string;sandbox:boolean;community:boolean;paused:boolean;contribution:Entry|null;juror:Entry|null}[]=[];
  for(const slug of [...new Set(keys.map(k=>k.company_slug))]) {
    const own=keys.filter(k=>k.company_slug===slug),entry=(purpose:KeyPurpose):Entry|null=>{
      const rows=own.filter(k=>(k.purpose??'contribution')===purpose);if(!rows.length)return null;
      const limits=rows.map(keyLimits).filter((l):l is IssuanceLimits=>!!l);
      if(!limits.length)return {issued:null,cap:null,velocityLimit:null,capReached:false,paused:false};
      const issued=counts.get(`${slug}|${purpose}`)??0,cap=Math.min(...limits.map(l=>l.cap));
      return {issued:issuanceBand(issued),cap,velocityLimit:Math.min(...limits.map(l=>l.velocity)),capReached:issued>=cap,paused:paused.has(`${slug}|${purpose}`)};
    };
    const contribution=entry('contribution'),juror=entry('juror');
    employers.push({company:slug,sandbox:own.every(k=>k.verification_class!=='mailbox'),community:own.some(k=>k.source==='community'),paused:!!(contribution?.paused||juror?.paused),contribution,juror});
  }
  return {epoch,bands:['<25','25–99','100–249','250+'],windowHours:ISSUANCE_POLICY.windowHours,pauseHours:ISSUANCE_POLICY.pauseHours,employers,
    note:'Per employer and purpose, for the current quarter only. issued: credentials (contribution) or juror tokens issued, in a coarse band. cap: the quarterly limit; capReached: it is used up. velocityLimit: the most that may be issued within a rolling 24 hours. paused: a request would have exceeded velocityLimit, so it was refused and issuance is paused for 24 hours; a contribution trip pauses both purposes for that employer, a juror trip pauses juror tokens only. Fictional (sandbox) employers have no cap, count or pause (null); per-connection rate limits apply to them. community: the employer was listed with its work-email domain after the current release, and its keys carry conservative default limits. Exact counts and times are not published.'};
}
/**
 * The one verification email. Its subject and body are the same for credentials and juror tokens, and whether or not
 * this mailbox already received them this quarter, so neither a mail gateway nor anyone reading the mailbox can tell
 * from it whether a credential exists. Only the code differs between messages.
 */
export function verificationEmail(code:string):{subject:string;text:string} {
  return {subject:'Should I Work There verification request',text:`Your code is ${code}. It expires in 15 minutes.\n\nEach work mailbox can receive one contribution credential and one set of up to ${JUROR_QUOTA} juror tokens per employer each quarter. If this mailbox already received them this quarter, this code cannot produce another.\n\nThis verifies access to a work mailbox, not your job title or employment status. Your employer may monitor this mailbox. Reviews are handled by a separate service and are never included in verification requests.\n\nIf you did not request this, ignore this email.`};
}
/** Aliases of one employer share a quota: the canonical mailbox drops +tags and uses the employer's first listed domain. */
export function canonicalMailbox(email:string,domains:string[]) {
  const [local,domain,...rest]=email.trim().toLowerCase().split('@');
  if(!local || !domain || rest.length || !domains.includes(domain)) return null;
  return `${local.split('+')[0]}@${domains[0]}`;
}
/** Plain HTTP is served only on a developer's own machine. */
const LOCAL_HOSTS = new Set(['localhost','127.0.0.1','[::1]']);
const HSTS = 'max-age=63072000; includeSubDomains';
export default {
 async fetch(request:Request,env:IssuerEnv,ctx?:Pick<ExecutionContext,'waitUntil'>):Promise<Response> {
  // Every response carries HSTS (outside local development), errors and preflights included.
  const hsts:Record<string,string>={...(env.ENVIRONMENT==='development'?{}:{'strict-transport-security':HSTS}),nel:'{"max_age":0}'};
  // Plain HTTP from anywhere but a local development host is redirected permanently to the same path and query over
  // HTTPS before anything is read, so no mailbox address, code or blinded message is ever accepted in cleartext. A
  // development stack (ENVIRONMENT=development) is never redirected: `wrangler dev` hands the worker the custom-domain
  // route's host (http://verify.shouldiworkthere.com/…), not localhost, and rewrites the Location back, so it would loop.
  const url=new URL(request.url);
  if(url.protocol==='http:' && !LOCAL_HOSTS.has(url.hostname) && env.ENVIRONMENT!=='development') {
   url.protocol='https:';
   return new Response(null,{status:301,headers:{location:url.href,'cache-control':'public, max-age=86400, no-transform','referrer-policy':'no-referrer','x-content-type-options':'nosniff',...hsts}});
  }
  const origin=request.headers.get('origin');
  const allowed=origin === env.ALLOWED_ORIGIN || (env.ENVIRONMENT==='development' && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin??''));
  const headers:Record<string,string>={'content-type':'application/json','cache-control':'no-store, no-transform','referrer-policy':'no-referrer','x-content-type-options':'nosniff','vary':'Origin',...hsts};
  if(allowed) headers['access-control-allow-origin']=origin!;
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(request.method==='OPTIONS') return new Response(null,{headers:{...headers,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'}});
  const pathname=url.pathname;
  // GET /keys and /stats take optional filters: company=<employer slug> (one employer: a browser about to verify needs
  // only its employer's keys, and names that key to /start anyway) and, for /keys, source=curated|community. Any other
  // query parameter is ignored; a malformed filter is 400 invalid_request.
  const company=url.searchParams.get('company'),sourceFilter=url.searchParams.get('source');
  const badFilter=(company!==null&&!EMPLOYER_SLUG.test(company))||(sourceFilter!==null&&sourceFilter!=='curated'&&sourceFilter!=='community');
  if(request.method==='GET' && pathname==='/keys') {
   if(badFilter) return reply({error:'invalid_request'},400);
   try {
    // source: 'curated' keys are pinned by the release built from the key registry; 'community' keys were created here
    // for an employer listed after it. pow: the proof of work /start and /issue-juror require (shared/pow.ts).
    return reply({keys:await servedKeys(env,{company,source:sourceFilter as KeySource|null}),pow:{version:POW_VERSION,bits:powBits(env.POW_BITS),windowMinutes:POW_WINDOW_MINUTES}});
   } catch { return reply({error:'keys_unavailable'},503); }
  }
  if(request.method==='GET' && pathname==='/stats') {
   if(badFilter||sourceFilter!==null) return reply({error:'invalid_request'},400);
   try { return reply(await issuanceStats(env,new Date(),company)); } catch { return reply({error:'stats_unavailable'},503); }
  }
  // The main worker's registrations (POST) and takedowns (DELETE) arrive over its service binding, with no browser origin
  // and no CORS.
  if((request.method==='POST'||request.method==='DELETE') && pathname==='/internal/employers') {
   delete headers['access-control-allow-origin'];
   const register=request.method==='POST';
   try { return await (register?registerEmployer:withdrawEmployer)(request,env,reply,networkKey(request.headers.get('cf-connecting-ip'))); } catch { return reply({error:register?'registration_unavailable':'withdrawal_unavailable'},503); }
  }
  if(request.method!=='POST' || !Object.hasOwn(ROUTES,pathname)) return reply({error:'not_found'},404);
  if(!allowed) return reply({error:'origin_not_allowed'},403);
  try {
   // Limits key on the connecting network (an IPv6 /64, or the IPv4 address) and run before the body is read.
   const network=networkKey(request.headers.get('cf-connecting-ip'));
   if(env.ABUSE && !(await env.ABUSE.limit({key:await keyedHash(env,`${Math.floor(Date.now()/HOUR)}:${network}`)})).success) return reply({error:'rate_limited'},429);
   let raw:string;
   try { raw=await readCapped(request,MAX_BODY_BYTES); } catch { return reply({error:'too_large'},413); }
   const juror=pathname==='/issue-juror';
   const parsed=ROUTES[pathname as keyof typeof ROUTES].safeParse(JSON.parse(raw)); if(!parsed.success) return reply({error:'invalid_request'},400);
   const body=parsed.data;
   if(juror && (body as z.infer<typeof jurorInput>).adultConfirmed!==true) return reply({error:'adult_confirmation_required'},400);
   // Proof of work (owner decision 5), before any key is read: bound to this origin, the route, the key id and a digest of
   // the normalized email address (/start) or of the exact blinded batch (/issue-juror), within minutes of this clock. A
   // refusal says what to recompute with: the difficulty and this verifier's current minute.
   if(juror || pathname==='/start') {
    const bits=powBits(env.POW_BITS);
    const target=juror?await powSubject.blinded((body as z.infer<typeof jurorInput>).blinded):await powSubject.email((body as z.infer<typeof startInput>).email);
    const problem=await checkPow((body as {pow?:unknown}).pow,{origin:origin!,action:juror?'issue-juror':'start',keyId:body.keyId,subject:target},bits);
    if(problem) return reply({error:'pow_required',reason:problem,bits,minute:powMinute()},400);
   }
   const keyRow=await env.VERIFIER.prepare('SELECT * FROM issuer_keys WHERE id=?').bind(body.keyId).first<KeyRow>();
   if(!keyRow || Date.parse(keyRow.expires_at)<=Date.now()) return reply({error:'issuer_key_unavailable'},400);
   // A sample employer's sandbox key signs nothing while the samples are hidden (owner decision 1), like an unknown key.
   if(keyRow.verification_class==='demo' && !samplesShown(env)) return reply({error:'issuer_key_unavailable'},400);
   const key=describe(keyRow), purpose=keyPurpose(key), limits=keyLimits(keyRow), source=keySource(key);
   // A key provisioned ahead of its quarter is published (so the next release can pin it) but signs nothing until then.
   if(!purpose || !source || !issuerKeyStarted(key)) return reply({error:'issuer_key_unavailable'},400);
   // A community key signs only for its employer's still-registered, still-acceptable domain.
   if(source==='community' && !(await communityDomainActive(env,keyRow))) return reply({error:'issuer_key_unavailable'},400);
   if(juror) return await issueJuror(env,reply,keyRow,key,limits,body as z.infer<typeof jurorInput>,network);
   const action=body as z.infer<typeof startInput>|z.infer<typeof issueInput>;
   if(action.action==='start') {
    if(key.verificationClass!=='mailbox' || env.EMAIL_ENABLED!=='true' || !env.EMAIL) return reply({error:'mailbox_verification_unavailable'},503);
    const email=action.email.trim().toLowerCase();
    const mailbox=canonicalMailbox(email,JSON.parse(keyRow.domains_json) as string[]);
    if(!mailbox) return reply({error:'use_approved_work_domain'},400);
    const now=new Date(), refusal=await blocked(env,key.companySlug,purpose,limits,now.getTime());
    if(refusal) return reply({error:refusal},503);
    // Not an oracle: every eligible address gets the same response, the same database work and, below the throttle, the
    // same email. /start never reads whether a credential or juror tokens were already issued; that quota is enforced
    // only at /issue and /issue-juror, so neither the reply nor the email (nor Cloudflare's delivery log of recipient
    // and subject) reveals which mailboxes hold a credential this quarter. The email throttle is per mailbox across
    // purposes and quarters, so no mailbox receives more than 3 emails in any 15 minutes. An employer anyone listed
    // (a community key) also has a daily email budget, per employer and for all of them together, so a listed domain
    // cannot be used to mail large numbers of addresses at it; over budget the reply is the same and nothing is sent.
    const mailboxHash=await keyedHash(env,`${purpose==='juror'?'juror-v1':'quota-v3'}:${key.companySlug}:${quarter(now)}:${mailbox}`);
    const throttleHash=await keyedHash(env,`throttle-v1:${mailbox}`);
    const recent=await env.VERIFIER.prepare('SELECT COUNT(*) AS n FROM mailbox_challenges WHERE throttle_hash=? AND expires_at>?').bind(throttleHash,now.toISOString()).first<{n:number}>();
    const send=(recent?.n??0)<3 && (source!=='community' || await communityEmailAllowed(env,key.companySlug,now));
    const id=randomToken(24), code=String(100000+randomInt(900000));
    // A throttled request still gets a challenge row (so the reply is identical), with a code nobody was sent.
    await env.VERIFIER.prepare('INSERT INTO mailbox_challenges(id,key_id,mailbox_hash,code_hash,expires_at,throttle_hash) VALUES(?,?,?,?,?,?)').bind(id,key.id,mailboxHash,await keyedHash(env,`${id}:${send?code:randomToken()}`),new Date(now.getTime()+15*60000).toISOString(),throttleHash).run();
    if(send) {const sending=env.EMAIL.send({from:env.EMAIL_FROM,to:email,...verificationEmail(code)}).then(()=>undefined,()=>undefined);if(ctx)ctx.waitUntil(sending);else await sending;}
    return reply({challengeId:id,expiresInMinutes:15});
   }
   if(purpose!=='contribution') return reply({error:'wrong_key_purpose'},400);
   let blinded:Uint8Array<ArrayBuffer>;
   try { blinded=decode(action.blinded); } catch { return reply({error:'invalid_blinded_message'},400); }
   if(blinded.length!==256) return reply({error:'invalid_blinded_message'},400);
   let release:(()=>Promise<unknown>)|null=null;
   const now=Date.now();
   if(key.verificationClass==='mailbox') {
    if(!action.challengeId || !action.code) return reply({error:'verification_required'},401);
    const blindedHash=await digest(blinded);
    const row=await env.VERIFIER.prepare('UPDATE mailbox_challenges SET attempts=attempts+1 WHERE id=? AND key_id=? AND attempts<5 AND expires_at>? RETURNING mailbox_hash,code_hash,used,blinded_hash').bind(action.challengeId,key.id,new Date().toISOString()).first<{mailbox_hash:string;code_hash:string;used:number;blinded_hash:string|null}>();
    if(!row || row.code_hash!==await keyedHash(env,`${action.challengeId}:${action.code}`)) return reply({error:'invalid_or_expired_code'},400);
    // A used challenge may only re-sign the identical blinded message (a retry after a lost response); RSA blind signing
    // is deterministic. Such a retry was already counted, so a later pause or cap never blocks it.
    if(row.used && row.blinded_hash!==blindedHash) return reply({error:'invalid_or_expired_code'},400);
    if(!row.used) {
     const prior=await env.VERIFIER.prepare('SELECT blinded_hash FROM issuance_quota_v3 WHERE mailbox_hash=?').bind(row.mailbox_hash).first<{blinded_hash:string}>();
     if(prior && prior.blinded_hash!==blindedHash) return reply({error:'credential_already_issued_this_period'},409);
     if(!prior) {
      const refusal=await blocked(env,key.companySlug,purpose,limits,now);
      if(refusal) return reply({error:refusal},503);
      try {
       await env.VERIFIER.batch([
        env.VERIFIER.prepare('INSERT INTO issuance_quota_v3(mailbox_hash,blinded_hash,expires_at) VALUES(?,?,?)').bind(row.mailbox_hash,blindedHash,quarterStart(new Date(now),1).toISOString()),
        env.VERIFIER.prepare('UPDATE mailbox_challenges SET used=1,blinded_hash=? WHERE id=? AND used=0').bind(blindedHash,action.challengeId),
        ...counted(env,key.companySlug,purpose,limits,1,now),
       ]);
       release=()=>env.VERIFIER.batch([
        env.VERIFIER.prepare('DELETE FROM issuance_quota_v3 WHERE mailbox_hash=? AND blinded_hash=?').bind(row.mailbox_hash,blindedHash),
        env.VERIFIER.prepare('UPDATE mailbox_challenges SET used=0,blinded_hash=NULL WHERE id=?').bind(action.challengeId),
        ...uncounted(env,key.companySlug,purpose,limits,1,now),
       ]);
      } catch(error) {
       const limited=await limitRefusal(env,key.companySlug,purpose,failureOf(error),now);
       if(limited) return reply({error:limited},503);
       const existing=await env.VERIFIER.prepare('SELECT blinded_hash FROM issuance_quota_v3 WHERE mailbox_hash=?').bind(row.mailbox_hash).first<{blinded_hash:string}>();
       if(!existing) return reply({error:'verification_unavailable'},503);
       if(existing.blinded_hash!==blindedHash) return reply({error:'credential_already_issued_this_period'},409);
      }
     }
    }
   }
   // Sandbox (demo) keys need no mailbox and have no cap, count or pause; ABUSE limits each connection.
   try {
    return reply({blindSignature:(await signAll(env,keyRow,[blinded]))[0]});
   } catch {
    // Nothing was issued, so the quarter's quota and the employer counts are released and the same code can be retried.
    if(release) await release().catch(()=>undefined);
    return reply({error:'signing_unavailable'},503);
   }
  } catch { return reply({error:'verification_failed'},400); }
 },
 async scheduled(_event:ScheduledController,env:IssuerEnv) {
  const date=new Date(),now=date.toISOString();
  await env.VERIFIER.batch([
   env.VERIFIER.prepare('DELETE FROM mailbox_challenges WHERE expires_at<?').bind(now),
   env.VERIFIER.prepare('DELETE FROM issuance_quota_v3 WHERE expires_at<?').bind(now),
   env.VERIFIER.prepare('DELETE FROM juror_quota WHERE expires_at<?').bind(now),
   env.VERIFIER.prepare('DELETE FROM issuance_hours WHERE hour<?').bind(Math.floor(date.getTime()/HOUR)-2*ISSUANCE_POLICY.windowHours),
   env.VERIFIER.prepare('DELETE FROM issuance_counts WHERE epoch<?').bind(quarter(date)),
   env.VERIFIER.prepare('DELETE FROM issuance_pauses WHERE paused_until<?').bind(now),
   env.VERIFIER.prepare('DELETE FROM issuer_keys WHERE expires_at<?').bind(now),
  ]);
  // Community email budgets are kept for today and yesterday only (separately, so the purge above never depends on it).
  try { await env.VERIFIER.prepare('DELETE FROM email_budget WHERE day<?').bind(new Date(date.getTime()-86400000).toISOString().slice(0,10)).run(); } catch {}
  // Community keys for a new quarter are created on demand here, a few employers per run; until then the previous
  // quarter's key (live through its grace quarter) keeps signing, so no employer is ever without a key.
  await ensureRegisteredKeys(env,date).catch(()=>0);
 },
};

/**
 * POST /issue-juror: 1–JUROR_QUOTA blinded juror messages. Mailbox keys need a code from the same /start challenge flow
 * (started with the juror key id). A mailbox receives juror tokens once per employer and quarter, as one batch of at most
 * JUROR_QUOTA, separate from the contribution credential: a later batch is refused whatever its size, with one generic
 * answer, so whoever holds a code learns only whether this mailbox's tokens were already issued, never how many (and a
 * probe of a mailbox that has none takes all of them). Sandbox keys (fictional employers) need no mailbox and are limited
 * per network instead.
 */
async function issueJuror(env:IssuerEnv,reply:(body:unknown,status?:number)=>Response,keyRow:KeyRow,key:IssuerKey,limits:IssuanceLimits|null,body:z.infer<typeof jurorInput>,network:string) {
 if(keyPurpose(key)!=='juror') return reply({error:'wrong_key_purpose'},400);
 let blinded:Uint8Array<ArrayBuffer>[];
 try { blinded=body.blinded.map(decode); } catch { return reply({error:'invalid_blinded_message'},400); }
 // Duplicates are compared as bytes, never as text spellings.
 if(blinded.some(b=>b.length!==256) || new Set(blinded.map(b=>encode(b))).size!==blinded.length) return reply({error:'invalid_blinded_message'},400);
 const joined=new Uint8Array(blinded.length*256);blinded.forEach((b,i)=>joined.set(b,i*256));
 const batchHash=await digest(joined), n=blinded.length, now=Date.now();
 let release:(()=>Promise<unknown>)|null=null;
 if(key.verificationClass==='mailbox') {
  if(!body.challengeId || !body.code) return reply({error:'verification_required'},401);
  const read=()=>env.VERIFIER.prepare('SELECT blinded_hash FROM mailbox_challenges WHERE id=?').bind(body.challengeId!).first<{blinded_hash:string|null}>();
  const row=await env.VERIFIER.prepare('UPDATE mailbox_challenges SET attempts=attempts+1 WHERE id=? AND key_id=? AND attempts<5 AND expires_at>? RETURNING mailbox_hash,code_hash,used,blinded_hash').bind(body.challengeId,key.id,new Date(now).toISOString()).first<{mailbox_hash:string;code_hash:string;used:number;blinded_hash:string|null}>();
  if(!row || row.code_hash!==await keyedHash(env,`${body.challengeId}:${body.code}`)) return reply({error:'invalid_or_expired_code'},400);
  // One challenge signs one batch. Only the identical batch is re-signed (a retry after a lost response).
  if(row.used && row.blinded_hash!==batchHash) return reply({error:'invalid_or_expired_code'},400);
  if(!row.used) {
   const refusal=await blocked(env,key.companySlug,'juror',limits,now);
   if(refusal) return reply({error:refusal},503);
   try {
    // The challenge is marked used first (a concurrent use of it fails with challenge_used, and only its identical batch is
    // re-signed below); then a plain INSERT records the mailbox's one batch this quarter. A second batch fails on the
    // primary key (or, above the quota, on the juror_quota_limit trigger) and the whole write is rolled back.
    await env.VERIFIER.batch([
     env.VERIFIER.prepare('UPDATE mailbox_challenges SET used=1,blinded_hash=? WHERE id=?').bind(batchHash,body.challengeId),
     env.VERIFIER.prepare('INSERT INTO juror_quota(mailbox_hash,tokens,expires_at) VALUES(?,?,?)').bind(row.mailbox_hash,n,quarterStart(new Date(now),1).toISOString()),
     ...counted(env,key.companySlug,'juror',limits,n,now),
    ]);
    release=()=>env.VERIFIER.batch([
     env.VERIFIER.prepare('DELETE FROM juror_quota WHERE mailbox_hash=? AND tokens=?').bind(row.mailbox_hash,n),
     env.VERIFIER.prepare('UPDATE mailbox_challenges SET used=0,blinded_hash=NULL WHERE id=?').bind(body.challengeId),
     ...uncounted(env,key.companySlug,'juror',limits,n,now),
    ]);
   } catch(error) {
    const failure=failureOf(error), limited=await limitRefusal(env,key.companySlug,'juror',failure,now);
    if(limited) return reply({error:limited},503);
    // One answer whatever the mailbox already holds: never a count of what remains.
    if(failure==='juror_quota') return reply({error:'juror_quota_exceeded'},409);
    // A concurrent request used this challenge first; only its identical batch may be re-signed.
    if(failure!=='challenge_used' || (await read())?.blinded_hash!==batchHash) return reply({error:failure==='challenge_used'?'invalid_or_expired_code':'verification_unavailable'},failure==='challenge_used'?400:503);
   }
  }
 } else if(env.JUROR_LIMIT && !(await env.JUROR_LIMIT.limit({key:await keyedHash(env,`juror-sandbox:${Math.floor(now/HOUR)}:${network}`)})).success) {
  // Sandbox juror tokens are limited per network (IPv6 /64 or IPv4 address) only: no cap, count or pause that one person
  // could use to lock everyone else out of the fictional employers' practice juries.
  return reply({error:'rate_limited'},429);
 }
 try {
  return reply({blindSignatures:await signAll(env,keyRow,blinded)});
 } catch {
  if(release) await release().catch(()=>undefined);
  return reply({error:'signing_unavailable'},503);
 }
}
