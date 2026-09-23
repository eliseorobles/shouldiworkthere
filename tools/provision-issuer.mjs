#!/usr/bin/env node
// Usage: node tools/provision-issuer.mjs [--remote [--put-master-secret] [--retire-legacy-secret] [--accept-default-caps] [--skip-community-check]] [--next-quarter] [--no-samples]
// Creates this quarter's blind-signature keys (one contribution key and one juror key per employer), seals every live
// private key (AES-256-GCM, key id as associated data) under ISSUER_MASTER_KEY, and writes: sealed rows for the verifier
// database (with the issuance cap and velocity limit for a real employer's headcount band; sandbox rows carry none),
// public keys with their purpose for the public database, and the public registry with fingerprints (read by
// tools/build.mjs, which pins it into the client, and by tools/transparency.mjs, which signs it). Headcount bands are read
// here, from the public database, because the verifier never reads it. Every run rewrites the limits of all live rows, so
// a changed band raises or lowers the cap. A remote run refuses when a real employer's band cannot be read (it would get
// the smallest cap), unless --accept-default-caps is passed. The only Worker secret is the 32-byte master key. Nothing
// secret is printed. Remote runs require ISSUER_MASTER_KEY in the environment and never fall back to the local key.
// Order: migrate first (public 0006, verifier 0002 and 0005).
//
// Local and production keys never mix (provisionFiles): only --remote reads and writes the production private keys
// (.issuer-secrets.json) and the committed production registry (db/issuer-public-keys.json and .sql). A local run keeps
// its own keys under .wrangler/provision/ (git-ignored), so a local provisioning can never change what a release pins or
// signs, and the local verifier never holds a production private key. Build the local client with
// `node tools/build.mjs --local` to pin the local registry.
//
// Provenance (keyProvenanceProblems): every private key entry records the run that created it (origin 'remote' or
// 'local') and, for a remote run, a digest of the master key it was created under. --remote refuses to reuse any entry
// that a remote run with this master key did not create, and any key whose RSA modulus is also a local key (the local
// registry and secrets under .wrangler/provision/, or a key the local verifier at http://localhost:8790 serves). So keys
// once written by a local run (for example by an older tools/prepare-local.mjs, which wrote the production paths) can
// never be sealed into the production verifier: move such a file aside and a remote run generates fresh keys.
//
// --next-quarter also creates next quarter's keys now. They are published at once but the browser never chooses them and
// the verifier never signs with them until that quarter starts (shared/proof.ts issuerKeyStarted), so a release built
// after this run already pins them and the quarterly rotation needs no rebuild at the quarter boundary. Provision the next
// quarter's keys, then build, sign and deploy the main worker, all before the quarter starts.
//
// Sample employers (owner decision 1, 2026-09-23: zero sample data in production). Fictional employers get sandbox keys
// only while the main worker shows them, which it does only when SAMPLE_EMPLOYERS is exactly 'on' (worker/src/flags.ts):
// wrangler.jsonc for a remote run ('off' in production); for a local run .dev.vars.main or .dev.vars override it, as under
// wrangler dev. --no-samples leaves them out whatever the setting. Without samples, every sandbox key is dropped from the
// secrets file, the registry and both SQL files, so a purged sample key (tools/purge-samples.mjs) is never re-created,
// re-sealed or re-published.
//
// Community keys (owner decision 4) are created by the verifier itself for employer domains registered after a release;
// this tool never writes or reads their private keys. A curated employer whose slug or domain the verifier's registry
// already lists would get a second key per quarter, so such a run is refused. A remote run also refuses when it cannot
// read that registry (communityCheckProblem), unless --skip-community-check is passed; a local run only notes it.
import {existsSync,readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {suite,quarter,quarterStart,sealIssuerKey,issuanceLimits,issuerKeyFingerprint,issuerKeyStarted,issuerKeyExpiry} from '../shared/proof.ts';

// Fictional sample employers (no domains) get sandbox keys. Every companies row of kind 'sample' in the public database is
// added at provisioning time (sampleEmployers), so a newly seeded fictional employer gets keys without editing this list.
export const EMPLOYERS=[['northwind-labs',[]],['helios-semiconductor',[]],['meridian-retail',[]],['stripe',['stripe.com']],['cloudflare',['cloudflare.com']],['google',['google.com']],['microsoft',['microsoft.com']],['openai',['openai.com']],['anthropic',['anthropic.com']],['meta',['meta.com','fb.com']],['amazon',['amazon.com']],['nvidia',['nvidia.com']]];
/** The keys a quarter needs. Fictional employers (no domains) get sandbox keys: 'demo' class, juror id suffix 'sandbox'. */
export function plannedKeys(employers,epoch) {
 return employers.flatMap(([slug,domains])=>{
  const verificationClass=domains.length?'mailbox':'demo';
  return [{id:`${slug}:${epoch}:${verificationClass}`,companySlug:slug,epoch,verificationClass,purpose:'contribution',domains},{id:`${slug}:${epoch}:juror:${domains.length?'mailbox':'sandbox'}`,companySlug:slug,epoch,verificationClass,purpose:'juror',domains}];
 });
}
const purposeOf=k=>k.purpose??'contribution';
/** Where a run reads and writes. Only a remote run touches the production private keys and the committed production registry. */
export function provisionFiles(remote) {
 return remote
  ?{secrets:'.issuer-secrets.json',publicSql:'db/issuer-public-keys.sql',registry:'db/issuer-public-keys.json',sealed:'.wrangler/provision/issuer-sealed-keys.sql'}
  :{secrets:'.wrangler/provision/local-issuer-secrets.json',publicSql:'.wrangler/provision/local-issuer-public-keys.sql',registry:'.wrangler/provision/local-issuer-public-keys.json',sealed:'.wrangler/provision/local-issuer-sealed-keys.sql'};
}
/** The issuance quarters a run creates keys for: the current one, and with --next-quarter the next one too. */
export function provisionEpochs(now,nextQuarter=false) {return nextQuarter?[quarter(now),quarter(quarterStart(now,1))]:[quarter(now)];}
/** A key covers its issuance quarter plus one quarter of redemption grace (the same rule the verifier applies to community keys). */
export const keyExpiry=epoch=>issuerKeyExpiry(epoch);
/**
 * Whether this run provisions sample (sandbox) keys: exactly when the main worker would show sample employers
 * (SAMPLE_EMPLOYERS === 'on'), reading a local run's .dev.vars.main (or .dev.vars) value first and then wrangler.jsonc, as
 * wrangler dev does. Never with --no-samples. Unset or any other value: no samples.
 */
export function samplesWanted({argv=[],remote=false,wranglerText='',localVarsText=''}={}) {
 if(argv.includes('--no-samples'))return false;
 const local=remote?undefined:/^[ \t]*SAMPLE_EMPLOYERS[ \t]*=[ \t]*["']?([^"'\n]*?)["']?[ \t]*$/m.exec(localVarsText??'')?.[1];
 const configured=/"SAMPLE_EMPLOYERS"\s*:\s*"([^"]*)"/.exec(wranglerText??'')?.[1];
 return (local??configured)==='on';
}
/** Private key entries (or public keys) without any sandbox key: what a run without samples keeps. */
export const withoutSamples=keys=>keys.filter(k=>k.verificationClass!=='demo');
/**
 * Curated employers of this run whose slug the verifier's community registry already lists, or one of whose domains is,
 * contains or is contained in a registered domain (the verifier refuses the same relations at registration); their
 * keys would collide.
 */
export function communityConflicts(employers,registered) {
 const rows=registered??[],slugs=new Set(rows.map(r=>r.company_slug));
 const related=(a,b)=>a===b||a.endsWith(`.${b}`)||b.endsWith(`.${a}`);
 return employers.filter(([slug,list])=>slugs.has(slug)||list.some(d=>rows.some(r=>typeof r.domain==='string'&&related(d,r.domain)))).map(([slug])=>slug).sort();
}
/**
 * Why this run may not go ahead without the community check: a remote run that could not read the verifier's registry
 * (registered === null) refuses unless --skip-community-check is passed, as a failed band read refuses without
 * --accept-default-caps. null when it may go ahead.
 */
export function communityCheckProblem({remote,registered,argv=[]}) {
 if(!remote||registered||argv.includes('--skip-community-check'))return null;
 return 'the verifier\'s community registry (verifier migration 0005) could not be read remotely, so curated employers cannot be checked against community registrations (a registered employer would get two keys a quarter). Fix the read, or re-run with --skip-community-check.';
}
const q=s=>s===null||s===undefined?'NULL':typeof s==='number'?String(s):`'${String(s).replaceAll("'","''")}'`;
/**
 * Production public keys are INSERT OR IGNORE: a published key is never altered. A local run replaces (replace=true),
 * because local keys are regenerated apart from production ones under the same ids and must match the local verifier.
 */
export function publicKeySql(keys,{replace=false}={}) {
 return keys.map(k=>`INSERT OR ${replace?'REPLACE':'IGNORE'} INTO trusted_issuers(id,company_slug,epoch,expires_at,verification_class,public_key_json,purpose) VALUES(${[k.id,k.companySlug,k.epoch,k.expiresAt,k.verificationClass,JSON.stringify(k.publicKey),purposeOf(k)].map(q).join(',')});`).join('\n');
}
/** Limits are recomputed from the current band on every run, so the sealed rows always carry the latest published band. Sandbox rows carry no limits. */
export async function sealedKeySql(keys,masterKey,bands) {
 const rows=[];
 for(const k of keys) {
  const band=bands.get(k.companySlug)??null,limits=issuanceLimits(band,k.verificationClass,purposeOf(k));
  rows.push(`INSERT OR REPLACE INTO issuer_keys(id,company_slug,epoch,expires_at,verification_class,domains_json,public_key_json,sealed_private_key,purpose,headcount_band,issuance_cap,velocity_limit) VALUES(${[k.id,k.companySlug,k.epoch,k.expiresAt,k.verificationClass,JSON.stringify(k.domains),JSON.stringify(k.publicKey),await sealIssuerKey(masterKey,k.id,k.privateKey),purposeOf(k),band,limits?.cap??null,limits?.velocity??null].map(q).join(',')});`);
 }
 return rows.join('\n');
}
/** Real employers whose headcount band is missing; with bands === null (the read failed) every real employer is missing. */
export function unbandedEmployers(keys,bands) {
 return [...new Set(keys.filter(k=>k.verificationClass==='mailbox'&&!bands?.get(k.companySlug)).map(k=>k.companySlug))].sort();
}
/** Fictional employers of the public database not yet in the list, as [slug, []] entries (sandbox keys only). */
export function sampleEmployers(employers,companies) {
 const known=new Set(employers.map(([slug])=>slug));
 return (companies??[]).filter(c=>c.kind==='sample'&&typeof c.slug==='string'&&!known.has(c.slug)).map(c=>[c.slug,[]]).sort(([a],[b])=>a.localeCompare(b));
}
/** A digest of the master key, recorded with each key a remote run creates; the key itself is never written. */
export const masterKeyId=async masterKey=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`siwt-master-key-id-v1:${masterKey}`))).toString('base64url');
/** RSA moduli of a list of keys (entries with publicKey.n), for comparing key sets without trusting ids. */
export const moduli=keys=>new Set((Array.isArray(keys)?keys:[]).map(k=>k?.publicKey?.n).filter(n=>typeof n==='string'));
/**
 * Why a remote run may not reuse these private key entries: each must have been created by a remote run (origin
 * 'remote') under this master key, and none may share its modulus with a local key. [] when they may be reused.
 */
export function keyProvenanceProblems(entries,{masterKeyId:current,localModuli=new Set()}) {
 const problems=[];
 const foreign=entries.filter(k=>k.origin!=='remote'||k.masterKeyId!==current).map(k=>k.id);
 if(foreign.length)problems.push(`${foreign.length} key(s) in the production secrets file were not created by a remote run under this ISSUER_MASTER_KEY (${foreign.slice(0,4).join(', ')}${foreign.length>4?', …':''})`);
 const local=entries.filter(k=>localModuli.has(k.publicKey?.n)).map(k=>k.id);
 if(local.length)problems.push(`${local.length} key(s) in the production secrets file are also local keys (${local.slice(0,4).join(', ')}${local.length>4?', …':''})`);
 return problems;
}
/** Every local key's modulus: the local registry and secrets files, and what a local verifier serves (best effort). */
export async function localKeyModuli({files=[provisionFiles(false).registry,provisionFiles(false).secrets],verifier='http://localhost:8790',fetcher=fetch}={}) {
 const out=new Set();
 for(const file of files) if(existsSync(file)) {try {for(const n of moduli(JSON.parse(readFileSync(file,'utf8'))))out.add(n);} catch {}}
 if(verifier) try {const r=await fetcher(`${verifier}/keys`,{signal:AbortSignal.timeout(2000)});if(r.ok)for(const n of moduli((await r.json())?.keys))out.add(n);} catch {}
 return out;
}
export async function publicRegistry(keys) {
 const out=[];
 for(const k of [...keys].sort((a,b)=>a.id.localeCompare(b.id))) {
  const key={id:k.id,companySlug:k.companySlug,epoch:k.epoch,expiresAt:k.expiresAt,verificationClass:k.verificationClass,purpose:purposeOf(k),publicKey:k.publicKey};
  out.push({...key,fingerprint:await issuerKeyFingerprint(key)});
 }
 return out;
}
/** The verifier's community registry (verifier migration 0005), or null when it cannot be read. */
function readCommunityRegistry(remote) {
 const r=spawnSync('bunx',['wrangler','d1','execute','shouldiworkthere-verifier',remote?'--remote':'--local','--config','issuer.wrangler.jsonc','--command','SELECT company_slug,domain FROM employer_domains','--json'],{encoding:'utf8'});
 if(r.status)return null;
 try { const rows=JSON.parse(r.stdout)?.[0]?.results; return Array.isArray(rows)?rows:null; } catch { return null; }
}
/** null when the read fails, so a failure is never mistaken for employers without a band. */
function readCompanies(remote) {
 const r=spawnSync('bunx',['wrangler','d1','execute','shouldiworkthere-public',remote?'--remote':'--local','--config','wrangler.jsonc','--command','SELECT slug,headcount_band,kind FROM companies','--json'],{encoding:'utf8'});
 if(r.status)return null;
 try { const rows=JSON.parse(r.stdout)?.[0]?.results; return Array.isArray(rows)?rows:null; } catch { return null; }
}
async function main() {
 const remote=process.argv.includes('--remote'),files=provisionFiles(remote);
 const fromFile=(file,name)=>existsSync(file)?readFileSync(file,'utf8').match(new RegExp(`^${name}=(.*)$`,'m'))?.[1]?.trim():undefined;
 const masterKey=process.env.ISSUER_MASTER_KEY||(remote?undefined:fromFile('.dev.vars.verifier','ISSUER_MASTER_KEY'));
 if(!masterKey) {console.error(remote?'Set ISSUER_MASTER_KEY (the production value) in the environment for --remote.':'Run node tools/prepare-local.mjs first (it creates .dev.vars.verifier).');process.exit(1);}
 const registry=existsSync(files.secrets)?JSON.parse(readFileSync(files.secrets,'utf8')):[];
 const origin=remote?'remote':'local',keyId=remote?await masterKeyId(masterKey):null;
 // Production keys are only ever keys a remote run created under this master key, and never a local key.
 if(remote) {
  const problems=keyProvenanceProblems(registry,{masterKeyId:keyId,localModuli:await localKeyModuli()});
  if(problems.length){console.error(`Refusing: ${problems.join('; ')}. These are not production keys and must never be sealed into the production verifier. Move ${files.secrets} (and db/issuer-public-keys.json and .sql, if they hold the same keys) aside, then re-run: a remote run then generates fresh keys. Nothing was written.`);process.exit(1);}
 }
 const now=new Date(),companies=readCompanies(remote);
 const bands=companies?new Map(companies.map(row=>[row.slug,row.headcount_band??null])):null;
 const readText=file=>existsSync(file)?readFileSync(file,'utf8'):'';
 const samples=samplesWanted({argv:process.argv,remote,wranglerText:readText('wrangler.jsonc'),localVarsText:readText('.dev.vars.main')||readText('.dev.vars')});
 // Employers without a domain are the fictional ones: they get sandbox keys only when samples are on.
 const employers=samples?[...EMPLOYERS,...sampleEmployers(EMPLOYERS,companies)]:EMPLOYERS.filter(([,domains])=>domains.length);
 // Sandbox keys already in the secrets file are dropped too, so nothing purged is sealed or published again.
 const droppedSamples=samples?0:registry.length-withoutSamples(registry).length;
 if(!samples)registry.splice(0,registry.length,...withoutSamples(registry));
 const community=readCommunityRegistry(remote),conflicts=communityConflicts(employers.filter(([,domains])=>domains.length),community);
 if(conflicts.length){console.error(`Refusing: the verifier's community registry already lists ${conflicts.join(', ')} (a registered work-email domain and community keys), so curated keys would give it two keys a quarter. Remove the employer from EMPLOYERS, or retire its community registration first (DELETE /internal/employers). Nothing was written.`);process.exit(1);}
 const unchecked=communityCheckProblem({remote,registered:community,argv:process.argv});
 if(unchecked){console.error(`Refusing: ${unchecked} Nothing was written.`);process.exit(1);}
 if(!community)console.warn(`Note: the verifier's community registry (verifier migration 0005) could not be read ${remote?'remotely (--skip-community-check)':'locally'}, so curated employers were not checked against community registrations.`);
 // Existing keys are never altered: their public description is already published, and the browser refuses keys whose
 // two published copies differ.
 const created=[];
 for(const epoch of provisionEpochs(now,process.argv.includes('--next-quarter'))) for(const planned of plannedKeys(employers,epoch)) {
  if(registry.some(k=>k.id===planned.id)) continue;
  created.push(planned);
  const pair=await suite().generateKey({modulusLength:2048,publicExponent:new Uint8Array([1,0,1])});
  registry.push({...planned,expiresAt:keyExpiry(epoch),publicKey:await crypto.subtle.exportKey('jwk',pair.publicKey),privateKey:await crypto.subtle.exportKey('jwk',pair.privateKey),origin,...(keyId?{masterKeyId:keyId}:{})});
 }
 // Entries written before provenance existed are marked by the kind of run that holds them (never 'remote': a remote run
 // refuses unmarked entries above).
 for(const k of registry) if(!k.origin) k.origin=origin;
 const live=registry.filter(k=>Date.parse(k.expiresAt)>Date.now());
 const unbanded=unbandedEmployers(live,bands);
 // Limits are rewritten on every run, so a failed band read would put every real employer on the smallest cap.
 if(remote&&unbanded.length&&!process.argv.includes('--accept-default-caps')) {console.error(`Refusing: ${bands?`no headcount band is published for ${unbanded.join(', ')}`:'the public database could not be read for headcount bands'}, so ${unbanded.length} employer(s) would get the smallest cap (50 credentials a quarter). Fix the read or publish the bands, or re-run with --accept-default-caps. Nothing was written.`);process.exit(1);}
 mkdirSync('.wrangler/provision',{recursive:true});
 writeFileSync(files.secrets,JSON.stringify(live),{mode:0o600});
 writeFileSync(files.publicSql,publicKeySql(live,{replace:!remote}));
 writeFileSync(files.registry,`${JSON.stringify(await publicRegistry(live),null,1)}\n`);
 writeFileSync(files.sealed,await sealedKeySql(live,masterKey,bands??new Map()),{mode:0o600});
 if(remote) {
  const run=(args,input)=>{const r=spawnSync('bunx',['wrangler',...args],input===undefined?{stdio:'inherit'}:{input,encoding:'utf8'});if(r.status){console.error(`wrangler ${args.slice(0,3).join(' ')} failed.`);process.exit(r.status);}};
  if(process.argv.includes('--put-master-secret')) run(['secret','put','ISSUER_MASTER_KEY','--config','issuer.wrangler.jsonc'],masterKey);
  run(['d1','execute','shouldiworkthere-verifier','--remote','--config','issuer.wrangler.jsonc','--file',files.sealed,'--yes']);
  run(['d1','execute','shouldiworkthere-public','--remote','--config','wrangler.jsonc','--file',files.publicSql,'--yes']);
  if(process.argv.includes('--retire-legacy-secret')) run(['secret','delete','ISSUER_KEYS','--config','issuer.wrangler.jsonc'],'y\n');
 }
 const waiting=live.filter(k=>Date.parse(k.expiresAt)>now.getTime()&&!issuerKeyStarted(k,now.getTime())).length;
 // Keys for a quarter that has already begun are current at once: until a release that pins them is deployed, every
 // browser refuses them. Provisioning next quarter's keys ahead of time (--next-quarter) avoids that window.
 const immediate=created.filter(k=>issuerKeyStarted(k,now.getTime())).length;
 if(remote&&immediate) console.warn(`WARNING: ${immediate} new key(s) are for the quarter already under way, so browsers start using them now. Until a release that pins them is deployed, the deployed client refuses them and contributions and juror tokens stop: commit db/issuer-public-keys.json, then build, sign and deploy the main worker right away. Next time, run with --next-quarter before the quarter starts.`);
 console.log(`Prepared ${live.length} live ${remote?'production':'local'} issuer keys (${live.filter(k=>purposeOf(k)==='juror').length} juror keys${waiting?`; ${waiting} for next quarter, unused until it starts`:''}; ${registry.length-live.length} expired private keys pruned). Public keys: ${files.publicSql} and ${files.registry}. Sealed private keys with issuance limits: ${files.sealed}${remote?' (applied remotely)':''}.${unbanded.length?` No headcount band was readable for ${unbanded.join(', ')}; those keys carry the smallest cap until provisioning runs again with the band published.`:''}${samples?'':` Sample employers are off (${process.argv.includes('--no-samples')?'--no-samples':'SAMPLE_EMPLOYERS'}): no sandbox keys were planned${droppedSamples?`, and ${droppedSamples} sandbox key(s) were dropped from ${files.secrets}`:''}.`} Apply public migration 0006 and verifier migrations 0002 and 0005 before loading these files.${remote?' Next: commit db/issuer-public-keys.json, then node tools/build.mjs, node tools/transparency.mjs and deploy the main worker, so the deployed client pins these keys (the release refuses to sign otherwise).':' For the local stack, build the client with node tools/build.mjs --local so it pins these local keys.'}`);
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) await main();
