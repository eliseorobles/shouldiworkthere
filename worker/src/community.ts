import {z} from 'zod';
import {checkPow,powBits,powMinute,powSubject,POW_WINDOW_MINUTES,type PowProblem} from '../../shared/pow.ts';
import {normalizeDomain,domainProblem,ownLabels,registrableDomain,sharesSignificantToken,nameMatchesDomain,domainLabelKey,compactName,GENERIC_TOKENS,type DomainProblem} from '../../shared/domains.ts';
import {scanText} from '../../shared/privacy.ts';
import {digest,encode,keyPurpose,keySource,communityKeyId,quarter,randomToken,EMPLOYER_SLUG,type IssuerKey} from '../../shared/proof.ts';
import {requestClient,requestNetwork} from './network.ts';
import type {Env} from './types.ts';

/**
 * Community employer listings (owner decision 4, 2026-09-23). Anyone can list an employer by name and work-email domain;
 * listing is separate from verifying and reveals nothing about any contributor. The main worker checks the request
 * (proof of work, name, domain rules, MX records, per-client, per-network and global daily limits, Jev), writes the public
 * listing and registers the domain with the verifier over the VERIFIER service binding, authenticated with
 * INTERNAL_TOKEN. The verifier holds the domain registry and creates the employer's contribution and juror keys; the main
 * worker copies their public halves into trusted_issuers (INSERT OR IGNORE, source 'community').
 *
 * A listing added wrongly is corrected on request under the terms (correctListing, POST /api/directory/correct with
 * ADMIN_TOKEN): its name fixed, its community domain detached at the verifier and here (its keys deleted, so no new
 * credential is issued and the publisher refuses the old ones), or the whole listing withdrawn when nothing about it is
 * published or waiting. A correction never changes, withholds or removes an account, and each one is recorded in the
 * public listing correction log.
 */

export const EMPLOYER_NAME_MAX=80;
/** Listing attempts that pass the free checks, per client (IPv4 address or IPv6 /64) and UTC day. */
export const LISTINGS_PER_CLIENT_PER_DAY=5;
/**
 * The same attempts per wider network (IPv4 /24 or IPv6 /48, network.ts clientNetwork) and UTC day, so one person
 * rotating through the /64s of a routed /48 cannot use up the site's daily listings.
 */
export const LISTINGS_PER_NETWORK_PER_DAY=15;
/** New listings and attached domains, all clients together, per UTC day. */
export const COMMUNITY_LISTINGS_PER_DAY=200;
/**
 * Jev thresholds: attaching a domain to an existing listing needs domain_plausible ≥ 0.85 (owner decision 4, and the
 * deterministic token check). A name is refused when Jev reads it as plainly not a name (≥ 0.8: sentences, spam and
 * reviews read 0.91–0.98, ordinary names 0.01–0.41 in live probes) or the name or the domain as abusive (≥ 0.5;
 * ordinary names read 0.01–0.02; domains that accuse someone, such as johnsmith-is-a-liar.com, globex-steals-wages.com and
 * initech-hr-harasses-staff.com, read 0.92–0.98, and ordinary domains 0.02–0.04, crooksncastles.com 0.30). A new listing whose domain does not plainly carry its name (shared/domains.ts nameMatchesDomain)
 * needs domain_plausible ≥ MATCH_AT for that name. Live probes of jev-1.13 (2026-09-23, owner's wording, the typed name as
 * `employer`): true pairs the deterministic rule misses read 0.25 (Meta Platforms, fb.com), 0.33 (Johnson & Johnson,
 * jnj.com) and 0.44–0.69 (bofa.com, google.com for Alphabet, bwater.com, lmco.com, pwc.com, ms.com, ngc.com, rtx.com);
 * unrelated pairs read 0.09–0.15 (wellsfargo.com, jpmorgan.com, apple.com, amazon.co.uk, microsoft-support.net under
 * other names) and the look-alike schwab.co 0.25, but short domains stay uncertain whatever the name (gs.com 0.49 and
 * kp.org 0.50 under unrelated names). 0.3 refuses every unrelated long domain and accepts all but fb.com; a short domain
 * that is a listed employer's name or curated alias is protected by listingsNamedByDomain instead.
 */
export const PLAUSIBLE_AT=.85,NOT_A_NAME_AT=.8,ABUSIVE_AT=.5,MATCH_AT=.3;
export const DOH_ENDPOINT='https://cloudflare-dns.com/dns-query',DOH_TIMEOUT_MS=4000;
/** The verifier's internal registration route (service binding only; INTERNAL_TOKEN as a bearer token). */
export const VERIFIER_REGISTER_PATH='/internal/employers';
export const EMPLOYER_CHECK_TIMEOUT_MS=8000,VERIFIER_TIMEOUT_MS=8000;
/** The coverage note stored with a community listing: only what stays true for as long as the listing exists. */
export const COMMUNITY_NOTE='Added by the community.';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
async function hmac(secret:string,message:string) {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(message))));
}
const today=(now=new Date())=>now.toISOString().slice(0,10);

/** The verifier refuses internal calls unless its INTERNAL_TOKEN has at least this many characters. */
export const INTERNAL_TOKEN_MIN=32;
/** Listing is open only with the verifier binding, the shared secret, hosted checks and (outside development) the rate-limit secret. */
export const listingOpen=(env:Pick<Env,'VERIFIER'|'INTERNAL_TOKEN'|'INFERENCE'|'RATE_LIMIT_SECRET'|'ENVIRONMENT'>)=>!!env.VERIFIER&&(env.INTERNAL_TOKEN?.length??0)>=INTERNAL_TOKEN_MIN&&!!env.INFERENCE&&(!!env.RATE_LIMIT_SECRET||env.ENVIRONMENT==='development');

// ---- Names ----
export type NameProblem='name_invalid'|'name_identifying'|'name_abusive';
/** A typed name as it is stored and shown: NFKC, whitespace runs collapsed, trimmed. */
export const normalizeEmployerName=(raw:string)=>raw.normalize('NFKC').replace(/\s+/g,' ').trim();
const INVISIBLE=/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/;
const NAME_CHARS=/^[\p{L}\p{M}\p{N} &.,'’\-()+!/:#]+$/u;
/** Whole words that never belong in an employer's name: insults, profanity and accusations ("Acme Scam"). */
const ABUSIVE_WORDS=/\b(?:scam(?:s|mers?|my)?|rip-?offs?|fraud(?:s|sters?|ulent)?|sucks?|shit\w*|fuck\w*|crap(?:py)?|bitch\w*|bastards?|assholes?|cunts?|whores?|sluts?|nazis?|rapists?|p(?:a)?edo\w*|porn\w*|liars?|thie(?:f|ves)|idiots?|morons?|retard\w*|criminals?)\b/iu;
/** Slurs, including common letter substitutions. */
const SLURS=[/\bn[i1!|]gg/i,/\bf[a@4]gg?[o0]ts?\b/i,/\bk[i1]kes?\b/i,/\bsp[i1]cks?\b/i,/\bch[i1]nks?\b/i,/\btr[a@4]nn(?:y|ies)\b/i,/\bwetbacks?\b/i,/\bg[o0]{2}ks?\b/i,/\bdykes?\b/i,/\bra[g]heads?\b/i];
/**
 * Letters of the scripts whose letters pass for one another (Latin, Cyrillic, Greek). A name that mixes them ('Gооgle'
 * with Cyrillic о) is refused: it can only be meant to look like another name.
 */
const CONFUSABLE_SCRIPTS=[/\p{Script=Latin}/u,/\p{Script=Cyrillic}/u,/\p{Script=Greek}/u];
/** A host name inside a name ('Google (google.com)'): letters, digits and hyphens, a dot, and a top-level label. */
const HOSTNAME_IN_NAME=/(?:^|[^\p{L}\p{N}.-])((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+\p{L}{2,63})(?=$|[^\p{L}\p{N}.-])/gu;
/**
 * Why a name cannot be listed, or null. It must be 2–80 characters of letters, digits, spaces and the punctuation names
 * use (& . , ' - ( ) + ! / : #), with a letter, at least two letters or digits ('3M') and at most 12 words, no invisible
 * or control characters, letters of only one of the Latin, Cyrillic and Greek scripts, no address, link, email or phone
 * number (shared/privacy.ts), and no insult, profanity, accusation or slur. With the listing's domain, a host name in
 * the name must be that domain or its registrable domain ('Booking.com' with booking.com), so a name cannot show a
 * different domain than the one it is listed with ('Google (google.com)' with another domain is refused).
 */
export function nameProblem(raw:string,domain?:string):NameProblem|null {
 if(INVISIBLE.test(raw))return 'name_invalid';
 const name=normalizeEmployerName(raw);
 if(/@|:\/\/|\bwww\./i.test(name))return 'name_identifying';
 if(scanText(name).some(f=>f.severity==='high'||['email','phone','url','street_address','identifier','named_person'].includes(f.kind)))return 'name_identifying';
 if(domain!==undefined) {
  const own=normalizeDomain(domain),allowed=new Set([own,registrableDomain(own)]);
  for(const match of name.matchAll(HOSTNAME_IN_NAME))if(!allowed.has(match[1]!.toLowerCase()))return 'name_identifying';
 }
 if(name.length<2||name.length>EMPLOYER_NAME_MAX||!NAME_CHARS.test(name))return 'name_invalid';
 if(!/\p{L}/u.test(name)||(name.match(/[\p{L}\p{N}]/gu)??[]).length<2||name.split(' ').length>12||/(.)\1{4,}/u.test(name))return 'name_invalid';
 if(CONFUSABLE_SCRIPTS.filter(script=>script.test(name)).length>1)return 'name_invalid';
 if(ABUSIVE_WORDS.test(name)||SLURS.some(r=>r.test(name)))return 'name_abusive';
 return null;
}
/** Letters and digits only, lowercase, accents removed: how two spellings of one name are compared. */
export const nameKey=(name:string)=>name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
/** Cyrillic and Greek letters that look like Latin ones, as those Latin letters (lowercase). */
const CONFUSABLES:Readonly<Record<string,string>>={'\u0430':'a','\u0432':'b','\u0435':'e','\u0451':'e','\u0437':'3','\u043a':'k','\u043c':'m','\u043d':'h','\u043e':'o','\u0440':'p','\u0441':'c','\u0442':'t','\u0443':'y','\u0445':'x','\u0455':'s','\u0456':'i','\u0457':'i','\u0458':'j','\u0501':'d','\u051b':'q','\u051d':'w','\u04bb':'h','\u04cf':'l','\u044c':'b','\u03b1':'a','\u03b2':'b','\u03b5':'e','\u03b7':'n','\u03b9':'i','\u03ba':'k','\u03bc':'u','\u03bd':'v','\u03bf':'o','\u03c1':'p','\u03c4':'t','\u03c5':'u','\u03c7':'x','\u03b6':'z','\u03b3':'y','\u03c9':'w'};
/** A name as the Latin letters it looks like ('Соса-Сола' in Cyrillic → 'coca-cola'), lowercase. */
export const skeleton=(name:string)=>[...name.normalize('NFKC').toLowerCase()].map(c=>CONFUSABLES[c]??c).join('');
/** Legal-form words that do not change which organization a name means ('Google LLC' is Google). */
const LEGAL_FORMS=['the','inc','incorporated','llc','llp','lp','ltd','limited','plc','co','corp','corporation','company','gmbh','ag','sa','sas','srl','spa','bv','nv','ab','as','oy','pte','pty','kk','group','holding','holdings'];
const nameWords=(name:string)=>skeleton(name).normalize('NFKD').replace(/\p{M}/gu,'').replace(/&/g,' and ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Which organization a name means: its look-alike letters as Latin, legal-form words dropped, run together. */
export const identityKey=(name:string)=>nameWords(name).filter(w=>!LEGAL_FORMS.includes(w)).join('');
/** The name without any generic word ('OpenAI Staff' → 'openai', 'Google Careers' → 'google'); '' below 4 characters. */
const coreKey=(name:string)=>{const key=nameWords(name).filter(w=>!GENERIC_TOKENS.includes(w)).join('');return key.length>=4?key:'';};
/** Every way a typed name can mean an organization: its identity and its core (both empty-free). */
const typedKeys=(name:string)=>new Set([identityKey(name),coreKey(name)].filter(Boolean));

// ---- Domains ----
/**
 * Insults, profanity and slurs found anywhere inside a domain label run together ('fuckacme', 'acmesucks'): only letter
 * runs no ordinary word contains. Words that do occur inside ordinary ones ('rapist' in therapist, 'cunt' in Scunthorpe,
 * 'nazi' in Nazir) are matched only as whole words, below, and Jev reads the domain too.
 */
const DOMAIN_ABUSE=/fuck|shit|nigg|fagg|whore|slut|bitch|asshole|porn|sucks|scammer|isascam|isafraud|fraudster|ripoff|paedo|pedophil|molest/;
/** Accusations about a person, as whole words of a domain ('john-smith-is-a-predator.com'), beside ABUSIVE_WORDS. */
const DOMAIN_ACCUSATIONS=/\b(?:predators?|abusers?|harass\w*|stalkers?|molesters?|perverts?|racists?|bigots?)\b/i;
/**
 * Why a domain's own name cannot be listed (it is shown beside the employer everywhere), or null: an insult,
 * profanity, accusation or slur in its words ('acme-is-a-scam.com', 'fuckacme.com'), or identifying details in them.
 * Its labels in front of the public suffix are read as words (split on hyphens and digits) and as written.
 */
export function domainAbuseProblem(domain:string):'domain_abusive'|null {
 const labels=ownLabels(normalizeDomain(domain));
 const words=labels.flatMap(l=>l.split(/[-0-9]+/)).filter(Boolean).join(' ');
 if(labels.some(l=>DOMAIN_ABUSE.test(l.replace(/-/g,''))))return 'domain_abusive';
 if(ABUSIVE_WORDS.test(words)||DOMAIN_ACCUSATIONS.test(words)||SLURS.some(r=>r.test(words)))return 'domain_abusive';
 if(scanText(words).some(f=>f.severity==='high'||['email','phone','street_address','identifier','named_person'].includes(f.kind)))return 'domain_abusive';
 return null;
}
/** A slug from a name (ASCII letters and digits), or '' when the name has none. */
export function slugify(text:string):string {
 return text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60).replace(/-+$/,'');
}
/**
 * The listing's slug: the name's, or the name's and the domain's when that is taken (or the domain's alone for a name
 * without Latin letters). Every candidate is an EMPLOYER_SLUG (at most 80 characters, single hyphens), as the verifier requires.
 */
export function slugCandidates(name:string,domain:string):string[] {
 const base=slugify(name),site=slugify(domain.replace(/\./g,' ')),cut=(s:string)=>s.slice(0,80).replace(/-+$/,'');
 return [...new Set([base,base?cut(`${base}-${site}`):cut(site)].filter(s=>EMPLOYER_SLUG.test(s)))];
}

// ---- DNS ----
export type MxResult={status:'ok';hosts:string[]}|{status:'none'}|{status:'unavailable'};
/**
 * The domain's MX records over DNS over HTTPS (Cloudflare's JSON API), read with the global fetch at call time. 'none'
 * for NXDOMAIN, no MX answer, or a null MX (RFC 7505: "0 ."); 'unavailable' when the resolver fails or times out, so
 * nothing is decided on a resolver failure.
 */
export async function mxRecords(domain:string,timeoutMs=DOH_TIMEOUT_MS):Promise<MxResult> {
 let body:{Status?:unknown;Answer?:unknown};
 try {
  const response=await globalThis.fetch(`${DOH_ENDPOINT}?name=${encodeURIComponent(domain)}&type=MX`,{headers:{accept:'application/dns-json'},signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)return {status:'unavailable'};
  body=await response.json() as typeof body;
 } catch {return {status:'unavailable'};}
 if(body?.Status===3)return {status:'none'};
 if(body?.Status!==0)return {status:'unavailable'};
 const answers=Array.isArray(body.Answer)?body.Answer as Array<{type?:unknown;data?:unknown}>:[];
 const hosts=answers.filter(a=>a?.type===15&&typeof a.data==='string').map(a=>String(a.data).trim().split(/\s+/)).filter(p=>p.length===2&&/^\d+$/.test(p[0]!)).map(p=>p[1]!.toLowerCase().replace(/\.$/,'')).filter(h=>h.length>0);
 return hosts.length?{status:'ok',hosts}:{status:'none'};
}

// ---- Jev ----
/** domainAbusive is 0 from an inference worker older than prompt v3, which did not read the domain for abuse. */
export interface ListingCheck {notAName:number;abusive:number;domainAbusive:number;plausible:number|null;model:string|null;}
const checkReply=z.looseObject({notAName:z.number().min(0).max(1),abusive:z.number().min(0).max(1),domainAbusive:z.number().min(0).max(1).optional(),plausible:z.number().min(0).max(1).nullable(),model:z.string().max(200).optional()});
/**
 * Jev's reading of a listing (the inference worker's /employer-check): null when it is unavailable or its budget is
 * spent. `employer` asks whether the domain is that organization's corporate email domain (plausible), for a curated
 * listing that may receive the domain, or for the typed name when the domain does not plainly carry it.
 */
export async function listingCheck(env:Pick<Env,'INFERENCE'>,input:{name:string;domain:string;employer?:string}):Promise<ListingCheck|null> {
 if(!env.INFERENCE)return null;
 try {
  const response=await env.INFERENCE.fetch('https://inference/employer-check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(EMPLOYER_CHECK_TIMEOUT_MS)});
  if(!response.ok)return null;
  const parsed=checkReply.safeParse(await response.json());
  return parsed.success?{notAName:parsed.data.notAName,abusive:parsed.data.abusive,domainAbusive:parsed.data.domainAbusive??0,plausible:parsed.data.plausible,model:parsed.data.model??null}:null;
 } catch {return null;}
}

// ---- Verifier ----
type VerifierEnv=Pick<Env,'VERIFIER'|'INTERNAL_TOKEN'>;
const internalHeaders=(env:VerifierEnv)=>({'content-type':'application/json',authorization:`Bearer ${env.INTERNAL_TOKEN}`});
/**
 * 'refused': the verifier does not accept this worker's INTERNAL_TOKEN (401, 403, or 503 internal_unavailable: its own
 * token is missing or short). Nothing can be registered until the secrets are fixed, so no listing is left pending on it.
 */
export type Registration={outcome:'registered';keys:unknown[]}|{outcome:'taken'}|{outcome:'unavailable'}|{outcome:'refused'};
const refusedToken=(status:number,body:{error?:unknown}|null)=>status===401||status===403||(status===503&&body?.error==='internal_unavailable');
/**
 * Registers a listing's domain with the verifier, which holds the domain registry (POST /internal/employers {slug,
 * domain}, worker/issuer.ts): 'registered' (the verifier created or already holds the employer's community keys, which
 * its reply lists), 'taken' (409: the domain belongs to another employer or a curated key, or the employer already has
 * another domain, or was withdrawn; 400: the verifier's own domain rules refuse it), 'refused' (it does not accept the
 * shared secret) or 'unavailable' (retried by the scheduled job). The token travels only over the service binding.
 */
export async function registerWithVerifier(env:VerifierEnv,listing:{slug:string;domain:string}):Promise<Registration> {
 if(!env.VERIFIER||!env.INTERNAL_TOKEN)return {outcome:'unavailable'};
 try {
  const response=await env.VERIFIER.fetch(`https://verifier${VERIFIER_REGISTER_PATH}`,{method:'POST',headers:internalHeaders(env),body:JSON.stringify({slug:listing.slug,domain:listing.domain}),signal:AbortSignal.timeout(VERIFIER_TIMEOUT_MS)});
  const body=await response.json().catch(()=>null) as {registered?:unknown;keys?:unknown;error?:unknown}|null;
  if(response.status===409||response.status===400)return {outcome:'taken'};
  if(refusedToken(response.status,body))return {outcome:'refused'};
  return response.ok&&body?.registered===true?{outcome:'registered',keys:Array.isArray(body.keys)?body.keys:[]}:{outcome:'unavailable'};
 } catch {return {outcome:'unavailable'};}
}
/**
 * Takes a community registration down at the verifier (DELETE /internal/employers {slug}): its registry row and its
 * community keys are deleted there at once, and the verifier keeps the slug and domain so neither is registered again.
 * 'withdrawn' also when there was nothing to take down (idempotent); 'curated' when the employer has curated keys there.
 */
export async function withdrawAtVerifier(env:VerifierEnv,slug:string):Promise<'withdrawn'|'curated'|'refused'|'unavailable'> {
 if(!env.VERIFIER||!env.INTERNAL_TOKEN)return 'unavailable';
 try {
  const response=await env.VERIFIER.fetch(`https://verifier${VERIFIER_REGISTER_PATH}`,{method:'DELETE',headers:internalHeaders(env),body:JSON.stringify({slug}),signal:AbortSignal.timeout(VERIFIER_TIMEOUT_MS)});
  const body=await response.json().catch(()=>null) as {withdrawn?:unknown;error?:unknown}|null;
  if(response.status===409&&body?.error==='not_community_employer')return 'curated';
  if(refusedToken(response.status,body))return 'refused';
  return response.ok&&body?.withdrawn===true?'withdrawn':'unavailable';
 } catch {return 'unavailable';}
}
/**
 * Whether the verifier accepts this worker's INTERNAL_TOKEN, without changing anything there: a DELETE of
 * /internal/employers with an empty body passes the token check and is then refused as malformed (400 invalid_request),
 * while a token the verifier does not accept is refused first (401, or 503 internal_unavailable when its own is missing).
 */
export async function probeVerifierLink(env:VerifierEnv):Promise<'ok'|'refused'|'unavailable'> {
 if(!env.VERIFIER||!env.INTERNAL_TOKEN)return 'unavailable';
 try {
  const response=await env.VERIFIER.fetch(`https://verifier${VERIFIER_REGISTER_PATH}`,{method:'DELETE',headers:internalHeaders(env),body:'{}',signal:AbortSignal.timeout(VERIFIER_TIMEOUT_MS)});
  const body=await response.json().catch(()=>null) as {error?:unknown}|null;
  if(refusedToken(response.status,body))return 'refused';
  return response.status===400&&body?.error==='invalid_request'?'ok':'unavailable';
 } catch {return 'unavailable';}
}
/** Where the scheduled job records the last probe (intake stats_snapshots): the state and the UTC day, nothing else. */
const LINK_SNAPSHOT='verifier_link';
/** The last recorded verifier link state and its UTC day, or null before the first scheduled run. */
export async function verifierLinkState(env:Pick<Env,'INTAKE'>):Promise<{state:'ok'|'refused'|'unavailable';day:string}|null> {
 try {
  const row=await env.INTAKE.prepare('SELECT day,payload FROM stats_snapshots WHERE name=?').bind(LINK_SNAPSHOT).first<{day:string;payload:string}>();
  const state=row?JSON.parse(row.payload)?.state:null;
  return row&&['ok','refused','unavailable'].includes(state)?{state,day:row.day}:null;
 } catch {return null;}
}
const communityKeySchema=z.looseObject({id:z.string().max(120),companySlug:z.string().regex(EMPLOYER_SLUG),epoch:z.string().regex(/^\d{4}-Q[1-4]$/),expiresAt:z.string().max(40),verificationClass:z.literal('mailbox'),purpose:z.enum(['contribution','juror']).optional(),source:z.literal('community'),publicKey:z.looseObject({kty:z.literal('RSA'),n:z.string().min(300).max(1000),e:z.string().max(20)})});
/**
 * A community key the publisher will copy: well formed, mailbox class, source 'community', an id that is exactly
 * communityKeyId(slug, epoch, purpose) with purpose and source agreeing with it (shared/proof.ts), not yet expired.
 */
export function acceptableCommunityKey(input:unknown,now=Date.now()):(IssuerKey&{source:'community'})|null {
 const parsed=communityKeySchema.safeParse(input);if(!parsed.success)return null;
 const k=parsed.data,purpose=keyPurpose({id:k.id,...(k.purpose?{purpose:k.purpose}:{})});
 if(!purpose||keySource({id:k.id,source:'community'})!=='community'||k.id!==communityKeyId(k.companySlug,k.epoch,purpose)||!(Date.parse(k.expiresAt)>now))return null;
 // The public key exactly as the verifier sent it (field order included), so both copies serialize alike.
 return {id:k.id,companySlug:k.companySlug,epoch:k.epoch,expiresAt:k.expiresAt,verificationClass:'mailbox',purpose,publicKey:(input as {publicKey:JsonWebKey}).publicKey,source:'community'};
}
/** Slugs of employers whose verification domain was added by the community and acknowledged by the verifier. */
async function communitySlugs(env:Pick<Env,'DB'>):Promise<Set<string>> {
 try {return new Set((await env.DB.prepare("SELECT DISTINCT c.slug FROM employer_domains d JOIN companies c ON c.id=d.company_id WHERE d.source='community' AND d.registered=1").all<{slug:string}>()).results.map(r=>r.slug));}
 catch {return new Set();}
}
/**
 * Inserts acceptable community keys of employers in `slugs` into trusted_issuers (INSERT OR IGNORE; ids already held are
 * skipped before anything is written); the number added.
 */
async function storeCommunityKeys(env:Pick<Env,'DB'>,keys:readonly unknown[],slugs:ReadonlySet<string>):Promise<number> {
 const held=new Set((await env.DB.prepare("SELECT id FROM trusted_issuers WHERE source='community'").all<{id:string}>()).results.map(r=>r.id));
 const wanted=keys.map(k=>acceptableCommunityKey(k)).filter((k):k is IssuerKey&{source:'community'}=>!!k&&slugs.has(k.companySlug)&&!held.has(k.id));
 if(!wanted.length)return 0;
 const results=await env.DB.batch(wanted.map(k=>env.DB.prepare("INSERT OR IGNORE INTO trusted_issuers(id,company_slug,epoch,expires_at,verification_class,public_key_json,purpose,source) VALUES(?,?,?,?,'mailbox',?,?,'community')").bind(k.id,k.companySlug,k.epoch,k.expiresAt,JSON.stringify(k.publicKey),k.purpose!)));
 return results.reduce((n,r)=>n+(r.meta.changes??0),0);
}
/** The verifier's live community keys (GET /keys?source=community), or null when they cannot be read. */
async function verifierCommunityKeys(env:Pick<Env,'VERIFIER'>):Promise<unknown[]|null> {
 if(!env.VERIFIER)return null;
 try {
  const response=await env.VERIFIER.fetch('https://verifier/keys?source=community',{headers:{accept:'application/json'},signal:AbortSignal.timeout(VERIFIER_TIMEOUT_MS)});
  if(!response.ok)return null;
  const body=await response.json() as {keys?:unknown};
  return Array.isArray(body?.keys)?body.keys:null;
 } catch {return null;}
}
/**
 * Copies the verifier's community keys (source 'community' on its public /keys) into trusted_issuers with INSERT OR IGNORE
 * (a published key is never altered), only for employers whose domain the community added here. Returns the number of
 * rows added; 0 when the verifier is unreachable.
 */
export async function syncCommunityKeys(env:Pick<Env,'DB'|'VERIFIER'>):Promise<number> {
 const slugs=await communitySlugs(env);if(!slugs.size)return 0;
 const keys=await verifierCommunityKeys(env);
 return keys?storeCommunityKeys(env,keys,slugs):0;
}

// ---- Limits ----
/** Spends one of `max` uses today of a keyed daily record (intake daily_budgets); false once they are used. */
async function spendDaily(env:Pick<Env,'INTAKE'>,key:string,max:number,now:Date):Promise<boolean> {
 return !!await env.INTAKE.prepare('INSERT INTO daily_budgets(day,digest,used) VALUES(?,?,1) ON CONFLICT(day,digest) DO UPDATE SET used=used+1 WHERE used<? RETURNING used').bind(today(now),key,max).first();
}
/**
 * One listing attempt from this client today (UTC): HMAC(RATE_LIMIT_SECRET, day, 'employers', digest of the client) in
 * the intake daily_budgets table, and one from its wider network (the same purpose, keyed with a digest of the IPv4 /24
 * or IPv6 /48 instead), both deleted after the day by the scheduled job. Fails closed: without the secret (outside
 * development) or on a storage error, no attempt is allowed.
 */
export async function spendListingAllowance(env:Pick<Env,'INTAKE'|'RATE_LIMIT_SECRET'|'ENVIRONMENT'>,request:Request,now=new Date()):Promise<boolean> {
 if(env.ENVIRONMENT==='development')return true;
 if(!env.RATE_LIMIT_SECRET)return false;
 try {
  const key=await hmac(env.RATE_LIMIT_SECRET,`siwt-quota-v1\n${today(now)}\nemployers\n${await digest(`siwt-address-v1:${requestClient(request)}`)}`);
  if(!await spendDaily(env,key,LISTINGS_PER_CLIENT_PER_DAY,now))return false;
  const network=await hmac(env.RATE_LIMIT_SECRET,`siwt-quota-v1\n${today(now)}\nemployers\n${await digest(`siwt-network-v1:${requestNetwork(request)}`)}`);
  return await spendDaily(env,network,LISTINGS_PER_NETWORK_PER_DAY,now);
 } catch {return false;}
}
/** One of today's COMMUNITY_LISTINGS_PER_DAY (moderation_counters, pruned after two days); false once they are used. */
async function spendGlobalListing(env:Pick<Env,'INTAKE'>,now=new Date()):Promise<boolean> {
 try {return !!await env.INTAKE.prepare("INSERT INTO moderation_counters(period,metric,count) VALUES(?,'community_listings',1) ON CONFLICT(period,metric) DO UPDATE SET count=count+1 WHERE count<? RETURNING count").bind(today(now),COMMUNITY_LISTINGS_PER_DAY).first();}
 catch {return false;}
}
async function releaseGlobalListing(env:Pick<Env,'INTAKE'>,now=new Date()) {
 try {await env.INTAKE.prepare("UPDATE moderation_counters SET count=MAX(0,count-1) WHERE period=? AND metric='community_listings'").bind(today(now)).run();} catch {}
}
const untilUtcMidnight=(now=new Date())=>Math.max(1,Math.ceil((Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)-now.getTime())/1000));

// ---- Listing ----
/** A real employer in the directory (visible or not), with its curated aliases and verification domains. */
export interface Listed {id:string;slug:string;name:string;origin:'curated'|'community';aliases:string[];domains:string[]}
async function realListings(env:Pick<Env,'DB'>):Promise<Listed[]> {
 const rows=(await env.DB.prepare("SELECT id,slug,name,COALESCE(origin,'curated') AS origin FROM companies WHERE kind='real'").all<{id:string;slug:string;name:string;origin:'curated'|'community'}>()).results;
 const aliases=new Map<string,string[]>(),domains=new Map<string,string[]>();
 try {for(const a of (await env.DB.prepare('SELECT company_id,alias FROM company_aliases').all<{company_id:string;alias:string}>()).results)aliases.set(a.company_id,[...(aliases.get(a.company_id)??[]),a.alias]);} catch {}
 for(const d of (await env.DB.prepare('SELECT company_id,domain FROM employer_domains ORDER BY position,domain').all<{company_id:string;domain:string}>()).results)domains.set(d.company_id,[...(domains.get(d.company_id)??[]),d.domain]);
 return rows.map(r=>({...r,aliases:aliases.get(r.id)??[],domains:domains.get(r.id)??[]}));
}
/** Whether a typed name means this listing: its identity or core equals the listing's name or a curated alias. */
export function namesListing(typed:string,listing:Pick<Listed,'name'|'aliases'>):boolean {
 const own=new Set([listing.name,...listing.aliases].map(identityKey).filter(Boolean));
 return [...typedKeys(typed)].some(k=>own.has(k));
}
/**
 * The listings a domain's registrable label names exactly (hyphens removed): a listing's whole name run together, with or
 * without its legal-form words, or one of its curated aliases ('wellsfargo' for Wells Fargo, 'schwab', 'jnj' and 'bofa'
 * for the employers with those aliases). Such a domain can be listed only for that employer (owner decision 4's attach
 * rule, or a listing of the same name where the owner decision allows one), never under another name.
 */
export function listingsNamedByDomain(domain:string,listings:readonly Listed[]):Listed[] {
 const label=domainLabelKey(domain);
 if(label.length<2)return [];
 return listings.filter(l=>[l.name,...l.aliases].some(n=>compactName(n)===label||identityKey(n)===label));
}
/** The listing that already holds this domain, or a parent of it (mail.acme.com is covered by acme.com). */
async function listedFor(env:Pick<Env,'DB'>,domain:string):Promise<{slug:string;name:string;domain:string}|null> {
 return env.DB.prepare("SELECT c.slug,c.name,d.domain FROM employer_domains d JOIN companies c ON c.id=d.company_id WHERE d.domain=? OR substr(?,-length(d.domain)-1)='.'||d.domain ORDER BY length(d.domain) DESC LIMIT 1").bind(domain,domain).first<{slug:string;name:string;domain:string}>();
}
async function freeSlug(env:Pick<Env,'DB'>,name:string,domain:string):Promise<string|null> {
 for(const slug of slugCandidates(name,domain)) if(!await env.DB.prepare('SELECT 1 AS taken FROM companies WHERE slug=?').bind(slug).first())return slug;
 return null;
}
const requestSchema=z.object({name:z.string().max(400),domain:z.string().max(400),pow:z.unknown().optional()}).strict();
/** The local development port of the main worker (wrangler.jsonc dev.port; tools/dev.mjs). */
export const LOCAL_DEV_PORT=8788;
/**
 * The origin a listing's proof of work is bound to: the site's origin as this worker sees it (/api/config reports it as
 * employerListing.pow.origin; in production it is the page's own origin). `wrangler dev` hands the worker the custom
 * domain's host instead of localhost (and rewrites the page's Origin header to match), so a development stack also
 * accepts a stamp bound to the local address the browser actually shows.
 */
export function powOrigins(env:Pick<Env,'ENVIRONMENT'>,request:Request):string[] {
 const own=new URL(request.url).origin;
 return env.ENVIRONMENT==='development'?[own,`http://localhost:${LOCAL_DEV_PORT}`,`http://127.0.0.1:${LOCAL_DEV_PORT}`]:[own];
}
export type ListingError=PowProblem|NameProblem|DomainProblem|'invalid_request'|'listing_unavailable'|'rate_limited'|'listing_daily_limit'|'domain_no_mx'|'dns_unavailable'|'checks_unavailable'|'name_not_organization'|'domain_already_listed'|'slug_unavailable'|'domain_abusive'|'name_already_listed'|'domain_belongs_to_listed'|'domain_name_mismatch';
const companyRef=(l:Pick<Listed,'slug'|'name'|'domains'>)=>({slug:l.slug,name:l.name,...(l.domains[0]?{domain:l.domains[0]}:{})});
/**
 * POST /api/employers {name, domain, pow}. Checks run cheapest first: the proof of work (one hash), the name and domain
 * rules (including the domain's own words), then this client's and its network's daily allowances, then duplicates:
 *  - the domain (or a parent of it) is listed already: 409 domain_already_listed;
 *  - the name means a listing that already has a domain ('Google', 'Google LLC', 'OpenAI Staff', or a name spelled in
 *    look-alike Cyrillic or Greek letters): 409 name_already_listed, with that listing (server-side, whatever the page
 *    asked the visitor to confirm). The one exception is a domain that may attach to a curated listing of that name
 *    without a domain: it goes on to Jev, and is refused the same way if it does not attach;
 *  - the domain's label is another listing's name or alias (wellsfargo.com under 'Acme Holdings'): 409
 *    domain_belongs_to_listed, with that listing;
 * then MX records (DNS over HTTPS), Jev and the verifier. A name matching a curated listing without a domain (Charles
 * Schwab) gets the domain attached only when Jev answers at least 0.85 that the domain is its corporate email domain AND
 * the primary label of the domain's registrable name is exactly a significant word, the whole name or a curated alias
 * (shared/domains.ts sharesSignificantToken: never a subdomain label or a part of a label); otherwise the domain becomes
 * its own community listing, shown as "Name (domain)". A new listing's domain must plainly carry its name
 * (shared/domains.ts nameMatchesDomain), or Jev must read it as at least MATCH_AT plausible for that name: 422
 * domain_name_mismatch otherwise.
 */
export async function addEmployer(env:Env,input:unknown,request:Request):Promise<Response> {
 if(!listingOpen(env))return json({error:'listing_unavailable'},503);
 const parsed=requestSchema.safeParse(input);
 if(!parsed.success)return json({error:'invalid_request'},400);
 const {name:rawName,domain:rawDomain,pow}=parsed.data;
 // Bound to this origin, the listing action, no key and a digest of the domain exactly as sent (shared/pow.ts).
 const subject=await powSubject.domain(rawDomain),bits=powBits(env.POW_BITS);
 let problem:PowProblem|null='pow_missing';
 for(const origin of powOrigins(env,request)){problem=await checkPow(pow,{origin,action:'add-employer',keyId:'',subject},bits);if(!problem||problem!=='pow_insufficient')break;}
 if(problem)return json({error:problem,minute:powMinute(),windowMinutes:POW_WINDOW_MINUTES},400);
 const name=normalizeEmployerName(rawName),domain=normalizeDomain(rawDomain);
 const domainIssue=domainProblem(domain);if(domainIssue)return json({error:domainIssue},422);
 const nameIssue=nameProblem(rawName,domain);if(nameIssue)return json({error:nameIssue},422);
 if(domainAbuseProblem(domain))return json({error:'domain_abusive'},422);
 if(!await spendListingAllowance(env,request)){const seconds=untilUtcMidnight();return json({error:'rate_limited',limit:'daily',retryAfterSeconds:seconds},429);}
 const existing=await listedFor(env,domain);
 if(existing)return json({error:'domain_already_listed',company:{slug:existing.slug,name:existing.name,domain:existing.domain}},409);
 const listings=await realListings(env);
 // A curated listing of this name (or alias) that has no domain yet may receive it (owner decision 4), when the domain's
 // registrable label is exactly its name, a significant word of it or an alias (shared/domains.ts) and Jev agrees below.
 const candidate=listings.find(l=>l.origin==='curated'&&!l.domains.length&&namesListing(name,l))??null;
 const deterministicAttach=!!candidate&&sharesSignificantToken(domain,[candidate.name,...candidate.aliases]);
 // Enforced here, not left to the page's confirmation: a name that means a listing which already has a verification
 // domain never becomes another listing. Only a domain that may attach to the curated listing goes on to Jev, so a
 // same-name listing someone added first cannot block the employer's own domain; if it does not attach, it is refused.
 const sameName=listings.find(l=>l.domains.length&&namesListing(name,l));
 if(sameName&&!deterministicAttach)return json({error:'name_already_listed',company:companyRef(sameName)},409);
 const claimed=listingsNamedByDomain(domain,listings);
 if(claimed.length&&!claimed.some(l=>namesListing(name,l)))return json({error:'domain_belongs_to_listed',company:companyRef(claimed[0]!)},409);
 const mx=await mxRecords(domain);
 if(mx.status==='unavailable')return json({error:'dns_unavailable'},503);
 if(mx.status==='none')return json({error:'domain_no_mx'},422);
 const carriesName=nameMatchesDomain(domain,name)||deterministicAttach;
 const employer=candidate?.name??(carriesName?undefined:name);
 const check=await listingCheck(env,{name,domain,...(employer?{employer}:{})});
 if(!check)return json({error:'checks_unavailable'},503);
 if(check.abusive>=ABUSIVE_AT)return json({error:'name_abusive'},422);
 if(check.domainAbusive>=ABUSIVE_AT)return json({error:'domain_abusive'},422);
 if(check.notAName>=NOT_A_NAME_AT)return json({error:'name_not_organization'},422);
 if(!carriesName&&!(check.plausible!==null&&check.plausible>=MATCH_AT))return json({error:'domain_name_mismatch'},422);
 const attach=deterministicAttach&&check.plausible!==null&&check.plausible>=PLAUSIBLE_AT;
 if(sameName&&!attach)return json({error:'name_already_listed',company:companyRef(sameName)},409);
 if(!await spendGlobalListing(env)){const seconds=untilUtcMidnight();return json({error:'listing_daily_limit',retryAfterSeconds:seconds},503);}
 let company:{id:string;slug:string;name:string;created:boolean};
 if(attach) company={id:candidate!.id,slug:candidate!.slug,name:candidate!.name,created:false};
 else {
  const slug=await freeSlug(env,name,domain);
  if(!slug){await releaseGlobalListing(env);return json({error:'slug_unavailable'},409);}
  company={id:`cc-${randomToken(12)}`,slug,name,created:true};
 }
 try {
  await env.DB.batch([
   ...(company.created?[env.DB.prepare("INSERT INTO companies(id,slug,name,kind,sector,coverage_note,origin) VALUES(?,?,?,'real',NULL,?,'community')").bind(company.id,company.slug,company.name,COMMUNITY_NOTE)]:[]),
   env.DB.prepare("INSERT INTO employer_domains(domain,company_id,source,position,registered) VALUES(?,?,'community',0,0)").bind(domain,company.id),
  ]);
 } catch(error) {
  await releaseGlobalListing(env);
  if(/UNIQUE|constraint/i.test(String(error))){const now=await listedFor(env,domain);return json({error:'domain_already_listed',...(now?{company:{slug:now.slug,name:now.name,domain:now.domain}}:{})},409);}
  throw error;
 }
 const registration=await registerWithVerifier(env,{slug:company.slug,domain});
 if(registration.outcome==='taken'||registration.outcome==='refused') {
  // Taken: the verifier already holds this domain (a curated employer's, a withdrawn one, or a race). Refused: the two
  // workers do not share the secret, so it could never register. Either way the listing is withdrawn at once.
  await removeListing(env,domain,company.id,company.created);await releaseGlobalListing(env);
  return registration.outcome==='taken'?json({error:'domain_already_listed'},409):json({error:'listing_unavailable'},503);
 }
 let ready=false;
 if(registration.outcome==='registered') {
  await env.DB.prepare('UPDATE employer_domains SET registered=1 WHERE domain=?').bind(domain).run();
  // The reply lists the employer's keys; /keys is read only when it lists none the publisher can use.
  await storeCommunityKeys(env,registration.keys,new Set([company.slug]))||await syncCommunityKeys(env);
  ready=!!await env.DB.prepare("SELECT 1 AS ok FROM trusted_issuers WHERE company_slug=? AND source='community' AND purpose='contribution' AND expires_at>?").bind(company.slug,new Date().toISOString()).first();
 }
 return json({listed:true,attached:attach,company:{slug:company.slug,name:company.name,origin:company.created?'community':'curated',domains:[domain]},verification:ready?'ready':'pending'},201);
}
/** Removes a listing's domain and, for a listing created with it, the employer row when nothing has been published about it. */
async function removeListing(env:Pick<Env,'DB'>,domain:string,companyId:string,created:boolean) {
 await env.DB.batch([
  env.DB.prepare('DELETE FROM employer_domains WHERE domain=? AND company_id=?').bind(domain,companyId),
  ...(created?[env.DB.prepare("DELETE FROM companies WHERE id=? AND origin='community' AND NOT EXISTS(SELECT 1 FROM testimony WHERE company_id=?) AND NOT EXISTS(SELECT 1 FROM metric_releases WHERE company_id=?) AND NOT EXISTS(SELECT 1 FROM employer_domains WHERE company_id=?)").bind(companyId,companyId,companyId,companyId)]:[]),
 ]);
}

// ---- Corrections ----
/**
 * Listing corrections (the terms' "Correcting a listing"; owner decisions 2 and 4). A person reviews each request; this
 * applies the outcome, with ADMIN_TOKEN, through POST /api/directory/correct:
 *  - detach: the listing's community-added domain is taken down at the verifier (its registry row and keys deleted there,
 *    and the slug and domain recorded so neither registers again) and here (the domain and the copied keys deleted, so
 *    the publisher also refuses credentials made with them). A curated domain is never detached this way.
 *  - withdraw: detach, then the community listing itself is removed, only while nothing about it is published or waiting
 *    in the intake database (an account is never removed or withheld by a correction).
 *  - rename: a community listing's name is replaced with one that passes the same name rules.
 * Each correction is appended to the public listing_corrections log (kind, reason, quarter and a digest of the slug).
 */
export const CORRECTION_ACTIONS=['detach','withdraw','rename'] as const;
export const CORRECTION_REASONS=['wrong_organization','wrong_domain','duplicate','content_rules','legal_order','verifier_withdrawn'] as const;
export type CorrectionAction=typeof CORRECTION_ACTIONS[number];
export type CorrectionReason=typeof CORRECTION_REASONS[number];
const correctionSchema=z.object({slug:z.string().regex(EMPLOYER_SLUG),action:z.enum(CORRECTION_ACTIONS),reason:z.enum(CORRECTION_REASONS).exclude(['verifier_withdrawn']),name:z.string().max(400).optional()}).strict();
/** A digest of a listing's slug, as the correction log names it (never the slug or name, which may be the problem). */
export const listingDigest=(slug:string)=>digest(`siwt-listing-v1:${slug}`);
async function logCorrection(env:Pick<Env,'DB'>,slug:string,action:CorrectionAction,reason:CorrectionReason,now=new Date()) {
 return env.DB.prepare('INSERT INTO listing_corrections(id,period,action,reason,target_digest) VALUES(?,?,?,?,?)').bind(`lc_${randomToken(12)}`,quarter(now),action,reason,await listingDigest(slug));
}
/** Deletes a listing's community-added domains and the community keys copied for it (the verifier's side is done first). */
const detachStatements=(env:Pick<Env,'DB'>,companyId:string,slug:string)=>[
 env.DB.prepare("DELETE FROM employer_domains WHERE company_id=? AND source='community'").bind(companyId),
 env.DB.prepare("DELETE FROM trusted_issuers WHERE company_slug=? AND source='community'").bind(slug),
];
/** Public tables whose rows are evidence about an employer: a listing with any of them is never removed. */
const EVIDENCE_TABLES=['testimony','metric_releases','cohorts','events','corroborations','structured_responses','pending_submissions'] as const;
export async function correctListing(env:Env,input:unknown):Promise<{status:number;body:Record<string,unknown>}> {
 const parsed=correctionSchema.safeParse(input);
 if(!parsed.success)return {status:400,body:{error:'invalid_request'}};
 const {slug,action,reason}=parsed.data;
 const company=await env.DB.prepare("SELECT id,slug,name,COALESCE(origin,'curated') AS origin FROM companies WHERE slug=? AND kind='real'").bind(slug).first<{id:string;slug:string;name:string;origin:string}>();
 if(!company)return {status:404,body:{error:'unknown_listing'}};
 const domains=(await env.DB.prepare('SELECT domain,source FROM employer_domains WHERE company_id=?').bind(company.id).all<{domain:string;source:string}>()).results;
 const community=domains.filter(d=>d.source==='community').map(d=>d.domain);
 if(action==='rename') {
  if(company.origin!=='community')return {status:409,body:{error:'curated_listing'}};
  const name=normalizeEmployerName(parsed.data.name??'');
  const problem=nameProblem(parsed.data.name??'',community[0]);if(problem)return {status:422,body:{error:problem}};
  const other=(await realListings(env)).find(l=>l.id!==company.id&&l.domains.length&&namesListing(name,l));
  if(other)return {status:409,body:{error:'name_already_listed',company:companyRef(other)}};
  await env.DB.batch([env.DB.prepare("UPDATE companies SET name=? WHERE id=? AND origin='community'").bind(name,company.id),await logCorrection(env,slug,action,reason)]);
  return {status:200,body:{corrected:true,action,company:{slug,name}}};
 }
 if(action==='withdraw') {
  if(company.origin!=='community')return {status:409,body:{error:'curated_listing'}};
  for(const table of EVIDENCE_TABLES) {
   let found:unknown=null;try {found=await env.DB.prepare(`SELECT 1 AS found FROM ${table} WHERE company_id=? LIMIT 1`).bind(company.id).first();} catch {}
   if(found)return {status:409,body:{error:'has_published_evidence'}};
  }
  if(await env.INTAKE.prepare("SELECT 1 AS found FROM submissions WHERE company_id=? AND status IN ('held','approved','publishing','published') LIMIT 1").bind(company.id).first())return {status:409,body:{error:'has_contributions'}};
 } else if(!community.length)return {status:409,body:{error:'no_community_domain'}};
 // The verifier first: while its keys exist it can still sign, so nothing changes here unless it confirms.
 if(community.length) {
  const outcome=await withdrawAtVerifier(env,slug);
  if(outcome==='curated')return {status:409,body:{error:'curated_listing'}};
  if(outcome!=='withdrawn')return {status:503,body:{error:outcome==='refused'?'verifier_refused_token':'verifier_unavailable'}};
 }
 await env.DB.batch([
  ...detachStatements(env,company.id,slug),
  ...(action==='withdraw'?[
   env.DB.prepare('DELETE FROM faq_interest WHERE company_id=?').bind(company.id),
   env.DB.prepare('DELETE FROM question_trails WHERE company_id=?').bind(company.id),
   env.DB.prepare('DELETE FROM company_aliases WHERE company_id=?').bind(company.id),
   env.DB.prepare("DELETE FROM companies WHERE id=? AND origin='community'").bind(company.id),
  ]:[]),
  await logCorrection(env,slug,action,reason),
 ]);
 return {status:200,body:{corrected:true,action,company:{slug,name:company.name},domainsDetached:community}};
}
/** The public listing correction log, newest quarter first: kind, reason, quarter and a digest of the slug. */
export async function correctionLog(env:Pick<Env,'DB'>):Promise<Array<{period:string;action:string;reason:string;targetDigest:string}>> {
 try {return (await env.DB.prepare('SELECT period,action,reason,target_digest FROM listing_corrections ORDER BY period DESC,id LIMIT 200').all<{period:string;action:string;reason:string;target_digest:string}>()).results.map(r=>({period:r.period,action:r.action,reason:r.reason,targetDigest:r.target_digest}));}
 catch {return [];}
}

/** The most local detachments one scheduled run mirrors from the verifier; more at once is treated as a verifier fault. */
export const MIRROR_MAX_PER_RUN=3;
/** Pending registrations retried per scheduled run, oldest first. */
export const PENDING_PER_RUN=50;
/**
 * Scheduled: checks that the verifier accepts the shared secret (probeVerifierLink; nothing more is tried when it does
 * not), registers listings the verifier has not acknowledged yet (oldest first; it was unreachable when they were
 * made), withdraws one whose domain the verifier holds for another employer, copies new community keys (a new quarter's
 * keys, for one), and mirrors a takedown made at the verifier: a registered community domain whose employer the
 * verifier's /keys?source=community no longer lists at all is detached here too. That includes the verifier answering
 * with no community keys at all (for instance, the only listing was taken down there). It is guarded instead by: the
 * link probe must have succeeded this run, the key list must have been read (a failed, non-OK or malformed answer
 * detaches nothing), and more than MIRROR_MAX_PER_RUN detachments at once are treated as a verifier fault and skipped.
 */
export async function communityHousekeeping(env:Env):Promise<Record<string,number>> {
 const counts:Record<string,number>={registered:0,withdrawn:0,keysAdded:0,mirrored:0,refused:0};
 if(!env.VERIFIER||!env.INTERNAL_TOKEN)return counts;
 // The shared secret first: /api/transparency reports the result, and tools/verify-deployment.mjs fails on 'refused'.
 const link=await probeVerifierLink(env);
 try {await env.INTAKE.prepare('INSERT INTO stats_snapshots(name,day,payload) VALUES(?,?,?) ON CONFLICT(name) DO UPDATE SET day=excluded.day,payload=excluded.payload').bind(LINK_SNAPSHOT,today(),JSON.stringify({state:link})).run();} catch {}
 if(link==='refused'){counts.refused=1;return counts;}
 let pending:Array<{domain:string;company_id:string;slug:string;origin:string|null}>=[];
 try {pending=(await env.DB.prepare("SELECT d.domain,d.company_id,c.slug,c.origin FROM employer_domains d JOIN companies c ON c.id=d.company_id WHERE d.source='community' AND d.registered=0 ORDER BY d.rowid LIMIT ?").bind(PENDING_PER_RUN).all<{domain:string;company_id:string;slug:string;origin:string|null}>()).results;} catch {return counts;}
 for(const p of pending) {
  const {outcome}=await registerWithVerifier(env,{slug:p.slug,domain:p.domain});
  if(outcome==='registered'){await env.DB.prepare('UPDATE employer_domains SET registered=1 WHERE domain=?').bind(p.domain).run();counts.registered!++;}
  else if(outcome==='taken'){await removeListing(env,p.domain,p.company_id,p.origin==='community');counts.withdrawn!++;}
  // The shared secret is wrong: every other registration would be refused too.
  else if(outcome==='refused'){counts.refused!++;break;}
 }
 counts.keysAdded=await syncCommunityKeys(env);
 // null (unreadable) never mirrors; an empty list read from a verifier that just accepted the secret does.
 const served=link==='ok'?await verifierCommunityKeys(env):null;
 if(served) {
  const listed=new Set(served.map(k=>(k as {companySlug?:unknown})?.companySlug).filter((s):s is string=>typeof s==='string'));
  const now=new Date().toISOString();
  const gone=(await env.DB.prepare("SELECT DISTINCT c.id,c.slug FROM employer_domains d JOIN companies c ON c.id=d.company_id WHERE d.source='community' AND d.registered=1 AND EXISTS(SELECT 1 FROM trusted_issuers t WHERE t.company_slug=c.slug AND t.source='community' AND t.expires_at>?)").bind(now).all<{id:string;slug:string}>()).results.filter(r=>!listed.has(r.slug));
  if(gone.length<=MIRROR_MAX_PER_RUN) for(const g of gone) {
   await env.DB.batch([...detachStatements(env,g.id,g.slug),await logCorrection(env,g.slug,'detach','verifier_withdrawn')]);
   counts.mirrored!++;
  }
  else counts.mirrorSkipped=gone.length;
 }
 return counts;
}
