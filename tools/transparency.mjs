#!/usr/bin/env node
// Usage: node tools/transparency.mjs [--init-key] [--key=.release-signing-key.json] [--registry=db/issuer-public-keys.json] [--dry-run] [--rekor [--rekor-url=URL]]
//                                     [--verifier=https://verify.shouldiworkthere.com] [--skip-verifier-keys-check]
//
// Builds the release manifest for the current build and signs it with the local Ed25519 release key:
//   buildId; SHA-256 of the client JS, CSS and fonts and of /app.js and /app.css exactly as served; SHA-256 of every
//   worker, shared, database and Wrangler configuration source file; fingerprints of every live issuer key
//   (contribution and juror, from db/issuer-public-keys.json); the moderation policy version and digest; the legal version.
// Writes worker/generated/release-manifest.ts (served at /.well-known/siwt-release.json by worker/src/release.ts) and
// docs/releases/<releasedOn>-<first 16 hex of the manifest SHA-256>.json, never overwriting an earlier release record
// (a worker-only change or a quarterly key re-release keeps the client buildId). Run after `node tools/build.mjs` and
// before `wrangler deploy`. It refuses when any signed source file changed, appeared or disappeared since that build.
// The signed sources include bun.lock, so the dependency versions bundled into the Workers are covered.
//
// Key pinning (the client refuses any issuer key its release did not pin). It refuses to sign unless:
//  - the client was built from the production registry (node tools/build.mjs, not --local) and pins exactly the live
//    keys of the registry being signed (pinProblems), so a client pinned to local keys, or to another registry file than
//    --registry, is never released;
//  - every live key the verifier serves (--verifier, default VERIFIER_ORIGIN from wrangler.jsonc) is in that registry
//    (unregisteredKeys). A key served but not pinned would be refused by every browser: contributions and juror tokens
//    would stop until the next release. --skip-verifier-keys-check skips only this network check, with a warning;
//  - no key of the registry is a local key (localKeyOverlap): none shares its RSA modulus with the local registry or
//    secrets under .wrangler/provision/ or with a key the local verifier (http://localhost:8790) serves, because a local
//    key's private half sits in a development worker and its plaintext master key. This check is never skipped.
// --dry-run reports these as warnings instead.
//
// --init-key   create .release-signing-key.json (0600) if it does not exist. Keep it out of version control and back it
//              up offline; losing it means announcing a new release key.
// --dry-run    build, sign (with a throwaway key when none exists) and verify in memory. It writes nothing, except the
//              null placeholder worker/generated/release-manifest.ts when that file is missing (the worker's stylesheet
//              module cannot load without it).
// --rekor      also submit the signed manifest to the Sigstore Rekor public transparency log (off by default). This is
//              permanent and public: the log records the manifest hash, the signature and the release public key. The
//              entry is a "rekord" (x509 format, Ed25519 public key); it has not been exercised against the live log in
//              this repository's tests, and a rejected submission is reported without changing anything else.
//
// The manifest lets anyone detect a served client, source listing, key set or policy that the operator did not sign
// (tools/verify-deployment.mjs). It cannot prove which code the Workers actually execute.
import {existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync,realpathSync} from 'node:fs';
import {createHash,createPublicKey,verify as nodeVerify} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonicalJson,policy,currentPolicyDigest} from '../shared/policy.ts';
import {LEGAL_VERSION,LEGAL_EFFECTIVE} from '../shared/brand.ts';
import {issuerKeyFingerprint,issuerKeySetDigest,keyPurpose} from '../shared/proof.ts';
import {localKeyModuli} from './provision-issuer.mjs';

export const MANIFEST_FORMAT='siwt-release-v1';
export const KEY_FORMAT='siwt-release-key-v1';
const b64url=bytes=>Buffer.from(bytes).toString('base64url');
export const sha256=data=>b64url(createHash('sha256').update(data).digest());
export const sha256hex=data=>createHash('sha256').update(data).digest('hex');
const SIGNED_DIRS=[['worker/src','.ts'],['shared','.ts'],['db','.sql']];
const SIGNED_FILES=['worker/issuer.ts','worker/inference.ts','worker/inference-core.ts','wrangler.jsonc','inference.wrangler.jsonc','issuer.wrangler.jsonc','package.json','bun.lock'];
export const isSignedPath=path=>SIGNED_FILES.includes(path)||SIGNED_DIRS.some(([dir,ext])=>path.startsWith(`${dir}/`)&&path.endsWith(ext));
/** Source files whose digests are signed: everything that defines server behaviour or stored data, and the lockfile. */
export function sourcePaths(root) {
 const walk=([dir,ext])=>existsSync(join(root,dir))?readdirSync(join(root,dir),{recursive:true}).map(String).filter(f=>f.endsWith(ext)).map(f=>`${dir}/${f}`):[];
 return [...SIGNED_DIRS.flatMap(walk),...SIGNED_FILES].filter(p=>existsSync(join(root,p))).sort();
}
/**
 * Signed paths the build's served source listing (SOURCE_FILES) does not match: changed since the build, added in a
 * directory the build lists, or listed by the build but since removed. Files the build never serves are not stale.
 */
export function staleSources(sources,built) {
 const listed=Object.keys(built),covered=SIGNED_DIRS.map(([dir])=>`${dir}/`).filter(dir=>listed.some(p=>p.startsWith(dir)));
 const changed=Object.keys(sources).filter(p=>p in built?built[p]!==sources[p]:covered.some(dir=>p.startsWith(dir)));
 const removed=listed.filter(p=>isSignedPath(p)&&!(p in sources));
 return [...changed,...removed].sort();
}
/** Release records are append-only: a new one never replaces an earlier signed manifest. */
export function releaseRecordPath(document) {return `docs/releases/${document.manifest.releasedOn}-${manifestHashHex(document).slice(0,16)}.json`;}
export const PLACEHOLDER_MODULE='// GENERATED by tools/transparency.mjs - do not edit by hand. null until a release manifest is signed.\nexport const RELEASE_MANIFEST: string | null = null;\n';
/** Pure: every input is passed in, so tests and the CLI build the identical manifest from identical inputs. */
export async function buildManifest({buildId,releasedOn,client,sources,issuerKeys,policyVersion,policyDigest,legal}) {
 const keys=[];
 for(const key of [...issuerKeys].sort((a,b)=>a.id.localeCompare(b.id))) {
  const purpose=keyPurpose(key);
  if(!purpose)throw new Error(`issuer key ${key.id} declares a purpose that disagrees with its id`);
  keys.push({id:key.id,purpose,fingerprint:await issuerKeyFingerprint(key)});
 }
 const files=Object.fromEntries(Object.entries(sources).sort(([a],[b])=>a.localeCompare(b)).map(([path,text])=>[path,sha256(text)]));
 return {
  format:MANIFEST_FORMAT,buildId,releasedOn,
  client:{served:{'/app.js':{sha256:sha256(client.appJs),bytes:Buffer.byteLength(client.appJs)},'/app.css':{sha256:sha256(client.appCss),bytes:Buffer.byteLength(client.appCss)}},js:sha256(client.js),css:sha256(client.css),fonts:sha256(client.fonts)},
  sources:{algorithm:'sha256-base64url',files,digest:sha256(canonicalJson(files))},
  issuerKeys:keys,issuerKeysDigest:await issuerKeySetDigest(issuerKeys),
  policy:{version:policyVersion,digest:policyDigest},
  legal,
 };
}
/**
 * Why a client build may not be released with this registry: it must have been built from the production registry and
 * pin exactly the registry's live fingerprints. clientPins is the build's CLIENT_ISSUER_PINS (tools/build.mjs).
 */
export function pinProblems(clientPins,registryFingerprints) {
 if(!clientPins||!Array.isArray(clientPins.fingerprints))return [`the client build pins no issuer keys${clientPins?.path?` (${clientPins.path} was missing when it ran)`:''}; run node tools/build.mjs after provisioning`];
 if(clientPins.registry!=='production')return [`the client was built with the ${clientPins.registry} issuer registry (${clientPins.path}); a release pins only the production registry, so rebuild with node tools/build.mjs (without --local)`];
 const pinned=new Set(clientPins.fingerprints),signed=new Set(registryFingerprints);
 const unpinned=[...signed].filter(f=>!pinned.has(f)),unsigned=[...pinned].filter(f=>!signed.has(f));
 return [
  ...(unpinned.length?[`${unpinned.length} live key(s) of the signed registry are not pinned by the client build (it ran before provisioning, or --registry names another file); rebuild with node tools/build.mjs`]:[]),
  ...(unsigned.length?[`the client build pins ${unsigned.length} key(s) the signed registry does not list as live (another registry file, or keys that expired since the build); rebuild with node tools/build.mjs`]:[]),
 ];
}
/**
 * Ids of live curated keys the verifier serves whose fingerprints the registry lacks: a client built from it would refuse
 * them. Community keys (source 'community', created by the verifier for an employer domain listed after a release) are
 * never in a registry and no release pins them; the browser accepts one only when the publisher's and the verifier's
 * copies agree, and tools/verify-deployment.mjs checks that they do.
 */
export async function unregisteredKeys(servedKeys,registryFingerprints,now=Date.now()) {
 const known=new Set(registryFingerprints),out=[];
 for(const key of servedKeys) {
  if(!(Date.parse(key.expiresAt)>now)||key.source==='community')continue;
  const fingerprint=await issuerKeyFingerprint({id:key.id,companySlug:key.companySlug,epoch:key.epoch,expiresAt:key.expiresAt,verificationClass:key.verificationClass,purpose:key.purpose,publicKey:key.publicKey});
  if(!known.has(fingerprint))out.push(key.id);
 }
 return out.sort();
}
/** Ids of registry keys whose RSA modulus is also a local key's: such a registry must never be signed. */
export function localKeyOverlap(registry,localModuli) {return registry.filter(k=>localModuli.has(k?.publicKey?.n)).map(k=>k.id).sort();}
/** The verifier origin the main worker is configured with (wrangler.jsonc VERIFIER_ORIGIN). */
export const configuredVerifier=text=>/"VERIFIER_ORIGIN"\s*:\s*"([^"]+)"/.exec(text)?.[1]??null;
const signedBytes=manifest=>Buffer.from(canonicalJson(manifest),'utf8');
export async function generateSigningKey() {
 const pair=await crypto.subtle.generateKey({name:'Ed25519'},true,['sign','verify']);
 const privateKey=await crypto.subtle.exportKey('jwk',pair.privateKey);
 return {format:KEY_FORMAT,alg:'Ed25519',keyId:sha256(Buffer.from(privateKey.x,'base64url')),publicKey:privateKey.x,privateKey};
}
export async function signManifest(manifest,keyFile) {
 const key=await crypto.subtle.importKey('jwk',keyFile.privateKey,{name:'Ed25519'},false,['sign']);
 const value=b64url(new Uint8Array(await crypto.subtle.sign({name:'Ed25519'},key,signedBytes(manifest))));
 return {manifest,signature:{alg:'Ed25519',keyId:keyFile.keyId,publicKey:keyFile.publicKey,value}};
}
export async function verifySignedManifest(document) {
 try {
  const {manifest,signature}=document;
  if(signature?.alg!=='Ed25519'||manifest?.format!==MANIFEST_FORMAT)return false;
  if(sha256(Buffer.from(signature.publicKey,'base64url'))!==signature.keyId)return false;
  const key=await crypto.subtle.importKey('jwk',{kty:'OKP',crv:'Ed25519',x:signature.publicKey},{name:'Ed25519'},false,['verify']);
  return await crypto.subtle.verify({name:'Ed25519'},key,Buffer.from(signature.value,'base64url'),signedBytes(manifest));
 } catch {return false;}
}
export const manifestHashHex=document=>sha256hex(signedBytes(document.manifest));
const ED25519_SPKI_PREFIX=Buffer.from('302a300506032b6570032100','hex');
export function publicKeyPem(x) {
 return `-----BEGIN PUBLIC KEY-----\n${Buffer.concat([ED25519_SPKI_PREFIX,Buffer.from(x,'base64url')]).toString('base64')}\n-----END PUBLIC KEY-----\n`;
}
/** Rekor "rekord" entry: the data is the canonical manifest, so the log records its SHA-256 (the manifest hash). */
export function rekorEntry(document) {
 return {apiVersion:'0.0.1',kind:'rekord',spec:{signature:{format:'x509',content:Buffer.from(document.signature.value,'base64url').toString('base64'),publicKey:{content:Buffer.from(publicKeyPem(document.signature.publicKey)).toString('base64')}},data:{content:signedBytes(document.manifest).toString('base64')}}};
}
/** The same check Rekor performs, run locally before anything is sent. */
export function rekorEntryVerifies(entry) {
 const pem=Buffer.from(entry.spec.signature.publicKey.content,'base64').toString('utf8');
 return nodeVerify(null,Buffer.from(entry.spec.data.content,'base64'),createPublicKey(pem),Buffer.from(entry.spec.signature.content,'base64'));
}
export async function submitToRekor(document,url='https://rekor.sigstore.dev',fetcher=fetch) {
 const entry=rekorEntry(document);
 if(!rekorEntryVerifies(entry))throw new Error('rekor entry does not verify locally');
 const response=await fetcher(`${url.replace(/\/+$/,'')}/api/v1/log/entries`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(entry)});
 const body=await response.json().catch(()=>null);
 if(!response.ok||!body||typeof body!=='object')throw new Error(`rekor refused the entry (${response.status})`);
 const [uuid,record]=Object.entries(body)[0]??[];
 if(!uuid)throw new Error('rekor returned no entry');
 return {url:url.replace(/\/+$/,''),uuid,logIndex:record.logIndex,integratedTime:record.integratedTime,manifestSha256:manifestHashHex(document)};
}
export function generatedModule(document) {
 return `// GENERATED by tools/transparency.mjs - do not edit by hand. The signed release manifest for build ${document.manifest.buildId}.\nexport const RELEASE_MANIFEST: string | null = ${JSON.stringify(JSON.stringify(document))};\n`;
}

async function main() {
 const root=join(fileURLToPath(import.meta.url),'..','..');
 const args=process.argv.slice(2),flag=name=>args.includes(name),option=(name,fallback)=>args.find(a=>a.startsWith(`${name}=`))?.slice(name.length+1)??fallback;
 const keyPath=resolve(root,option('--key','.release-signing-key.json')),dry=flag('--dry-run');
 const assetsPath=join(root,'worker/generated/client-assets.ts'),generatedPath=join(root,'worker/generated/release-manifest.ts');
 if(!existsSync(assetsPath)){console.error('No client build found. Run node tools/build.mjs first.');process.exit(1);}
 // worker/generated/ is not versioned; the worker (and so its stylesheet module) cannot load without this module.
 if(!existsSync(generatedPath)){writeFileSync(generatedPath,PLACEHOLDER_MODULE);console.log('Wrote the null placeholder worker/generated/release-manifest.ts.');}
 const assets=await import(pathToFileURL(assetsPath).href);
 const {stylesheet}=await import(pathToFileURL(join(root,'worker/src/pages.ts')).href);
 const paths=sourcePaths(root),sources=Object.fromEntries(paths.map(p=>[p,readFileSync(join(root,p),'utf8')]));
 // The served source listing is a snapshot taken by the build; a manifest over newer files would not match it.
 const stale=staleSources(sources,assets.SOURCE_FILES);
 if(stale.length&&!dry){console.error(`Refusing: the client build does not match ${stale.length} signed source file(s) (${stale.slice(0,5).join(', ')}${stale.length>5?', …':''}): changed, added or removed since it ran. Run node tools/build.mjs first.`);process.exit(1);}
 const registryPath=resolve(root,option('--registry','db/issuer-public-keys.json'));
 if(!existsSync(registryPath)){console.error(`${registryPath} is missing. The production registry is written by node tools/provision-issuer.mjs --remote.`);process.exit(1);}
 const registry=JSON.parse(readFileSync(registryPath,'utf8'));
 for(const entry of registry) if(entry.fingerprint!==await issuerKeyFingerprint(entry)){console.error(`Refusing: the fingerprint recorded for ${entry.id} does not match its key.`);process.exit(1);}
 const live=registry.filter(k=>Date.parse(k.expiresAt)>Date.now());
 // The browser refuses keys its release did not pin, so the release must pin exactly what it signs, and what the
 // verifier serves must be in it.
 const liveFingerprints=live.map(k=>k.fingerprint),keyProblems=pinProblems(assets.CLIENT_ISSUER_PINS,liveFingerprints);
 // A local key is never a production key: its private half is loaded in a development worker.
 const local=localKeyOverlap(registry,await localKeyModuli({files:['.wrangler/provision/local-issuer-public-keys.json','.wrangler/provision/local-issuer-secrets.json'].map(f=>join(root,f))}));
 if(local.length)keyProblems.push(`${local.length} key(s) of ${registryPath} are local keys, held by the local development verifier (${local.slice(0,4).join(', ')}${local.length>4?', …':''}); they must never be released. Move the registry and .issuer-secrets.json aside and provision fresh production keys with node tools/provision-issuer.mjs --remote`);
 if(flag('--skip-verifier-keys-check')) console.warn('WARNING: the verifier\'s live keys were not compared with the registry (--skip-verifier-keys-check). If it serves a key this release does not pin, browsers refuse it and contributions and juror tokens stop until the next release.');
 else if(dry) console.log('Dry run: the verifier\'s live keys were not fetched.');
 else {
  const verifierOrigin=(option('--verifier',null)??configuredVerifier(readFileSync(join(root,'wrangler.jsonc'),'utf8'))??'https://verify.shouldiworkthere.com').replace(/\/+$/,'');
  let served=null;
  try {const response=await fetch(`${verifierOrigin}/keys`,{signal:AbortSignal.timeout(15000),headers:{accept:'application/json'}});served=response.ok?(await response.json())?.keys:null;} catch {}
  if(!Array.isArray(served))keyProblems.push(`the verifier's live keys could not be read from ${verifierOrigin}/keys; check the origin (--verifier) or, only if it is unreachable and you accept the risk, pass --skip-verifier-keys-check`);
  else {const missing=await unregisteredKeys(served,liveFingerprints);if(missing.length)keyProblems.push(`the verifier at ${verifierOrigin} serves ${missing.length} live key(s) the registry does not contain (${missing.slice(0,4).join(', ')}${missing.length>4?', …':''}), so every browser would refuse them. Sign the registry that provisioning wrote (db/issuer-public-keys.json from provision-issuer --remote), then rebuild`);}
 }
 if(keyProblems.length&&!dry){console.error(`Refusing: ${keyProblems.join('; ')}.`);process.exit(1);}
 const manifest=await buildManifest({buildId:assets.CLIENT_BUILD_ID,releasedOn:new Date().toISOString().slice(0,10),client:{appJs:assets.CLIENT_JS,appCss:stylesheet(),js:assets.CLIENT_JS,css:assets.CLIENT_CSS,fonts:assets.CLIENT_FONTS},sources,issuerKeys:live,policyVersion:policy.version,policyDigest:await currentPolicyDigest(),legal:{version:LEGAL_VERSION,effective:LEGAL_EFFECTIVE}});
 let keyFile;
 if(existsSync(keyPath)) keyFile=JSON.parse(readFileSync(keyPath,'utf8'));
 else if(dry) {keyFile=await generateSigningKey();console.log('Dry run: no release signing key exists, so a throwaway in-memory key signs this run; nothing is written.');}
 else if(!flag('--init-key')){console.error(`No release signing key at ${keyPath}. Create one with --init-key, keep it out of version control, and back it up offline.`);process.exit(1);}
 else {
  keyFile=await generateSigningKey();
  writeFileSync(keyPath,`${JSON.stringify(keyFile,null,1)}\n`,{mode:0o600,flag:'wx'});
  console.log(`Created a new Ed25519 release signing key at ${keyPath} (mode 0600). Publish its public key with the first release.`);
 }
 if(keyFile.format!==KEY_FORMAT||keyFile.alg!=='Ed25519'){console.error('The release key file has an unknown format.');process.exit(1);}
 const document=await signManifest(manifest,keyFile);
 if(!(await verifySignedManifest(document))){console.error('The signed manifest does not verify; nothing was written.');process.exit(1);}
 // Ed25519 is deterministic, so re-running the same release on the same day reproduces its record byte for byte; any
 // other existing record at this path is refused rather than replaced.
 const record=join(root,releaseRecordPath(document)),recordText=doc=>`${JSON.stringify(doc,null,1)}\n`;
 const recorded=!dry&&existsSync(record);
 if(recorded&&(flag('--rekor')||readFileSync(record,'utf8')!==recordText(document))){console.error(`Refusing: ${releaseRecordPath(document)} already exists with different content. Release records are never overwritten.`);process.exit(1);}
 if(flag('--rekor')&&!dry) {
  try {document.rekor=await submitToRekor(document,option('--rekor-url','https://rekor.sigstore.dev'));console.log(`Rekor entry ${document.rekor.uuid} (log index ${document.rekor.logIndex}).`);}
  catch(error){console.error(`Rekor submission failed: ${error.message}. Nothing was written; re-run without --rekor to release without a Rekor entry.`);process.exit(1);}
 }
 const summary=`build ${manifest.buildId}: ${Object.keys(manifest.sources.files).length} source files, ${manifest.issuerKeys.length} issuer keys (${manifest.issuerKeys.filter(k=>k.purpose==='juror').length} juror), policy ${manifest.policy.version}, legal ${manifest.legal.version}; manifest sha256 ${manifestHashHex(document)}; signer ${keyFile.keyId}`;
 if(dry){console.log(`Dry run (no release written): ${summary}${stale.length?`\nWARNING: ${stale.length} signed source file(s) changed, appeared or disappeared since the last build (${stale.slice(0,5).join(', ')}${stale.length>5?', …':''}); a real release would refuse.`:''}${keyProblems.length?`\nWARNING: ${keyProblems.join('; ')}; a real release would refuse.`:''}`);return;}
 mkdirSync(join(root,'docs/releases'),{recursive:true});mkdirSync(join(root,'worker/generated'),{recursive:true});
 if(!recorded)writeFileSync(record,recordText(document),{flag:'wx'});
 writeFileSync(generatedPath,generatedModule(document));
 console.log(`Signed release manifest written: ${releaseRecordPath(document)}${recorded?' (already recorded, unchanged)':''} and worker/generated/release-manifest.ts. ${summary}. Deploy the main worker next so /.well-known/siwt-release.json serves it, then run node tools/verify-deployment.mjs.`);
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) await main();
