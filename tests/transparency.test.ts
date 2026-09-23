import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {testEnv,TestD1,applyMigrations} from './d1.ts';
import {merkleRoot,testimonyLeaves,metricLeaves,issuerRegistry,archiveTransparency,publicCount,ARCHIVE_FORMAT,ARCHIVE_METHOD} from '../worker/src/ledger.ts';
import {WITHHELD_BODY} from '../worker/src/evidence.ts';
import {releaseManifestResponse} from '../worker/src/release.ts';
import {RELEASE_MANIFEST} from '../worker/generated/release-manifest.ts';
import {canonicalJson,policy,policyDocument} from '../shared/policy.ts';
import {digest,randomToken,quarter,suite,sealIssuerKey,issuerKeyFingerprint,issuerKeySetDigest,type IssuerKey} from '../shared/proof.ts';
import issuer,{type IssuerEnv} from '../worker/issuer.ts';

type Row=Record<string,unknown>;
type Check={check:string;status:'PASS'|'FAIL'|'WARN'|'SKIP';detail:string};
type WatchState={archives?:Record<string,string>;releases?:Record<string,{buildId:string;releasedOn:string}>};
const watcher=await import('../tools/verify-deployment.mjs' as string) as {injectionFindings:(html:string,setCookie:string|null)=>{what:string;setting:string}[];archiveModerationProblems:(a:Row)=>string[];merkleRoot:(l:string[])=>string;canonicalJson:(v:unknown)=>string;archiveDigest:(a:Row)=>string;keyFingerprint:(k:IssuerKey)=>string;manifestSignatureValid:(d:unknown)=>Promise<boolean>;watch:(o:{site:string;verifier:string;fetcher:typeof fetch;pinnedKeys?:string[];archiveLimit?:number;state?:WatchState|null;aliases?:string[]})=>Promise<Check[]>;BROWSER_HEADERS:Record<string,string>;nelFindings:(h:Headers)=>{headers:string[];hosts:string[]}|null;NEL_SETTING:string;DEFAULT_ALIASES:string[]};
const release=await import('../tools/transparency.mjs' as string) as {buildManifest:(i:Row)=>Promise<Row&{buildId:string}>;generateSigningKey:()=>Promise<{keyId:string;publicKey:string}>;signManifest:(m:Row,k:unknown)=>Promise<{manifest:Row;signature:{publicKey:string;keyId:string;value:string}}>;verifySignedManifest:(d:unknown)=>Promise<boolean>;rekorEntry:(d:unknown)=>{spec:{data:{content:string};signature:{content:string}}};rekorEntryVerifies:(e:unknown)=>boolean;manifestHashHex:(d:unknown)=>string;submitToRekor:(d:unknown,url:string,f:typeof fetch)=>Promise<Row>;generatedModule:(d:unknown)=>string;sourcePaths:(root:string)=>string[];staleSources:(s:Record<string,string>,b:Record<string,string>)=>string[];releaseRecordPath:(d:unknown)=>string;isSignedPath:(p:string)=>boolean};
const raw=(b64:string)=>Buffer.from(b64,'base64url');
const sha=(...parts:Buffer[])=>createHash('sha256').update(Buffer.concat(parts)).digest();

test('Merkle roots follow RFC 6962, and the worker and the independent watcher compute the same root',async()=>{
 const leaves=await Promise.all(['a','b','c'].map(x=>digest(x)));
 assert.equal(await merkleRoot([]),sha().toString('base64url'),'the empty tree is SHA-256 of nothing');
 assert.equal(await merkleRoot([leaves[0]!]),sha(Buffer.from([0]),raw(leaves[0]!)).toString('base64url'));
 const node=(l:Buffer,r:Buffer)=>sha(Buffer.from([1]),l,r),leaf=(x:string)=>sha(Buffer.from([0]),raw(x));
 assert.equal(await merkleRoot(leaves),node(node(leaf(leaves[0]!),leaf(leaves[1]!)),leaf(leaves[2]!)).toString('base64url'),'split at the largest power of two below n');
 for(let n=0;n<=17;n++) {
  const set=await Promise.all(Array.from({length:n},()=>digest(randomToken())));
  assert.equal(await merkleRoot(set),watcher.merkleRoot(set),`n=${n}`);
 }
 assert.notEqual(await merkleRoot(leaves),await merkleRoot([...leaves].reverse()),'order matters, so leaves are always sorted first');
});

test('account leaves commit to the body as served: withheld text is committed as its placeholder, withdrawn accounts are left out',async()=>{
 const {env,publicDb}=testEnv();
 const insert=(id:string,body:string,withdrawn:string|null=null)=>publicDb.prepare("INSERT INTO testimony(id,company_id,layer,body,period,verification_class,release_batch,published_at,withdrawn_at) VALUES(?,'co-northwind','experience',?,'2026-Q3','demo','q','2026-Q3',?)").bind(id,body,withdrawn).raw();
 insert('t_visible','A specific account of the reorganization and what changed for the team afterwards.');
 insert('t_withheld','Email me at jane.doe@example.com and I will tell you everything about my manager.');
 insert('t_gone','An account that was withdrawn by its author before this archive.','2026-Q3');
 const leaves=await testimonyLeaves(env);
 assert.deepEqual(leaves,[...leaves].sort());
 assert.ok(leaves.includes(await digest(`t_visible:${await digest('A specific account of the reorganization and what changed for the team afterwards.')}`)));
 assert.ok(leaves.includes(await digest(`t_withheld:${await digest(WITHHELD_BODY)}`)),'the placeholder that is served');
 assert.equal(leaves.includes(await digest(`t_withheld:${await digest('Email me at jane.doe@example.com and I will tell you everything about my manager.')}`)),false,'no fingerprint of hidden text');
 const total=(publicDb.db.prepare('SELECT COUNT(*) AS n FROM testimony WHERE withdrawn_at IS NULL').get() as {n:number}).n;
 assert.equal(leaves.length,total,'withdrawn accounts are not committed');
 const before=await merkleRoot(leaves);
 publicDb.prepare("UPDATE testimony SET body='An edited account.' WHERE id='t_visible'").raw();
 const edited=await merkleRoot(await testimonyLeaves(env));assert.notEqual(edited,before,'an in-place edit changes the root');
 publicDb.prepare("DELETE FROM testimony WHERE id='t_visible'").raw();assert.notEqual(await merkleRoot(await testimonyLeaves(env)),edited);
});

test('release leaves commit to each metric release as served: a distribution has a null value and its bands',async()=>{
 const {env,publicDb}=testEnv();
 const leaves=await metricLeaves(env);
 assert.equal(leaves.length,(publicDb.db.prepare('SELECT COUNT(*) AS n FROM metric_releases').get() as {n:number}).n);
 const r=publicDb.db.prepare("SELECT r.*,COALESCE(r.verification_method,d.verification_method) AS method FROM metric_releases r JOIN metric_definitions d ON d.id=r.metric_id WHERE r.id='r-043'").get() as Row;
 const bands=(publicDb.db.prepare("SELECT band,share FROM distribution_bands WHERE release_id='r-043' ORDER BY sort_order,band").all() as {band:string;share:number}[]).map(b=>[b.band,b.share]);
 assert.equal(bands.length>0,true);
 const expected=await digest(canonicalJson({id:'r-043',companyId:r.company_id,metricId:r.metric_id,cohortId:r.cohort_id,period:r.period,value:null,n:r.n,ciLow:r.ci_low,ciHigh:r.ci_high,eventId:r.event_id,releaseBatch:r.release_batch,verificationMethod:r.method,bands}));
 assert.ok(leaves.includes(expected));
 const before=await merkleRoot(leaves);publicDb.prepare("UPDATE distribution_bands SET share=share+1 WHERE release_id='r-043'").raw();
 assert.notEqual(await merkleRoot(await metricLeaves(env)),before,'changing a published band changes the root');
});

function fakeArchives() {
 const objects=new Map<string,string>();
 return {objects,bucket:{get:async(name:string)=>objects.has(name)?{json:async()=>JSON.parse(objects.get(name)!),body:objects.get(name)}:null,put:async(name:string,body:string)=>{if(objects.has(name))throw new Error('overwrite');objects.set(name,body);}}};
}
async function archiveOn(env:unknown,day:string) {
 mock.timers.enable({apis:['Date'],now:Date.parse(`${day}T12:00:00Z`)});
 try {await archiveTransparency(env as Parameters<typeof archiveTransparency>[0]);} finally {mock.timers.reset();}
}

test('v4 archives are recomputable by the independent watcher, chain to the previous archive, publish roots but no leaves, and carry the coarse moderation statistics and the public exception log',async()=>{
 const {env,publicDb}=testEnv();const {objects,bucket}=fakeArchives();(env as {ARCHIVES:unknown}).ARCHIVES=bucket;
 publicDb.prepare("INSERT INTO trusted_issuers(id,company_slug,epoch,expires_at,verification_class,public_key_json,purpose) VALUES('stripe:q:juror:mailbox','stripe','q','2099-01-01T00:00:00Z','mailbox','{\"kty\":\"RSA\",\"n\":\"n1\",\"e\":\"AQAB\"}','juror')").raw();
 await archiveOn(env,'2026-09-20');await archiveOn(env,'2026-09-21');
 const first=JSON.parse(objects.get('transparency-2026-09-20.json')!) as Row,second=JSON.parse(objects.get('transparency-2026-09-21.json')!) as Row;
 assert.equal(second.format,ARCHIVE_FORMAT);
 for(const a of [first,second])assert.equal(watcher.archiveDigest(a),a.digest,'the watcher recomputes the digest');
 assert.equal(second.previousDigest,first.digest);
 const rows=publicDb.db.prepare('SELECT id,payload_json,digest,previous_digest FROM release_manifests ORDER BY id').all() as Row[];
 assert.deepEqual(rows.map(r=>[r.digest,r.previous_digest]),[[first.digest,null],[second.digest,first.digest]]);
 const {digest:_d,...data}=second;assert.equal(rows[1]!.payload_json,canonicalJson(data));
 const accounts=await testimonyLeaves(env),releases=await metricLeaves(env);
 assert.deepEqual(second.publishedAccounts,{merkleRoot:await merkleRoot(accounts),count:publicCount(accounts.length)});
 assert.deepEqual(second.metricReleases,{merkleRoot:await merkleRoot(releases),count:publicCount(releases.length)});
 const text=objects.get('transparency-2026-09-21.json')!;
 assert.equal([...accounts,...releases].some(l=>text.includes(l)),false,'no per-account or per-release leaf is archived');
 const registry=await issuerRegistry(env);
 assert.equal(second.issuerKeysDigest,await issuerKeySetDigest(registry.keys));
 assert.equal(second.issuerKeysDigest,createHash('sha256').update(JSON.stringify((second.issuerKeys as {fingerprint:string}[]).map(k=>k.fingerprint).sort())).digest('base64url'),'the digest is recomputable from the listed fingerprints');
 assert.ok((second.issuerKeys as {id:string}[]).some(k=>k.id==='stripe:q:juror:mailbox'));
 assert.equal(second.releaseManifestDigest,RELEASE_MANIFEST?await digest(RELEASE_MANIFEST):null);
 assert.notEqual(watcher.archiveDigest({...second,stats:{}}),second.digest,'any edit to an archive is detected');
 assert.equal(ARCHIVE_FORMAT,'shouldiworkthere-transparency-v4');
 const moderation=second.moderation as {period:string;counts:Row;heldByReason:Row;juryOutcomes:Row};
 assert.equal(moderation.period,quarter());
 const rounded=new Set(['submitted','publishedAutomatically','repairs','jury']);
 assert.ok(Object.entries(moderation.counts).every(([k,v])=>rounded.has(k)?v==='<25'||(typeof v==='number'&&v%25===0):v==='<5'||(typeof v==='number'&&v>=5)),'every archived count is coarse: contribution-derived ones rounded like contribution counts');
 assert.ok([...Object.values(moderation.heldByReason),...Object.values(moderation.juryOutcomes)].every(v=>v==='<25'||(typeof v==='number'&&v%25===0)));
 assert.deepEqual(second.exceptions,[]);assert.deepEqual(watcher.archiveModerationProblems(second),[]);
 for(const field of ['moderation','exceptions','"<5"','"<25"']) assert.ok(ARCHIVE_METHOD.includes(field),field);
 assert.doesNotMatch(ARCHIVE_METHOD,/ever published/,'a key deleted after a compromise is omitted from later archives (RT-COPY-09)');
 assert.match(ARCHIVE_METHOD,/in the public registry when this archive was written/);
 assert.match(String(second.limits),/computed at most once per UTC day/);
});

test('the watcher flags archived moderation data that is not coarse, and exception entries that carry more than the public log',()=>{
 const ok={moderation:{period:'2026-Q3',counts:{submitted:'<25',jury:50,rejected:12,appeals:'<5'},heldByReason:{jury:'<25',exception:0},juryOutcomes:{upheld:25}},exceptions:[{id:'exc_1',period:'2026-Q3',kind:'legal_order',scope:'withhold_account',targetDigest:'A'.repeat(43),expiresOn:'2026-10-01',signers:['t0','t1'],actionDigest:'d',policyVersion:'0.5.0',policyDigest:'p'}]};
 assert.deepEqual(watcher.archiveModerationProblems(ok),[]);
 assert.match(watcher.archiveModerationProblems({...ok,moderation:{...ok.moderation,counts:{submitted:3}}}).join(),/submitted=3 is not coarse/);
 // Contribution-derived counts must be rounded like contribution counts (RT-DIFF-03): an exact 7, or '<5', is refused.
 assert.match(watcher.archiveModerationProblems({...ok,moderation:{...ok.moderation,counts:{submitted:7}}}).join(),/submitted=7 is not coarse/);
 assert.match(watcher.archiveModerationProblems({...ok,moderation:{...ok.moderation,counts:{jury:'<5'}}}).join(),/jury="<5" is not coarse/);
 assert.match(watcher.archiveModerationProblems({...ok,moderation:{...ok.moderation,heldByReason:{jury:26}}}).join(),/jury=26 is not coarse/);
 assert.match(watcher.archiveModerationProblems({...ok,moderation:{...ok.moderation,counts:{rejected:'<25'}}}).join(),/rejected="<25" is not coarse/);
 assert.match(watcher.archiveModerationProblems({...ok,exceptions:[{...ok.exceptions[0],body:'the account text'}]}).join(),/unexpected fields: body/);
 assert.match(watcher.archiveModerationProblems({...ok,exceptions:[{...ok.exceptions[0],targetDigest:'t_account1'}]}).join(),/by digest/);
});

test('the watcher names each Cloudflare feature that injects a script or a cookie, and the zone setting to switch off',()=>{
 assert.deepEqual(watcher.injectionFindings('<html><body><p>ok</p><script src="/app.js"></script></body></html>',null),[]);
 const cases:[string,string|null,RegExp][]=[
  ['<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="ab">[email&#160;protected]</a><script src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>',null,/Email Address Obfuscation/],
  ['<script src="/cdn-cgi/scripts/7d0fa10a/cloudflare-static/rocket-loader.min.js" data-cf-settings="x" defer></script>',null,/Rocket Loader/],
  ['<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon=\'{"token":"t"}\'></script>',null,/Web Analytics/],
  ['<script src="/cdn-cgi/zaraz/s.js?z=1"></script>',null,/Zaraz/],
  ['<script src="/cdn-cgi/challenge-platform/h/b/scripts/jsd/main.js"></script>',null,/JavaScript detections/],
  ['<p>ok</p>','__cf_bm=abc; path=/; HttpOnly',/cookie __cf_bm/],
  ['<p>ok</p>','cf_clearance=xyz; path=/',/cookie cf_clearance/],
  ['<p>ok</p>','session=1; path=/',/a cookie/],
 ];
 for(const [html,cookie,expected] of cases) assert.match(JSON.stringify(watcher.injectionFindings(html,cookie)),expected);
});

test('the worker and the watcher agree on issuer key fingerprints, and purpose is part of the fingerprint',async()=>{
 const keys:IssuerKey[]=[{id:'stripe:2026-Q3:mailbox',companySlug:'stripe',epoch:'2026-Q3',expiresAt:'2027-01-01T00:00:00.000Z',verificationClass:'mailbox',publicKey:{kty:'RSA',n:'abc',e:'AQAB'}},{id:'stripe:2026-Q3:juror:mailbox',companySlug:'stripe',epoch:'2026-Q3',expiresAt:'2027-01-01T00:00:00.000Z',verificationClass:'mailbox',purpose:'juror',publicKey:{kty:'RSA',n:'abc',e:'AQAB'}}];
 for(const k of keys)assert.equal(watcher.keyFingerprint(k),await issuerKeyFingerprint(k));
 assert.notEqual(await issuerKeyFingerprint(keys[0]!),await issuerKeyFingerprint(keys[1]!));
 assert.notEqual(await issuerKeyFingerprint(keys[1]!),await issuerKeyFingerprint({...keys[1]!,purpose:'contribution'}));
});

const policyDigest=async()=>(await policyDocument(policy.version))!.digest;
async function signedRelease(keys:IssuerKey[],overrides:Row={}) {
 const signer=await release.generateSigningKey();
 const manifest=await release.buildManifest({buildId:'b0001',releasedOn:'2026-09-22',client:{appJs:'console.log(1)',appCss:'fonts\nbody{}',js:'console.log(1)',css:'body{}',fonts:'fonts'},sources:{'worker/issuer.ts':'issuer source','shared/proof.ts':'proof source','wrangler.jsonc':'{}'},issuerKeys:keys,policyVersion:policy.version,policyDigest:await policyDigest(),legal:{version:'1.0.0',effective:'2026-09-22'},...overrides});
 return {signer,document:await release.signManifest(manifest,signer)};
}

test('a signed release manifest verifies with both implementations, and any change or a swapped key fails',async()=>{
 const {signer,document}=await signedRelease([]);
 assert.equal(await release.verifySignedManifest(document),true);assert.equal(await watcher.manifestSignatureValid(document),true);
 const edited={...document,manifest:{...document.manifest,buildId:'b0002'}};
 assert.equal(await release.verifySignedManifest(edited),false);assert.equal(await watcher.manifestSignatureValid(edited),false);
 const other=await release.generateSigningKey();
 for(const signature of [{...document.signature,publicKey:other.publicKey},{...document.signature,publicKey:other.publicKey,keyId:other.keyId}]) {
  assert.equal(await release.verifySignedManifest({...document,signature}),false);assert.equal(await watcher.manifestSignatureValid({...document,signature}),false);
 }
 assert.equal(document.signature.keyId,signer.keyId);
 const moduleText=release.generatedModule(document);
 assert.deepEqual(JSON.parse(JSON.parse(/= (".*");\n$/.exec(moduleText)![1]!)),document,'the generated module embeds the exact signed document');
 assert.match(moduleText,/export const RELEASE_MANIFEST: string \| null = /);
});

test('the manifest refuses a key whose purpose disagrees with its id and signs every key with its purpose',async()=>{
 const key:IssuerKey={id:'stripe:q:juror:mailbox',companySlug:'stripe',epoch:'q',expiresAt:'2099-01-01T00:00:00Z',verificationClass:'mailbox',purpose:'juror',publicKey:{kty:'RSA',n:'n',e:'AQAB'}};
 await assert.rejects(release.buildManifest({buildId:'b',releasedOn:'d',client:{appJs:'',appCss:'',js:'',css:'',fonts:''},sources:{},issuerKeys:[{...key,purpose:'contribution'}],policyVersion:'v',policyDigest:'d',legal:{}}),/disagrees/);
 const {document}=await signedRelease([key]);
 assert.deepEqual(document.manifest.issuerKeys,[{id:key.id,purpose:'juror',fingerprint:await issuerKeyFingerprint(key)}]);
});

test('the optional Rekor entry verifies locally before submission, records the manifest hash, and a refusal is reported',async()=>{
 const {document}=await signedRelease([]);
 const entry=release.rekorEntry(document);
 assert.equal(release.rekorEntryVerifies(entry),true);
 assert.equal(createHash('sha256').update(Buffer.from(entry.spec.data.content,'base64')).digest('hex'),release.manifestHashHex(document));
 const forged=structuredClone(entry);forged.spec.data.content=Buffer.from('{"format":"forged"}').toString('base64');assert.equal(release.rekorEntryVerifies(forged),false);
 const sent:Row[]=[];
 const ok=await release.submitToRekor(document,'https://rekor.test/',(async(url:string,init:RequestInit)=>{sent.push({url,body:JSON.parse(String(init.body))});return Response.json({'uuid-1':{logIndex:7,integratedTime:1,body:'x'}},{status:201});}) as unknown as typeof fetch);
 assert.deepEqual([sent[0]!.url,(sent[0]!.body as Row).kind,ok.uuid,ok.logIndex,ok.manifestSha256],['https://rekor.test/api/v1/log/entries','rekord','uuid-1',7,release.manifestHashHex(document)]);
 await assert.rejects(release.submitToRekor(document,'https://rekor.test',(async()=>Response.json({message:'unsupported'},{status:400})) as unknown as typeof fetch),/refused/);
});

test('the signed source list covers the workers, shared code, migrations, Wrangler configs and the lockfile, and never secrets or generated files',()=>{
 const paths=release.sourcePaths(process.cwd());
 for(const required of ['worker/issuer.ts','worker/inference.ts','worker/src/ledger.ts','worker/src/release.ts','shared/proof.ts','db/verifier-migrations/0002_juror_tokens_and_issuance_controls.sql','db/migrations/0006_juror_keys.sql','issuer.wrangler.jsonc','wrangler.jsonc','package.json','bun.lock'])assert.ok(paths.includes(required),required);
 assert.equal(paths.some(p=>/generated|\.dev\.vars|secrets|signing-key|\.env/.test(p)),false);
 assert.ok(paths.every(release.isSignedPath));
});

test('a release refuses a stale build listing: a signed source changed, added or removed since the build is flagged',()=>{
 const built={'worker/src/a.ts':'a','shared/b.ts':'b','db/migrations/0001_x.sql':'x','docs/notes.md':'n','db/issuer-public-keys.json':'[]','package.json':'{}'};
 const current={'worker/src/a.ts':'a','shared/b.ts':'b','db/migrations/0001_x.sql':'x','package.json':'{}','wrangler.jsonc':'{}','bun.lock':'lock'};
 assert.deepEqual(release.staleSources(current,built),[],'files the build never serves (configs, lockfile) are not stale');
 assert.deepEqual(release.staleSources({...current,'worker/src/a.ts':'A'},built),['worker/src/a.ts'],'changed');
 assert.deepEqual(release.staleSources({...current,'worker/src/new.ts':'n','db/migrations/0002_y.sql':'y'},built),['db/migrations/0002_y.sql','worker/src/new.ts'],'added in a directory the build lists');
 const {'shared/b.ts':_removed,...without}=current;
 assert.deepEqual(release.staleSources(without,built),['shared/b.ts'],'removed but still listed by the build');
});

test('release records are append-only: two releases of the same client build get different records',async()=>{
 const key:IssuerKey={id:'stripe:q:juror:mailbox',companySlug:'stripe',epoch:'q',expiresAt:'2099-01-01T00:00:00Z',verificationClass:'mailbox',purpose:'juror',publicKey:{kty:'RSA',n:'n',e:'AQAB'}};
 const first=(await signedRelease([])).document,second=(await signedRelease([key])).document;
 assert.equal(first.manifest.buildId,second.manifest.buildId,'a quarterly key re-release keeps the client build id');
 assert.match(release.releaseRecordPath(first),/^docs\/releases\/2026-09-22-[0-9a-f]{16}\.json$/);
 assert.notEqual(release.releaseRecordPath(first),release.releaseRecordPath(second));
 assert.equal(release.releaseRecordPath(first),`docs/releases/2026-09-22-${release.manifestHashHex(first).slice(0,16)}.json`);
 const source=readFileSync('tools/transparency.mjs','utf8');
 assert.match(source,/writeFileSync\(record,recordText\(document\),\{flag:'wx'\}\)/,'the record is created exclusively, never overwritten');
});

test('a dry run never creates a release key, even with --init-key, and writes no release',{skip:!existsSync('worker/generated/client-assets.ts')},()=>{
 const dir=mkdtempSync(join(tmpdir(),'siwt-release-'));
 try {
  writeFileSync(join(dir,'registry.json'),'[]');
  const keyPath=join(dir,'release-key.json');
  const r=spawnSync(process.execPath,['tools/transparency.mjs','--dry-run','--init-key',`--key=${keyPath}`,`--registry=${join(dir,'registry.json')}`],{encoding:'utf8',timeout:120000});
  assert.equal(r.status,0,r.stderr);
  assert.equal(existsSync(keyPath),false,'no key file');
  assert.match(r.stdout,/throwaway in-memory key/);assert.match(r.stdout,/Dry run \(no release written\)/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('the archive method states every field and encoding an outsider needs to recompute its roots',()=>{
 for(const field of ['id','companyId','metricId','cohortId','period','value','n','ciLow','ciHigh','eventId','releaseBatch','verificationMethod','bands','"<public id>:<SHA-256 of the body exactly as served>"','siwt-issuer-key-v1:','[id, companySlug, epoch, expiresAt, verificationClass, purpose, kty, n, e]','0x00','0x01','base64url','null for distributions'])assert.ok(ARCHIVE_METHOD.includes(field),field);
});
test('a community key\'s archived fingerprint can be recomputed from the archive method alone',async()=>{
 // The method says a community key's array gets the string "community" as a tenth element; recompute exactly that.
 assert.match(ARCHIVE_METHOD,/with the string "community" appended as a tenth element for a community key/);
 const pair=await suite().generateKey({modulusLength:2048,publicExponent:new Uint8Array([1,0,1])}),jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
 const community:IssuerKey={id:'acme-widgets:2026-Q3:juror:community',companySlug:'acme-widgets',epoch:'2026-Q3',expiresAt:'2027-01-01T00:00:00.000Z',verificationClass:'mailbox',purpose:'juror',source:'community',publicKey:jwk};
 const byMethod=(key:IssuerKey,extra:string[])=>createHash('sha256').update(`siwt-issuer-key-v1:${JSON.stringify([key.id,key.companySlug,key.epoch,key.expiresAt,key.verificationClass,key.purpose??'contribution',key.publicKey.kty,key.publicKey.n,key.publicKey.e,...extra])}`).digest('base64url');
 assert.equal(await issuerKeyFingerprint(community),byMethod(community,['community']));
 const curated:IssuerKey={...community,id:'acme-widgets:2026-Q3:juror:mailbox'};delete (curated as {source?:unknown}).source;
 assert.equal(await issuerKeyFingerprint(curated),byMethod(curated,[]),'a curated key has the nine elements');
 // The archive writer names the community key with that fingerprint.
 const {env,publicDb}=testEnv();
 publicDb.prepare("INSERT INTO trusted_issuers(id,company_slug,epoch,expires_at,verification_class,public_key_json,purpose,source) VALUES(?,?,?,?,'mailbox',?,'juror','community')").bind(community.id,community.companySlug,community.epoch,community.expiresAt,JSON.stringify(jwk)).raw();
 const entry=(await issuerRegistry(env)).entries.find(e=>e.id===community.id);
 assert.equal(entry?.fingerprint,byMethod(community,['community']));
});

test('releaseManifestResponse serves the embedded signed manifest verbatim, or 404 no_release_manifest when none is signed',async()=>{
 const response=releaseManifestResponse();
 if(RELEASE_MANIFEST===null) {assert.equal(response.status,404);assert.deepEqual(await response.json(),{error:'no_release_manifest'});}
 else {assert.equal(response.status,200);assert.equal(await response.text(),RELEASE_MANIFEST);assert.equal(await watcher.manifestSignatureValid(JSON.parse(RELEASE_MANIFEST)),true);}
});

// A complete deployment built from the real verifier worker, the real archive writer and the real policy documents.
async function deployment() {
 const {env,publicDb}=testEnv();const {objects,bucket}=fakeArchives();(env as {ARCHIVES:unknown}).ARCHIVES=bucket;
 const vdb=new TestD1();applyMigrations(vdb,'db/verifier-migrations');
 const venv={VERIFIER:vdb,ISSUER_MASTER_KEY:randomToken(32),MAILBOX_PEPPER:'p',ALLOWED_ORIGIN:'https://site.test',EMAIL_FROM:'v@site.test',EMAIL_ENABLED:'false'} as unknown as IssuerEnv;
 const keys:IssuerKey[]=[];
 for(const [id,purpose] of [['stripe:q:mailbox','contribution'],['stripe:q:juror:mailbox','juror']] as const) {
  const pair=await suite().generateKey({modulusLength:2048,publicExponent:new Uint8Array([1,0,1])});
  const key:IssuerKey={id,companySlug:'stripe',epoch:quarter(),expiresAt:'2099-01-01T00:00:00.000Z',verificationClass:'mailbox',purpose,publicKey:await crypto.subtle.exportKey('jwk',pair.publicKey)};keys.push(key);
  vdb.prepare('INSERT INTO issuer_keys(id,company_slug,epoch,expires_at,verification_class,domains_json,public_key_json,sealed_private_key,purpose) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,'stripe',key.epoch,key.expiresAt,'mailbox','["stripe.com"]',JSON.stringify(key.publicKey),await sealIssuerKey(venv.ISSUER_MASTER_KEY,id,await crypto.subtle.exportKey('jwk',pair.privateKey)),purpose).raw();
  publicDb.prepare('INSERT INTO trusted_issuers(id,company_slug,epoch,expires_at,verification_class,public_key_json,purpose) VALUES(?,?,?,?,?,?,?)').bind(id,'stripe',key.epoch,key.expiresAt,'mailbox',JSON.stringify(key.publicKey),purpose).raw();
 }
 await archiveOn(env,'2026-09-20');await archiveOn(env,'2026-09-21');
 // The served client pins every live key's fingerprint, as tools/build.mjs embeds them.
 const appJs=`var pins=${JSON.stringify((await Promise.all(keys.map(issuerKeyFingerprint))).sort())};`;
 const {signer,document}=await signedRelease(keys,{client:{appJs,appCss:'fonts\nbody{}',js:appJs,css:'body{}',fonts:'fonts'}});
 // The home page, a legal page and /api/config come from the real main worker, so the injection check covers what it emits.
 const main=(await import('../worker/src/index.ts')).default;(env as {RATE_LIMIT_SECRET?:string}).RATE_LIMIT_SECRET='watch-test-secret';
 // A production deployment hides the fictional employers (owner decision 1).
 (env as {SAMPLE_EMPLOYERS?:string}).SAMPLE_EMPLOYERS='off';
 const page=(path:string)=>(init?:RequestInit)=>main.fetch(new Request(`https://site.test${path}`,{headers:init?.headers}),env);
 const site:Record<string,(init?:RequestInit)=>Response|Promise<Response>>={
  '/':page('/'),'/privacy':page('/privacy'),'/api/config':page('/api/config'),'/api/directory':page('/api/directory'),
  '/.well-known/siwt-release.json':()=>new Response(JSON.stringify(document)),
  '/app.js':()=>new Response(appJs),'/app.css':()=>new Response('fonts\nbody{}'),
  '/api/source':()=>Response.json({files:{'worker/issuer.ts':'issuer source','shared/proof.ts':'proof source'}}),
  '/api/proof/keys':()=>Response.json({keys:(publicDb.db.prepare('SELECT * FROM trusted_issuers WHERE expires_at>?').all(new Date().toISOString()) as Row[]).map(r=>({id:r.id,companySlug:r.company_slug,epoch:r.epoch,expiresAt:r.expires_at,verificationClass:r.verification_class,purpose:r.purpose,publicKey:JSON.parse(r.public_key_json as string)}))}),
  '/moderation/current.json':()=>new Response(null,{status:302,headers:{location:`/moderation/v${policy.version}.json`}}),
  [`/moderation/v${policy.version}.json`]:async()=>{const d=(await policyDocument(policy.version))!;return new Response(canonicalJson(d.policy),{headers:{'x-policy-digest':d.digest}});},
  '/api/transparency':()=>Response.json({archives:(publicDb.db.prepare('SELECT id,digest,previous_digest FROM release_manifests ORDER BY created_at DESC').all() as Row[]).map(r=>({...r,...relisted.get(r.id as string)}))}),
 };
 const overrides:Record<string,(init?:RequestInit)=>Response|Promise<Response>>={},relisted=new Map<string,{digest:string;previous_digest:string|null}>();
 // Alias hostnames answer as tools/redirect-worker does (a 301 to the same path on the site), unless a test overrides one.
 const alias=(input:string)=>{const url=new URL(input);return new Response(null,{status:301,headers:{location:`https://site.test${url.pathname}${url.search}`}});};
 const fetcher=(async(input:string,init?:RequestInit)=>{
  const url=new URL(input);
  const hostOverride=overrides[`host:${url.host}`];if(hostOverride)return hostOverride(init);
  if(url.host==='www.site.test'||url.host==='kernel.site.test')return alias(input);
  // Plain HTTP reaches the real workers, which must redirect it themselves.
  if(url.protocol==='http:'&&!overrides[`http:${url.host}`])return url.host==='verify.test'?issuer.fetch(new Request(input,init),venv):main.fetch(new Request(input,init),env);
  if(url.protocol==='http:')return overrides[`http:${url.host}`]!(init);
  if(url.origin==='https://verify.test')return overrides[`verifier${url.pathname}`]?.(init)??issuer.fetch(new Request(input),venv);
  const handler=overrides[url.pathname]??site[url.pathname];if(handler)return handler(init);
  const archive=/^\/archives\/(transparency-\d{4}-\d{2}-\d{2})\.json$/.exec(url.pathname)?.[1];
  return archive&&objects.has(`${archive}.json`)?new Response(objects.get(`${archive}.json`)):Response.json({error:'not_found'},{status:404});
 }) as unknown as typeof fetch;
 const run=(pinned=[signer.publicKey],extra:{archiveLimit?:number;state?:WatchState|null;localModuli?:string[];aliases?:string[]}={})=>watcher.watch({site:'https://site.test',verifier:'https://verify.test',fetcher,pinnedKeys:pinned,...extra});
 /** Rewrites one archive the way a dishonest operator would: recomputed digest, and the listing updated to match. */
 // The public table is append-only, so the rewritten listing is served as an override (an operator could drop the trigger).
 const rewrite=(day:string,change:(archive:Row)=>void)=>{
  const id=`transparency-${day}`,archive=JSON.parse(objects.get(`${id}.json`)!) as Row;change(archive);
  const digest=watcher.archiveDigest(archive);objects.set(`${id}.json`,JSON.stringify({...archive,digest}));
  relisted.set(id,{digest,previous_digest:(archive.previousDigest as string|null)??null});
  return digest;
 };
 const saved=new Map(objects),restore=()=>{for(const [k,v] of saved)objects.set(k,v);relisted.clear();};
 return {run,rewrite,restore,overrides,objects,document,keys,vdb,publicDb,appJs,env,venv};
}
const statusOf=(results:Check[],check:string)=>results.find(r=>r.check===check)?.status;

test('the deployment watcher passes a consistent deployment',async()=>{
 const {run}=await deployment();const results=await run(undefined,{aliases:['https://www.site.test','https://kernel.site.test']});
 assert.deepEqual(results.filter(r=>r.status==='FAIL'),[]);
 for(const check of ['release signature','release signer','client /app.js','client /app.css','source listing','issuer keys agree','issuer key purposes and limits','issuer keys signed','issuer keys pinned','moderation policy','archive digests','archive chain','archive moderation','archive key registry','no injected scripts or cookies','challenges open','verifier stats coarse','no Network Error Logging','plain HTTP redirects (site)','plain HTTP redirects (verifier)','alias www.site.test','alias kernel.site.test'])assert.equal(statusOf(results,check),'PASS',check);
 assert.equal(statusOf(results,'rekor entry'),'SKIP');
 // The real workers redirect plain HTTP themselves (the harness sends http:// straight to them).
 assert.match(results.find(r=>r.check==='plain HTTP redirects (site)')!.detail,/^http:\/\/site\.test\/privacy\?watch=1 → 301 https:\/\/site\.test\/privacy\?watch=1$/);
 assert.match(results.find(r=>r.check==='plain HTTP redirects (verifier)')!.detail,/→ 301 https:\/\/verify\.test\/keys\?watch=1$/);
 assert.equal(statusOf(await run(),'alias hostnames'),'SKIP','without --aliases nothing is claimed about them');
});

test('the watcher fails a production verifier that serves any sandbox key while the site hides the fictional employers',async()=>{
 const d=await deployment();
 const consistent=(await d.run()).find(r=>r.check==='sandbox keys retired')!;
 assert.equal(consistent.status,'PASS');assert.match(consistent.detail,/neither the site nor the verifier serves a sandbox key/);
 // The real verifier, with its SAMPLE_EMPLOYERS 'on' and a fictional employer's sandbox key still in its database.
 const sandbox=await suite().generateKey({modulusLength:2048,publicExponent:new Uint8Array([1,0,1])});
 const demoId='northwind-labs:2026-Q3:sandbox';
 d.vdb.prepare('INSERT INTO issuer_keys(id,company_slug,epoch,expires_at,verification_class,domains_json,public_key_json,sealed_private_key,purpose) VALUES(?,?,?,?,?,?,?,?,?)').bind(demoId,'northwind-labs',quarter(),'2099-01-01T00:00:00.000Z','demo','[]',JSON.stringify(await crypto.subtle.exportKey('jwk',sandbox.publicKey)),await sealIssuerKey(d.venv.ISSUER_MASTER_KEY,demoId,await crypto.subtle.exportKey('jwk',sandbox.privateKey)),'contribution').raw();
 assert.equal(statusOf(await d.run(),'sandbox keys retired'),'PASS','hidden by the verifier (SAMPLE_EMPLOYERS not on), the row itself is not visible');
 (d.venv as {SAMPLE_EMPLOYERS?:string}).SAMPLE_EMPLOYERS='on';
 const results=await d.run(),served=results.find(r=>r.check==='sandbox keys retired')!;
 assert.equal(served.status,'FAIL','a served sandbox key is a failure, not a warning');
 assert.match(served.detail,/the verifier serves 1 sandbox key\(s\) of fictional employers \(northwind-labs:2026-Q3:sandbox\) although the site hides those employers: deploy the verifier with SAMPLE_EMPLOYERS 'off' \(issuer\.wrangler\.jsonc\), then delete its sandbox key rows with node tools\/purge-samples\.mjs --remote/);
 assert.equal(statusOf(results,'issuer keys agree'),'PASS','the curated keys still agree; the sandbox key is reported on its own');
 assert.doesNotMatch(served.detail,/next provisioning/);
 // A site that shows the fictional employers (a local stack) expects them.
 d.overrides['/api/config']=()=>Response.json({sampleEmployers:true});
 assert.equal(statusOf(await d.run(),'sandbox keys retired'),'SKIP');
 delete d.overrides['/api/config'];
 // The watcher's wording about copying community keys matches the main worker: when a listing is added, and every 6 hours.
 const source=readFileSync('tools/verify-deployment.mjs','utf8');
 assert.doesNotMatch(source,/at registration|when a credential names|next provisioning/);
 assert.match(source,/copies them when a listing is added and on its 6-hourly job/);
});

test('the watcher requests pages as a browser, so it sees the Web Analytics beacon Cloudflare injects only for browsers (the earlier plain fetch passed falsely)',async()=>{
 const d=await deployment();const seen:Record<string,string>[]=[];
 // Cloudflare injects the beacon into HTML served to a browser user agent only, as observed in production (2026-09-23).
 const zone=(init?:RequestInit)=>{
  const headers=Object.fromEntries(new Headers(init?.headers).entries());seen.push(headers);
  const browser=/Chrome\//.test(headers['user-agent']??'')&&/text\/html/.test(headers.accept??'');
  return new Response(`<!doctype html><html><body><div id="app-root"></div>${browser?'<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/v31" data-cf-beacon=\'{"token":"t"}\'></script>':''}</body></html>`,{headers:{'content-type':'text/html'}});
 };
 d.overrides['/']=zone;
 const check=(await d.run()).find(r=>r.check==='no injected scripts or cookies')!;
 assert.equal(check.status,'FAIL');assert.match(check.detail,/\/: Web Analytics beacon \(switch off: Web Analytics \(automatic setup \/ RUM\)\)/);assert.match(check.detail,/fetched as a browser/);
 assert.ok(seen.length>0&&seen.every(h=>h['user-agent']===watcher.BROWSER_HEADERS['user-agent']&&/^text\/html/.test(h.accept??'')),'pages are fetched with a Chrome user agent and Accept: text/html');
 assert.match(watcher.BROWSER_HEADERS['user-agent']!,/Chrome\/\d+/);
});

test('the watcher warns about Network Error Logging headers and names the zone setting that turns them off',async()=>{
 const d=await deployment();
 const nel={'report-to':'{"group":"cf-nel","max_age":604800,"endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4?s=abc"}]}',nel:'{"success_fraction":0.0,"report_to":"cf-nel","max_age":604800}'};
 const plain=async(response:Response|Promise<Response>)=>{const r=await response;const h=new Headers(r.headers);for(const [k,v] of Object.entries(nel))h.set(k,v);return new Response(await r.text(),{status:r.status,headers:h});};
 d.overrides['/']=()=>plain(new Response('<p>ok</p>',{headers:{'content-type':'text/html'}}));
 d.overrides['verifier/stats']=async()=>plain(Response.json({epoch:quarter(),employers:[]}));
 const warned=(await d.run()).find(r=>r.check==='no Network Error Logging')!;
 assert.equal(warned.status,'WARN','a WARN, not a FAIL: nothing is sent unless a load fails, but the privacy policy must not be contradicted');
 assert.match(warned.detail,/\/: nel, report-to/);assert.match(warned.detail,/verifier \/stats: nel, report-to/);assert.match(warned.detail,/a\.nel\.cloudflare\.com/);
 assert.ok(warned.detail.includes(watcher.NEL_SETTING));assert.match(watcher.NEL_SETTING,/zone setting nel/);
 assert.deepEqual(watcher.nelFindings(new Headers(nel)),{headers:['nel','report-to'],hosts:['a.nel.cloudflare.com']});
 assert.equal(watcher.nelFindings(new Headers({'content-type':'text/html'})),null);
 // The workers themselves set neither header: an unmodified deployment passes.
 delete d.overrides['/'];delete d.overrides['verifier/stats'];
 assert.equal(statusOf(await d.run(),'no Network Error Logging'),'PASS');
});

test('the watcher fails a site or verifier that serves plain HTTP, and alias hostnames that do not redirect to the site',async()=>{
 const d=await deployment();
 const aliases=['https://www.site.test','https://kernel.site.test'];
 // Plain HTTP answered with the page (production before this release: HTTP/1.1 200 over plaintext).
 d.overrides['http:site.test']=()=>new Response('<p>page</p>',{status:200});
 d.overrides['http:verify.test']=()=>new Response(null,{status:302,headers:{location:'https://verify.test/keys?watch=1'}});
 let results=await d.run(undefined,{aliases});
 assert.equal(statusOf(results,'plain HTTP redirects (site)'),'FAIL');assert.match(results.find(r=>r.check==='plain HTTP redirects (site)')!.detail,/answered 200[^]*Always Use HTTPS/);
 assert.equal(statusOf(results,'plain HTTP redirects (verifier)'),'FAIL','a temporary redirect is not enough');
 d.overrides['http:site.test']=()=>new Response(null,{status:301,headers:{location:'https://site.test/'}});
 assert.equal(statusOf(await d.run(),'plain HTTP redirects (site)'),'FAIL','the path and query must be kept');
 delete d.overrides['http:site.test'];delete d.overrides['http:verify.test'];
 // www with no DNS record (production: NXDOMAIN), and kernel answering the page itself instead of redirecting.
 d.overrides['host:www.site.test']=()=>{throw Object.assign(new TypeError('fetch failed'),{cause:{code:'ENOTFOUND'}});};
 d.overrides['host:kernel.site.test']=()=>new Response('<p>kernel</p>');
 results=await d.run(undefined,{aliases});
 const www=results.find(r=>r.check==='alias www.site.test')!,kernel=results.find(r=>r.check==='alias kernel.site.test')!;
 assert.equal(www.status,'FAIL');assert.match(www.detail,/unreachable \(ENOTFOUND\): there is no DNS record or custom domain for www\.site\.test[^]*tools\/redirect-worker/);
 assert.equal(kernel.status,'FAIL');assert.match(kernel.detail,/answered 200/);
 d.overrides['host:kernel.site.test']=()=>new Response(null,{status:301,headers:{location:'https://elsewhere.test/privacy?watch=1'}});
 assert.equal(statusOf(await d.run(undefined,{aliases}),'alias kernel.site.test'),'FAIL','a redirect to another site fails');
 // A local stack is plain HTTP by design: nothing to redirect.
 assert.equal(statusOf(await watcher.watch({site:'http://localhost:8788',verifier:'http://localhost:8790',fetcher:(async()=>{throw new Error('offline');}) as unknown as typeof fetch}),'plain HTTP redirects (site)'),'SKIP');
 assert.deepEqual(watcher.DEFAULT_ALIASES,['https://www.shouldiworkthere.com','https://kernel.shouldiworkthere.com']);
});

test('the deployment watcher fails each kind of tampering: assets, sources, tagging keys, unsigned keys, policy, archives, signer and verifier stats',async()=>{
 const d=await deployment();
 const expectFail=async(check:string,tamper:()=>void,undo:()=>void)=>{tamper();try {assert.equal(statusOf(await d.run(),check),'FAIL',check);} finally {undo();}};
 const clear=(...paths:string[])=>()=>{for(const p of paths)delete d.overrides[p];};
 await expectFail('client /app.js',()=>{d.overrides['/app.js']=()=>new Response('console.log(2)');},clear('/app.js'));
 await expectFail('source listing',()=>{d.overrides['/api/source']=()=>Response.json({files:{'worker/issuer.ts':'patched issuer source'}});},clear('/api/source'));
 await expectFail('moderation policy',()=>{d.overrides[`/moderation/v${policy.version}.json`]=()=>new Response('{"rules":[]}');},clear(`/moderation/v${policy.version}.json`));
 const tagged=async()=>{const listed=await (await issuer.fetch(new Request('https://verify.test/keys'),{VERIFIER:d.vdb,EMAIL_ENABLED:'false'} as unknown as IssuerEnv)).json() as {keys:IssuerKey[]};listed.keys[0]!.publicKey={...listed.keys[0]!.publicKey,n:'AAAA'};return Response.json(listed);};
 await expectFail('issuer keys agree',()=>{d.overrides['verifier/keys']=tagged;},clear('verifier/keys'));
 d.publicDb.prepare("INSERT INTO trusted_issuers(id,company_slug,epoch,expires_at,verification_class,public_key_json,purpose) VALUES('stripe:q2:mailbox','stripe','q2','2099-01-01T00:00:00.000Z','mailbox','{\"kty\":\"RSA\",\"n\":\"x\",\"e\":\"AQAB\"}','contribution')").raw();
 assert.equal(statusOf(await d.run(),'issuer keys signed'),'FAIL','a live key the release did not sign');
 d.publicDb.db.exec("DELETE FROM trusted_issuers WHERE id='stripe:q2:mailbox'");
 const name='transparency-2026-09-20.json',original=d.objects.get(name)!;
 await expectFail('archive digests',()=>{const a=JSON.parse(original);a.stats={published:500};d.objects.set(name,JSON.stringify(a));},()=>d.objects.set(name,original));
 const other=await release.generateSigningKey();
 assert.equal(statusOf(await d.run([other.publicKey]),'release signer'),'FAIL','signed by a key that is not pinned');
 assert.equal(statusOf(await d.run([]),'release signer'),'WARN');
 await expectFail('verifier stats coarse',()=>{d.overrides['verifier/stats']=()=>Response.json({epoch:quarter(),employers:[{company:'stripe',contribution:{issued:37},paused:true,pausedUntil:'2026-09-22T10:00:00Z'}]});},clear('verifier/stats'));
 await expectFail('release manifest',()=>{d.overrides['/.well-known/siwt-release.json']=()=>Response.json({error:'no_release_manifest'},{status:404});},clear('/.well-known/siwt-release.json'));
 const [contributionKey,jurorKey]=[d.keys.find(k=>k.purpose==='contribution')!,d.keys.find(k=>k.purpose==='juror')!];
 await expectFail('issuer key purposes and limits',()=>{d.overrides['/api/proof/keys']=()=>Response.json({keys:[...d.keys,{...jurorKey,id:'stripe:q9:juror:mailbox',purpose:'contribution'}]});},clear('/api/proof/keys'));
 await expectFail('issuer key purposes and limits',()=>{d.overrides['/api/proof/keys']=()=>Response.json({keys:[...d.keys,...Array.from({length:4},(_,i)=>({...contributionKey,id:`stripe:q${i}:mailbox`}))]});},clear('/api/proof/keys'));
 await expectFail('archive chain',()=>{d.rewrite('2026-09-21',a=>{a.previousDigest=sha(Buffer.from('an archive that never existed')).toString('base64url');});},d.restore);
 await expectFail('archive moderation',()=>{d.rewrite('2026-09-21',a=>{(a.moderation as {counts:Row}).counts.submitted=2;});},d.restore);
 await expectFail('no injected scripts or cookies',()=>{d.overrides['/privacy']=()=>new Response('<p>Write to <a class="__cf_email__" data-cfemail="ab">[email protected]</a></p><script src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>');},clear('/privacy'));
 await expectFail('no injected scripts or cookies',()=>{d.overrides['/']=()=>new Response('<p>ok</p>',{headers:{'set-cookie':'__cf_bm=abc; path=/; HttpOnly'}});},clear('/'));
 // Browsers refuse a live key their client did not pin: contributions stop, so the watcher fails and says so.
 const juror=await issuerKeyFingerprint(d.keys.find(k=>k.purpose==='juror')!);
 d.overrides['/app.js']=()=>new Response(d.appJs.replace(juror,''));
 const partly=(await d.run()).find(r=>r.check==='issuer keys pinned')!;assert.equal(partly.status,'FAIL');assert.match(partly.detail,/does not pin 1 live key\(s\), so browsers refuse them[^]*stripe:q:juror:mailbox/);
 d.overrides['/app.js']=()=>new Response('console.log(1)');
 const none=(await d.run()).find(r=>r.check==='issuer keys pinned')!;assert.equal(none.status,'FAIL');assert.match(none.detail,/pins none of the 2 live keys/);
 delete d.overrides['/app.js'];
 d.overrides['/api/config']=()=>Response.json({moderation:{challengesEnabled:false,policyVersion:policy.version}});
 assert.equal(statusOf(await d.run(),'challenges open'),'WARN','closed challenges (no RATE_LIMIT_SECRET) are flagged');delete d.overrides['/api/config'];
 assert.deepEqual((await d.run()).filter(r=>r.status==='FAIL'),[],'every tampering was undone');
});

test('with a state file, the watcher pins archive history: a consistent rewrite of every archive, or a fork after the newest pinned one, fails',async()=>{
 const d=await deployment(),state:WatchState={};
 const first=await d.run(undefined,{state});
 assert.deepEqual([statusOf(first,'archive history'),statusOf(first,'release history')],['PASS','PASS']);
 assert.deepEqual(Object.keys(state.archives!).sort(),['transparency-2026-09-20','transparency-2026-09-21']);
 assert.equal(Object.keys(state.releases!).length,1);
 assert.equal(statusOf(await d.run(undefined,{state}),'archive history'),'PASS','an unchanged history passes');
 const restore=d.restore;
 // A wholesale rewrite: every digest recomputed and the chain relinked, so each run on its own sees nothing wrong.
 const rewritten=d.rewrite('2026-09-20',a=>{a.stats={published:500};});d.rewrite('2026-09-21',a=>{a.previousDigest=rewritten;});
 const fresh=await d.run();
 assert.deepEqual([statusOf(fresh,'archive digests'),statusOf(fresh,'archive chain')],['PASS','PASS'],'without history the rewrite is invisible');
 const pinned=await d.run(undefined,{state:structuredClone(state)});
 assert.equal(statusOf(pinned,'archive history'),'FAIL');assert.match(pinned.find(r=>r.check==='archive history')!.detail,/changed since it was pinned/);
 restore();
 // A fork: the newest listed archive no longer links to the archive pinned before it.
 const onlyFirst:WatchState={archives:{'transparency-2026-09-20':state.archives!['transparency-2026-09-20']!}};
 assert.equal(statusOf(await d.run(undefined,{state:structuredClone(onlyFirst),archiveLimit:1}),'archive history'),'PASS','a history beyond the listing window is walked back and linked');
 d.rewrite('2026-09-21',a=>{a.previousDigest=sha(Buffer.from('forked')).toString('base64url');});
 const forked=await d.run(undefined,{state:structuredClone(onlyFirst),archiveLimit:1});
 assert.equal(statusOf(forked,'archive chain'),'PASS','the window alone shows nothing');
 assert.equal(statusOf(forked,'archive history'),'FAIL');
 restore();
 const later:WatchState={releases:{other:{buildId:'b9999',releasedOn:'2099-01-01'}}};
 assert.equal(statusOf(await d.run(undefined,{state:later}),'release history'),'WARN','a release older than one seen before is flagged');
 assert.equal(statusOf(await d.run(),'archive history'),undefined,'no state file, no history check');
});

test('the watcher is independent: it imports only Node built-ins',()=>{
 const source=readFileSync('tools/verify-deployment.mjs','utf8');
 assert.deepEqual([...source.matchAll(/^import .* from '([^']+)';$/gm)].map(m=>m[1]).filter(m=>!m!.startsWith('node:')),[]);
});

test('the client build pins the live registry keys by recomputed fingerprint, refuses a registry whose stated fingerprint is wrong, and pins nothing without one',async()=>{
 const build=await import('../tools/build.mjs' as string) as {issuerPins:(path?:string,now?:number)=>Promise<{fingerprints:string[]|null;digest:string|null}>;RELEASE_MANIFEST_PLACEHOLDER:string};
 const dir=mkdtempSync(join(tmpdir(),'siwt-pins-'));
 try {
  const key:IssuerKey={id:'stripe:q:mailbox',companySlug:'stripe',epoch:'q',expiresAt:'2099-01-01T00:00:00.000Z',verificationClass:'mailbox',purpose:'contribution',publicKey:{kty:'RSA',n:'n1',e:'AQAB'}};
  const expired:IssuerKey={...key,id:'stripe:old:mailbox',expiresAt:'2000-01-01T00:00:00.000Z'};
  const path=join(dir,'registry.json');
  writeFileSync(path,JSON.stringify([{...key,fingerprint:await issuerKeyFingerprint(key)},{...expired,fingerprint:await issuerKeyFingerprint(expired)}]));
  const pins=await build.issuerPins(path);
  assert.deepEqual(pins.fingerprints,[await issuerKeyFingerprint(key)],'expired keys are not pinned');
  assert.equal(pins.digest,await issuerKeySetDigest([key]),'the same form as issuerKeySetDigest and the archives');
  writeFileSync(path,JSON.stringify([{...key,fingerprint:'A'.repeat(43)}]));
  await assert.rejects(build.issuerPins(path),/does not match/,'a registry edited without its key is refused');
  assert.deepEqual(await build.issuerPins(join(dir,'missing.json')),{fingerprints:null,digest:null});
 } finally {rmSync(dir,{recursive:true,force:true});}
 assert.equal(build.RELEASE_MANIFEST_PLACEHOLDER,(release as unknown as {PLACEHOLDER_MODULE:string}).PLACEHOLDER_MODULE,'build.mjs writes the same null placeholder as transparency.mjs');
 assert.ok(existsSync('worker/generated/release-manifest.ts'),'importing the build (as tsc and the tests do on a fresh checkout) leaves the placeholder in place');
 const source=readFileSync('tools/build.mjs','utf8');
 assert.match(source,/__SIWT_ISSUER_FINGERPRINTS__: JSON\.stringify\(pins\.fingerprints\)/);assert.match(source,/__SIWT_ISSUER_REGISTRY_DIGEST__: JSON\.stringify\(pins\.digest\)/);
 assert.match(source,/if \(!existsSync\(manifestModule\)\) writeFileSync/,'an existing (signed) release manifest module is never overwritten');
});

test('a release is refused unless its client pins exactly the signed production registry and the verifier serves nothing else',async()=>{
 const gate=release as unknown as {pinProblems:(pins:unknown,registry:string[])=>string[];unregisteredKeys:(served:IssuerKey[],registry:string[],now?:number)=>Promise<string[]>;configuredVerifier:(text:string)=>string|null};
 const key:IssuerKey={id:'stripe:2026-Q3:mailbox',companySlug:'stripe',epoch:'2026-Q3',expiresAt:'2099-01-01T00:00:00.000Z',verificationClass:'mailbox',purpose:'contribution',publicKey:{kty:'RSA',n:'n1',e:'AQAB'}};
 const next:IssuerKey={...key,id:'stripe:2026-Q4:mailbox',epoch:'2026-Q4',publicKey:{kty:'RSA',n:'n2',e:'AQAB'}};
 const [a,b]=[await issuerKeyFingerprint(key),await issuerKeyFingerprint(next)];
 const pins=(registry:string,fingerprints:string[]|null)=>({registry,path:registry==='local'?'.wrangler/provision/local-issuer-public-keys.json':'db/issuer-public-keys.json',fingerprints,digest:null});
 assert.deepEqual(gate.pinProblems(pins('production',[a,b]),[b,a]),[],'the same set, in any order');
 assert.match(gate.pinProblems(pins('local',[a,b]),[a,b])[0]!,/built with the local issuer registry[^]*only the production registry/,'a client pinned to local keys is never released');
 assert.match(gate.pinProblems(pins('production',null),[a])[0]!,/pins no issuer keys/);
 assert.match(gate.pinProblems(undefined,[a])[0]!,/pins no issuer keys/,'a build from before pinning was recorded');
 assert.match(gate.pinProblems(pins('production',[a]),[a,b]).join(' '),/1 live key\(s\) of the signed registry are not pinned/,'built before provisioning, or --registry names another file');
 assert.match(gate.pinProblems(pins('production',[a,b]),[a]).join(' '),/pins 1 key\(s\) the signed registry does not list/);
 assert.deepEqual(await gate.unregisteredKeys([key,next],[a,b]),[]);
 assert.deepEqual(await gate.unregisteredKeys([key,next],[a]),[next.id],'a served key the registry lacks would be refused by every browser');
 assert.deepEqual(await gate.unregisteredKeys([{...next,expiresAt:'2000-01-01T00:00:00.000Z'}],[a]),[],'expired keys do not count');
 assert.deepEqual(await gate.unregisteredKeys([{...key,purpose:undefined}],[a]),[],'a key served without its purpose field is the same key');
 assert.equal(gate.configuredVerifier(readFileSync('wrangler.jsonc','utf8')),'https://verify.shouldiworkthere.com');
 const source=readFileSync('tools/transparency.mjs','utf8');
 assert.match(source,/if\(keyProblems\.length&&!dry\)\{console\.error\(`Refusing:/,'a real release refuses; a dry run only warns');
 const build=readFileSync('tools/build.mjs','utf8');
 assert.match(build,/export const CLIENT_ISSUER_PINS = \$\{JSON\.stringify\(pins\)\}/,'the build records what it pinned and from which registry');
 assert.match(build,/pinsFor\(local \? "local" : "production"\)/,'only --local pins the local registry');
});

test('the deploy gate lists every migration a worker’s databases still need, in the order Wrangler applies them',async()=>{
 const {readdirSync}=await import('node:fs');
 const db=await import('../tools/db.mjs' as string) as {unapplied:(files:string[],applied:Set<string>)=>string[];WORKER_DATABASES:Record<string,string[]>};
 assert.deepEqual(db.WORKER_DATABASES,{main:['public','intake'],inference:['public'],verifier:['verifier']});
 assert.deepEqual(db.unapplied(['0002_b.sql','README.md','0001_a.sql','0003_c.sql'],new Set(['0001_a.sql'])),['0002_b.sql','0003_c.sql']);
 for(const dir of ['db/migrations','db/intake-migrations','db/verifier-migrations']) assert.deepEqual(db.unapplied(readdirSync(dir),new Set(readdirSync(dir))),[],dir);
 for(const [config,binding] of [['wrangler.jsonc','shouldiworkthere-intake'],['wrangler.jsonc','shouldiworkthere-public'],['inference.wrangler.jsonc','shouldiworkthere-public'],['issuer.wrangler.jsonc','shouldiworkthere-verifier']] as const) assert.ok(readFileSync(config,'utf8').includes(binding),`${config} binds ${binding}, which the gate checks`);
});

test('a registry holding any local key cannot be signed, and the watcher fails a deployment that serves one (RT-KEY-02, WS-01, RT-C1)',async()=>{
 const gate=release as unknown as {localKeyOverlap:(registry:{id:string;publicKey?:{n?:string}}[],local:Set<string>)=>string[]};
 const registry=[{id:'stripe:2026-Q4:mailbox',publicKey:{n:'prod-n'}},{id:'stripe:2026-Q4:juror:mailbox',publicKey:{n:'dev-n'}}];
 assert.deepEqual(gate.localKeyOverlap(registry,new Set(['dev-n','other'])),['stripe:2026-Q4:juror:mailbox']);
 assert.deepEqual(gate.localKeyOverlap(registry,new Set()),[]);
 const source=readFileSync('tools/transparency.mjs','utf8');
 assert.match(source,/const local=localKeyOverlap\(registry,await localKeyModuli\(/,'the release gate compares the registry with the local registry, secrets and verifier');
 assert.match(source,/if\(local\.length\)keyProblems\.push\(/,'and refuses to sign on any overlap');
 // The independent watcher: with the checkout's local registry, a served local key fails.
 const d=await deployment();
 const served=(await (await issuer.fetch(new Request('https://verify.test/keys'),{VERIFIER:d.vdb,EMAIL_ENABLED:'false'} as unknown as IssuerEnv)).json() as {keys:IssuerKey[]}).keys;
 assert.equal(statusOf(await d.run(undefined,{localModuli:[served[0]!.publicKey.n!]}),'issuer keys are not local keys'),'FAIL');
 assert.equal(statusOf(await d.run(undefined,{localModuli:['not-a-served-modulus']}),'issuer keys are not local keys'),'PASS');
 assert.equal((await d.run()).find(r=>r.check==='issuer keys are not local keys')?.status,'SKIP','without a local registry the check is skipped, not passed');
 assert.deepEqual((watcher as unknown as {localModuliFrom:(f:string)=>string[]}).localModuliFrom('does/not/exist.json'),[]);
});

test('a NEL policy with max_age 0 and no report-to is a withdrawal, not reporting; a live policy or an endpoint is a finding',async()=>{
 const {nelFindings}=watcher;
 assert.equal(nelFindings(new Headers({nel:'{"max_age":0}'})),null);
 assert.deepEqual(nelFindings(new Headers({nel:'{"max_age":0}, {"report_to":"cf-nel","success_fraction":0.0,"max_age":604800}'}))?.headers,['nel']);
 assert.deepEqual(nelFindings(new Headers({nel:'{"max_age":0}','report-to':'{"group":"cf-nel","endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4"}]}'}))?.headers,['report-to']);
});

// ---------------------------------------------------------------------------------------------------------------
// Community keys (owner decision 4): created by the verifier after a release, so never signed or pinned; the watcher
// checks that the site's and the verifier's copies agree exactly instead. And the launch switches: no fictional data.
// ---------------------------------------------------------------------------------------------------------------
test('the watcher checks community keys by agreement, never by signature or pin, and fails a site that shows fictional employers',async()=>{
 const d=await deployment();
 const pair=await suite().generateKey({modulusLength:2048,publicExponent:new Uint8Array([1,0,1])}),publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey);
 const community=(['contribution','juror'] as const).map(purpose=>({id:`acme:${quarter()}:${purpose==='juror'?'juror:':''}community`,companySlug:'acme',epoch:quarter(),expiresAt:'2099-01-01T00:00:00.000Z',verificationClass:'mailbox' as const,purpose,source:'community' as const,publicKey}));
 const served=async()=>(await (await issuer.fetch(new Request('https://verify.test/keys'),{VERIFIER:d.vdb,EMAIL_ENABLED:'false'} as unknown as IssuerEnv)).json() as {keys:IssuerKey[]}).keys;
 const site=d.keys.map(k=>({...k,source:'curated'}));
 d.overrides['/api/proof/keys']=()=>Response.json({keys:[...site,...community]});
 d.overrides['verifier/keys']=async()=>Response.json({keys:[...await served(),...community]});
 const agreed=await d.run();
 assert.equal(statusOf(agreed,'community keys agree'),'PASS');
 for(const check of ['issuer keys agree','issuer keys signed','issuer keys pinned'])assert.equal(statusOf(agreed,check),'PASS',`${check}: community keys are not in the release, and that is expected`);
 // The site's copy differs from the verifier's (a tagging key), or drops its source: browsers would refuse it, and the watcher fails.
 d.overrides['/api/proof/keys']=()=>Response.json({keys:[...site,{...community[0]!,publicKey:{...publicKey,n:`${publicKey.n!.slice(0,-4)}AAAA`}},community[1]]});
 const tagged=(await d.run()).find(r=>r.check==='community keys agree')!;assert.equal(tagged.status,'FAIL');assert.match(tagged.detail,/does not serve identically/);
 d.overrides['/api/proof/keys']=()=>Response.json({keys:[...site,{...community[0]!,source:'curated'},community[1]]});
 assert.equal(statusOf(await d.run(),'community keys agree'),'FAIL','a source that disagrees with the id');
 // A key on the verifier the site has not copied yet is only pending.
 d.overrides['/api/proof/keys']=()=>Response.json({keys:[...site,community[0]]});
 assert.equal(statusOf(await d.run(),'community keys agree'),'WARN');
 delete d.overrides['/api/proof/keys'];delete d.overrides['verifier/keys'];
 assert.equal(statusOf(await d.run(),'community keys agree'),'SKIP','no community keys yet');
 // The production site hides every fictional employer and lists new employers.
 const launch=await d.run();assert.equal(statusOf(launch,'fictional employers hidden'),'PASS');
 const main=(await import('../worker/src/index.ts')).default;
 d.overrides['/api/config']=async()=>{const r=await main.fetch(new Request('https://site.test/api/config'),{...d.env,SAMPLE_EMPLOYERS:'on'} as never);return r;};
 d.overrides['/api/directory']=async()=>main.fetch(new Request('https://site.test/api/directory'),{...d.env,SAMPLE_EMPLOYERS:'on'} as never);
 const shown=(await d.run()).find(r=>r.check==='fictional employers hidden')!;assert.equal(shown.status,'FAIL');assert.match(shown.detail,/northwind-labs/);
 delete d.overrides['/api/config'];delete d.overrides['/api/directory'];
 assert.equal(statusOf(await d.run(),'employer listing open'),'WARN','the test deployment has no verifier binding or shared secret, so listing is reported closed');
 // The release gate never asks a registry for a community key.
 const gate=await import('../tools/transparency.mjs' as string) as {unregisteredKeys:(served:unknown[],registry:string[],now?:number)=>Promise<string[]>};
 assert.deepEqual(await gate.unregisteredKeys(community,[]),[]);
 assert.deepEqual(await gate.unregisteredKeys([{...community[0]!,source:undefined,id:`acme:${quarter()}:mailbox`}],[]),[`acme:${quarter()}:mailbox`],'a curated key missing from the registry is still refused');
 // The archive fingerprints a community key with its source, exactly as the verifier and the browser do.
 d.publicDb.prepare("INSERT INTO trusted_issuers(id,company_slug,epoch,expires_at,verification_class,public_key_json,purpose,source) VALUES(?,?,?,?,?,?,?,'community')").bind(community[0]!.id,'acme',community[0]!.epoch,community[0]!.expiresAt,'mailbox',JSON.stringify(publicKey),'contribution').raw();
 const registry=await issuerRegistry(d.env as never);const entry=registry.entries.find(e=>e.id===community[0]!.id)!;
 assert.equal(entry.fingerprint,await issuerKeyFingerprint(community[0]!));assert.equal(entry.fingerprint,watcher.keyFingerprint(community[0]! as IssuerKey));
 assert.notEqual(entry.fingerprint,await issuerKeyFingerprint({...community[0]!,source:undefined}),'dropping the source changes the key');
});
