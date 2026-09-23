import {z} from 'zod';
import type {Env} from './types.ts';
import {decode,digest,encode,quarter,randomToken,issuerKeyFingerprint,issuerKeySetDigest,type IssuerKey,type KeyPurpose} from '../../shared/proof.ts';
import {policy,currentPolicyDigest,canonicalJson} from '../../shared/policy.ts';
import {WITHHELD_BODY,hasDirectIdentifier} from './evidence.ts';
import {RELEASE_MANIFEST} from '../generated/release-manifest.ts';
import {moderationStats,exceptionLog,publicCount} from './moderation.ts';
import {visibleCompanySql} from './flags.ts';
/** Contribution counts: 0 stays 0, 1–24 is '<25', larger counts are rounded down to a multiple of 25 (defined beside the moderation counts that share it). */
export {publicCount};
/**
 * v4 adds the quarter's moderation statistics and the public exception log; digests are computed as in v3. From policy
 * 0.6.0 the contribution-derived moderation counts are rounded like contribution counts ('<25', multiples of 25).
 */
export const ARCHIVE_FORMAT='shouldiworkthere-transparency-v4';
/** Published inside every v3 archive, so anyone holding a snapshot can recompute each value without this code. */
export const ARCHIVE_METHOD='Digests are base64url (no padding) SHA-256. digest: SHA-256 of the canonical JSON (object keys sorted, no whitespace) of this archive without "digest". Merkle roots follow RFC 6962 (leaf node SHA-256(0x00 || leaf), interior node SHA-256(0x01 || left || right), split at the largest power of two below n, empty tree SHA-256 of nothing) over the leaves sorted as base64url strings, each leaf being the 32 bytes of a SHA-256 digest. publishedAccounts: one leaf per published account that is not withdrawn, SHA-256 of the UTF-8 text "<public id>:<SHA-256 of the body exactly as served>"; a body withheld for a direct identifier is served, and committed, as its placeholder text. metricReleases: one leaf per metric release, SHA-256 of the canonical JSON of {id, companyId, metricId, cohortId, period, value, n, ciLow, ciHigh, eventId, releaseBatch, verificationMethod, bands}, where value is null for distributions, verificationMethod is the release\'s own method or else its metric\'s, and bands is [[band, share], ...] ordered by display order then band (empty when none). issuerKeys: every issuer key in the public registry when this archive was written (a key deleted after a compromise, or with a community listing\'s detached domain, is omitted from later archives), as {id, fingerprint}, fingerprint = SHA-256 of "siwt-issuer-key-v1:" followed by the JSON array [id, companySlug, epoch, expiresAt, verificationClass, purpose, kty, n, e], with the string "community" appended as a tenth element for a community key (an id ending ":community", created by the verifier for an employer domain added by the community); issuerKeysDigest: SHA-256 of the JSON array of the sorted fingerprints. releaseManifestDigest: SHA-256 of the release document served at /.well-known/siwt-release.json when this archive was written (null if none). previousDigest: the digest of the archive before this one. moderation: the quarter\'s moderation statistics as served at /api/moderation/stats: counts that follow contributions (submitted, publishedAutomatically, repairs, jury, heldByReason, juryOutcomes) are 0, the string "<25" (1 to 24) or a multiple of 25, and every other count below 5 is the string "<5". exceptions: the public exception log as served at /api/moderation/exceptions (kind, scope, a SHA-256 digest of the target, the expiry day, the signing trustees, the action digest and the pinned policy); never account text or a requester.';
const sha256=async(bytes:Uint8Array<ArrayBuffer>)=>new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
const joined=(prefix:number,...parts:Uint8Array[])=>{const out=new Uint8Array(1+parts.reduce((n,p)=>n+p.length,0));out[0]=prefix;let at=1;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
/**
 * RFC 6962 Merkle tree hash over leaves given as base64url SHA-256 digests: a leaf node is SHA-256(0x00||leaf), an
 * interior node SHA-256(0x01||left||right), split at the largest power of two below n; the empty tree is SHA-256("").
 * Callers pass leaves sorted, so the root depends only on the set.
 */
export async function merkleRoot(leaves:string[]):Promise<string> {
 const tree=async(items:Uint8Array<ArrayBuffer>[]):Promise<Uint8Array<ArrayBuffer>>=>{
  if(items.length<2)return sha256(items.length?joined(0,items[0]!):new Uint8Array(0));
  let split=1;while(split*2<items.length)split*=2;
  return sha256(joined(1,await tree(items.slice(0,split)),await tree(items.slice(split))));
 };
 return encode(await tree(leaves.map(decode)));
}
async function paged<T extends {id:string}>(env:Pick<Env,'DB'>,sql:string):Promise<T[]> {
 const rows:T[]=[];let after='';
 for(;;) {const page=(await env.DB.prepare(sql).bind(after).all<T>()).results;rows.push(...page);if(page.length<500)return rows;after=page.at(-1)!.id;}
}
/** Only employers a visitor may see are committed: a hidden fictional employer's accounts and releases are not served. */
const visibleCompanies=(env:Partial<Pick<Env,'SAMPLE_EMPLOYERS'>>)=>`(SELECT id FROM companies WHERE ${visibleCompanySql(env)})`;
/**
 * One leaf per visible published account: SHA-256(public_id + ':' + SHA-256(body as served)), sorted. An account withheld
 * for a direct identifier is committed as its placeholder, so no fingerprint of hidden text is ever published.
 */
export async function testimonyLeaves(env:Pick<Env,'DB'>&Partial<Pick<Env,'SAMPLE_EMPLOYERS'>>) {
 const rows=await paged<{id:string;body:string}>(env,`SELECT id,body FROM testimony WHERE withdrawn_at IS NULL AND company_id IN ${visibleCompanies(env)} AND id>? ORDER BY id LIMIT 500`);
 return (await Promise.all(rows.map(async r=>digest(`${r.id}:${await digest(hasDirectIdentifier(r.body)?WITHHELD_BODY:r.body)}`)))).sort();
}
/** One leaf per metric release: SHA-256 of the canonical JSON of the release as served (a distribution's value is null; its bands are included). */
export async function metricLeaves(env:Pick<Env,'DB'>&Partial<Pick<Env,'SAMPLE_EMPLOYERS'>>) {
 const rows=await paged<{id:string;company_id:string;metric_id:string;cohort_id:string|null;period:string;value:number;n:number;ci_low:number|null;ci_high:number|null;event_id:string|null;release_batch:string;verification_method:string|null;response_type:string|null}>(env,`SELECT r.id,r.company_id,r.metric_id,r.cohort_id,r.period,r.value,r.n,r.ci_low,r.ci_high,r.event_id,r.release_batch,COALESCE(r.verification_method,d.verification_method) AS verification_method,d.response_type FROM metric_releases r LEFT JOIN metric_definitions d ON d.id=r.metric_id WHERE r.company_id IN ${visibleCompanies(env)} AND r.id>? ORDER BY r.id LIMIT 500`);
 const bands=new Map<string,[string,number][]>();
 for(const b of (await env.DB.prepare('SELECT release_id,band,share FROM distribution_bands ORDER BY release_id,sort_order,band').all<{release_id:string;band:string;share:number}>()).results)bands.set(b.release_id,[...(bands.get(b.release_id)??[]),[b.band,b.share]]);
 return (await Promise.all(rows.map(r=>digest(canonicalJson({id:r.id,companyId:r.company_id,metricId:r.metric_id,cohortId:r.cohort_id,period:r.period,value:r.response_type==='distribution'?null:r.value,n:r.n,ciLow:r.ci_low,ciHigh:r.ci_high,eventId:r.event_id,releaseBatch:r.release_batch,verificationMethod:r.verification_method,bands:bands.get(r.id)??[]}))))).sort();
}
/**
 * Every issuer public key in the public registry now (expired ones stay listed; a key deleted after a compromise is not),
 * with the fingerprint the browser and the release manifest use.
 */
export async function issuerRegistry(env:Pick<Env,'DB'>) {
 const rows=(await env.DB.prepare('SELECT * FROM trusted_issuers ORDER BY id').all<{id:string;company_slug:string;epoch:string;expires_at:string;verification_class:'demo'|'mailbox';purpose?:KeyPurpose|null;public_key_json:string;source?:string|null}>()).results;
 // A community key's fingerprint covers its source (shared/proof.ts), so the archive names it exactly as the verifier does.
 const keys:IssuerKey[]=rows.map(r=>({id:r.id,companySlug:r.company_slug,epoch:r.epoch,expiresAt:r.expires_at,verificationClass:r.verification_class,...(r.purpose?{purpose:r.purpose}:{}),...(r.source==='community'?{source:'community' as const}:{}),publicKey:JSON.parse(r.public_key_json) as JsonWebKey}));
 return {keys,entries:await Promise.all(keys.map(async k=>({id:k.id,fingerprint:await issuerKeyFingerprint(k)})))};
}
/** Coarse contribution counts, computed now. System expiries are reported as 'expired', never as author withdrawals. */
export async function computePublicStats(env:Env):Promise<Record<string,0|'<25'|number>> {
 const row=await env.INTAKE.prepare("SELECT COUNT(*) AS submitted,SUM(status IN ('approved','publishing')) AS eligible,SUM(status='held') AS held_for_repair,SUM(status='published') AS published,SUM(status='withdrawn') AS withdrawn,SUM(status='expired') AS expired FROM submissions").first<Record<string,number>>();
 const revisions=await env.INTAKE.prepare("SELECT COUNT(*) AS n FROM actions WHERE action='revise'").first<{n:number}>();
 return Object.fromEntries(Object.entries({...row,revisions:revisions?.n??0}).map(([key,value])=>[key,publicCount(value)]));
}
/**
 * The contribution counts served at /api/transparency and archived: computed at most once per UTC day (the first request
 * or scheduled run of the day) and served from that snapshot, so polling cannot time the moment a rounded count moves.
 */
export async function publicStats(env:Env,now=new Date()):Promise<Record<string,0|'<25'|number>> {
 const day=now.toISOString().slice(0,10);
 try {
  const stored=await env.INTAKE.prepare("SELECT day,payload FROM stats_snapshots WHERE name='contribution_counts'").first<{day:string;payload:string}>();
  if(stored?.day===day) return JSON.parse(stored.payload) as Record<string,0|'<25'|number>;
 } catch {}
 const stats=await computePublicStats(env);
 try {await env.INTAKE.prepare("INSERT INTO stats_snapshots(name,day,payload) VALUES('contribution_counts',?,?) ON CONFLICT(name) DO UPDATE SET day=excluded.day,payload=excluded.payload").bind(day,JSON.stringify(stats)).run();} catch {}
 return stats;
}
/** Digest of every issuer public key in the public registry (issuerKeySetDigest), so readers can detect per-visitor (tagging) keys across archives. Archives before v3 used a different canonical form. */
export async function issuerRegistryDigest(env:Pick<Env,'DB'>) {return issuerKeySetDigest((await issuerRegistry(env)).keys);}
export async function appendFinance(env:Env,input:unknown) {
 const entry=z.object({period:z.string().regex(/^20\d{2}-\d{2}$/),kind:z.enum(['cost','donation']),category:z.string().min(2).max(80),amount_cents:z.number().int().min(0).max(100000000),currency:z.literal('USD'),note:z.string().max(400)}).strict().parse(input);
 if(/employer|sponsor|privileg|recruit|advert/i.test(entry.category) && entry.kind==='donation') throw new Error('prohibited_revenue_category');
 const id=randomToken();await env.DB.prepare('INSERT INTO financial_entries(id,period,kind,category,amount_cents,currency,note) VALUES(?,?,?,?,?,?,?)').bind(id,entry.period,entry.kind,entry.category,entry.amount_cents,entry.currency,entry.note).run();return {id};
}
export async function appendLegal(env:Env,input:unknown) {
 const entry=z.object({received_on:z.string().regex(/^20\d{2}-\d{2}$/),kind:z.string().max(60),jurisdiction:z.string().max(80),scope_summary:z.string().max(400),responded:z.string().max(80),data_disclosed:z.string().max(400)}).strict().parse(input);
 const id=randomToken();await env.DB.prepare('INSERT INTO legal_requests(id,received_on,kind,jurisdiction,scope_summary,responded,data_disclosed) VALUES(?,?,?,?,?,?,?)').bind(id,entry.received_on,entry.kind,entry.jurisdiction,entry.scope_summary,entry.responded,entry.data_disclosed).run();return {id};
}
export async function archiveTransparency(env:Env) {
 if(!env.ARCHIVES)return;
 const day=new Date().toISOString().slice(0,10),id=`transparency-${day}`;
 if(await env.DB.prepare('SELECT id FROM release_manifests WHERE id=?').bind(id).first())return;
 const previous=await env.DB.prepare('SELECT digest FROM release_manifests ORDER BY created_at DESC LIMIT 1').first<{digest:string}>();
 const name=`${id}.json`, existing=await env.ARCHIVES.get(name);
 let payload:string,hash:string;
 if(existing) {
  // Archives are write-once: an object left by an interrupted run is recorded as is, never replaced.
  const {digest:stored,...data}=await existing.json<Record<string,unknown>&{digest:string}>();
  payload=data.format===ARCHIVE_FORMAT?canonicalJson(data):JSON.stringify(data);hash=stored;
 } else {
  const ledger=(await env.DB.prepare('SELECT period,kind,category,amount_cents,currency FROM financial_entries ORDER BY id').all()).results;
  const actions=(await env.INTAKE.prepare('SELECT action,COUNT(*) AS n FROM actions WHERE period=? GROUP BY action').bind(quarter()).all<{action:string;n:number}>()).results;
  const [accounts,releases,registry]=await Promise.all([testimonyLeaves(env),metricLeaves(env),issuerRegistry(env)]);
  // Already coarse ('<5' below 5) and public; the exception log names a digest of each target, never the account.
  const moderation=await moderationStats(env), exceptions=(await exceptionLog(env)).entries;
  // Roots only: leaf lists are not archived, so a withdrawn account leaves no permanent per-account fingerprint here.
  const data={format:ARCHIVE_FORMAT,period:quarter(),stats:await publicStats(env),actionsThisQuarter:Object.fromEntries(actions.map(a=>[a.action,publicCount(a.n)])),finance:ledger,policyVersion:policy.version,policyDigest:await currentPolicyDigest(),
   issuerKeysDigest:await issuerKeySetDigest(registry.keys),issuerKeys:registry.entries,
   publishedAccounts:{merkleRoot:await merkleRoot(accounts),count:publicCount(accounts.length)},
   metricReleases:{merkleRoot:await merkleRoot(releases),count:publicCount(releases.length)},
   releaseManifestDigest:RELEASE_MANIFEST?await digest(RELEASE_MANIFEST):null,
   previousDigest:previous?.digest??null,
   moderation,exceptions,
   method:ARCHIVE_METHOD,
   limits:'Contribution counts, and moderation counts that follow contributions, from 1 to 24 are shown as "<25"; larger counts are rounded down to multiples of 25. Other moderation counts below 5 are shown as "<5". Every count is computed at most once per UTC day. No drafts, addresses, credentials, or individual decisions.'};
  payload=canonicalJson(data);hash=await digest(payload);
  await env.ARCHIVES.put(name,JSON.stringify({digest:hash,...data}),{httpMetadata:{contentType:'application/json'}});
 }
 await env.DB.prepare('INSERT OR IGNORE INTO release_manifests(id,period,payload_json,digest,previous_digest,created_at) VALUES(?,?,?,?,?,?)').bind(id,quarter(),payload,hash,previous?.digest??null,day).run();
}
