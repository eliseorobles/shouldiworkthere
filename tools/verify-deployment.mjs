#!/usr/bin/env node
// Usage: node tools/verify-deployment.mjs [--site=https://shouldiworkthere.com] [--verifier=https://verify.shouldiworkthere.com]
//                                          [--release-key=<base64url Ed25519 public key>] [--archives=12] [--check-rekor]
//                                          [--state=<file>] [--local-registry=<file>]
//                                          [--aliases=https://www.shouldiworkthere.com,https://kernel.shouldiworkthere.com]
//
// An independent watcher anyone can run. It uses only Node built-ins (no project code), fetches public URLs with plain
// GET requests, and prints PASS / FAIL / WARN / SKIP per check; the exit code is 1 if any check fails.
//  - the signed release manifest (/.well-known/siwt-release.json): Ed25519 signature, and the signer against a pinned
//    release key (--release-key, or every docs/releases/*.json in the current directory)
//  - /app.js and /app.css byte-for-byte against the manifest; /api/source files against the signed source digests
//  - issuer keys: the site (/api/proof/keys) and the verifier (/keys) publish identical curated keys, every live curated
//    key is signed in the manifest and pinned by the served /app.js (browsers refuse unpinned keys), purposes agree with
//    key ids, at most 4 live keys per employer and purpose
//  - community keys (source 'community': created by the verifier for an employer domain listed after the release, so no
//    release can sign or pin them): every one the site publishes is on the verifier with an identical record, ids and
//    sources agree, and the verifier's live community keys are all copied to the site (WARN while one is not yet copied)
//  - fictional sample employers are hidden (/api/config sampleEmployers false and no 'sample' row in /api/directory), and
//    listing new employers is open (/api/config employerListing.open)
//  - while the site hides the fictional employers, neither the site nor the verifier serves any of their sandbox ('demo')
//    keys (FAIL otherwise: production holds no fictional data)
//  - the verifier accepted the main worker's INTERNAL_TOKEN at the main worker's last scheduled check
//    (/api/transparency verifierLink; FAIL when it was refused)
//  - no served issuer key is a local development key: when this checkout has a local registry
//    (.wrangler/provision/local-issuer-public-keys.json, or --local-registry), no key the site or the verifier serves may
//    share its RSA modulus with it, because a local key's private half is loaded in a development worker
//  - the moderation policy served at /moderation/current.json against the signed digest
//  - transparency archives: each digest recomputed, the hash chain, the key registry, and the release link
//  - v4 archives: archived moderation statistics are coarse (contribution-derived counts 0, '<25' or a multiple of 25;
//    the others '<5' or at least 5) and exception entries name targets by digest
//  - / and /privacy carry no Cloudflare-injected script or cookie (Email Address Obfuscation, Rocket Loader, the Web
//    Analytics beacon, Zaraz, challenge scripts, __cf_bm / cf_clearance), and the zone setting to switch off is named.
//    Pages are fetched as a browser (a Chrome user agent, Accept: text/html): Cloudflare injects the Web Analytics beacon
//    only into what browsers receive, so a plain fetch would miss it
//  - no response carries Network Error Logging headers (nel / report-to), which make browsers report failed page loads,
//    with the page URL, to Cloudflare (WARN, naming the zone setting to turn off)
//  - plain HTTP to the site and to the verifier is answered with a 301 to the same path and query over HTTPS
//  - each alias hostname (--aliases; by default www. and kernel. of the default site) answers a 301 to the same path on
//    the site
//  - challenges are open (WARN otherwise: the main worker lacks RATE_LIMIT_SECRET, which keys the daily budget)
//  - the verifier's /stats stays coarse (bands only, no timestamps)
//  - with --check-rekor, the Rekor entry named in the manifest records this manifest's hash
//  - with --state=<file>, history across runs: archives pinned on earlier runs must still be served unchanged and today's
//    chain must lead back to the newest of them (a wholesale rewrite with recomputed digests fails here), and a release
//    older than one seen before is flagged. The file is created on the first run and updated after each run.
// What it cannot show: which code the Workers execute, or what other visitors are served. Without --state (or another
// copy kept by someone), an operator who rewrites every archive consistently is not detected.
import {createHash,webcrypto} from 'node:crypto';
import {existsSync,readdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

export function canonicalJson(value) {
 if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
 return JSON.stringify(value);
}
const hash=data=>createHash('sha256').update(data).digest();
export const sha256=data=>hash(data).toString('base64url');
/** RFC 6962 Merkle tree hash over base64url SHA-256 leaves (see worker/src/ledger.ts). */
export function merkleRoot(leaves) {
 const tree=items=>{
  if(items.length<2)return hash(items.length?Buffer.concat([Buffer.from([0]),items[0]]):Buffer.alloc(0));
  let split=1;while(split*2<items.length)split*=2;
  return hash(Buffer.concat([Buffer.from([1]),tree(items.slice(0,split)),tree(items.slice(split))]));
 };
 return tree(leaves.map(l=>Buffer.from(l,'base64url'))).toString('base64url');
}
export function keyPurpose(key) {
 const byId=key.id.includes(':juror:')?'juror':'contribution';
 return key.purpose==null||key.purpose===byId?byId:null;
}
/** 'community' for ids ending ':community' (shared/proof.ts keySource); a declared source that disagrees is null. */
export function keySource(key) {
 const byId=String(key.id).endsWith(':community')?'community':'curated';
 return key.source==null||key.source===byId?byId:null;
}
/** A community key's record ends with 'community' (shared/proof.ts), so a copy that drops or changes its source differs. */
const keyRecord=key=>JSON.stringify([key.id,key.companySlug,key.epoch,key.expiresAt,key.verificationClass,keyPurpose(key),key.publicKey?.kty??null,key.publicKey?.n??null,key.publicKey?.e??null,...(key.source==='community'?['community']:[])]);
/**
 * Problems between the site's and the verifier's community keys. Every community key the site publishes must be on the
 * verifier with an identical record (the browser accepts a community key only when both copies agree); a live one on the
 * verifier that the site has not copied yet is only pending (the site copies it when a listing is added and on its
 * 6-hourly job).
 */
export function communityKeyProblems(siteKeys,verifierKeys,now=Date.now()) {
 const community=keys=>keys.filter(k=>k?.source==='community'||String(k?.id).endsWith(':community'));
 const site=community(siteKeys),verifier=community(verifierKeys),byId=new Map(verifier.map(k=>[k.id,k]));
 const mislabeled=[...site,...verifier].filter(k=>keySource(k)!=='community'||k.verificationClass!=='mailbox'||!keyPurpose(k)).map(k=>k.id);
 const differ=site.filter(k=>!byId.has(k.id)||keyRecord(byId.get(k.id))!==keyRecord(k)).map(k=>k.id);
 const pending=verifier.filter(k=>Date.parse(k.expiresAt)>now&&!site.some(s=>s.id===k.id)).map(k=>k.id);
 return {site:site.length,verifier:verifier.length,mislabeled:[...new Set(mislabeled)].sort(),differ:differ.sort(),pending:pending.sort()};
}
/**
 * The main worker's scheduled check that the verifier accepts the INTERNAL_TOKEN they share (/api/transparency
 * verifierLink: {state, day}). 'refused' FAILs: every new listing is refused and none can be registered until both workers
 * hold the same secret. null (no finding) when listing is closed and nothing was checked.
 */
export function verifierLinkFinding(link,listingOpen,now=Date.now()) {
 if(!link||typeof link!=='object')return listingOpen?{status:'WARN',detail:'the main worker has not checked its link to the verifier yet (its scheduled job runs every 6 hours), or this release does not report it'}:null;
 const age=Math.floor((now-Date.parse(`${link.day}T00:00:00Z`))/86400000);
 if(link.state==='refused')return {status:'FAIL',detail:`on ${link.day} the verifier refused the main worker's INTERNAL_TOKEN: set the same secret (at least 32 characters) on both workers with wrangler secret put INTERNAL_TOKEN`};
 if(link.state!=='ok')return {status:'WARN',detail:`on ${link.day} the verifier could not be reached from the main worker`};
 return age>2?{status:'WARN',detail:`the last successful check of the verifier link was on ${link.day}`}:{status:'PASS',detail:`the verifier accepted the shared secret on ${link.day}`};
}
/**
 * Owner decision 1: production holds no fictional data. While the site says it hides the fictional employers
 * (/api/config sampleEmployers false), any sandbox ('demo') key served by the site or the verifier FAILs: the verifier
 * serves them only while its own SAMPLE_EMPLOYERS is 'on'. null (no finding) when the site does not report the switch;
 * SKIP while it shows the fictional employers (a local stack, on purpose).
 */
export function sandboxKeysFinding(config,siteKeys,verifierKeys) {
 if(!config||typeof config.sampleEmployers!=='boolean')return null;
 if(config.sampleEmployers)return {status:'SKIP',detail:'the site shows the fictional employers, so their sandbox keys are expected'};
 const demo=keys=>(Array.isArray(keys)?keys:[]).filter(k=>k?.verificationClass==='demo').map(k=>k.id);
 const onVerifier=demo(verifierKeys),onSite=demo(siteKeys),list=ids=>`${ids.slice(0,4).join(', ')}${ids.length>4?', …':''}`;
 if(!onVerifier.length&&!onSite.length)return {status:'PASS',detail:'the site hides the fictional employers, and neither the site nor the verifier serves a sandbox key'};
 return {status:'FAIL',detail:[
  onVerifier.length?`the verifier serves ${onVerifier.length} sandbox key(s) of fictional employers (${list(onVerifier)}) although the site hides those employers: deploy the verifier with SAMPLE_EMPLOYERS 'off' (issuer.wrangler.jsonc), then delete its sandbox key rows with node tools/purge-samples.mjs --remote (a dry run; then --apply --bookmark=<id>)`:'',
  onSite.length?`the site publishes ${onSite.length} sandbox key(s) (${list(onSite)}) although it hides the fictional employers: its SAMPLE_EMPLOYERS and /api/proof/keys disagree`:'',
 ].filter(Boolean).join('; ')};
}
export const keyFingerprint=key=>sha256(`siwt-issuer-key-v1:${keyRecord(key)}`);
export async function manifestSignatureValid(document) {
 try {
  const {manifest,signature}=document;
  if(signature?.alg!=='Ed25519'||sha256(Buffer.from(signature.publicKey,'base64url'))!==signature.keyId)return false;
  const key=await webcrypto.subtle.importKey('jwk',{kty:'OKP',crv:'Ed25519',x:signature.publicKey},{name:'Ed25519'},false,['verify']);
  return await webcrypto.subtle.verify({name:'Ed25519'},key,Buffer.from(signature.value,'base64url'),Buffer.from(canonicalJson(manifest)));
 } catch {return false;}
}
/** Formats whose digest is SHA-256 of the canonical JSON; v4 adds moderation statistics and the exception log to v3. */
export const CANONICAL_ARCHIVE_FORMATS=new Set(['shouldiworkthere-transparency-v3','shouldiworkthere-transparency-v4']);
/** v3 and later archives hash their canonical JSON; earlier formats hashed JSON.stringify in stored key order. Neither includes "digest". */
export function archiveDigest(archive) {
 const {digest:_stated,...data}=archive;
 return sha256(CANONICAL_ARCHIVE_FORMATS.has(data.format)?canonicalJson(data):JSON.stringify(data));
}
const BANDS=new Set(['<25','25–99','100–249','250+']);
/** Moderation counts that follow contributions (policy 0.6.0 publicStatistics) are rounded like contribution counts. */
export const ROUNDED_MODERATION=new Set(['submitted','publishedAutomatically','repairs','jury']);
const roundedGroup=group=>group==='heldByReason'||group==='juryOutcomes';
const EXCEPTION_FIELDS=['actionDigest','expiresOn','id','kind','period','policyDigest','policyVersion','scope','signers','targetDigest'];
/**
 * Problems in a v4 archive's moderation data: a count that follows contributions must be 0, '<25' or a multiple of 25,
 * and any other count '<5' or a whole number of at least 5; exception entries may carry only the public log's fields (a
 * digest of the target, never account text or a requester).
 */
export function archiveModerationProblems(archive) {
 const problems=[],m=archive.moderation;
 if(!m||typeof m!=='object')return ['no moderation statistics'];
 for(const [group,values] of Object.entries({counts:m.counts,heldByReason:m.heldByReason,juryOutcomes:m.juryOutcomes})) {
  if(!values||typeof values!=='object'){problems.push(`moderation.${group} missing`);continue;}
  for(const [key,value] of Object.entries(values)) {
   const rounded=roundedGroup(group)||ROUNDED_MODERATION.has(key);
   const ok=rounded?value==='<25'||(Number.isInteger(value)&&value>=0&&value%25===0):value==='<5'||(Number.isInteger(value)&&value>=5);
   if(!ok)problems.push(`moderation.${group}.${key}=${JSON.stringify(value)} is not coarse`);
  }
 }
 if(!Array.isArray(archive.exceptions))problems.push('no exception log');
 else for(const entry of archive.exceptions) {
  const extra=Object.keys(entry??{}).filter(k=>!EXCEPTION_FIELDS.includes(k));
  if(extra.length)problems.push(`exception ${entry?.id??'?'} has unexpected fields: ${extra.join(', ')}`);
  if(!/^[A-Za-z0-9_-]{43}$/.test(entry?.targetDigest??''))problems.push(`exception ${entry?.id??'?'} does not name its target by digest`);
 }
 return problems;
}
/**
 * Cloudflare zone features that inject scripts, rewrite HTML or set cookies. Any of them makes "no cookies", "no
 * third-party scripts" or "trust pages work without JavaScript" false. [pattern, what it is, the zone setting to switch off]
 */
export const INJECTIONS=[
 [/\/cdn-cgi\/scripts\/[^"' ]*email-decode|data-cfemail|__cf_email__/i,'Email Address Obfuscation','Scrape Shield > Email Address Obfuscation'],
 [/rocket-loader|data-cf-settings|type="[0-9a-f]{24}-text\/javascript"/i,'Rocket Loader','Speed > Optimization > Rocket Loader'],
 [/static\.cloudflareinsights\.com|cf-beacon|\/cdn-cgi\/rum/i,'Web Analytics beacon','Web Analytics (automatic setup / RUM)'],
 [/\/cdn-cgi\/zaraz\//i,'Zaraz','Zaraz'],
 [/\/cdn-cgi\/challenge-platform\//i,'bot challenge script (JavaScript detections)','Security > Bots > Bot Fight Mode and JavaScript detections'],
];
export const INJECTED_COOKIES=[['__cf_bm','Bot Management / Bot Fight Mode'],['cf_clearance','a challenge (Security Level, Bot Fight Mode or a WAF rule)'],['_cfuvid','rate limiting by cookie']];
/** What a served page shows of injected scripts or cookies: [{what, setting}]. */
export function injectionFindings(html,setCookie) {
 const found=INJECTIONS.filter(([pattern])=>pattern.test(html)).map(([,what,setting])=>({what,setting}));
 for(const [name,why] of INJECTED_COOKIES) if(new RegExp(`(^|[\\s,;])${name}=`).test(setCookie??''))found.push({what:`cookie ${name}`,setting:why});
 if(setCookie&&!found.some(f=>f.what.startsWith('cookie ')))found.push({what:'a cookie',setting:'the site sets no cookies; find the zone feature or rule that adds this one'});
 return found;
}

/**
 * What a browser sends for a page. Cloudflare decides from these whether to inject the Web Analytics beacon (it does
 * only for browsers), so the injection check must look like one; Node's default headers are served clean HTML.
 */
export const BROWSER_HEADERS=Object.freeze({'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',accept:'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8','accept-language':'en-US,en;q=0.9'});
/** Network Error Logging: headers that make browsers report failed loads of this origin's pages (with their URLs) elsewhere. */
export function nelFindings(headers) {
 // A NEL policy whose every entry has max_age 0 (and no report-to) withdraws error reporting: that is what the
 // workers send on purpose, so only a live policy or a reporting endpoint is a finding.
 let policies=[];try {policies=JSON.parse(`[${headers?.get?.('nel')??''}]`);} catch {policies=[{max_age:1}];}
 const liveNel=policies.some(p=>!(p&&typeof p==='object'&&Number(p.max_age)===0));
 const found=[...(liveNel?['nel']:[]),...(headers?.get?.('report-to')?['report-to']:[])];
 if(!found.length)return null;
 let hosts=[];
 try {hosts=[...new Set(JSON.parse(`[${headers.get('report-to')??''}]`).flatMap(group=>(group?.endpoints??[]).map(e=>new URL(e.url).host)))];} catch {}
 return {headers:found,hosts};
}
export const NEL_SETTING='Network Error Logging for the zone (zone setting nel: the dashboard toggle, or PATCH /zones/{zone_id}/settings/nel with {"value":{"enabled":false}})';
/** Aliases the default site answers with a permanent redirect (tools/redirect-worker binds both as custom domains). */
export const DEFAULT_ALIASES=['https://www.shouldiworkthere.com','https://kernel.shouldiworkthere.com'];
/** state (optional) is read and updated in place: {archives:{[id]:digest}, releases:{[manifest sha256 hex]:{buildId,releasedOn}}}. */
export async function watch({site,verifier,fetcher=fetch,pinnedKeys=[],archiveLimit=12,checkRekor=false,state=null,localModuli=[],aliases=[]}) {
 const results=[],record=(check,status,detail)=>results.push({check,status,detail});
 // Redirects are followed here (at most three, same origin only) so the final URL is known with any fetch implementation.
 const get=async(url,as='text',extraHeaders={})=>{
  try {
   let target=url,response;
   for(let hop=0;;hop++) {
    response=await fetcher(target,{redirect:'manual',headers:{accept:as==='json'?'application/json':'*/*',...extraHeaders}});
    const location=response.headers.get('location');
    if(response.status<300||response.status>=400||!location||hop===3)break;
    const next=new URL(location,target);if(next.origin!==new URL(url).origin)break;target=next.href;
   }
   const bytes=Buffer.from(await response.arrayBuffer());
   return {ok:response.ok,status:response.status,url:target,headers:response.headers,bytes,text:bytes.toString('utf8')};
  } catch(error) {return {ok:false,status:0,url,headers:new Headers(),bytes:Buffer.alloc(0),text:'',error:String(error?.message??error)};}
 };
 const json=r=>{try {return JSON.parse(r.text);} catch {return null;}};
 const release=await get(`${site}/.well-known/siwt-release.json`,'json'),document=release.ok?json(release):null,manifest=document?.manifest;
 if(!manifest) record('release manifest','FAIL',release.status===404?'no signed release manifest is served':`unavailable (${release.status||release.error})`);
 else {
  record('release manifest','PASS',`build ${manifest.buildId}, released ${manifest.releasedOn}`);
  const signed=await manifestSignatureValid(document);
  record('release signature',signed?'PASS':'FAIL',`Ed25519 key ${document.signature?.keyId}`);
  if(!pinnedKeys.length) record('release signer','WARN','no pinned release key (pass --release-key or run from a checkout with docs/releases); trusting the key the site presents');
  else record('release signer',pinnedKeys.includes(document.signature?.publicKey)?'PASS':'FAIL',pinnedKeys.includes(document.signature?.publicKey)?'signed by a pinned release key':'signed by a key that is not pinned');
  if(state&&signed) {
   state.releases??={};
   const id=hash(Buffer.from(canonicalJson(manifest))).toString('hex'),seen=state.releases[id],newer=Object.values(state.releases).filter(r=>String(r.releasedOn)>String(manifest.releasedOn));
   record('release history',!seen&&newer.length?'WARN':'PASS',seen?'this release was seen on an earlier run':newer.length?`older than ${newer.length} release(s) seen on earlier runs (a rollback?)`:'a release not seen before; pinned for later runs');
   state.releases[id]??={buildId:manifest.buildId,releasedOn:manifest.releasedOn};
  }
 }
 let appJs=null;
 for(const path of ['/app.js','/app.css']) {
  if(!manifest){record(`client ${path}`,'SKIP','no manifest');continue;}
  const served=await get(`${site}${path}`),expected=manifest.client?.served?.[path]?.sha256;
  if(path==='/app.js')appJs=served;
  record(`client ${path}`,served.ok&&sha256(served.bytes)===expected?'PASS':'FAIL',served.ok?`served ${sha256(served.bytes)}, signed ${expected}`:`unavailable (${served.status||served.error})`);
 }
 if(manifest) {
  const listing=json(await get(`${site}/api/source`,'json'))?.files;
  if(!listing) record('source listing','FAIL','/api/source is unavailable');
  else {
   const signed=Object.entries(manifest.sources?.files??{}),missing=signed.filter(([p])=>!(p in listing)),changed=signed.filter(([p,d])=>p in listing&&sha256(listing[p])!==d);
   record('source listing',changed.length?'FAIL':'PASS',changed.length?`differs from the signed digest: ${changed.map(([p])=>p).slice(0,8).join(', ')}`:`${signed.length-missing.length} files match; ${missing.length} signed files are not served (compare them with the repository)`);
  }
 } else record('source listing','SKIP','no manifest');
 const config=json(await get(`${site}/api/config`,'json'));
 const allSiteKeys=json(await get(`${site}/api/proof/keys`,'json'))?.keys,allVerifierKeys=json(await get(`${verifier}/keys`,'json'))?.keys;
 // Community keys are checked on their own below; every other check here concerns the curated (released) keys.
 const curated=keys=>Array.isArray(keys)?keys.filter(k=>keySource(k)!=='community'):keys;
 const siteKeys=curated(allSiteKeys),verifierKeys=curated(allVerifierKeys);
 if(!Array.isArray(siteKeys)||!Array.isArray(verifierKeys)) record('issuer keys agree','FAIL',`unavailable (site ${Array.isArray(siteKeys)?'ok':'missing'}, verifier ${Array.isArray(verifierKeys)?'ok':'missing'})`);
 else {
  // While the site hides the fictional employers, it publishes none of their sandbox ('demo') keys, and a sandbox key the
  // verifier still serves is reported on its own below rather than as a mismatch.
  const hidesSamples=config?.sampleEmployers===false,hiddenDemo=hidesSamples?verifierKeys.filter(k=>k.verificationClass==='demo'&&!siteKeys.some(s=>s.id===k.id)).map(k=>k.id):[];
  const byId=new Map(verifierKeys.map(k=>[k.id,k])),differ=siteKeys.filter(k=>!byId.has(k.id)||keyRecord(byId.get(k.id))!==keyRecord(k)).map(k=>k.id),onlyVerifier=verifierKeys.filter(k=>!siteKeys.some(s=>s.id===k.id)&&!hiddenDemo.includes(k.id)).map(k=>k.id);
  record('issuer keys agree',differ.length||onlyVerifier.length?'FAIL':'PASS',differ.length||onlyVerifier.length?`mismatched: ${[...differ,...onlyVerifier].join(', ')}`:`${siteKeys.length} curated keys identical on the site and the verifier${hiddenDemo.length?` (the verifier also serves ${hiddenDemo.length} sandbox key(s); see sandbox keys retired)`:''}`);
  const retired=sandboxKeysFinding(config,siteKeys,verifierKeys);if(retired)record('sandbox keys retired',retired.status,retired.detail);
  const groups=new Map();for(const k of siteKeys){const g=`${k.companySlug}|${keyPurpose(k)}`;groups.set(g,(groups.get(g)??0)+1);}
  const bad=siteKeys.filter(k=>!keyPurpose(k)).map(k=>k.id),crowded=[...groups].filter(([,n])=>n>4).map(([g])=>g);
  record('issuer key purposes and limits',bad.length||crowded.length?'FAIL':'PASS',bad.length||crowded.length?`purpose disagrees with id: ${bad.join(', ')||'none'}; more than 4 live keys: ${crowded.join(', ')||'none'}`:'every purpose matches its key id; at most 4 live keys per employer and purpose');
  if(manifest) {
   const signedPrints=new Set((manifest.issuerKeys??[]).map(k=>k.fingerprint)),unsigned=siteKeys.filter(k=>!signedPrints.has(keyFingerprint(k))).map(k=>k.id);
   record('issuer keys signed',unsigned.length?'FAIL':'PASS',unsigned.length?`live keys missing from the signed manifest: ${unsigned.join(', ')}`:`all ${siteKeys.length} live keys are in the signed manifest`);
  }
  // The client refuses to blind against a key its release did not pin: a live key missing here stops contributions or
  // juror tokens for that employer until a release that pins it is deployed.
  const app=appJs??await get(`${site}/app.js`);
  if(!app.ok) record('issuer keys pinned','FAIL',`/app.js is unavailable (${app.status||app.error})`);
  else {
   const unpinned=siteKeys.filter(k=>!app.text.includes(keyFingerprint(k))).map(k=>k.id),list=unpinned.slice(0,6).join(', ')+(unpinned.length>6?', …':'');
   record('issuer keys pinned',unpinned.length?'FAIL':'PASS',!unpinned.length?`the served client pins all ${siteKeys.length} live keys`:unpinned.length===siteKeys.length?`the served client pins none of the ${siteKeys.length} live keys: it was built without the production registry (no pinning) or pins other keys, which every browser then refuses. Build, sign and deploy a release from the production registry`:`the served client does not pin ${unpinned.length} live key(s), so browsers refuse them and contributions or juror tokens stop for those employers: ${list}. Build, sign and deploy a release that pins the current registry`);
  }
 }
 if(!Array.isArray(allSiteKeys)||!Array.isArray(allVerifierKeys)) record('community keys agree','FAIL','unavailable (the site or the verifier key list could not be read)');
 else {
  const c=communityKeyProblems(allSiteKeys,allVerifierKeys);
  const failed=c.mislabeled.length||c.differ.length;
  record('community keys agree',failed?'FAIL':c.pending.length?'WARN':c.site?'PASS':'SKIP',failed?`${c.differ.length?`community keys the site publishes that the verifier does not serve identically (browsers refuse them): ${c.differ.slice(0,6).join(', ')}`:''}${c.differ.length&&c.mislabeled.length?'; ':''}${c.mislabeled.length?`keys whose source, class or purpose disagrees with the id: ${c.mislabeled.slice(0,6).join(', ')}`:''}`:c.pending.length?`${c.site} community keys identical on the site and the verifier; ${c.pending.length} live on the verifier are not copied to the site yet (${c.pending.slice(0,4).join(', ')}${c.pending.length>4?', …':''}): the main worker copies them when a listing is added and on its 6-hourly job`:c.site?`${c.site} community keys identical on the site and the verifier`:'no community keys yet (no listed employer has been registered with the verifier)');
 }
 if(!localModuli.length) record('issuer keys are not local keys','SKIP','no local issuer registry in this checkout (pass --local-registry=<file> to compare)');
 else {
  const local=new Set(localModuli),served=[...(Array.isArray(siteKeys)?siteKeys:[]),...(Array.isArray(verifierKeys)?verifierKeys:[])];
  const hits=[...new Set(served.filter(k=>local.has(k?.publicKey?.n)).map(k=>k.id))].sort();
  record('issuer keys are not local keys',hits.length?'FAIL':'PASS',hits.length?`served keys that are local development keys (their private halves are loaded in a local worker): ${hits.slice(0,6).join(', ')}${hits.length>6?', …':''}. Provision fresh production keys with node tools/provision-issuer.mjs --remote`:`none of the ${served.length} served keys shares its modulus with the ${local.size} local keys`);
 }
 if(manifest?.policy) {
  const served=await get(`${site}/moderation/current.json`,'json'),digest=sha256(served.bytes),version=/\/moderation\/v([\d.]+)\.json$/.exec(new URL(served.url).pathname)?.[1];
  const ok=served.ok&&digest===manifest.policy.digest&&version===manifest.policy.version&&(served.headers.get('x-policy-digest')??digest)===digest;
  record('moderation policy',ok?'PASS':'FAIL',`served v${version??'?'} ${digest}; signed v${manifest.policy.version} ${manifest.policy.digest}`);
 } else record('moderation policy','SKIP','no manifest');
 const transparency=json(await get(`${site}/api/transparency`,'json')),listed=transparency?.archives;
 const link=verifierLinkFinding(transparency?.verifierLink,config?.employerListing?.open===true);
 if(link)record('verifier link',link.status,link.detail);
 const archives=[],fetchArchive=async id=>{const body=json(await get(`${site}/archives/${id}.json`,'json'));return body?{body,computed:archiveDigest(body)}:null;};
 if(!Array.isArray(listed)) record('archive digests','FAIL','/api/transparency is unavailable');
 else if(!listed.length) record('archive digests','WARN','no transparency archives are listed yet');
 else {
  const recent=[...listed].sort((a,b)=>String(a.id).localeCompare(String(b.id))).slice(-archiveLimit);
  const broken=[];
  for(const entry of recent) {
   const body=json(await get(`${site}/archives/${entry.id}.json`,'json'));
   if(!body){broken.push(`${entry.id} unavailable`);continue;}
   const computed=archiveDigest(body),ok=computed===body.digest&&computed===entry.digest;
   if(!ok)broken.push(`${entry.id} digest ${computed} (stated ${body.digest}, listed ${entry.digest})`);
   archives.push({entry,body,computed,ok});
  }
  record('archive digests',broken.length?'FAIL':'PASS',broken.length?broken.join('; '):`${archives.length} archives recomputed`);
  const gaps=[];
  for(let i=1;i<archives.length;i++){const {entry,body}=archives[i],prior=archives[i-1].body.digest;if(body.previousDigest!==prior||entry.previous_digest!==prior)gaps.push(entry.id);}
  record('archive chain',gaps.length?'FAIL':'PASS',gaps.length?`previous digest does not link: ${gaps.join(', ')}`:`${Math.max(0,archives.length-1)} consecutive links verified (the first archive in the window links outside it)`);
  const latest=[...archives].reverse().find(a=>CANONICAL_ARCHIVE_FORMATS.has(a.body.format))?.body;
  const v4=[...archives].reverse().find(a=>a.body.format==='shouldiworkthere-transparency-v4')?.body;
  if(!v4) record('archive moderation','SKIP','no v4 archive yet (moderation statistics are archived from format v4)');
  else {const problems=archiveModerationProblems(v4);record('archive moderation',problems.length?'FAIL':'PASS',problems.length?problems.slice(0,6).join('; '):`statistics for ${v4.moderation.period} are coarse; ${v4.exceptions.length} exception log entr${v4.exceptions.length===1?'y':'ies'} name targets by digest only`);}
  if(!latest) record('archive key registry','SKIP','no v3 or later archive yet');
  else {
   const prints=(latest.issuerKeys??[]).map(k=>k.fingerprint),consistent=sha256(JSON.stringify([...prints].sort()))===latest.issuerKeysDigest;
   const roots=[latest.publishedAccounts?.merkleRoot,latest.metricReleases?.merkleRoot].every(r=>/^[A-Za-z0-9_-]{43}$/.test(r??''));
   const unregistered=Array.isArray(siteKeys)?siteKeys.filter(k=>!prints.includes(keyFingerprint(k))).map(k=>k.id):[];
   record('archive key registry',!consistent||!roots?'FAIL':unregistered.length?'WARN':'PASS',!consistent?'issuerKeysDigest does not match the listed fingerprints':!roots?'malformed Merkle roots':unregistered.length?`the latest archive predates live keys: ${unregistered.join(', ')}`:`registry of ${prints.length} keys covers every live key; Merkle roots present`);
   if(document) {
    const servedDigest=sha256(release.bytes);
    record('archive release link',latest.releaseManifestDigest===servedDigest?'PASS':'WARN',latest.releaseManifestDigest===servedDigest?'the latest archive was written by the release now served':`the latest archive records release manifest ${latest.releaseManifestDigest??'none'} (it predates the one served now, or none was embedded)`);
   }
  }
 }
 if(state) {
  // Archives are write-once. Ones pinned on earlier runs must be served unchanged, and today's chain must lead back to
  // the newest of them; a consistent rewrite of the whole history recomputes every digest but cannot pass this.
  state.archives??={};
  const pinned=Object.entries(state.archives).sort(([a],[b])=>a.localeCompare(b)),inWindow=new Map(archives.map(a=>[String(a.entry.id),a])),problems=[];
  let unverified=null;
  for(const [id,digest] of pinned.slice(-60)) {
   const seen=inWindow.get(id)??await fetchArchive(id);
   if(!seen)problems.push(`${id} was pinned earlier but is no longer served`);
   else if(seen.computed!==digest||seen.body.digest!==digest)problems.push(`${id} changed since it was pinned`);
  }
  const newest=pinned.at(-1),oldest=archives[0];
  if(newest&&oldest&&!inWindow.has(newest[0])&&String(oldest.entry.id)>newest[0]) {
   // At most one archive per UTC day, named by date: walk back day by day from the oldest listed archive.
   let need=oldest.body.previousDigest,day=Date.parse(String(oldest.entry.id).slice(-10)),steps=0;
   while(need!==newest[1]) {
    if(need==null){problems.push('the chain restarts without reaching the archives pinned earlier');break;}
    if(++steps>366){unverified=`more than a year of archives lies between ${newest[0]} and ${oldest.entry.id}; the link was not walked`;break;}
    day-=86400000;const id=`transparency-${new Date(day).toISOString().slice(0,10)}`;
    if(!(id>=newest[0])){problems.push(`the chain does not lead back to ${newest[0]}, the newest archive pinned earlier`);break;}
    const found=await fetchArchive(id);
    if(!found)continue;
    if(found.computed!==need||found.body.digest!==need){problems.push(`${id} is not the archive its successor links to`);break;}
    need=found.body.previousDigest;
   }
  }
  let added=0;
  if(!problems.length)for(const a of archives)if(a.ok&&!(String(a.entry.id) in state.archives)){state.archives[String(a.entry.id)]=a.computed;added++;}
  record('archive history',problems.length?'FAIL':unverified?'WARN':'PASS',problems.length?problems.join('; '):unverified?unverified:pinned.length?`${Math.min(pinned.length,60)} archives pinned on earlier runs are unchanged and the chain reaches them; ${added} newly pinned`:`first run with this state file: ${added} archives pinned for later runs`);
 }
 // Cloudflare zone features can inject scripts or cookies into what visitors are served; the code sets neither. The pages
 // are requested as a browser would request them, because the Web Analytics beacon is injected only for browsers.
 const injected=[],reporting=[];
 for(const path of ['/','/privacy']) {
  const page=await get(`${site}${path}`,'text',BROWSER_HEADERS);
  if(!page.ok){injected.push({what:`${path} unavailable (${page.status||page.error})`,setting:'-'});continue;}
  for(const f of injectionFindings(page.text,page.headers.get('set-cookie')))injected.push({...f,what:`${path}: ${f.what}`});
  const nel=nelFindings(page.headers);if(nel)reporting.push({where:path,...nel});
 }
 record('no injected scripts or cookies',injected.length?'FAIL':'PASS',injected.length?`${injected.map(f=>`${f.what} (switch off: ${f.setting})`).join('; ')} [fetched as a browser: Chrome user agent, Accept text/html]`:'/ and /privacy, fetched as a browser (Chrome user agent, Accept text/html), carry no Cloudflare-injected script, beacon or cookie. Zone settings that must stay off: Email Address Obfuscation, Rocket Loader, Web Analytics automatic setup, Zaraz, Bot Fight Mode and JavaScript detections');
 // Plain HTTP must never be served: each origin answers a permanent redirect to the same path and query over HTTPS.
 const probe=async(url,headers={})=>{
  try {const response=await fetcher(url,{redirect:'manual',headers});await response.arrayBuffer().catch(()=>null);return {status:response.status,location:response.headers.get('location'),headers:response.headers};}
  catch(error) {return {status:0,location:null,headers:new Headers(),error:String(error?.cause?.code??error?.message??error)};}
 };
 for(const [name,origin,path] of [['site',site,'/privacy?watch=1'],['verifier',verifier,'/keys?watch=1']]) {
  const check=`plain HTTP redirects (${name})`;
  let secure;try {secure=new URL(origin);} catch {record(check,'FAIL',`not a URL: ${origin}`);continue;}
  if(secure.protocol!=='https:'){record(check,'SKIP',`${origin} is itself served over plain HTTP (a local stack)`);continue;}
  const plain=`http://${secure.host}${path}`,expected=`https://${secure.host}${path}`,r=await probe(plain);
  const ok=r.status===301&&r.location===expected;
  record(check,ok?'PASS':'FAIL',ok?`${plain} → 301 ${expected}`:r.status===0?`${plain} unreachable (${r.error})`:`${plain} answered ${r.status}${r.location?` → ${r.location}`:''}, not a 301 to ${expected}: pages, searches and contributions could travel in cleartext. The workers redirect plain HTTP themselves; if this persists, turn on the zone setting Always Use HTTPS`);
 }
 // Alias hostnames (the former Kernel hostname, www) answer a permanent redirect to the same path on the site.
 if(!aliases.length) record('alias hostnames','SKIP','no alias hostnames given (pass --aliases=<origin>,<origin>)');
 for(const alias of aliases) {
  const host=(()=>{try {return new URL(alias).host;} catch {return alias;}})(),from=`${alias.replace(/\/+$/,'')}/privacy?watch=1`,expected=`${site}/privacy?watch=1`,r=await probe(from);
  const ok=r.status===301&&r.location===expected;
  record(`alias ${host}`,ok?'PASS':'FAIL',ok?`${from} → 301 ${expected}`:r.status===0?`${from} unreachable (${r.error}): there is no DNS record or custom domain for ${host}. tools/redirect-worker binds it as a custom domain (wrangler deploy --config tools/redirect-worker/wrangler.jsonc)`:`${from} answered ${r.status}${r.location?` → ${r.location}`:''}, not a 301 to ${expected}`);
 }
 if(!config||typeof config.sampleEmployers!=='boolean') record('fictional employers hidden','SKIP','/api/config does not report sampleEmployers (a release before the launch switches)');
 else {
  const directory=json(await get(`${site}/api/directory`,'json'))?.companies,shown=Array.isArray(directory)?directory.filter(c=>c?.kind==='sample').map(c=>c.slug):null;
  const local=/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(site);
  const ok=!config.sampleEmployers&&Array.isArray(shown)&&!shown.length;
  record('fictional employers hidden',ok?'PASS':local?'SKIP':'FAIL',ok?'/api/config reports sampleEmployers false and /api/directory lists no fictional employer':!Array.isArray(shown)?'/api/directory is unavailable':`fictional employers are shown${shown.length?` (${shown.slice(0,6).join(', ')})`:''}: set SAMPLE_EMPLOYERS to 'off' in wrangler.jsonc and run node tools/purge-samples.mjs${local?' (a local stack shows them on purpose)':''}`);
  const listing=config.employerListing;
  record('employer listing open',listing?.open?'PASS':'WARN',listing?.open?`listing new employers is open (proof of work ${listing.pow?.bits??'?'} bits, ${listing.perClientPerDay??'?'} attempts per client per day)`:'listing new employers is closed: the main worker needs the VERIFIER service binding, INTERNAL_TOKEN (at least 32 characters, the same value on the verifier), RATE_LIMIT_SECRET and the INFERENCE binding');
 }
 if(!config?.moderation) record('challenges open','WARN','/api/config reports no moderation status');
 else record('challenges open',config.moderation.challengesEnabled?'PASS':'WARN',config.moderation.challengesEnabled?`policy ${config.moderation.policyVersion}; challenges are open (the daily budget is keyed)`:'challenges are closed: the main worker has no RATE_LIMIT_SECRET, which keys the daily challenge budget');
 const statsResponse=await get(`${verifier}/stats`,'json'),stats=json(statsResponse);
 if(!stats) record('verifier stats coarse','FAIL',`unavailable (${statsResponse.status||statsResponse.error})`);
 else {
  const values=(stats.employers??[]).flatMap(e=>[e.contribution?.issued,e.juror?.issued]).filter(v=>v!==undefined&&v!==null);
  const fine=/\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}/.test(statsResponse.text),badBand=values.filter(v=>!BANDS.has(v));
  record('verifier stats coarse',fine||badBand.length?'FAIL':'PASS',fine?'contains a timestamp finer than the quarter':badBand.length?`non-band counts: ${badBand.join(', ')}`:`epoch ${stats.epoch}; ${(stats.employers??[]).length} employers in bands; ${(stats.employers??[]).filter(e=>e.paused).length} paused`);
 }
 const verifierNel=nelFindings(statsResponse.headers);if(verifierNel)reporting.push({where:'verifier /stats',...verifierNel});
 const endpoints=[...new Set(reporting.flatMap(r=>r.hosts))];
 record('no Network Error Logging',reporting.length?'WARN':'PASS',reporting.length?`${reporting.map(r=>`${r.where}: ${r.headers.join(', ')}`).join('; ')}. After a network error, browsers send reports with the page URL (for example /c/<employer>)${endpoints.length?` to ${endpoints.join(', ')}`:''}; the site's code sets neither header. Turn off ${NEL_SETTING}`:'no nel or report-to header on /, /privacy or the verifier');
 if(!document?.rekor) record('rekor entry','SKIP','the manifest names no Rekor entry');
 else if(!checkRekor) record('rekor entry','SKIP',`entry ${document.rekor.uuid}; pass --check-rekor to fetch it from ${document.rekor.url}`);
 else {
  const entry=json(await get(`${document.rekor.url}/api/v1/log/entries/${document.rekor.uuid}`,'json'));
  let recorded=null;try {recorded=JSON.parse(Buffer.from(Object.values(entry??{})[0]?.body??'','base64').toString('utf8'))?.spec?.data?.hash?.value??null;} catch {}
  const expected=hash(Buffer.from(canonicalJson(manifest))).toString('hex');
  record('rekor entry',recorded===expected?'PASS':'FAIL',`log records ${recorded??'nothing readable'}; manifest sha256 ${expected}`);
 }
 return results;
}
/** RSA moduli of the local development registry (a JSON array of keys with publicKey.n), or [] without one. */
export function localModuliFrom(file) {
 if(!file||!existsSync(file))return [];
 try {const keys=JSON.parse(readFileSync(file,'utf8'));return Array.isArray(keys)?keys.map(k=>k?.publicKey?.n).filter(n=>typeof n==='string'):[];} catch {return [];}
}
export function pinnedFromCheckout(dir='docs/releases') {
 if(!existsSync(dir))return [];
 return [...new Set(readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>{try {return JSON.parse(readFileSync(join(dir,f),'utf8'))?.signature?.publicKey;} catch {return null;}}).filter(Boolean))];
}
async function main() {
 const args=process.argv.slice(2),option=(name,fallback)=>args.find(a=>a.startsWith(`${name}=`))?.slice(name.length+1)??fallback;
 const site=option('--site','https://shouldiworkthere.com').replace(/\/+$/,''),verifier=option('--verifier','https://verify.shouldiworkthere.com').replace(/\/+$/,'');
 const pinned=option('--release-key',null),statePath=option('--state',null);
 const state=statePath?(existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{format:'siwt-watch-state-v1',site,archives:{},releases:{}}):null;
 const localModuli=localModuliFrom(option('--local-registry','.wrangler/provision/local-issuer-public-keys.json'));
 // Alias hostnames are checked by default only for the default site; --aliases= (empty) skips them.
 const listed=option('--aliases',null),aliases=listed!==null?listed.split(',').map(a=>a.trim().replace(/\/+$/,'')).filter(Boolean):site==='https://shouldiworkthere.com'?DEFAULT_ALIASES:[];
 const results=await watch({site,verifier,pinnedKeys:pinned?[pinned]:pinnedFromCheckout(),archiveLimit:Number(option('--archives','12'))||12,checkRekor:args.includes('--check-rekor'),state,localModuli,aliases});
 if(statePath)writeFileSync(statePath,`${JSON.stringify(state,null,1)}\n`);
 const width=Math.max(...results.map(r=>r.check.length));
 for(const r of results) console.log(`${r.status.padEnd(4)}  ${r.check.padEnd(width)}  ${r.detail}`);
 const failed=results.filter(r=>r.status==='FAIL').length;
 console.log(`\n${failed?`${failed} check(s) FAILED`:'No check failed'} for ${site} and ${verifier}.`);
 process.exitCode=failed?1:0;
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) await main();
