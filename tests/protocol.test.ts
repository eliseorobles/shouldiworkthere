import {test} from 'node:test';
import assert from 'node:assert/strict';
import {suite,prepareProof,validateProof,encode,decode,publicAuthorSchema,type IssuerKey,authorMessage,verifyAuthor,digest,randomToken,quarter,quarterStart,epochStart,issuerKeyStarted,sealIssuerKey,openIssuerKey,sameIssuerKey,currentIssuerKey,reusableIssuance,MAX_CONCURRENT_KEYS} from '../shared/proof.ts';
import {TestD1,applyMigrations} from './d1.ts';
import issuer,{canonicalMailbox,verificationEmail,type IssuerEnv} from '../worker/issuer.ts';
import * as vault from '../web/vault.ts';
import {solvePow,powSubject,powMinute,type PowStamp} from '../shared/pow.ts';

import {proofFixture} from './proof-fixture.ts';
test('RFC9474 blind issuance verifies offline and the issuer sees neither prepared payload nor final signature',async()=>{
 const f=await proofFixture();const result=await validateProof(f.proof,f.issuer,'northwind-labs');
 assert.deepEqual(result.authorKey,f.publicKey);assert.notEqual(encode(f.blinded),f.proof.prepared);assert.notEqual(encode(f.signature),f.proof.signature);assert.equal(f.author.privateKey.extractable,false);
});
test('wrong employer, expiry and payload/signature tampering fail',async()=>{
 const f=await proofFixture();await assert.rejects(validateProof(f.proof,f.issuer,'stripe'),/employer_mismatch/);await assert.rejects(validateProof(f.proof,f.issuer,'northwind-labs',Date.parse('2028-01-01')),/expired/);
 const changed=decode(f.proof.prepared);changed[40]=changed[40]!^1;
 await assert.rejects(validateProof({...f.proof,prepared:encode(changed)},f.issuer,'northwind-labs'),/invalid_signature/);
 await assert.rejects(validateProof({...f.proof,signature:encode(crypto.getRandomValues(new Uint8Array(256)))},f.issuer,'northwind-labs'));
});
test('author signatures bind digest(capability), action, revision, content digest and screening consent; never a receipt id',async()=>{
 const f=await proofFixture();const subject=await digest('cap_one');const m=authorMessage(subject,'revise',0,'h',true);const sig=encode(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},f.author.privateKey,m)));
 assert.equal(await verifyAuthor(f.publicKey,sig,m),true);
 for(const other of [authorMessage(await digest('cap_two'),'revise',0,'h',true),authorMessage(subject,'withdraw',0,'h',true),authorMessage(subject,'revise',1,'h',true),authorMessage(subject,'revise',0,'changed',true),authorMessage(subject,'revise',0,'h',false)])assert.equal(await verifyAuthor(f.publicKey,sig,other),false);
 const payload=JSON.parse(new TextDecoder().decode(m)) as Record<string,unknown>;assert.deepEqual(Object.keys(payload).sort(),['action','payloadHash','revision','screeningConsent','subject','v']);
});

async function verifierEnv() {
 const db=new TestD1();applyMigrations(db,'db/verifier-migrations');
 const sent:{to:string;subject:string;text:string}[]=[];
 // POW_BITS '8' keeps the proof of work cheap in tests; tests/pow.test.ts covers the default difficulty. The test
 // verifier shows the fictional employers' sandbox keys (SAMPLE_EMPLOYERS 'on', as locally); production hides them.
 const env={VERIFIER:db,ISSUER_MASTER_KEY:randomToken(32),MAILBOX_PEPPER:'test-pepper',EMAIL:{send:async(message:{to:string;subject:string;text:string})=>{sent.push(message);}},ALLOWED_ORIGIN:'https://shouldiworkthere.com',EMAIL_FROM:'verify@example.test',EMAIL_ENABLED:'true',ENVIRONMENT:'test',POW_BITS:'8',INTERNAL_TOKEN:randomToken(32),SAMPLE_EMPLOYERS:'on'};
 return {db,env:env as unknown as IssuerEnv&{VERIFIER:D1Database},sent};
}
async function addKey(env:IssuerEnv,db:TestD1,key:Omit<IssuerKey,'publicKey'>,domains:string[],limits:{cap?:number;velocity?:number;band?:string}={}) {
 const pair=await suite().generateKey({modulusLength:2048,publicExponent:new Uint8Array([1,0,1])});
 const publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey);
 db.prepare('INSERT INTO issuer_keys(id,company_slug,epoch,expires_at,verification_class,domains_json,public_key_json,sealed_private_key,purpose,headcount_band,issuance_cap,velocity_limit) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(key.id,key.companySlug,key.epoch,key.expiresAt,key.verificationClass,JSON.stringify(domains),JSON.stringify(publicKey),await sealIssuerKey(env.ISSUER_MASTER_KEY,key.id,await crypto.subtle.exportKey('jwk',pair.privateKey)),key.purpose??'contribution',limits.band??null,limits.cap??null,limits.velocity??null).raw();
 return {...key,purpose:key.purpose??'contribution',publicKey} as IssuerKey;
}
/** Posts to the one route that accepts the body's shape: /start, /issue, or (explicitly) /issue-juror. */
const routeOf=(body:unknown)=>(body as {action?:unknown}|null)?.action==='start'?'/start':'/issue';
const SITE='https://shouldiworkthere.com';
/** The proof of work a browser attaches to /start and /issue-juror (at the test difficulty), or undefined when the body has nothing to bind. */
async function stampFor(body:unknown,path:string,bits=8):Promise<PowStamp|undefined> {
 const b=body as {keyId?:unknown;email?:unknown;blinded?:unknown}|null;
 if(typeof b?.keyId!=='string')return undefined;
 if(path==='/start'&&typeof b.email==='string')return solvePow({origin:SITE,action:'start',keyId:b.keyId,subject:await powSubject.email(b.email)},{bits});
 if(path==='/issue-juror'&&Array.isArray(b.blinded)&&b.blinded.every(x=>typeof x==='string'))return solvePow({origin:SITE,action:'issue-juror',keyId:b.keyId,subject:await powSubject.blinded(b.blinded as string[])},{bits});
 return undefined;
}
/** Exactly this body, with no proof of work added. */
const rawCall=(env:IssuerEnv,body:unknown,path:string,origin=SITE)=>issuer.fetch(new Request(`https://verify.test${path}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),env);
/** As the browser sends it: /start and /issue-juror bodies carry a proof of work unless the body already sets `pow`. */
const call=async(env:IssuerEnv,body:unknown,path=routeOf(body))=>{
 const plain=!!body&&typeof body==='object'&&!Array.isArray(body)&&!('pow' in body),pow=plain?await stampFor(body,path):undefined;
 return rawCall(env,pow?{...body as object,pow}:body,path);
};
const codeFrom=(text:string)=>/Your code is (\d{6})/.exec(text)?.[1];
const future='2099-01-01T00:00:00.000Z';
async function credential(env:IssuerEnv,sent:{text:string}[],key:IssuerKey,email:string) {
 const start=await call(env,{action:'start',keyId:key.id,email});const {challengeId}=await start.json() as {challengeId:string};
 const code=codeFrom(sent.at(-1)!.text)!;
 const author=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',author.publicKey);
 const prepared=await prepareProof(key,publicAuthorSchema.parse({kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y}));
 const body={action:'issue',keyId:key.id,blinded:prepared.blinded,challengeId,code};
 return {body,prepared,response:await call(env,body)};
}

test('issuer private keys are sealed with AES-256-GCM bound to their key id and the master key',async()=>{
 const master=randomToken(32),jwk={kty:'RSA',n:'abc',e:'AQAB',d:'secret-exponent'} as JsonWebKey;
 const sealed=await sealIssuerKey(master,'k1',jwk);
 assert.equal(sealed.includes('secret'),false);assert.deepEqual(await openIssuerKey(master,'k1',sealed),jwk);
 await assert.rejects(openIssuerKey(master,'k2',sealed));await assert.rejects(openIssuerKey(randomToken(32),'k1',sealed));await assert.rejects(sealIssuerKey('short','k1',jwk),/invalid_master_key/);
});

test('the browser uses a key only when publisher and verifier describe it identically, and refuses too many concurrent keys',()=>{
 const base:IssuerKey={id:'stripe:2026-Q3:mailbox',companySlug:'stripe',epoch:'2026-Q3',expiresAt:future,verificationClass:'mailbox',publicKey:{kty:'RSA',n:'n1',e:'AQAB'}};
 assert.equal(sameIssuerKey(base,{...base,publicKey:{...base.publicKey}}),true);
 for(const changed of [{...base,publicKey:{...base.publicKey,n:'n2'}},{...base,expiresAt:'2098-01-01T00:00:00.000Z'},{...base,verificationClass:'demo' as const},{...base,epoch:'2026-Q4'}])assert.equal(sameIssuerKey(base,changed),false);
 const newer={...base,id:'stripe:2026-Q4:mailbox',epoch:'2026-Q4'};
 const keys=[base,newer,{...base,id:'old',expiresAt:'2000-01-01T00:00:00.000Z',epoch:'2027-Q1'}];
 assert.equal(currentIssuerKey(keys,'stripe',Date.parse('2026-11-01T00:00:00Z'))?.id,newer.id,'the newest key whose quarter has begun');
 assert.equal(currentIssuerKey(keys,'stripe',Date.parse('2026-09-30T23:59:59Z'))?.id,base.id,'a key provisioned ahead of its quarter is never chosen before the quarter starts');
 assert.throws(()=>currentIssuerKey(Array.from({length:MAX_CONCURRENT_KEYS+1},(_,i)=>({...base,id:`k${i}`})),'stripe'),/too_many_issuer_keys/);
});

test('a key provisioned ahead of its quarter is published at once but chosen and signed with only once its quarter starts',async()=>{
 assert.equal(epochStart('2026-Q4'),Date.parse('2026-10-01T00:00:00Z'));assert.ok(Number.isNaN(epochStart('q')));
 assert.equal(issuerKeyStarted({epoch:'2026-Q4'},Date.parse('2026-09-30T23:59:59Z')),false);assert.equal(issuerKeyStarted({epoch:'2026-Q4'},Date.parse('2026-10-01T00:00:00Z')),true);
 assert.equal(issuerKeyStarted({epoch:'q'}),true,'an epoch in another form counts as started, as before');
 const {db,env}=await verifierEnv();const next=quarter(quarterStart(new Date(),1));
 const mailbox=await addKey(env,db,{id:`stripe:${next}:mailbox`,companySlug:'stripe',epoch:next,expiresAt:future,verificationClass:'mailbox'},['stripe.com']);
 const sandbox=await addKey(env,db,{id:`northwind-labs:${next}:demo`,companySlug:'northwind-labs',epoch:next,expiresAt:future,verificationClass:'demo'},[]);
 const juror=await addKey(env,db,{id:`northwind-labs:${next}:juror:sandbox`,companySlug:'northwind-labs',epoch:next,expiresAt:future,verificationClass:'demo',purpose:'juror'},[]);
 const listed=await (await issuer.fetch(new Request('https://verify.test/keys'),env)).json() as {keys:IssuerKey[]};
 assert.deepEqual(listed.keys.map(k=>k.id).sort(),[mailbox.id,sandbox.id,juror.id].sort(),'published before its quarter, so a release can pin it');
 assert.equal(currentIssuerKey(listed.keys,'stripe'),undefined,'the browser never chooses it yet');
 const author=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',author.publicKey);
 const prepared=await prepareProof(sandbox,publicAuthorSchema.parse({kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y}));
 for(const [body,path] of [[{action:'start',keyId:mailbox.id,email:'jane@stripe.com'},'/start'],[{action:'issue',keyId:sandbox.id,blinded:prepared.blinded},'/issue'],[{keyId:juror.id,blinded:[prepared.blinded],adultConfirmed:true},'/issue-juror']] as const) {
  const response=await call(env,body,path);assert.deepEqual([response.status,await response.json()],[400,{error:'issuer_key_unavailable'}],`${path} ${JSON.stringify(body).slice(0,40)}`);
 }
});

test('mailboxes are canonicalized: +tags are dropped and employer domain aliases share one mailbox',()=>{
 assert.equal(canonicalMailbox(' Jane.Doe+reviews@FB.com ',['meta.com','fb.com']),'jane.doe@meta.com');
 assert.equal(canonicalMailbox('jane@meta.com',['meta.com','fb.com']),'jane@meta.com');
 assert.equal(canonicalMailbox('jane@gmail.com',['meta.com']),null);assert.equal(canonicalMailbox('a@b@meta.com',['meta.com']),null);
});

test('verifier start is not an oracle: an already-credentialed address gets the same response and the very same email, and the quota is enforced only at /issue',async()=>{
 const {db,env,sent}=await verifierEnv();
 const key=await addKey(env,db,{id:'stripe:q:mailbox',companySlug:'stripe',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['stripe.com']);
 const issued=await credential(env,sent,key,'victim@stripe.com');assert.equal(issued.response.status,200);
 const responses=[],challenges:string[]=[];
 for(const email of ['victim@stripe.com','victim+probe@stripe.com','bystander@stripe.com']) {
  const response=await call(env,{action:'start',keyId:key.id,email});const body=await response.json() as {challengeId:string};
  responses.push({status:response.status,keys:Object.keys(body).sort()});challenges.push(body.challengeId);
 }
 assert.deepEqual(responses.map(r=>JSON.stringify(r)),Array(3).fill(JSON.stringify({status:200,keys:['challengeId','expiresInMinutes']})));
 const [victim,tagged,bystander]=sent.slice(-3);
 // One template: apart from the six-digit code, the email is identical whether or not the mailbox holds a credential, and
 // for both purposes, so neither mail headers, Cloudflare's delivery log nor the message body reveal who holds one.
 const template=(m:{subject:string;text:string})=>({subject:m.subject,text:m.text.replace(/\b\d{6}\b/,'CODE')});
 for(const m of [victim,tagged]) assert.deepEqual(template(m!),template(bystander!));
 assert.deepEqual(template(bystander!),template(verificationEmail('000000')));
 for(const m of [victim,tagged,bystander]) assert.ok(codeFrom(m!.text),'every request below the throttle gets a working code');
 assert.doesNotMatch(bystander!.text,/already (issued|received)[^.]*so no/i);assert.equal(tagged!.to,'victim+probe@stripe.com');
 // The mailbox that already holds its credential can verify, but its code cannot produce a second one.
 const author=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',author.publicKey);
 const second=await prepareProof(key,publicAuthorSchema.parse({kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y}));
 const refused=await call(env,{action:'issue',keyId:key.id,blinded:second.blinded,challengeId:challenges[0],code:codeFrom(victim!.text)});
 assert.deepEqual([refused.status,await refused.json()],[409,{error:'credential_already_issued_this_period'}]);
 assert.equal((await call(env,{action:'issue',keyId:key.id,blinded:second.blinded,challengeId:challenges[2],code:codeFrom(bystander!.text)})).status,200,'a mailbox without a credential gets one');
 for(let index=0;index<3;index++)await call(env,{action:'start',keyId:key.id,email:'bystander@stripe.com'});
 const flood=await call(env,{action:'start',keyId:key.id,email:'bystander@stripe.com'});
 assert.equal(flood.status,200,'rate-limited requests look identical');assert.equal(sent.filter(m=>m.to==='bystander@stripe.com').length,3,'and send nothing');
});

test('one credential per mailbox, employer and quarter, across overlapping keys and domain aliases',async()=>{
 const {db,env,sent}=await verifierEnv();
 const first=await addKey(env,db,{id:'meta:a:mailbox',companySlug:'meta',epoch:'2026-Q3',expiresAt:future,verificationClass:'mailbox'},['meta.com','fb.com']);
 // Last quarter's key, still live for its grace quarter, overlaps this quarter's.
 const second=await addKey(env,db,{id:'meta:b:mailbox',companySlug:'meta',epoch:quarter(quarterStart(new Date(),-1)),expiresAt:future,verificationClass:'mailbox'},['meta.com','fb.com']);
 assert.equal((await credential(env,sent,first,'jane@meta.com')).response.status,200);
 const alias=await credential(env,sent,second,'Jane+2@fb.com');
 assert.ok(codeFrom(sent.at(-1)!.text),'the code is sent as to anyone; the one-credential rule is enforced when issuing');
 assert.deepEqual([alias.response.status,await alias.response.json()],[409,{error:'credential_already_issued_this_period'}]);
 const again=await call(env,{action:'start',keyId:second.id,email:'Jane+3@fb.com'});assert.equal(again.status,200);
 const {challengeId}=await again.json() as {challengeId:string};
 const guess=await call(env,{action:'issue',keyId:second.id,blinded:encode(new Uint8Array(256).fill(7)),challengeId,code:'000000'});
 assert.equal(guess.status,400);
 assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM issuance_quota_v3').get() as {n:number}).n,1);
});

test('a lost response can be retried: the identical blinded message is re-signed, a different one is refused',async()=>{
 const {db,env,sent}=await verifierEnv();
 const key=await addKey(env,db,{id:'stripe:q:mailbox',companySlug:'stripe',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['stripe.com']);
 const first=await credential(env,sent,key,'retry@stripe.com');const signature=(await first.response.json() as {blindSignature:string}).blindSignature;
 const retry=await call(env,first.body);assert.equal(retry.status,200);assert.equal((await retry.json() as {blindSignature:string}).blindSignature,signature);
 const proof=await first.prepared.finalize(signature);assert.ok(await validateProof(proof,key,'stripe'));
 const other=await call(env,{...first.body,blinded:encode(new Uint8Array(256).fill(9))});assert.equal(other.status,400);
});

test('the quarter quota is released when signing fails, so the same code works once signing recovers',async()=>{
 const {db,env,sent}=await verifierEnv();
 const key=await addKey(env,db,{id:'stripe:q:mailbox',companySlug:'stripe',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['stripe.com']);
 const master=env.ISSUER_MASTER_KEY;(env as {ISSUER_MASTER_KEY:string}).ISSUER_MASTER_KEY=randomToken(32);
 const failed=await credential(env,sent,key,'unlucky@stripe.com');
 assert.equal(failed.response.status,503);assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM issuance_quota_v3').get() as {n:number}).n,0);
 (env as {ISSUER_MASTER_KEY:string}).ISSUER_MASTER_KEY=master;
 assert.equal((await call(env,failed.body)).status,200);
});

test('/keys serves public keys from sealed rows and never private material; the cron purges expired rows',async()=>{
 const {db,env}=await verifierEnv();
 await addKey(env,db,{id:'northwind:q:demo',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo'},[]);
 await addKey(env,db,{id:'old:q:demo',companySlug:'northwind-labs',epoch:'2020-Q1',expiresAt:'2020-06-01T00:00:00.000Z',verificationClass:'demo'},[]);
 const listed=await (await issuer.fetch(new Request('https://verify.test/keys'),env)).json() as {keys:(IssuerKey&Record<string,unknown>)[]};
 assert.deepEqual(listed.keys.map(k=>k.id),['northwind:q:demo']);
 const text=JSON.stringify(listed);assert.equal(/sealed|"d":|domains/.test(text),false);
 db.prepare("INSERT INTO mailbox_challenges(id,key_id,mailbox_hash,code_hash,expires_at) VALUES('c','k','m','h','2000-01-01T00:00:00Z')").raw();
 db.prepare("INSERT INTO issuance_quota_v3 VALUES('m','b','2000-01-01T00:00:00Z')").raw();
 await issuer.scheduled({} as ScheduledController,env);
 for(const table of ['mailbox_challenges','issuance_quota_v3'])assert.equal((db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n,0);
 assert.deepEqual((db.db.prepare('SELECT id FROM issuer_keys').all() as {id:string}[]).map(r=>r.id),['northwind:q:demo']);
});

test('a client retry after a lost /issue response resends the identical blinded message and gets a credential; a fresh one is refused',async()=>{
 const {db,env,sent}=await verifierEnv();
 const key=await addKey(env,db,{id:'stripe:q:mailbox',companySlug:'stripe',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['stripe.com']);
 const {challengeId}=await (await call(env,{action:'start',keyId:key.id,email:'lost@stripe.com'})).json() as {challengeId:string};
 const code=codeFrom(sent.at(-1)!.text)!;
 const author=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);const jwk=await crypto.subtle.exportKey('jwk',author.publicKey);
 const authorKey=publicAuthorSchema.parse({kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y});
 let pending:{challengeId:string;keyId:string;prepared:Awaited<ReturnType<typeof prepareProof>>}|null=null;
 const attempt=async()=>{const prepared=reusableIssuance(pending,challengeId,key.id)?.prepared??await prepareProof(key,authorKey);pending={challengeId,keyId:key.id,prepared};return {prepared,response:await call(env,{action:'issue',keyId:key.id,blinded:prepared.blinded,challengeId,code})};};
 assert.equal((await attempt()).response.status,200,'signed, but the response never reaches the browser');
 const fresh=await prepareProof(key,authorKey);
 assert.equal((await call(env,{action:'issue',keyId:key.id,blinded:fresh.blinded,challengeId,code})).status,400,'a newly blinded retry is refused');
 const retry=await attempt();assert.equal(retry.response.status,200);
 const proof=await retry.prepared.finalize((await retry.response.json() as {blindSignature:string}).blindSignature);
 assert.ok(await validateProof(proof,key,'stripe'));
 for(const [other,keyId] of [['another-challenge',key.id],[challengeId,'other:key'],['',key.id]] as const)assert.equal(reusableIssuance(pending,other,keyId),null);
});

// Just enough of IndexedDB for web/vault.ts, including the spec rule that a database created by an open request whose
// first upgrade is aborted is not kept.
type FakeDatabase={version:number;stores:Map<string,Map<unknown,unknown>>};
function fakeIndexedDB(listing:boolean) {
 const databases=new Map<string,FakeDatabase>(),opened:string[]=[],later=(work:()=>void)=>setTimeout(work,0);
 const connection=(db:FakeDatabase)=>({objectStoreNames:{contains:(store:string)=>db.stores.has(store)},createObjectStore:(store:string)=>{db.stores.set(store,new Map());},close:()=>{},transaction:(store:string)=>{
  const map=db.stores.get(store)!,done=(result:unknown)=>({result});
  const tx={oncomplete:null as null|(()=>void),onerror:null,onabort:null,error:null,objectStore:()=>({put:(value:unknown,key:unknown)=>{map.set(key,value);return done(key);},get:(key:unknown)=>done(map.get(key)),delete:(key:unknown)=>{map.delete(key);return done(undefined);},getAll:()=>done([...map.values()]),count:()=>done(map.size)})};
  later(()=>tx.oncomplete?.());return tx;
 }});
 const request=()=>({result:undefined as unknown,transaction:null as unknown,onsuccess:null as null|((event:unknown)=>void),onerror:null as null|((event:unknown)=>void),onupgradeneeded:null as null|((event:unknown)=>void),onblocked:null});
 const api={
  ...(listing?{databases:async()=>[...databases].map(([name,db])=>({name,version:db.version}))}:{}),
  open(name:string,version?:number) {
   opened.push(name);const req=request();
   later(()=>{
    const db=databases.get(name)??{version:0,stores:new Map()},wanted=version??(db.version||1);
    if(wanted>db.version) {
     let aborted=false;req.result=connection(db);req.transaction={abort:()=>{aborted=true;}};
     req.onupgradeneeded?.({oldVersion:db.version});
     if(aborted) {req.onerror?.({preventDefault:()=>{}});return;}
     db.version=wanted;databases.set(name,db);
    }
    req.result=connection(db);req.onsuccess?.({});
   });
   return req;
  },
  deleteDatabase(name:string) {const req=request();later(()=>{databases.delete(name);req.onsuccess?.({});});return req;},
 };
 (globalThis as {indexedDB?:unknown}).indexedDB=api;
 return {databases,opened};
}

test('reading never creates the device database, keeping something does, and it is deleted once nothing is kept; the v1 vault keyed by public ids is deleted',async()=>{
 const fake=fakeIndexedDB(true);
 fake.databases.set('shouldiworkthere-author-vault',{version:2,stores:new Map([['keys',new Map<unknown,unknown>([['t_public_id',{}]])]])});
 assert.deepEqual(await vault.listPendingProofs('stripe'),[]);assert.equal(await vault.hasAuthor('cap_x'),false);
 await vault.forgetAuthor('cap_x');await vault.deletePendingProof('handle');
 await assert.rejects(vault.signAction('cap_x','withdraw',0,''),/does not hold the signing key/);
 assert.deepEqual([...fake.databases.keys()],[],'a visit that only reads leaves no database behind');
 assert.equal(fake.opened.includes(vault.DEVICE_STORE),false);
 const author=await vault.createAuthor();await vault.saveAuthor('cap_x',author.privateKey);
 assert.deepEqual([...fake.databases.keys()],[vault.DEVICE_STORE]);assert.equal(await vault.hasAuthor('cap_x'),true);
 assert.deepEqual([...fake.databases.get(vault.DEVICE_STORE)!.stores.get('keys')!.keys()],[await vault.vaultKey('cap_x')],'keyed by a capability-derived value, never an id');
 await vault.forgetAuthor('cap_x');
 assert.deepEqual([...fake.databases.keys()],[]);
});

test('without indexedDB.databases(), the existence probe aborts the creating upgrade, so reading still creates nothing',async()=>{
 const fake=fakeIndexedDB(false);
 assert.deepEqual(await vault.listPendingProofs('stripe'),[]);assert.equal(await vault.hasAuthor('cap_y'),false);
 assert.deepEqual([...fake.databases.keys()],[]);
 const handle=await vault.savePendingProof({companySlug:'stripe',keyId:'k',expiresAt:future,proof:{keyId:'k',prepared:'p',signature:'s'},author:await vault.createAuthor()});
 assert.equal((await vault.listPendingProofs('stripe')).length,1);assert.equal((await vault.listPendingProofs('meta')).length,0);
 await vault.deletePendingProof(handle);
 assert.deepEqual([...fake.databases.keys()],[]);
});

// ---- Juror tokens (CONTRACT-2) ----
import {prepareJurorToken,validateJurorToken,keyPurpose,jurorClass,issuanceLimits,issuanceBand,issuerKeyFingerprint,finalizeBlinding,networkKey,readCapped,JUROR_QUOTA,JUROR_BATCH_MAX,type KeyPurpose,type BlindingState} from '../shared/proof.ts';
import {keyLimits} from '../worker/issuer.ts';
import {testEnv} from './d1.ts';
import {readFileSync} from 'node:fs';

async function jurorKey(id='northwind-labs:2026-Q3:juror:sandbox',companySlug='northwind-labs') {
 const pair=await suite().generateKey({modulusLength:2048,publicExponent:new Uint8Array([1,0,1])});
 const key:IssuerKey={id,companySlug,epoch:'2026-Q3',expiresAt:future,verificationClass:'demo',purpose:'juror',publicKey:await crypto.subtle.exportKey('jwk',pair.publicKey)};
 const token=async(k:IssuerKey=key)=>{const prepared=await prepareJurorToken(k);return prepared.finalize(encode(await suite().blindSign(pair.privateKey,decode(prepared.blinded))));};
 return {key,pair,token};
}
const payloadOf=(prepared:string)=>JSON.parse(new TextDecoder().decode(decode(prepared).slice(32))) as Record<string,unknown>;

test('juror tokens verify offline, carry purpose juror and no author key, and have domain-separated nullifiers',async()=>{
 const {key,token}=await jurorKey();const t=await token();
 const result=await validateJurorToken(t,key);
 assert.equal(result.key.id,key.id);assert.deepEqual(Object.keys(payloadOf(t.prepared)).sort(),['nonce','purpose','scope','v']);assert.equal(payloadOf(t.prepared).purpose,'juror');
 assert.notEqual(result.nullifier,await digest(decode(t.prepared)),'not the contribution nullifier form');
 assert.equal((await validateJurorToken(t,key)).nullifier,result.nullifier,'deterministic, so a spent token is recognised');
 assert.notEqual((await validateJurorToken(await token(),key)).nullifier,result.nullifier);
 assert.equal(jurorClass(key),'sandbox');assert.equal(jurorClass({verificationClass:'mailbox'}),'mailbox');
});

test('a juror token is never a contribution proof and a contribution proof is never a juror token',async()=>{
 const {key,pair,token}=await jurorKey();const t=await token();
 await assert.rejects(validateProof(t,key,'northwind-labs'),/unknown_issuer_key/,'juror keys are refused for contributions');
 const f=await proofFixture();
 await assert.rejects(validateJurorToken(f.proof,f.issuer),/unknown_issuer_key/,'contribution keys are refused for jury duty');
 await assert.rejects(prepareJurorToken(f.issuer),/unknown_issuer_key/);
 // Even if one RSA key were published under both ids, the payloads cannot cross: each schema is strict.
 const twin:IssuerKey={...key,id:'northwind-labs:2026-Q3:demo',purpose:'contribution'};
 const crossPrepared=suite().prepare(new TextEncoder().encode(JSON.stringify({v:1,scope:twin.id,nonce:randomToken(),purpose:'juror'})));
 const crossBlind=await suite().blind(await crypto.subtle.importKey('jwk',twin.publicKey,{name:'RSA-PSS',hash:'SHA-384'},true,['verify']),crossPrepared);
 const crossSig=await suite().finalize(await crypto.subtle.importKey('jwk',twin.publicKey,{name:'RSA-PSS',hash:'SHA-384'},true,['verify']),crossPrepared,await suite().blindSign(pair.privateKey,crossBlind.blindedMsg),crossBlind.inv);
 await assert.rejects(validateProof({keyId:twin.id,prepared:encode(crossPrepared),signature:encode(crossSig)},twin,'northwind-labs'),'a juror payload signed by a contribution key has no author key and is refused');
});

test('a key whose declared purpose disagrees with its id is unusable for either purpose',async()=>{
 const {key,token}=await jurorKey();const t=await token();
 const relabelled={...key,purpose:'contribution' as KeyPurpose};
 assert.equal(keyPurpose(relabelled),null);assert.equal(keyPurpose(key),'juror');assert.equal(keyPurpose({id:'stripe:2026-Q3:mailbox'}),'contribution');
 await assert.rejects(validateJurorToken(t,relabelled),/unknown_issuer_key/);await assert.rejects(validateProof(t,relabelled,'northwind-labs'),/unknown_issuer_key/);
 assert.equal(sameIssuerKey(key,relabelled),false);
 const {purpose:_omitted,...legacyCopy}=key;assert.equal(sameIssuerKey(key,legacyCopy as IssuerKey),true,'a copy without the purpose field describes the same juror key');
 assert.equal(await issuerKeyFingerprint(key),await issuerKeyFingerprint(legacyCopy as IssuerKey));assert.notEqual(await issuerKeyFingerprint(key),await issuerKeyFingerprint(relabelled));
});

// Every other spelling of the same bytes: the unused low bits of the last base64url character, which atob ignores.
const ALPHABET='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function respellings(text:string):string[] {
 const unused=[0,4,2][decode(text).length%3]!;if(!unused)return [];
 const last=ALPHABET.indexOf(text.at(-1)!),base=last&~((1<<unused)-1);
 return Array.from({length:1<<unused},(_,k)=>ALPHABET[base|k]!).filter(c=>c!==text.at(-1)).map(c=>text.slice(0,-1)+c);
}

test('one juror token has exactly one nullifier: other spellings of the same signed bytes are refused',async()=>{
 let checked=0;
 for(const id of ['northwind-labs:2026-Q3:juror:sandbox','meta:2026-Q4:juror:mailbox','stripe:2026-Q4:juror:mailbox']) {
  const {key,token}=await jurorKey(id,id.split(':')[0]!);const t=await token();
  const nullifier=(await validateJurorToken(t,key)).nullifier;
  assert.equal(nullifier,await digest(`siwt-juror-v1:${encode(decode(t.prepared))}`),'computed over the signed bytes');
  for(const field of ['prepared','signature'] as const)for(const variant of respellings(t[field])) {
   checked++;assert.deepEqual(Buffer.from(variant,'base64url'),Buffer.from(t[field],'base64url'),'a lenient decoder reads the same bytes');
   await assert.rejects(validateJurorToken({...t,[field]:variant},key),/invalid_encoding/,`${field} respelled`);
  }
 }
 assert.ok(checked>0,'at least one key id length leaves unused bits to flip');
 const f=await proofFixture();
 for(const variant of respellings(f.proof.prepared))await assert.rejects(validateProof({...f.proof,prepared:variant},f.issuer,'northwind-labs'),/invalid_encoding/);
 for(const bad of ['','a','ab=','a+b','a/b','AB CD'])assert.throws(()=>decode(bad),/invalid_encoding/,JSON.stringify(bad));
 for(let n=0;n<40;n++){const bytes=crypto.getRandomValues(new Uint8Array(n+1));assert.deepEqual(decode(encode(bytes)),bytes);}
 const master=randomToken(32),jwk={kty:'RSA',n:'abc',e:'AQAB',d:'x'} as JsonWebKey,sealed=await sealIssuerKey(master,'k1',jwk);
 for(const variant of respellings(master))assert.deepEqual(await openIssuerKey(variant,'k1',sealed),jwk,'the operator-set master key alone is read leniently, so a respelled secret cannot stop signing');
});

test('/issue-juror compares a batch as bytes: one blinded message under two spellings is refused, not signed twice',async()=>{
 const {db,env}=await verifierEnv();
 const key=await addKey(env,db,{id:'northwind-labs:q:juror:sandbox',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo',purpose:'juror'},[]);
 let blinded=(await prepareJurorToken(key)).blinded;
 for(let i=0;i<20&&!respellings(blinded).length;i++)blinded=(await prepareJurorToken(key)).blinded;
 const variant=respellings(blinded)[0];
 if(variant){const r=await call(env,{keyId:key.id,blinded:[blinded,variant],adultConfirmed:true},'/issue-juror');assert.deepEqual([r.status,await r.json()],[400,{error:'invalid_blinded_message'}]);}
 const contribution=await addKey(env,db,{id:'northwind-labs:q:demo',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo'},[]);
 const r=await call(env,{action:'issue',keyId:contribution.id,blinded:'not*base64'});
 assert.equal(r.status,400);
});

test('an interrupted issuance can be finished later from its saved blinding state, and only with the key it was blinded for',async()=>{
 const {key,pair}=await jurorKey();
 const prepared=await prepareJurorToken(key);
 const saved=JSON.parse(JSON.stringify(prepared.state)) as BlindingState;
 assert.deepEqual(Object.keys(saved).sort(),['inv','keyId','prepared']);
 const blindSignature=encode(await suite().blindSign(pair.privateKey,decode(prepared.blinded)));
 const resumed=await finalizeBlinding(key,saved,blindSignature);
 assert.deepEqual(resumed,await prepared.finalize(blindSignature),'the same token as finishing in memory');
 assert.ok(await validateJurorToken(resumed,key));
 const other=await jurorKey('helios-semiconductor:2026-Q3:juror:sandbox','helios-semiconductor');
 await assert.rejects(finalizeBlinding(other.key,saved,blindSignature),/unknown_issuer_key/);
 await assert.rejects(finalizeBlinding(key,saved,encode(new Uint8Array(256).fill(3))),'a wrong blind signature does not finish');
 const f=await proofFixture();const author=f.publicKey;
 const contribution=await prepareProof(f.issuer,author);assert.equal(contribution.state.keyId,f.issuer.id);
});

test('juror tokens fail on tampering, expiry and a wrong key',async()=>{
 const {key,token}=await jurorKey();const t=await token();
 const changed=decode(t.prepared);changed[40]=changed[40]!^1;
 await assert.rejects(validateJurorToken({...t,prepared:encode(changed)},key),/invalid_signature/);
 await assert.rejects(validateJurorToken(t,key,Date.parse('2100-01-01')),/credential_expired/);
 const other=await jurorKey('helios-semiconductor:2026-Q3:juror:sandbox','helios-semiconductor');
 await assert.rejects(validateJurorToken(t,other.key),/unknown_issuer_key/);
 await assert.rejects(validateJurorToken({...t,keyId:other.key.id},other.key),/invalid_signature/);
 await assert.rejects(validateJurorToken({...t,extra:1},key));
});

test('contribution key selection ignores juror keys, and the concurrent-key limit counts each purpose separately',()=>{
 const base:IssuerKey={id:'stripe:2026-Q3:mailbox',companySlug:'stripe',epoch:'2026-Q3',expiresAt:future,verificationClass:'mailbox',publicKey:{kty:'RSA',n:'n1',e:'AQAB'}};
 const contribution=Array.from({length:MAX_CONCURRENT_KEYS},(_,i)=>({...base,id:`stripe:2026-Q${i}:mailbox`,epoch:`2026-Q${i}`}));
 const jurors=Array.from({length:MAX_CONCURRENT_KEYS},(_,i)=>({...base,id:`stripe:2027-Q${i}:juror:mailbox`,epoch:`2027-Q${i}`,purpose:'juror' as const}));
 assert.equal(currentIssuerKey([...contribution,...jurors],'stripe')?.id,'stripe:2026-Q3:mailbox','a newer juror key is never chosen for a contribution');
 assert.equal(currentIssuerKey([...contribution,...jurors],'stripe',Date.parse('2027-08-01T00:00:00Z'),'juror')?.id,'stripe:2027-Q3:juror:mailbox');
 const unlabelled=jurors.map(({purpose:_p,...k})=>k as IssuerKey);
 assert.equal(currentIssuerKey([...contribution,...unlabelled],'stripe')?.id,'stripe:2026-Q3:mailbox','juror ids are recognised even without a purpose field');
 assert.throws(()=>currentIssuerKey([...jurors,{...jurors[0]!,id:'stripe:x:juror:mailbox'}],'stripe',Date.now(),'juror'),/too_many_issuer_keys/);
});

/** A juror batch as the jury page sends it: with its 18+ confirmation (the requirement itself is tested on its own). */
const jurorCall=(env:IssuerEnv,body:unknown)=>call(env,{adultConfirmed:true,...body as object},'/issue-juror');
async function jurorBatch(key:IssuerKey,n:number) {return Promise.all(Array.from({length:n},()=>prepareJurorToken(key)));}
async function mailboxJurorSetup(limits:{cap?:number;velocity?:number}={}) {
 const v=await verifierEnv();
 const contribution=await addKey(v.env,v.db,{id:'stripe:q:mailbox',companySlug:'stripe',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['stripe.com'],limits);
 const juror=await addKey(v.env,v.db,{id:'stripe:q:juror:mailbox',companySlug:'stripe',epoch:quarter(),expiresAt:future,verificationClass:'mailbox',purpose:'juror'},['stripe.com'],limits);
 const start=async(email:string,key=juror)=>{const r=await call(v.env,{action:'start',keyId:key.id,email});const body=await r.json() as {challengeId:string;error?:string};return {status:r.status,body,code:codeFrom(v.sent.at(-1)?.text??'')};};
 return {...v,contribution,juror,start};
}

test('/issue-juror issues a mailbox its juror tokens once per employer and quarter (one set of up to 3, separate from the contribution credential); a later request learns only that they were issued, never how many (RT-ORACLE-06)',async()=>{
 const {env,db,sent,contribution,juror,start}=await mailboxJurorSetup();
 assert.equal(JUROR_QUOTA,3,'policy 0.6.0');assert.equal(JUROR_BATCH_MAX,JUROR_QUOTA,'no batch asks for more than the quota');
 assert.equal((await credential(env,sent,contribution,'jane@stripe.com')).response.status,200,'the mailbox already holds its contribution credential');
 const first=await start('jane@stripe.com');assert.equal(first.status,200);assert.ok(first.code,'the juror quota is separate, so a code is sent');
 const two=await jurorBatch(juror,2);
 const issued=await jurorCall(env,{keyId:juror.id,blinded:two.map(p=>p.blinded),challengeId:first.body.challengeId,code:first.code});
 assert.equal(issued.status,200);
 const signatures=(await issued.json() as {blindSignatures:string[]}).blindSignatures;assert.equal(signatures.length,2);
 const tokens=await Promise.all(two.map((p,i)=>p.finalize(signatures[i]!)));
 const nullifiers=new Set();for(const t of tokens)nullifiers.add((await validateJurorToken(t,juror)).nullifier);assert.equal(nullifiers.size,2);
 // Someone who reads a fresh code for the same mailbox (an employer's mail gateway) probes with every batch size: each
 // answer is the same, carries no count, and nothing is spent.
 const second=await start('jane+jury@stripe.com');assert.ok(second.code);
 for(const n of [1,2,3,1,3]) {
  const probe=await jurorCall(env,{keyId:juror.id,blinded:(await jurorBatch(juror,n)).map(p=>p.blinded),challengeId:second.body.challengeId,code:second.code});
  assert.deepEqual([probe.status,await probe.json()],[409,{error:'juror_quota_exceeded'}],`a batch of ${n}`);
 }
 assert.equal((db.db.prepare('SELECT tokens FROM juror_quota').get() as {tokens:number}).tokens,2,'the probes changed nothing');
 // A mailbox with no tokens yet: the first batch, of any size up to the quota, is its only one this quarter.
 const other=await start('sam@stripe.com');
 assert.equal((await jurorCall(env,{keyId:juror.id,blinded:(await jurorBatch(juror,1)).map(p=>p.blinded),challengeId:other.body.challengeId,code:other.code})).status,200);
 const later=await start('sam@stripe.com');
 const refused=await jurorCall(env,{keyId:juror.id,blinded:(await jurorBatch(juror,1)).map(p=>p.blinded),challengeId:later.body.challengeId,code:later.code});
 assert.deepEqual([refused.status,await refused.json()],[409,{error:'juror_quota_exceeded'}]);
 const emailed=sent.length;
 assert.equal((await start('jane@stripe.com')).status,200);assert.equal(sent.length,emailed,'a 4th request for this mailbox within 15 minutes, whatever its purpose, sends nothing');
 db.prepare("UPDATE mailbox_challenges SET expires_at='2000-01-01T00:00:00Z'").raw();
 const full=await start('jane@stripe.com');
 assert.equal(full.status,200);assert.deepEqual(Object.keys(full.body).sort(),['challengeId','expiresInMinutes'],'same response as any other address');
 assert.ok(full.code,'the same code email as anyone gets');assert.equal(sent.at(-1)!.text.replace(/\b\d{6}\b/,'CODE'),sent[1]!.text.replace(/\b\d{6}\b/,'CODE'));
 const spent=await jurorCall(env,{keyId:juror.id,blinded:(await jurorBatch(juror,1)).map(p=>p.blinded),challengeId:full.body.challengeId,code:full.code});
 assert.deepEqual([spent.status,await spent.json()],[409,{error:'juror_quota_exceeded'}],'the quota is enforced when issuing');
 // Verifier 0003: a mailbox that received 4 or 5 tokens under the earlier quota keeps them but cannot get more; a release still works.
 db.exec('DROP TRIGGER juror_quota_three_insert');db.prepare("INSERT INTO juror_quota(mailbox_hash,tokens,expires_at) VALUES('legacy',5,?)").bind(future).raw();
 db.exec(readFileSync('db/verifier-migrations/0003_juror_quota_three.sql','utf8'));
 assert.throws(()=>db.db.prepare("UPDATE juror_quota SET tokens=tokens+1 WHERE mailbox_hash='legacy'").run(),/juror_quota_limit/);
 db.prepare("UPDATE juror_quota SET tokens=4 WHERE mailbox_hash='legacy'").raw();
 assert.throws(()=>db.db.prepare("INSERT INTO juror_quota(mailbox_hash,tokens,expires_at) VALUES('fresh',4,?)").run(future),/juror_quota_limit/);
});

test('juror and contribution keys cannot be used at each other\'s endpoint, and malformed batches are refused',async()=>{
 const {env,contribution,juror,start}=await mailboxJurorSetup();
 const s=await start('sam@stripe.com');
 assert.equal((await call(env,{action:'issue',keyId:juror.id,blinded:(await prepareJurorToken(juror)).blinded,challengeId:s.body.challengeId,code:s.code})).status,400);
 const wrong=await jurorCall(env,{keyId:contribution.id,blinded:[encode(new Uint8Array(256).fill(1))],challengeId:s.body.challengeId,code:s.code});
 assert.deepEqual([wrong.status,await wrong.json()],[400,{error:'wrong_key_purpose'}]);
 const blinded=(await jurorBatch(juror,JUROR_BATCH_MAX+1)).map(p=>p.blinded);
 assert.equal((await jurorCall(env,{keyId:juror.id,blinded,challengeId:s.body.challengeId,code:s.code})).status,400,`at most ${JUROR_BATCH_MAX} per request`);
 assert.equal((await jurorCall(env,{keyId:juror.id,blinded:[],challengeId:s.body.challengeId,code:s.code})).status,400);
 const dup=await jurorCall(env,{keyId:juror.id,blinded:[blinded[0],blinded[0]],challengeId:s.body.challengeId,code:s.code});
 assert.deepEqual([dup.status,await dup.json()],[400,{error:'invalid_blinded_message'}]);
 assert.equal((await jurorCall(env,{keyId:juror.id,blinded:[blinded[0]]})).status,401,'a mailbox juror key needs the mailbox code');
 assert.equal((await jurorCall(env,{keyId:juror.id,blinded:[blinded[0]],challengeId:s.body.challengeId,code:'000000'})).status,400);
});

test('a juror batch lost in transit is re-signed only when resent identically on the same challenge',async()=>{
 const {env,db,juror,start}=await mailboxJurorSetup();
 const s=await start('lee@stripe.com');const batch=await jurorBatch(juror,2);const body={keyId:juror.id,blinded:batch.map(p=>p.blinded),challengeId:s.body.challengeId,code:s.code};
 const first=await (await jurorCall(env,body)).json() as {blindSignatures:string[]};
 const again=await jurorCall(env,body);assert.equal(again.status,200);assert.deepEqual(await again.json(),first);
 assert.equal((db.db.prepare('SELECT tokens FROM juror_quota').get() as {tokens:number}).tokens,2,'a retry is not counted twice');
 assert.equal((await jurorCall(env,{...body,blinded:(await jurorBatch(juror,2)).map(p=>p.blinded)})).status,400,'a different batch on a used challenge is refused');
 assert.equal((await jurorCall(env,{...body,blinded:[...body.blinded].reverse()})).status,400);
 assert.throws(()=>db.db.prepare('UPDATE mailbox_challenges SET used=1 WHERE id=?').run(s.body.challengeId),/challenge_used/,'a second use of one challenge aborts at the database');
});

test('sandbox juror tokens need no mailbox but are limited per connection, and never start a mailbox challenge',async()=>{
 const {db,env}=await verifierEnv();let allowed=1;
 (env as {JUROR_LIMIT?:unknown}).JUROR_LIMIT={limit:async()=>({success:allowed-->0})};
 const key=await addKey(env,db,{id:'northwind-labs:q:juror:sandbox',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo',purpose:'juror'},[]);
 const batch=await jurorBatch(key,JUROR_BATCH_MAX);
 const ok=await jurorCall(env,{keyId:key.id,blinded:batch.map(p=>p.blinded)});assert.equal(ok.status,200);
 const token=await batch[0]!.finalize((await ok.json() as {blindSignatures:string[]}).blindSignatures[0]!);
 assert.equal(jurorClass((await validateJurorToken(token,key)).key),'sandbox');
 assert.equal((await jurorCall(env,{keyId:key.id,blinded:[(await prepareJurorToken(key)).blinded]})).status,429);
 assert.equal((await call(env,{action:'start',keyId:key.id,email:'a@northwind.test'})).status,503);
});

test('the quarterly cap per employer is enforced atomically and then refuses /start for every address at that employer',async()=>{
 const {env,db,sent,contribution}=await mailboxJurorSetup({cap:2,velocity:100});
 for(const who of ['a','b'])assert.equal((await credential(env,sent,contribution,`${who}@stripe.com`)).response.status,200);
 const before=sent.length;
 const refused=await call(env,{action:'start',keyId:contribution.id,email:'c@stripe.com'});
 assert.deepEqual([refused.status,await refused.json()],[503,{error:'issuance_cap_reached'}]);assert.equal(sent.length,before,'no email is sent');
 // The database constraint alone refuses a batch past the cap and rolls back the mailbox quota row with it.
 await assert.rejects(db.batch([db.prepare('INSERT INTO issuance_quota_v3 VALUES(?,?,?)').bind('mbx','b',future),db.prepare('INSERT INTO issuance_counts(company_slug,purpose,epoch,issued,cap) VALUES(?,?,?,?,?) ON CONFLICT(company_slug,purpose,epoch) DO UPDATE SET issued=issued+excluded.issued,cap=excluded.cap').bind('stripe','contribution',quarter(),1,2)]),/issuance_cap/);
 assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM issuance_quota_v3 WHERE mailbox_hash='mbx'").get()!.n,0);
});

test('re-provisioning with a larger headcount band raises the cap within the quarter; the cap is not stuck at its lowest value',async()=>{
 const {env,db,sent,contribution}=await mailboxJurorSetup({cap:1,velocity:100});
 assert.equal((await credential(env,sent,contribution,'a@stripe.com')).response.status,200);
 assert.deepEqual([(await call(env,{action:'start',keyId:contribution.id,email:'b@stripe.com'})).status],[503]);
 db.prepare('UPDATE issuer_keys SET issuance_cap=3 WHERE id=?').bind(contribution.id).raw();
 for(const who of ['b','c'])assert.equal((await credential(env,sent,contribution,`${who}@stripe.com`)).response.status,200,who);
 assert.deepEqual({...db.db.prepare('SELECT issued,cap FROM issuance_counts').get()},{issued:3,cap:3});
 db.prepare('UPDATE issuer_keys SET issuance_cap=2 WHERE id=?').bind(contribution.id).raw();
 assert.deepEqual(await (await call(env,{action:'start',keyId:contribution.id,email:'d@stripe.com'})).json(),{error:'issuance_cap_reached'},'and a lowered cap applies at once');
});

test('a contribution velocity trip pauses both purposes for that employer for 24 hours; other employers are unaffected',async()=>{
 const {env,db,sent,contribution,juror,start}=await mailboxJurorSetup({cap:100,velocity:2});
 for(const who of ['a','b'])assert.equal((await credential(env,sent,contribution,`${who}@stripe.com`)).response.status,200);
 const third=await credential(env,sent,contribution,'c@stripe.com');
 assert.deepEqual([third.response.status,await third.response.json()],[503,{error:'issuance_paused'}]);
 const pauses=db.db.prepare('SELECT purpose,paused_until FROM issuance_pauses WHERE company_slug=? ORDER BY purpose').all('stripe') as {purpose:string;paused_until:string}[];
 assert.deepEqual(pauses.map(p=>p.purpose),['contribution','juror']);
 for(const p of pauses)assert.ok(Math.abs(Date.parse(p.paused_until)-Date.now()-24*3600000)<60000,'paused for 24 hours');
 assert.equal(db.db.prepare('SELECT issued FROM issuance_counts').get()!.issued,2,'the refused issuance was rolled back');
 assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM issuance_quota_v3').get()!.n,2,'and its mailbox quota row with it');
 assert.deepEqual([(await start('d@stripe.com',contribution)).status,(await start('e@stripe.com',juror)).status],[503,503],'both purposes pause for that employer');
 const other=await addKey(env,db,{id:'meta:q:mailbox',companySlug:'meta',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['meta.com']);
 assert.equal((await credential(env,sent,other,'x@meta.com')).response.status,200,'other employers are unaffected');
 db.prepare("UPDATE issuance_pauses SET paused_until='2000-01-01T00:00:00Z'").raw();db.prepare('UPDATE issuance_hours SET hour=hour-25').raw();
 assert.equal((await call(env,third.body)).status,200,'after the pause and outside the window, the same code works');
});

test('a juror velocity trip pauses juror tokens only: ordinary juror demand never shuts off contribution credentials',async()=>{
 const {env,db,sent,contribution,juror,start}=await mailboxJurorSetup({cap:100,velocity:5});
 // Five tokens in the window (3 + 2 from two mailboxes, each within its quota of 3) reach the velocity limit of 5.
 for(const [who,n] of [['a',3],['d',2]] as const) {const s=await start(`${who}@stripe.com`);assert.equal((await jurorCall(env,{keyId:juror.id,blinded:(await jurorBatch(juror,n)).map(p=>p.blinded),challengeId:s.body.challengeId,code:s.code})).status,200);}
 const t=await start('b@stripe.com');
 const tripped=await jurorCall(env,{keyId:juror.id,blinded:(await jurorBatch(juror,1)).map(p=>p.blinded),challengeId:t.body.challengeId,code:t.code});
 assert.deepEqual([tripped.status,await tripped.json()],[503,{error:'issuance_paused'}]);
 assert.deepEqual((db.db.prepare('SELECT purpose FROM issuance_pauses').all() as {purpose:string}[]).map(r=>r.purpose),['juror']);
 assert.equal((await start('c@stripe.com')).status,503,'juror issuance is paused');
 assert.equal((await credential(env,sent,contribution,'c@stripe.com')).response.status,200,'contribution credentials are still issued');
});

test('sandbox (fictional employer) issuance is never capped, counted or paused: a burst of juror tokens cannot shut the demo',async()=>{
 const {db,env}=await verifierEnv();
 const demo=await addKey(env,db,{id:'northwind-labs:q:demo',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo'},[],{cap:1,velocity:1});
 const juror=await addKey(env,db,{id:'northwind-labs:q:juror:sandbox',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo',purpose:'juror'},[],{cap:1,velocity:1});
 for(let i=0;i<4;i++)assert.equal((await jurorCall(env,{keyId:juror.id,blinded:(await jurorBatch(juror,JUROR_BATCH_MAX)).map(p=>p.blinded)})).status,200,'even limits stored on a sandbox row are ignored');
 const issue=async()=>call(env,{action:'issue',keyId:demo.id,blinded:(await prepareProof(demo,(await proofFixture()).publicKey)).blinded});
 for(let i=0;i<3;i++)assert.equal((await issue()).status,200,'the demo contribution credential keeps working');
 for(const table of ['issuance_counts','issuance_hours','issuance_pauses'])assert.equal((db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n,0,`${table} holds nothing for fictional employers`);
 assert.equal(issuanceLimits('1,001-5,000','demo','juror'),null);
 assert.equal(keyLimits({verification_class:'demo',purpose:'juror',headcount_band:null,issuance_cap:5,velocity_limit:5}),null);
});

test('no mailbox receives more than 3 emails in any 15 minutes, across contribution and juror requests',async()=>{
 const {env,sent,contribution,juror,start}=await mailboxJurorSetup();
 for(let i=0;i<3;i++)assert.equal((await start('pat@stripe.com',contribution)).status,200);
 const juryRequest=await start('Pat+jury@stripe.com',juror);
 assert.equal(juryRequest.status,200,'the response is the same as for any request');
 assert.equal(sent.filter(m=>/^pat(\+jury)?@stripe\.com$/i.test(m.to)).length,3,'the fourth request in 15 minutes sends nothing');
 assert.ok((await start('sam@stripe.com',juror)).code,'other mailboxes are unaffected');
});

test('a failed signing releases the employer counts as well as the mailbox quota',async()=>{
 const {env,db,sent,contribution,juror,start}=await mailboxJurorSetup();
 (env as {ISSUER_MASTER_KEY:string}).ISSUER_MASTER_KEY=randomToken(32);
 assert.equal((await credential(env,sent,contribution,'f@stripe.com')).response.status,503);
 const s=await start('f@stripe.com');
 assert.equal((await jurorCall(env,{keyId:juror.id,blinded:(await jurorBatch(juror,2)).map(p=>p.blinded),challengeId:s.body.challengeId,code:s.code})).status,503);
 for(const [table,column] of [['issuance_counts','issued'],['issuance_hours','n'],['juror_quota','tokens']] as const)assert.deepEqual((db.db.prepare(`SELECT ${column} AS v FROM ${table}`).all() as {v:number}[]).map(r=>r.v).filter(Boolean),[],table);
});

test('/stats shows coarse bands, caps and pause flags per purpose for the current quarter only, with no finer time and no exact counts',async()=>{
 const {env,db}=await mailboxJurorSetup({cap:300,velocity:30});
 await addKey(env,db,{id:'northwind-labs:q:demo',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo'},[]);
 const count=db.prepare('INSERT INTO issuance_counts VALUES(?,?,?,?,?)');
 count.bind('stripe','contribution',quarter(),37,300).raw();count.bind('stripe','juror',quarter(),3,300).raw();count.bind('stripe','contribution','2001-Q1',999,1000).raw();
 db.prepare('INSERT INTO issuance_pauses VALUES(?,?,?)').bind('stripe','juror',future).raw();
 const response=await issuer.fetch(new Request('https://verify.test/stats'),env);const text=await response.text();
 type Entry={issued:string|null;cap:number|null;velocityLimit:number|null;capReached:boolean;paused:boolean};
 const stats=JSON.parse(text) as {epoch:string;note:string;employers:{company:string;sandbox:boolean;paused:boolean;contribution:Entry|null;juror:Entry|null}[]};
 assert.equal(stats.epoch,quarter());
 const stripe=stats.employers.find(e=>e.company==='stripe')!,northwind=stats.employers.find(e=>e.company==='northwind-labs')!;
 assert.deepEqual([stripe.paused,stripe.sandbox,stripe.contribution,stripe.juror?.issued,stripe.juror?.paused],[true,false,{issued:'25–99',cap:300,velocityLimit:30,capReached:false,paused:false},'<25',true]);
 assert.deepEqual([northwind.paused,northwind.sandbox,northwind.contribution,northwind.juror],[false,true,{issued:null,cap:null,velocityLimit:null,capReached:false,paused:false},null],'fictional employers have no cap, count or pause');
 assert.equal(/\d{4}-\d{2}-\d{2}|T\d{2}:|paused_until|"hour"|\b37\b|\b999\b/.test(text),false,'no timestamps, exact counts or earlier quarters');
 assert.match(stats.note,/would have exceeded velocityLimit/,'the note says a trip refuses the request; issued never exceeds the limit');
 assert.deepEqual([0,24,25,99,100,249,250].map(issuanceBand),['<25','<25','25–99','25–99','100–249','100–249','250+']);
});

test('/keys states each key\'s purpose; the scheduled job purges spent quotas, stale counters and ended pauses',async()=>{
 const {env,db}=await mailboxJurorSetup();
 const listed=await (await issuer.fetch(new Request('https://verify.test/keys'),env)).json() as {keys:IssuerKey[]};
 assert.deepEqual(listed.keys.map(k=>[k.id,k.purpose]).sort(),[['stripe:q:juror:mailbox','juror'],['stripe:q:mailbox','contribution']]);
 db.prepare("INSERT INTO juror_quota VALUES('m',2,'2000-01-01T00:00:00Z')").raw();
 db.prepare("INSERT INTO issuance_counts VALUES('stripe','contribution','2001-Q1',3,50)").raw();db.prepare("INSERT INTO issuance_counts VALUES('stripe','contribution',?,3,50)").bind(quarter()).raw();
 db.prepare("INSERT INTO issuance_hours VALUES('stripe','contribution',1,3,10)").raw();db.prepare("INSERT INTO issuance_hours VALUES('stripe','contribution',?,3,10)").bind(Math.floor(Date.now()/3600000)).raw();
 db.prepare("INSERT INTO issuance_pauses VALUES('stripe','contribution','2000-01-01T00:00:00Z')").raw();
 await issuer.scheduled({} as ScheduledController,env);
 const n=(sql:string)=>(db.db.prepare(sql).get() as {n:number}).n;
 assert.deepEqual([n('SELECT COUNT(*) AS n FROM juror_quota'),n('SELECT COUNT(*) AS n FROM issuance_counts'),n('SELECT COUNT(*) AS n FROM issuance_hours'),n('SELECT COUNT(*) AS n FROM issuance_pauses')],[0,1,1,0]);
});

test('issuance limits scale with the published headcount band, unknown bands get the smallest cap, and sandbox keys have none',()=>{
 assert.deepEqual(issuanceLimits('1,001-5,000','mailbox','contribution'),{cap:150,velocity:15});
 assert.deepEqual(issuanceLimits('1,001-5,000','mailbox','juror'),{cap:300,velocity:30});
 assert.deepEqual(issuanceLimits('100,001+','mailbox','contribution'),{cap:2000,velocity:200});
 assert.deepEqual(issuanceLimits('50,001-100,000','mailbox','contribution'),{cap:1200,velocity:120});
 for(const unknown of [null,undefined,'','Fewer than fifty','unknown'])assert.deepEqual(issuanceLimits(unknown,'mailbox','contribution'),{cap:50,velocity:10});
 assert.equal(issuanceLimits('50,001+','demo','contribution'),null);
 const bands=['11-50','201-500','1,001-5,000','5,001-10,000','10,001-50,000','50,001-100,000','100,001+'].map(b=>issuanceLimits(b,'mailbox','contribution')!.cap);
 assert.deepEqual([...bands].sort((a,b)=>a-b),bands,'a larger employer never gets a smaller cap');
 assert.ok(bands.every(c=>c>=25),'every cap allows at least one publication batch of 25');
 assert.deepEqual(keyLimits({verification_class:'mailbox',purpose:null,headcount_band:null,issuance_cap:null,velocity_limit:null}),{cap:50,velocity:10},'rows provisioned before limits existed get the smallest cap');
 assert.deepEqual(keyLimits({verification_class:'mailbox',purpose:'juror',headcount_band:null,issuance_cap:7,velocity_limit:3}),{cap:7,velocity:3});
});

test('the verifier never reads the public database: its only binding is VERIFIER and limits arrive in its own key rows',()=>{
 const source=readFileSync('worker/issuer.ts','utf8');
 assert.equal(/trusted_issuers|\bcompanies\b|env\.DB\b|env\.INTAKE\b/.test(source),false);
 const config=JSON.parse(readFileSync('issuer.wrangler.jsonc','utf8')) as {d1_databases:{binding:string}[];services?:unknown};
 assert.deepEqual(config.d1_databases.map(d=>d.binding),['VERIFIER']);assert.equal(config.services,undefined);
});

test('public migration 0006 gives every existing issuer key the contribution purpose and refuses unknown purposes',()=>{
 const {publicDb}=testEnv();
 publicDb.prepare('INSERT INTO trusted_issuers(id,company_slug,epoch,expires_at,verification_class,public_key_json) VALUES(?,?,?,?,?,?)').bind('stripe:q:mailbox','stripe','q',future,'mailbox','{}').raw();
 publicDb.prepare('INSERT INTO trusted_issuers(id,company_slug,epoch,expires_at,verification_class,public_key_json,purpose) VALUES(?,?,?,?,?,?,?)').bind('stripe:q:juror:mailbox','stripe','q',future,'mailbox','{}','juror').raw();
 assert.deepEqual(publicDb.db.prepare('SELECT id,purpose FROM trusted_issuers ORDER BY id').all().map(r=>[r.id,r.purpose]),[['stripe:q:juror:mailbox','juror'],['stripe:q:mailbox','contribution']]);
 assert.throws(()=>publicDb.prepare('INSERT INTO trusted_issuers(id,company_slug,epoch,expires_at,verification_class,public_key_json,purpose) VALUES(?,?,?,?,?,?,?)').bind('x','stripe','q',future,'mailbox','{}','admin').raw(),/CHECK/);
});

test('provisioning plans one contribution and one juror key per employer and embeds band-scaled limits in sealed rows only',async()=>{
 const tool=await import('../tools/provision-issuer.mjs' as string) as {EMPLOYERS:[string,string[]][];plannedKeys:(e:unknown,epoch:string)=>(IssuerKey&{domains:string[]})[];publicKeySql:(k:unknown[])=>string;sealedKeySql:(k:unknown[],m:string,b:Map<string,string|null>)=>Promise<string>;publicRegistry:(k:unknown[])=>Promise<(IssuerKey&{fingerprint:string})[]>;unbandedEmployers:(k:unknown[],b:Map<string,string|null>|null)=>string[]};
 const planned=tool.plannedKeys(tool.EMPLOYERS,'2026-Q4');
 assert.equal(planned.length,tool.EMPLOYERS.length*2);
 assert.deepEqual(planned.filter(k=>k.companySlug==='stripe').map(k=>[k.id,k.purpose,k.verificationClass]),[['stripe:2026-Q4:mailbox','contribution','mailbox'],['stripe:2026-Q4:juror:mailbox','juror','mailbox']]);
 assert.deepEqual(planned.filter(k=>k.companySlug==='northwind-labs').map(k=>k.id),['northwind-labs:2026-Q4:demo','northwind-labs:2026-Q4:juror:sandbox']);
 assert.ok(planned.every(k=>keyPurpose(k)===k.purpose),'every planned id agrees with its purpose');
 const pair=await suite().generateKey({modulusLength:2048,publicExponent:new Uint8Array([1,0,1])});
 const keys=await Promise.all(planned.filter(k=>k.companySlug==='stripe').map(async k=>({...k,expiresAt:future,publicKey:await crypto.subtle.exportKey('jwk',pair.publicKey),privateKey:await crypto.subtle.exportKey('jwk',pair.privateKey)})));
 const master=randomToken(32),sealed=await tool.sealedKeySql(keys,master,new Map([['stripe','5,001-10,000']]));
 const db=new TestD1();applyMigrations(db,'db/verifier-migrations');db.exec(sealed);
 assert.deepEqual(db.db.prepare('SELECT id,purpose,headcount_band,issuance_cap,velocity_limit FROM issuer_keys ORDER BY id').all().map(r=>Object.values(r)),[['stripe:2026-Q4:juror:mailbox','juror','5,001-10,000',600,60],['stripe:2026-Q4:mailbox','contribution','5,001-10,000',300,30]]);
 const publicSql=tool.publicKeySql(keys);assert.equal(/issuance_cap|velocity|sealed|"d":/.test(publicSql),false,'the public SQL carries no limits or private material');
 const {publicDb}=testEnv();publicDb.exec(publicSql);
 assert.deepEqual(publicDb.db.prepare('SELECT id,purpose FROM trusted_issuers WHERE company_slug=? ORDER BY id').all('stripe').map(r=>[r.id,r.purpose]),[['stripe:2026-Q4:juror:mailbox','juror'],['stripe:2026-Q4:mailbox','contribution']]);
 const registry=await tool.publicRegistry(keys);
 assert.equal(JSON.stringify(registry).includes('"d"'),false);for(const k of registry)assert.equal(k.fingerprint,await issuerKeyFingerprint(k));
 const sandbox=await Promise.all(planned.filter(k=>k.companySlug==='northwind-labs').map(async k=>({...k,expiresAt:future,publicKey:keys[0]!.publicKey,privateKey:keys[0]!.privateKey})));
 db.exec(await tool.sealedKeySql(sandbox,master,new Map([['northwind-labs','1,001-5,000']])));
 assert.deepEqual(db.db.prepare("SELECT issuance_cap,velocity_limit FROM issuer_keys WHERE company_slug='northwind-labs'").all().map(r=>Object.values(r)),[[null,null],[null,null]],'sandbox rows carry no limits');
});

test('local provisioning never touches the production private keys or registry, and next-quarter keys are planned ahead',async()=>{
 const tool=await import('../tools/provision-issuer.mjs' as string) as {provisionFiles:(remote:boolean)=>Record<'secrets'|'publicSql'|'registry'|'sealed',string>;provisionEpochs:(now:Date,next?:boolean)=>string[];keyExpiry:(epoch:string)=>string;publicKeySql:(k:unknown[],o?:{replace?:boolean})=>string};
 const local=tool.provisionFiles(false),remote=tool.provisionFiles(true);
 assert.deepEqual(remote,{secrets:'.issuer-secrets.json',publicSql:'db/issuer-public-keys.sql',registry:'db/issuer-public-keys.json',sealed:'.wrangler/provision/issuer-sealed-keys.sql'});
 for(const path of Object.values(local)) {
  assert.ok(path.startsWith('.wrangler/provision/local-'),`${path} is git-ignored and local-only`);
  assert.equal(Object.values(remote).includes(path),false,`${path} is never a production file`);
 }
 const build=await import('../tools/build.mjs' as string) as {PIN_REGISTRIES:{production:string;local:string}};
 assert.deepEqual(build.PIN_REGISTRIES,{production:remote.registry,local:local.registry},'a release build pins what --remote writes; --local pins what prepare-local writes');
 const prepareSource=readFileSync('tools/prepare-local.mjs','utf8').split('\n').filter(line=>!line.trim().startsWith('//')).join('\n');
 assert.match(prepareSource,/provisionFiles\(false\)/);assert.doesNotMatch(prepareSource,/db\/issuer-public-keys|issuer-secrets\.json'|--remote/,'prepare-local loads only local keys');
 assert.match(prepareSource,/'tools\/build\.mjs','--local'/,'the local client pins the local keys');
 const dev=await import('../tools/dev.mjs' as string) as {pinNote:(assets:string,localRegistry:boolean)=>string|null};
 const assets=(registry:string)=>`export const CLIENT_JS = "";\nexport const CLIENT_ISSUER_PINS = ${JSON.stringify({registry,path:'x',fingerprints:[],digest:null})};\n`;
 assert.match(dev.pinNote(assets('production'),true)!,/build\.mjs --local/,'starting the local stack with a release build says why local keys are refused');
 assert.equal(dev.pinNote(assets('local'),true),null);assert.equal(dev.pinNote(assets('production'),false),null,'no local keys yet: nothing to say');
 assert.deepEqual(tool.provisionEpochs(new Date('2026-09-22T00:00:00Z')),['2026-Q3']);
 assert.deepEqual(tool.provisionEpochs(new Date('2026-12-31T23:00:00Z'),true),['2026-Q4','2027-Q1']);
 assert.deepEqual(['2026-Q3','2026-Q4','2027-Q1'].map(tool.keyExpiry),['2027-01-01T00:00:00.000Z','2027-04-01T00:00:00.000Z','2027-07-01T00:00:00.000Z'],'issuance quarter plus one quarter of grace');
 const key={id:'stripe:2026-Q3:mailbox',companySlug:'stripe',epoch:'2026-Q3',expiresAt:future,verificationClass:'mailbox',purpose:'contribution',publicKey:{kty:'RSA',n:'n',e:'AQAB'}};
 assert.match(tool.publicKeySql([key]),/^INSERT OR IGNORE INTO trusted_issuers/,'a published production key is never altered');
 assert.match(tool.publicKeySql([key],{replace:true}),/^INSERT OR REPLACE INTO trusted_issuers/,'regenerated local keys replace the old local rows');
});

test('a remote provisioning run cannot silently put real employers on the smallest cap when their bands are unreadable',()=>{
 return import('../tools/provision-issuer.mjs' as string).then((tool:{plannedKeys:(e:unknown,epoch:string)=>IssuerKey[];EMPLOYERS:unknown;unbandedEmployers:(k:unknown[],b:Map<string,string|null>|null)=>string[]})=>{
  const keys=tool.plannedKeys(tool.EMPLOYERS,'2026-Q4');
  const real=[...new Set(keys.filter(k=>k.verificationClass==='mailbox').map(k=>k.companySlug))].sort();
  assert.deepEqual(tool.unbandedEmployers(keys,null),real,'a failed read leaves every real employer unbanded (and the remote run refuses)');
  assert.deepEqual(tool.unbandedEmployers(keys,new Map(real.map(s=>[s,'1,001-5,000']))),[],'fictional employers never need a band');
  assert.deepEqual(tool.unbandedEmployers(keys,new Map(real.filter(s=>s!=='meta').map(s=>[s,'1,001-5,000']))),['meta']);
  const source=readFileSync('tools/provision-issuer.mjs','utf8');
  assert.match(source,/remote&&unbanded\.length&&!process\.argv\.includes\('--accept-default-caps'\)/);
 });
});

// ---- Local tooling ----
type Vars=Record<string,string>;
test('each local worker gets only its own secrets, local secrets survive re-runs, and local inference never defaults to the billable binding',async()=>{
 const prepare=await import('../tools/prepare-local.mjs' as string) as {localVars:(e:{main?:Vars;verifier?:Vars;inference?:Vars},env:Vars,g?:()=>string)=>Record<string,Vars>;withoutSecrets:(env:Vars)=>Vars};
 let n=0;const files=prepare.localVars({},{TYPESAFE_API_KEY:'provider-key',ADMIN_TOKEN:'admin'},()=>`generated-${n++}`);
 assert.deepEqual(Object.keys(files).sort(),['.dev.vars','.dev.vars.inference','.dev.vars.main','.dev.vars.verifier']);
 // INTERNAL_TOKEN (owner decision 4) is the one secret two workers share: the main worker and the verifier, identical.
 const only=(vars:Vars,required:string[],optional:string[],what:string)=>{for(const k of required)assert.ok(k in vars,`${what} ${k}`);for(const k of Object.keys(vars))assert.ok(required.includes(k)||optional.includes(k),`${what} must not hold ${k}`);};
 only(files['.dev.vars.main']!,['ENVIRONMENT','RATE_LIMIT_SECRET','VERIFIER_ORIGIN'],['INTERNAL_TOKEN','SAMPLE_EMPLOYERS','POW_BITS','TESTIMONY_BATCH_MIN'],'main');
 assert.deepEqual(files['.dev.vars.inference'],{ENVIRONMENT:'development',JEV_PROVIDER:'typesafe',TYPESAFE_API_KEY:'provider-key'});
 only(files['.dev.vars.verifier']!,['ENVIRONMENT','ISSUER_MASTER_KEY','MAILBOX_PEPPER'],['INTERNAL_TOKEN','POW_BITS','SAMPLE_EMPLOYERS'],'verifier');
 // The local verifier lists and signs with the sandbox keys the local site shows (it hides them unless exactly 'on').
 assert.equal(files['.dev.vars.verifier']!.SAMPLE_EMPLOYERS,'on');assert.equal(files['.dev.vars.main']!.SAMPLE_EMPLOYERS,'on');
 assert.equal(prepare.localVars({verifier:{SAMPLE_EMPLOYERS:'off'}},{})['.dev.vars.verifier']!.SAMPLE_EMPLOYERS,'on','a re-run restores it');
 if('INTERNAL_TOKEN' in files['.dev.vars.main']!||'INTERNAL_TOKEN' in files['.dev.vars.verifier']!){assert.ok(files['.dev.vars.main']!.INTERNAL_TOKEN,'the shared token is set');assert.equal(files['.dev.vars.main']!.INTERNAL_TOKEN,files['.dev.vars.verifier']!.INTERNAL_TOKEN,'one shared token');}
 assert.deepEqual(files['.dev.vars'],{ENVIRONMENT:'development',VERIFIER_ORIGIN:'http://localhost:8790'},'the legacy shared file holds no secret');
 assert.equal(JSON.stringify(files).includes('admin'),false,'the admin token is written nowhere');
 const again=prepare.localVars({main:files['.dev.vars.main'],verifier:files['.dev.vars.verifier']},{},()=>'fresh');
 assert.equal(again['.dev.vars.verifier']!.ISSUER_MASTER_KEY,files['.dev.vars.verifier']!.ISSUER_MASTER_KEY,'locally sealed keys stay readable');
 assert.equal(again['.dev.vars.main']!.RATE_LIMIT_SECRET,files['.dev.vars.main']!.RATE_LIMIT_SECRET);
 assert.equal(again['.dev.vars.inference']!.TYPESAFE_API_KEY,'','no key anywhere stays empty');
 const kept=prepare.localVars({inference:files['.dev.vars.inference']},{},()=>'fresh');
 assert.equal(kept['.dev.vars.inference']!.TYPESAFE_API_KEY,'provider-key','a re-run without the key in .env keeps the one already in the file');
 assert.equal(prepare.localVars({inference:files['.dev.vars.inference']},{TYPESAFE_API_KEY:'rotated'})['.dev.vars.inference']!.TYPESAFE_API_KEY,'rotated','a key in .env wins');
 assert.deepEqual(prepare.withoutSecrets({PATH:'/bin',TYPESAFE_API_KEY:'k',ISSUER_MASTER_KEY:'m',MAILBOX_PEPPER:'p',RATE_LIMIT_SECRET:'r',ADMIN_TOKEN:'a'}),{PATH:'/bin'});
 const dev=await import('../tools/dev.mjs' as string) as {WORKERS:{name:string;envFile:string;owns:string[]}[];envFileProblems:(w:unknown,text:string)=>string[];childEnv:(env:Vars)=>Vars};
 assert.deepEqual(dev.WORKERS.map(w=>w.name),['inference','verifier','main'],'inference is up before the main worker binds to it');
 const text=(vars:Vars)=>Object.entries(vars).map(([k,v])=>`${k}=${v}`).join('\n');
 for(const worker of dev.WORKERS)assert.deepEqual(dev.envFileProblems(worker,text(files[worker.envFile]!)),[],worker.name);
 const main=dev.WORKERS.find(w=>w.name==='main')!,inference=dev.WORKERS.find(w=>w.name==='inference')!;
 assert.equal(dev.envFileProblems(main,'ENVIRONMENT=development\nTYPESAFE_API_KEY=k\nISSUER_MASTER_KEY=m').length,2,'another worker\'s secret in the main env file refuses the start');
 assert.match(dev.envFileProblems(inference,'TYPESAFE_API_KEY=k').join(),/billable/);
 assert.deepEqual(dev.childEnv({HOME:'/h',RATE_LIMIT_SECRET:'r',TYPESAFE_API_KEY:'k'}),{HOME:'/h'});
 const select=(dev as unknown as {selectedWorkers:(argv:string[])=>{name:string}[]}).selectedWorkers;
 assert.deepEqual(select(['node','dev.mjs','--restart']).map(w=>w.name),['inference','verifier','main'],'without --only every worker (re)starts');
 assert.deepEqual(select(['node','dev.mjs','--restart','--only=verifier']).map(w=>w.name),['verifier'],'--only restarts one worker and leaves the others running');
 assert.throws(()=>select(['node','dev.mjs','--only=verfier']),/Unknown worker verfier/);
});

test('db.mjs names each pending migration by its own header and flags every row-changing statement for the remote gate',async()=>{
 // db/migrations/0001_reconciliation.sql predates headers (a comment-only header is requested; db.mjs prints '(no header comment)').
 const db=await import('../tools/db.mjs' as string) as {header:(f:string)=>string;rowChanges:(sql:string)=>string[]};
 const {readdirSync}=await import('node:fs');
 for(const dir of ['db/migrations','db/intake-migrations','db/verifier-migrations'])for(const file of readdirSync(dir).filter(f=>/^\d{4}_.*\.sql$/.test(f)&&`${dir}/${f}`!=='db/migrations/0001_reconciliation.sql'))assert.ok(db.header(`${dir}/${file}`).length>20,`${dir}/${file} states what it changes`);
 assert.deepEqual(db.rowChanges(readFileSync('db/migrations/0006_juror_keys.sql','utf8')),[],'public 0006 is additive');
 assert.deepEqual(db.rowChanges(readFileSync('db/verifier-migrations/0002_juror_tokens_and_issuance_controls.sql','utf8')),[],'verifier 0002 is additive');
 for(const file of ['0005_domain_registry_and_community_keys.sql','0006_community_email_budget_and_withdrawals.sql'])assert.deepEqual(db.rowChanges(readFileSync(`db/verifier-migrations/${file}`,'utf8')),[],`verifier ${file} is additive`);
 assert.deepEqual(db.rowChanges('-- DELETE FROM x in a comment\n/* UPDATE y SET z=1 */\nALTER TABLE t ADD COLUMN c TEXT;\nCREATE TRIGGER g BEFORE UPDATE OF used, n ON t BEGIN SELECT 1; END;\nCREATE TRIGGER h AFTER DELETE ON t BEGIN SELECT RAISE(ABORT, \'no delete\'); END;\nCREATE TABLE c(p TEXT REFERENCES t(id) ON DELETE CASCADE ON UPDATE SET NULL);\nINSERT INTO t VALUES(\'please drop and update\');'),[],'comments, strings, trigger events and foreign-key actions change no rows');
 // Fails closed: every statement that can change or remove rows, columns or tables is flagged, however it is spelled.
 for(const sql of ['delete from submissions;','UPDATE testimony SET body=1;','DROP TABLE IF EXISTS legacy;','INSERT OR REPLACE INTO k VALUES(1);','INSERT INTO t(a) VALUES(1) ON CONFLICT(a) DO UPDATE SET a=2;','ALTER TABLE t DROP COLUMN c;','ALTER TABLE t RENAME TO u;','UPDATE OR REPLACE t SET a=1;','UPDATE t AS a SET x=1;','DELETE FROM "quoted";','REPLACE INTO k VALUES(1);','CREATE TRIGGER k AFTER INSERT ON t BEGIN DELETE FROM u; END;'])assert.ok(db.rowChanges(sql).length>0,sql);
 for(const file of ['db/verifier-migrations/0001_sealed_keys_and_quota.sql','db/migrations/0004_legacy_scrub.sql'])assert.ok(db.rowChanges(readFileSync(file,'utf8')).length>0,`${file} is gated`);
 const source=readFileSync('tools/db.mjs','utf8');
 assert.equal(source.includes("f === '0001_sealed_keys_and_quota.sql')"),false,'verifier 0001 also passes the generic gate');
 assert.match(source,/if \(mode === '--remote'\) \{ console\.error\(`Refusing: could not read/,'an unreadable remote database is refused, never treated as empty');
});

// ================= Round-3 red-team hardening =================
test('networkKey: an IPv6 client is its /64, an IPv4-mapped address is its IPv4 address, and nothing else is merged (RT-ABUSE-03, WS-04)',()=>{
 for(const [a,b] of [['2001:db8:1:2::1','2001:db8:1:2:ffff:ffff:ffff:ffff'],['2001:DB8:1:2::1','2001:db8:0001:0002:0:0:0:9'],['[2001:db8:1:2::1]','2001:db8:1:2::1%eth0'],['::ffff:198.51.100.9','198.51.100.9'],['::ffff:c633:6409','198.51.100.9']]) assert.equal(networkKey(a),networkKey(b),`${a} ~ ${b}`);
 for(const [a,b] of [['2001:db8:1:2::1','2001:db8:1:3::1'],['198.51.100.9','198.51.100.10'],['2001:db8::1','198.51.100.9']]) assert.notEqual(networkKey(a),networkKey(b),`${a} vs ${b}`);
 assert.equal(networkKey('2001:db8:1:2::1'),'2001:db8:1:2::/64');
 assert.equal(networkKey(null),'local');assert.equal(networkKey(' 198.51.100.9 '),'198.51.100.9');
 for(const odd of ['1:2:3:4:5:6:7:8:9','1::2::3','not-an-address','::ffff:999.1.1.1']) assert.equal(networkKey(odd),odd,'an unparsable value is kept as it is (never merged with others)');
});

test('readCapped never buffers more than its cap: a declared or a streamed (chunked) larger body is refused (WS-07)',async()=>{
 assert.equal(await readCapped(new Request('https://x.test',{method:'POST',body:'{"a":1}'}),10),'{"a":1}');
 await assert.rejects(readCapped(new Request('https://x.test',{method:'POST',headers:{'content-length':'999999'},body:'{}'}),10),/request_too_large/);
 let pulled=0;
 const endless=new ReadableStream<Uint8Array>({pull(controller){pulled++;controller.enqueue(new Uint8Array(1024));}});
 await assert.rejects(readCapped(new Request('https://x.test',{method:'POST',body:endless,duplex:'half'} as RequestInit),4000),/request_too_large/);
 assert.ok(pulled<=6,`stopped after ${pulled} chunks`);
});

test('the verifier routes each POST path to exactly one request shape, answers any other path 404, refuses a chunked oversized body with 413, and limits by network before reading (WS-07)',async()=>{
 const {db,env}=await verifierEnv();
 const sandbox=await addKey(env,db,{id:'northwind-labs:q:demo',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo'},[]);
 const prepared=await prepareProof(sandbox,(await proofFixture()).publicKey);
 const issueBody={action:'issue',keyId:sandbox.id,blinded:prepared.blinded};
 assert.deepEqual([(await call(env,issueBody,'/whatever')).status,(await call(env,issueBody,'/')).status,(await call(env,issueBody,'/issue/')).status],[404,404,404]);
 assert.deepEqual([(await call(env,issueBody,'/start')).status,(await call(env,{action:'start',keyId:sandbox.id,email:'a@b.test'},'/issue')).status],[400,400],'each path accepts only its own action');
 assert.equal((await call(env,{keyId:sandbox.id,blinded:[prepared.blinded]},'/issue')).status,400);
 assert.equal((await call(env,issueBody,'/issue')).status,200);
 const chunked=new ReadableStream<Uint8Array>({start(controller){for(let i=0;i<10;i++)controller.enqueue(new TextEncoder().encode(' '.repeat(1000)));controller.close();}});
 const big=await issuer.fetch(new Request('https://verify.test/issue',{method:'POST',headers:{origin:'https://shouldiworkthere.com','content-type':'application/json'},body:chunked,duplex:'half'} as RequestInit),env);
 assert.equal(big.status,413);
 // The per-network limiter runs before the body is read, keyed on the /64.
 const keys:string[]=[];let read=false;
 (env as {ABUSE?:unknown}).ABUSE={limit:async({key}:{key:string})=>{keys.push(key);return {success:false};}};
 const watched=new ReadableStream<Uint8Array>({pull(controller){read=true;controller.enqueue(new TextEncoder().encode(JSON.stringify(issueBody)));controller.close();}},{highWaterMark:0});
 const limited=await issuer.fetch(new Request('https://verify.test/issue',{method:'POST',headers:{origin:'https://shouldiworkthere.com','cf-connecting-ip':'2001:db8:5:6::1'},body:watched,duplex:'half'} as RequestInit),env);
 assert.equal(limited.status,429);assert.equal(read,false,'the body was never read');
 await issuer.fetch(new Request('https://verify.test/issue',{method:'POST',headers:{origin:'https://shouldiworkthere.com','cf-connecting-ip':'2001:db8:5:6:aaaa::2'},body:'{}'}),env);
 assert.equal(keys.length,2);assert.equal(keys[0],keys[1],'two addresses in one /64 share one limiter key');
});

test('sandbox juror tokens are limited per network: two addresses in one IPv6 /64 share one bucket (WS-04)',async()=>{
 const {db,env}=await verifierEnv();const keys:string[]=[];
 (env as {JUROR_LIMIT?:unknown}).JUROR_LIMIT={limit:async({key}:{key:string})=>{keys.push(key);return {success:true};}};
 const key=await addKey(env,db,{id:'northwind-labs:q:juror:sandbox',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo',purpose:'juror'},[]);
 for(const ip of ['2001:db8:9:9::1','2001:db8:9:9::beef']) {
  const body={keyId:key.id,blinded:[(await prepareJurorToken(key)).blinded],adultConfirmed:true};
  const r=await issuer.fetch(new Request('https://verify.test/issue-juror',{method:'POST',headers:{origin:'https://shouldiworkthere.com','content-type':'application/json','cf-connecting-ip':ip},body:JSON.stringify({...body,pow:await stampFor(body,'/issue-juror')})}),env);
  assert.equal(r.status,200);
 }
 assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
});

test('every rate-limit namespace_id is unique across the three Workers, so no two limiters share state (RT-CFG-07)',()=>{
 const ids=['wrangler.jsonc','inference.wrangler.jsonc','issuer.wrangler.jsonc'].flatMap(file=>((JSON.parse(readFileSync(file,'utf8')) as {ratelimits?:{name:string;namespace_id:string}[]}).ratelimits??[]).map(r=>`${r.namespace_id} (${file} ${r.name})`));
 const seen=new Map<string,string>();
 for(const id of ids){const ns=id.split(' ')[0]!;assert.ok(!seen.has(ns),`${id} reuses the namespace of ${seen.get(ns)}`);seen.set(ns,id);}
 assert.ok(ids.length>=7);
});

test('verifier 0004 drops the legacy tables with exact issuance and redemption times, and tools/db.mjs gates it as a row change (RT-RET-08)',async()=>{
 const db=new TestD1();applyMigrations(db,'db/verifier-migrations');
 const tables=(db.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(r=>r.name);
 for(const legacy of ['attestation_jobs','issued_credentials','revocation_list','issuance_quota','challenges','issuance_quota_v2']) assert.ok(!tables.includes(legacy),legacy);
 for(const current of ['issuer_keys','mailbox_challenges','issuance_quota_v3','juror_quota','issuance_counts','issuance_hours','issuance_pauses']) assert.ok(tables.includes(current),current);
 const tool=await import('../tools/db.mjs' as string) as {rowChanges:(sql:string)=>string[];header:(file:string)=>string;LEGACY_VERIFIER_TABLES:string[]};
 const file='db/verifier-migrations/0004_drop_legacy_tables.sql';
 assert.ok(tool.rowChanges(readFileSync(file,'utf8')).length>=6,'applied remotely only with --accept-row-changes');
 assert.match(tool.header(file),/REMOVES ROWS/);
 assert.deepEqual([...tool.LEGACY_VERIFIER_TABLES].sort(),['attestation_jobs','challenges','issuance_quota','issuance_quota_v2','issued_credentials','revocation_list']);
});

test('provisioning never adopts a local key as a production key: provenance and modulus checks refuse reuse (RT-KEY-02, WS-01, RT-C1)',async()=>{
 const tool=await import('../tools/provision-issuer.mjs' as string) as {keyProvenanceProblems:(entries:unknown[],o:{masterKeyId:string;localModuli?:Set<string>})=>string[];masterKeyId:(k:string)=>Promise<string>;moduli:(keys:unknown)=>Set<string>;sampleEmployers:(e:[string,string[]][],c:unknown)=>[string,string[]][];EMPLOYERS:[string,string[]][]};
 const id=await tool.masterKeyId('production-master-key');
 assert.notEqual(id,await tool.masterKeyId('local-master-key'));assert.equal(id.includes('production'),false,'only a digest of the master key is recorded');
 const remote={id:'stripe:2026-Q4:mailbox',origin:'remote',masterKeyId:id,publicKey:{n:'remote-n'}};
 assert.deepEqual(tool.keyProvenanceProblems([remote],{masterKeyId:id}),[]);
 // Keys written by a local run, or before provenance existed (the 15:16 files), or under another master key: refused.
 for(const entry of [{...remote,origin:'local'},{id:remote.id,publicKey:{n:'x'}},{...remote,masterKeyId:await tool.masterKeyId('other')}]) assert.match(tool.keyProvenanceProblems([entry],{masterKeyId:id}).join(),/not created by a remote run/);
 assert.match(tool.keyProvenanceProblems([remote],{masterKeyId:id,localModuli:new Set(['remote-n'])}).join(),/also local keys/,'a key the local registry or verifier holds is never reused');
 assert.deepEqual([...tool.moduli([{publicKey:{n:'a'}},{publicKey:{}},null])],['a']);
 // Fictional employers seeded in the public database get sandbox keys without editing the list (RT-B1).
 assert.deepEqual(tool.sampleEmployers(tool.EMPLOYERS,[{slug:'northwind-labs',kind:'sample'},{slug:'aurora-freight',kind:'sample'},{slug:'charles-schwab',kind:'real'}]),[['aurora-freight',[]]]);
 assert.deepEqual(tool.sampleEmployers(tool.EMPLOYERS,null),[]);
 const source=readFileSync('tools/provision-issuer.mjs','utf8');
 assert.match(source,/if\(remote\) \{\n  const problems=keyProvenanceProblems\(registry,\{masterKeyId:keyId,localModuli:await localKeyModuli\(\)\}\);/,'a remote run checks provenance before anything is generated or written');
});

test('this checkout holds no production registry that shares a key with the local registry (RT-C1)',()=>{
 const read=(file:string)=>{try {return JSON.parse(readFileSync(file,'utf8')) as {publicKey?:{n?:string}}[];} catch {return [];}};
 const production=new Set(read('db/issuer-public-keys.json').map(k=>k.publicKey?.n).filter(Boolean));
 const shared=read('.wrangler/provision/local-issuer-public-keys.json').filter(k=>production.has(k.publicKey?.n));
 assert.equal(shared.length,0,'move db/issuer-public-keys.* and .issuer-secrets.json aside: they are local keys');
});

test('local tooling: .env with a secret is tightened to 0600, and dev.mjs warns when the production registry holds a local key (WS-10, RT-C1)',async()=>{
 const prepare=await import('../tools/prepare-local.mjs' as string) as {envFileNeedsTightening:(mode:number,text:string)=>boolean};
 assert.equal(prepare.envFileNeedsTightening(0o100644,'TYPESAFE_API_KEY=abc\nADMIN_TOKEN=def\n'),true);
 assert.equal(prepare.envFileNeedsTightening(0o100640,'export ADMIN_TOKEN=def'),true);
 assert.equal(prepare.envFileNeedsTightening(0o100600,'TYPESAFE_API_KEY=abc'),false);
 assert.equal(prepare.envFileNeedsTightening(0o100644,'JEV_PROVIDER=typesafe\nTYPESAFE_API_KEY=\n'),false,'an empty value is not a secret');
 const dev=await import('../tools/dev.mjs' as string) as {sharedKeyNote:(a:string,b:string)=>string|null};
 const key=(n:string)=>JSON.stringify([{id:'k',publicKey:{n}}]);
 assert.match(dev.sharedKeyNote(key('same'),key('same'))!,/also local keys/);
 assert.equal(dev.sharedKeyNote(key('prod'),key('local')),null);
});

test('juror tokens are issued only with the 18+ confirmation: anything but adultConfirmed:true is refused before a key is read or anything is signed',async()=>{
 const {db,env}=await verifierEnv();let limited=0;
 (env as {JUROR_LIMIT?:unknown}).JUROR_LIMIT={limit:async()=>{limited++;return {success:true};}};
 const key=await addKey(env,db,{id:'northwind-labs:q:juror:sandbox',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo',purpose:'juror'},[]);
 const blinded=[(await prepareJurorToken(key)).blinded];
 for(const confirmation of [{},{adultConfirmed:false},{adultConfirmed:'true'},{adultConfirmed:1},{adultConfirmed:null}]) {
  const r=await call(env,{keyId:key.id,blinded,...confirmation},'/issue-juror');
  assert.deepEqual([r.status,await r.json()],[400,{error:'adult_confirmation_required'}],JSON.stringify(confirmation));
 }
 assert.equal(limited,0,'nothing reached the per-network juror limiter, so a refused request spends none of it');
 // Even for an unknown key the confirmation is asked first (it is a precondition, not an oracle for key ids).
 assert.deepEqual(await (await call(env,{keyId:'nope',blinded},'/issue-juror')).json(),{error:'adult_confirmation_required'});
 const ok=await call(env,{keyId:key.id,blinded,adultConfirmed:true},'/issue-juror');
 assert.equal(ok.status,200);assert.equal((await ok.json() as {blindSignatures:string[]}).blindSignatures.length,1);
 // Contribution credentials are unchanged: /issue neither needs nor accepts the juror confirmation.
 assert.deepEqual(await (await call(env,{action:'issue',keyId:key.id,blinded:blinded[0],adultConfirmed:true})).json(),{error:'invalid_request'});
});

test('the verifier sends HSTS on every response, errors and preflights included, and redirects plain HTTP to HTTPS before reading anything',async()=>{
 const {db,env}=await verifierEnv();
 const HSTS='max-age=63072000; includeSubDomains';
 const origin={origin:'https://shouldiworkthere.com'};
 const responses:[string,Response][]=[
  ['GET /keys',await issuer.fetch(new Request('https://verify.test/keys'),env)],
  ['GET /stats',await issuer.fetch(new Request('https://verify.test/stats'),env)],
  ['GET unknown path (404)',await issuer.fetch(new Request('https://verify.test/nope'),env)],
  ['OPTIONS preflight',await issuer.fetch(new Request('https://verify.test/issue',{method:'OPTIONS',headers:origin}),env)],
  ['POST from another origin (403)',await issuer.fetch(new Request('https://verify.test/issue',{method:'POST',headers:{origin:'https://evil.test'},body:'{}'}),env)],
  ['POST malformed (400)',await call(env,{bad:true},'/issue')],
  ['POST too large (413)',await issuer.fetch(new Request('https://verify.test/issue',{method:'POST',headers:{...origin,'content-length':'99999'},body:'{}'}),env)],
 ];
 const limitedEnv={...env,ABUSE:{limit:async()=>({success:false})}} as IssuerEnv;
 responses.push(['POST rate limited (429)',await call(limitedEnv,{bad:true},'/issue')]);
 const broken={...env,VERIFIER:{prepare:()=>{throw new Error('down');}}} as unknown as IssuerEnv;
 responses.push(['GET /keys, database down (503)',await issuer.fetch(new Request('https://verify.test/keys'),broken)]);
 for(const [what,r] of responses) assert.equal(r.headers.get('strict-transport-security'),HSTS,what);
 assert.deepEqual(responses.map(([,r])=>r.status),[200,200,404,200,403,400,413,429,503]);
 // Plain HTTP: a permanent redirect to the same path and query over HTTPS, with HSTS, whatever the method; nothing is read.
 let touched=0;const watched={...env,VERIFIER:new Proxy(db,{get:(t,p)=>{touched++;return Reflect.get(t,p);}})} as unknown as IssuerEnv;
 for(const [method,path] of [['GET','/keys?x=1&y=2'],['POST','/issue-juror'],['OPTIONS','/start']] as const) {
  const r=await issuer.fetch(new Request(`http://verify.test${path}`,{method,headers:origin,...(method==='POST'?{body:'{"keyId":"k"}'}:{})}),watched);
  assert.equal(r.status,301,`${method} ${path}`);assert.equal(r.headers.get('location'),`https://verify.test${path}`);assert.equal(r.headers.get('strict-transport-security'),HSTS);
  assert.equal(await r.text(),'','a redirect carries no body');
 }
 assert.equal(touched,0,'the database is never touched over plain HTTP');
 // A local development stack is plain HTTP by design, and sends no HSTS (as the main worker in development).
 const dev={...env,ENVIRONMENT:'development'} as IssuerEnv;
 // `wrangler dev` hands the worker the custom-domain route's host, not localhost, and rewrites a Location back to
 // localhost: redirecting there looped every request of the local stack (seen 2026-09-23), so development never redirects.
 for(const url of ['http://localhost:8790/keys','http://127.0.0.1:8790/keys','http://verify.shouldiworkthere.com/keys']) {
  const r=await issuer.fetch(new Request(url),dev);assert.equal(r.status,200,url);assert.equal(r.headers.get('strict-transport-security'),null,url);
 }
});

// ================= Owner decisions 4 and 5 (2026-09-23): community employers and proof of work =================
import {keySource,communityKeyId,issuerKeyExpiry,COMMUNITY_KEY_LIMITS,EMPLOYER_SLUG} from '../shared/proof.ts';
import {leadingZeroBits,powPrefix} from '../shared/pow.ts';

/** POST /internal/employers as the main worker sends it over its service binding: no browser origin, the shared token. */
const register=(env:IssuerEnv,body:unknown,token:string|null=(env as {INTERNAL_TOKEN?:string}).INTERNAL_TOKEN??null,headers:Record<string,string>={})=>issuer.fetch(new Request('https://verify.test/internal/employers',{method:'POST',headers:{'content-type':'application/json',...(token===null?{}:{authorization:`Bearer ${token}`}),...headers},body:JSON.stringify(body)}),env);
type Registered={registered:boolean;created:boolean;companySlug:string;domain:string;keys:(IssuerKey&{mailboxEnabled:boolean})[]};
const count=(db:TestD1,sql:string)=>(db.db.prepare(sql).get() as {n:number}).n;

test('/start and /issue-juror require a proof of work bound to this origin, route, key and request, checked before any key is read or email sent',async()=>{
 const {db,env,sent}=await verifierEnv();
 const key=await addKey(env,db,{id:'stripe:q:mailbox',companySlug:'stripe',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['stripe.com']);
 const body={action:'start',keyId:key.id,email:'jane@stripe.com'};
 const missing=await rawCall(env,body,'/start'),refusal=await missing.json() as {error:string;reason:string;bits:number;minute:number};
 assert.equal(missing.status,400);assert.deepEqual([refusal.error,refusal.reason,refusal.bits],['pow_required','pow_missing',8],'the refusal says what to recompute with');
 assert.ok(Math.abs(refusal.minute-powMinute())<=1,'and the verifier\'s minute, for a device with a wrong clock');
 assert.equal((await (await rawCall(env,{...body,keyId:'unknown:key'},'/start')).json() as {error:string}).error,'pow_required','checked before the key is looked up');
 const bound=async(over:{origin?:string;action?:'start'|'issue-juror'|'add-employer';keyId?:string;email?:string},minute?:number)=>solvePow({origin:over.origin??SITE,action:over.action??'start',keyId:over.keyId??key.id,subject:await powSubject.email(over.email??body.email)},{bits:8,...(minute===undefined?{}:{minute})});
 const wrong={
  'another address':await bound({email:'sam@stripe.com'}),'another key':await bound({keyId:'stripe:q2:mailbox'}),'another origin':await bound({origin:'https://evil.example'}),
  'another route':await bound({action:'issue-juror'}),'a listing stamp':await bound({action:'add-employer'}),'a stale minute':await bound({},powMinute()-5),'no nonce':{minute:powMinute()},
 };
 for(const [what,pow] of Object.entries(wrong)) {
  const r=await rawCall(env,{...body,pow},'/start');assert.deepEqual([r.status,(await r.json() as {error:string}).error],[400,'pow_required'],what);
 }
 // Too weak for the configured difficulty: exactly the zero bits it has pass, one more is refused.
 const good=(await stampFor(body,'/start'))!;
 const bits=leadingZeroBits(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(powPrefix({origin:SITE,action:'start',keyId:key.id,subject:await powSubject.email(body.email)},good.minute)+good.nonce))));
 const harder={...env,POW_BITS:String(bits+1)} as IssuerEnv;
 assert.deepEqual(await (await rawCall(harder,{...body,pow:good},'/start')).json(),{error:'pow_required',reason:'pow_insufficient',bits:bits+1,minute:powMinute()});
 assert.equal(sent.length,0,'no refused request sends an email');assert.equal(count(db,'SELECT COUNT(*) AS n FROM mailbox_challenges'),0,'or writes a challenge');
 assert.equal((await rawCall(env,{...body,pow:good},'/start')).status,200);assert.equal(sent.length,1);
 // Juror batches: bound to the exact blinded messages, in order.
 const juror=await addKey(env,db,{id:'northwind-labs:q:juror:sandbox',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo',purpose:'juror'},[]);
 const batch=(await jurorBatch(juror,2)).map(p=>p.blinded),jurorBody={keyId:juror.id,blinded:batch,adultConfirmed:true};
 assert.equal((await (await rawCall(env,jurorBody,'/issue-juror')).json() as {error:string}).error,'pow_required');
 const reordered=await stampFor({...jurorBody,blinded:[...batch].reverse()},'/issue-juror'),single=await stampFor({...jurorBody,blinded:[batch[0]]},'/issue-juror');
 for(const pow of [reordered,single]) assert.equal((await (await rawCall(env,{...jurorBody,pow},'/issue-juror')).json() as {error:string}).error,'pow_required');
 assert.equal((await rawCall(env,{...jurorBody,pow:await stampFor(jurorBody,'/issue-juror')},'/issue-juror')).status,200);
 // /keys states the difficulty; unset, it is the default.
 assert.deepEqual((await (await issuer.fetch(new Request('https://verify.test/keys'),env)).json() as {pow:unknown}).pow,{version:1,bits:8,windowMinutes:2});
 const {POW_BITS:_unset,...defaults}=env as IssuerEnv&{POW_BITS?:string};
 assert.deepEqual((await (await issuer.fetch(new Request('https://verify.test/keys'),defaults as IssuerEnv)).json() as {pow:unknown}).pow,{version:1,bits:20,windowMinutes:2});
 assert.equal((await (await rawCall(defaults as IssuerEnv,{...body,pow:good},'/start')).json() as {bits:number}).bits,20,'an 8-bit stamp is refused at the default difficulty');
});

test('registration is authenticated by INTERNAL_TOKEN, compared in constant time; a wrong or missing token is refused and rate limited, and the route answers no browser',async()=>{
 const {db,env}=await verifierEnv();let limited=0;
 (env as {ABUSE?:unknown}).ABUSE={limit:async()=>{limited++;return {success:true};}};
 const body={slug:'acme-widgets',domain:'acmewidgets.com'},token=(env as {INTERNAL_TOKEN:string}).INTERNAL_TOKEN;
 for(const [what,r] of [['a wrong token',await register(env,body,randomToken(32))],['no header',await register(env,body,null)],['the token with one character changed',await register(env,body,token.slice(0,-1)+(token.endsWith('A')?'B':'A'))],['another scheme',await register(env,body,null,{authorization:`Basic ${token}`})],['a token prefix',await register(env,body,token.slice(0,16))]] as const)
  assert.deepEqual([r.status,await r.json()],[401,{error:'unauthorized'}],what);
 assert.equal(limited,5,'each refused attempt counts against the caller\'s network');
 (env as {ABUSE?:unknown}).ABUSE={limit:async()=>({success:false})};
 assert.equal((await register(env,body,randomToken(32))).status,429);
 for(const configured of [undefined,'','short-token']) {
  const r=await register({...env,INTERNAL_TOKEN:configured} as IssuerEnv,body,configured??'x');
  assert.deepEqual([r.status,await r.json()],[503,{error:'internal_unavailable'}],`INTERNAL_TOKEN ${JSON.stringify(configured)}`);
 }
 assert.deepEqual([count(db,'SELECT COUNT(*) AS n FROM employer_domains'),count(db,'SELECT COUNT(*) AS n FROM issuer_keys')],[0,0],'nothing was registered or created');
 assert.equal((await issuer.fetch(new Request('https://verify.test/internal/employers'),env)).status,404,'GET is not a route');
 (env as {REGISTER_LIMIT?:unknown}).REGISTER_LIMIT={limit:async()=>({success:false})};
 assert.equal((await register(env,body)).status,429,'registrations share one limit per Cloudflare location, whoever calls');
 delete (env as {REGISTER_LIMIT?:unknown}).REGISTER_LIMIT;
 const fromPage=await register(env,body,token,{origin:SITE});
 assert.equal(fromPage.status,200);assert.equal(fromPage.headers.get('access-control-allow-origin'),null,'no CORS: a browser page can never read it');
 assert.equal(JSON.stringify(await fromPage.json()).includes(token),false,'the token is never echoed');
});

test('registering a domain creates the employer\'s contribution and juror keys on demand: RSA-2048, sealed under the master key, conservative caps, served at /keys as community keys',async()=>{
 const {db,env,sent}=await verifierEnv();
 const r=await register(env,{slug:'acme-widgets',domain:' AcmeWidgets.COM. '});assert.equal(r.status,200);
 const text=await r.text(),out=JSON.parse(text) as Registered,epoch=quarter();
 assert.deepEqual([out.registered,out.created,out.companySlug,out.domain],[true,true,'acme-widgets','acmewidgets.com'],'the domain is normalized');
 assert.deepEqual(out.keys.map(k=>[k.id,k.purpose,k.source,k.verificationClass,k.epoch,k.expiresAt,k.mailboxEnabled]).sort(),[
  [communityKeyId('acme-widgets',epoch,'contribution'),'contribution','community','mailbox',epoch,issuerKeyExpiry(epoch),true],
  [`acme-widgets:${epoch}:juror:community`,'juror','community','mailbox',epoch,issuerKeyExpiry(epoch),true]].sort());
 assert.equal(/sealed|"d":|"p":|"q":|"dp":|"qi":/.test(text),false,'no private material in the answer');
 const rows=db.db.prepare("SELECT * FROM issuer_keys WHERE source='community' ORDER BY id").all() as {id:string;purpose:string;domains_json:string;issuance_cap:number;velocity_limit:number;headcount_band:string|null;sealed_private_key:string;public_key_json:string}[];
 assert.deepEqual(rows.map(k=>[k.purpose,k.domains_json,k.headcount_band,k.issuance_cap,k.velocity_limit]),[['contribution','["acmewidgets.com"]',null,COMMUNITY_KEY_LIMITS.contribution.cap,COMMUNITY_KEY_LIMITS.contribution.velocity],['juror','["acmewidgets.com"]',null,COMMUNITY_KEY_LIMITS.juror.cap,COMMUNITY_KEY_LIMITS.juror.velocity]]);
 for(const row of rows) {
  const pub=JSON.parse(row.public_key_json) as JsonWebKey,priv=await openIssuerKey(env.ISSUER_MASTER_KEY,row.id,row.sealed_private_key);
  assert.equal(decode(pub.n!).length,256,'RSA-2048');assert.equal(priv.n,pub.n);assert.ok(priv.d);assert.equal(row.sealed_private_key.includes(priv.d!),false);
  await assert.rejects(openIssuerKey(env.ISSUER_MASTER_KEY,`${row.id}x`,row.sealed_private_key),'sealed to its own key id');
  await assert.rejects(openIssuerKey(randomToken(32),row.id,row.sealed_private_key),'and to the master key');
 }
 assert.notEqual(rows[0]!.public_key_json,rows[1]!.public_key_json,'two distinct keys');
 // /keys serves both exactly as registration answered, labeled community; the curated form of the same key differs.
 const listed=(await (await issuer.fetch(new Request('https://verify.test/keys'),env)).json() as {keys:(IssuerKey&{mailboxEnabled:boolean})[]}).keys;
 assert.deepEqual(listed.filter(k=>k.source==='community'),out.keys);
 const contribution=out.keys.find(k=>k.purpose==='contribution')!,jurorKey=out.keys.find(k=>k.purpose==='juror')!;
 assert.equal(sameIssuerKey(contribution,{...contribution}),true);
 const {source:_dropped,...unlabelled}=contribution;
 for(const copy of [unlabelled as IssuerKey,{...contribution,source:'curated' as const}]) assert.equal(sameIssuerKey(contribution,copy),false,'a copy that drops or changes the source is another key');
 // End to end: a mailbox at the registered domain gets a credential that validates offline; another domain cannot.
 const issued=await credential(env,sent,contribution,'pat@acmewidgets.com');assert.equal(issued.response.status,200);
 assert.ok(await validateProof(await issued.prepared.finalize((await issued.response.json() as {blindSignature:string}).blindSignature),contribution,'acme-widgets'));
 assert.deepEqual(await (await call(env,{action:'start',keyId:contribution.id,email:'pat@gmail.com'})).json(),{error:'use_approved_work_domain'});
 const s=await call(env,{action:'start',keyId:jurorKey.id,email:'lee@acmewidgets.com'});const {challengeId}=await s.json() as {challengeId:string};
 const tokens=await jurorBatch(jurorKey,2);
 const signed=await jurorCall(env,{keyId:jurorKey.id,blinded:tokens.map(t=>t.blinded),challengeId,code:codeFrom(sent.at(-1)!.text)});
 assert.equal(signed.status,200);assert.ok(await validateJurorToken(await tokens[0]!.finalize((await signed.json() as {blindSignatures:string[]}).blindSignatures[0]!),jurorKey));
 // The community caps are counted like any real employer's, and /stats marks the employer as a community listing.
 const stats=(await (await issuer.fetch(new Request('https://verify.test/stats'),env)).json() as {employers:{company:string;community:boolean;sandbox:boolean;contribution:{cap:number}|null;juror:{cap:number}|null}[]}).employers.find(e=>e.company==='acme-widgets')!;
 assert.deepEqual([stats.community,stats.sandbox,stats.contribution?.cap,stats.juror?.cap],[true,false,COMMUNITY_KEY_LIMITS.contribution.cap,COMMUNITY_KEY_LIMITS.juror.cap]);
 assert.deepEqual(db.db.prepare("SELECT purpose,issued FROM issuance_counts WHERE company_slug='acme-widgets' ORDER BY purpose").all().map(r=>[r.purpose,r.issued]),[['contribution',1],['juror',2]]);
});

test('registration is idempotent and refuses conflicts: one domain per employer, one employer per domain, curated and sample employers, and domains shared/domains.ts refuses',async()=>{
 const {db,env}=await verifierEnv();
 await addKey(env,db,{id:'stripe:q:mailbox',companySlug:'stripe',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['stripe.com']);
 await addKey(env,db,{id:'meta:q:mailbox',companySlug:'meta',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['meta.com','fb.com']);
 await addKey(env,db,{id:'northwind-labs:q:demo',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo'},[]);
 const first=await (await register(env,{slug:'acme-widgets',domain:'acmewidgets.com'})).json() as Registered;
 const again=await register(env,{slug:'acme-widgets',domain:'@ACMEWIDGETS.com'});assert.equal(again.status,200);
 const repeated=await again.json() as Registered;
 assert.equal(repeated.created,false);assert.deepEqual(repeated.keys,first.keys,'the same keys, none added');
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM issuer_keys WHERE source='community'"),2);
 const refusals:[unknown,number,Record<string,string>][]=[
  [{slug:'acme-two',domain:'acmewidgets.com'},409,{error:'domain_taken'}],
  [{slug:'acme-widgets',domain:'acme-widgets.net'},409,{error:'employer_has_domain'}],
  [{slug:'stripe-fans',domain:'stripe.com'},409,{error:'domain_taken'}],
  [{slug:'facebook',domain:'FB.com'},409,{error:'domain_taken'}],
  [{slug:'meta-engineering',domain:'eng.meta.com'},409,{error:'domain_taken'}],
  [{slug:'acme-mail',domain:'mail.acmewidgets.com'},409,{error:'domain_taken'}],
  [{slug:'acme-widgets',domain:'mail.acmewidgets.com'},409,{error:'employer_has_domain'}],
  [{slug:'stripe',domain:'stripe.dev'},409,{error:'employer_has_domain'}],
  [{slug:'northwind-labs',domain:'northwindlabs.com'},409,{error:'sample_employer'}],
  [{slug:'freemail',domain:'gmail.com'},400,{error:'domain_not_allowed',reason:'domain_free_mail'}],
  [{slug:'freemail',domain:'mail.yahoo.co.uk'},400,{error:'domain_not_allowed',reason:'domain_free_mail'}],
  [{slug:'throwaway',domain:'mailinator.com'},400,{error:'domain_not_allowed',reason:'domain_disposable'}],
  [{slug:'reserved',domain:'example.com'},400,{error:'domain_not_allowed',reason:'domain_reserved'}],
  [{slug:'suffix',domain:'co.uk'},400,{error:'domain_not_allowed',reason:'domain_public_suffix'}],
  [{slug:'garbage',domain:'not a domain'},400,{error:'domain_not_allowed',reason:'domain_invalid'}],
  [{slug:'address',domain:'jane@acme.com'},400,{error:'domain_not_allowed',reason:'domain_invalid'}],
  [{slug:'Bad Slug',domain:'badslug.com'},400,{error:'invalid_request'}],
  [{slug:'extra',domain:'extra.com',name:'Extra Inc'},400,{error:'invalid_request'}],
 ];
 for(const [body,status,answer] of refusals) {const r=await register(env,body);assert.deepEqual([r.status,await r.json()],[status,answer],JSON.stringify(body));}
 assert.deepEqual(db.db.prepare('SELECT domain,company_slug FROM employer_domains').all().map(r=>[r.domain,r.company_slug]),[['acmewidgets.com','acme-widgets']],'only the one registration');
 // Only an exact or parent match is taken: a name that merely ends the same way is another domain.
 assert.equal((await register(env,{slug:'notacme-widgets',domain:'notacmewidgets.com'})).status,200);
 db.exec("DELETE FROM issuer_keys WHERE company_slug='notacme-widgets'");db.exec("DELETE FROM employer_domains WHERE company_slug='notacme-widgets'");
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM issuer_keys WHERE source='community'"),2,'and no refused request created a key');
 // The database holds the same rules on its own.
 assert.throws(()=>db.db.prepare("INSERT INTO employer_domains VALUES('other.com','acme-widgets','2026-Q3')").run(),/UNIQUE/);
 assert.throws(()=>db.db.prepare("INSERT INTO employer_domains VALUES('acmewidgets.com','acme-two','2026-Q3')").run(),/UNIQUE|PRIMARY/);
 assert.throws(()=>db.db.prepare("INSERT INTO employer_domains VALUES('Upper.com','upper','2026-Q3')").run(),/CHECK/);
 assert.throws(()=>db.db.prepare("UPDATE issuer_keys SET source='sample'").run(),/CHECK/);
 assert.ok(EMPLOYER_SLUG.test('acme-widgets')&&!EMPLOYER_SLUG.test('acme--widgets')&&!EMPLOYER_SLUG.test('-acme')&&!EMPLOYER_SLUG.test('a:b')&&!EMPLOYER_SLUG.test('a'.repeat(81)));
});

test('a community key signs only for its employer\'s still-registered, still-accepted domain, and a relabelled community key is refused',async()=>{
 const {db,env,sent}=await verifierEnv();
 const out=await (await register(env,{slug:'acme-widgets',domain:'acmewidgets.com'})).json() as Registered;
 const key=out.keys.find(k=>k.purpose==='contribution')!,start=()=>call(env,{action:'start',keyId:key.id,email:'pat@acmewidgets.com'});
 assert.equal((await start()).status,200);
 db.exec("DELETE FROM employer_domains");
 assert.deepEqual(await (await start()).json(),{error:'issuer_key_unavailable'},'unregistered: the key stops');
 db.exec("INSERT INTO employer_domains VALUES('acme-widgets.net','acme-widgets','2026-Q3')");
 assert.deepEqual(await (await start()).json(),{error:'issuer_key_unavailable'},'registered to another domain: the key stops');
 db.exec("UPDATE employer_domains SET domain='acmewidgets.com'");
 assert.equal((await start()).status,200);
 db.prepare("UPDATE issuer_keys SET source='curated' WHERE id=?").bind(key.id).raw();
 assert.deepEqual(await (await start()).json(),{error:'issuer_key_unavailable'},'a community id labelled curated is refused');
 assert.equal(keySource({id:key.id,source:'curated'}),null);
 // A registry row whose domain shared/domains.ts now refuses (lists grow after registration) stops its key.
 const pair=await suite().generateKey({modulusLength:2048,publicExponent:new Uint8Array([1,0,1])}),id=communityKeyId('gmail-fans',quarter(),'contribution');
 db.prepare("INSERT INTO issuer_keys(id,company_slug,epoch,expires_at,verification_class,domains_json,public_key_json,sealed_private_key,purpose,issuance_cap,velocity_limit,source) VALUES(?,?,?,?,'mailbox','[\"gmail.com\"]',?,?,'contribution',50,10,'community')").bind(id,'gmail-fans',quarter(),future,JSON.stringify(await crypto.subtle.exportKey('jwk',pair.publicKey)),await sealIssuerKey(env.ISSUER_MASTER_KEY,id,await crypto.subtle.exportKey('jwk',pair.privateKey))).raw();
 db.exec("INSERT INTO employer_domains VALUES('gmail.com','gmail-fans','2026-Q3')");
 const before=sent.length;
 assert.deepEqual(await (await call(env,{action:'start',keyId:id,email:'x@gmail.com'})).json(),{error:'issuer_key_unavailable'});
 assert.equal(sent.length,before,'and sends nothing');
});

test('the scheduled job creates missing community keys for the current quarter, a few employers per run, after purging expired rows',async()=>{
 const {db,env}=await verifierEnv();
 const out=await (await register(env,{slug:'acme-widgets',domain:'acmewidgets.com'})).json() as Registered;
 db.exec("DELETE FROM issuer_keys WHERE source='community'");
 db.exec("INSERT INTO employer_domains VALUES('globex.com','globex','2026-Q1')");
 await issuer.scheduled({} as ScheduledController,env);
 const rows=db.db.prepare("SELECT id,company_slug,public_key_json FROM issuer_keys WHERE source='community' ORDER BY id").all() as {id:string;company_slug:string;public_key_json:string}[];
 const epoch=quarter();
 assert.deepEqual(rows.map(r=>r.id),[`acme-widgets:${epoch}:community`,`acme-widgets:${epoch}:juror:community`,`globex:${epoch}:community`,`globex:${epoch}:juror:community`]);
 assert.equal(rows.some(r=>out.keys.some(k=>JSON.stringify(k.publicKey)===r.public_key_json)),false,'fresh keys');
 // An expired community key is purged; the current quarter's key stays; nothing is created twice.
 db.prepare("INSERT INTO issuer_keys(id,company_slug,epoch,expires_at,verification_class,domains_json,public_key_json,sealed_private_key,purpose,source) VALUES('globex:2020-Q1:community','globex','2020-Q1','2020-07-01T00:00:00.000Z','mailbox','[\"globex.com\"]','{}','x','contribution','community')").raw();
 await issuer.scheduled({} as ScheduledController,env);
 assert.deepEqual((db.db.prepare("SELECT id FROM issuer_keys WHERE source='community' ORDER BY id").all() as {id:string}[]).map(r=>r.id),rows.map(r=>r.id));
 // An employer that has curated keys after all, or whose domain is now refused, gets no new community key.
 await addKey(env,db,{id:'initech:q:mailbox',companySlug:'initech',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['initech.com']);
 db.exec("INSERT INTO employer_domains VALUES('initech-careers.com','initech','2026-Q3')");db.exec("INSERT INTO employer_domains VALUES('mailinator.com','spam-co','2026-Q3')");
 await issuer.scheduled({} as ScheduledController,env);
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM issuer_keys WHERE source='community' AND company_slug IN ('initech','spam-co')"),0);
 db.exec("DELETE FROM employer_domains WHERE company_slug IN ('initech','spam-co')");
 // A broken master key never stops the purge.
 db.exec("INSERT INTO mailbox_challenges(id,key_id,mailbox_hash,code_hash,expires_at) VALUES('old','k','m','h','2000-01-01T00:00:00Z')");db.exec("DELETE FROM issuer_keys WHERE company_slug='globex'");
 await issuer.scheduled({} as ScheduledController,{...env,ISSUER_MASTER_KEY:'broken'} as IssuerEnv);
 assert.equal(count(db,'SELECT COUNT(*) AS n FROM mailbox_challenges'),0);assert.equal(count(db,"SELECT COUNT(*) AS n FROM issuer_keys WHERE company_slug='globex'"),0);
});

test('key sources: community ids and labels must agree, curated fingerprints are unchanged, and pinned registries still verify',async()=>{
 assert.deepEqual([keySource({id:'acme:2026-Q3:community'}),keySource({id:'acme:2026-Q3:juror:community',source:'community'}),keySource({id:'stripe:2026-Q3:mailbox'}),keySource({id:'stripe:2026-Q3:mailbox',source:'curated'})],['community','community','curated','curated']);
 assert.deepEqual([keySource({id:'acme:2026-Q3:community',source:'curated'}),keySource({id:'stripe:2026-Q3:mailbox',source:'community'})],[null,null]);
 assert.deepEqual([communityKeyId('acme','2026-Q3','contribution'),communityKeyId('acme','2026-Q3','juror')],['acme:2026-Q3:community','acme:2026-Q3:juror:community']);
 assert.deepEqual([keyPurpose({id:communityKeyId('acme','2026-Q3','juror')}),keyPurpose({id:communityKeyId('acme','2026-Q3','contribution')})],['juror','contribution']);
 assert.deepEqual(['2026-Q3','2026-Q4'].map(issuerKeyExpiry),['2027-01-01T00:00:00.000Z','2027-04-01T00:00:00.000Z']);assert.throws(()=>issuerKeyExpiry('soon'),/invalid_epoch/);
 const curated:IssuerKey={id:'stripe:2026-Q3:mailbox',companySlug:'stripe',epoch:'2026-Q3',expiresAt:future,verificationClass:'mailbox',purpose:'contribution',publicKey:{kty:'RSA',n:'n1',e:'AQAB'}};
 assert.equal(await issuerKeyFingerprint({...curated,source:'curated'}),await issuerKeyFingerprint(curated),'a curated key\'s fingerprint does not depend on the source field');
 assert.equal(sameIssuerKey(curated,{...curated,source:'curated'}),true);
 const community:IssuerKey={...curated,id:'acme:2026-Q3:community',companySlug:'acme',source:'community'};
 assert.notEqual(await issuerKeyFingerprint(community),await issuerKeyFingerprint({...community,source:undefined}));
 // Every fingerprint recorded in a committed or local registry still matches: releases built before this change verify.
 for(const file of ['db/issuer-public-keys.json','.wrangler/provision/local-issuer-public-keys.json']) {
  let registry:(IssuerKey&{fingerprint:string})[]=[];try {registry=JSON.parse(readFileSync(file,'utf8'));} catch {continue;}
  for(const k of registry) assert.equal(await issuerKeyFingerprint(k),k.fingerprint,`${file} ${k.id}`);
 }
});

test('provisioning leaves sample employers out when SAMPLE_EMPLOYERS is not on (or with --no-samples), drops their keys, and refuses curated keys for community-registered employers',async()=>{
 const tool=await import('../tools/provision-issuer.mjs' as string) as {EMPLOYERS:[string,string[]][];plannedKeys:(e:unknown,epoch:string)=>IssuerKey[];samplesWanted:(o:{argv?:string[];remote?:boolean;wranglerText?:string;localVarsText?:string})=>boolean;withoutSamples:<T extends {verificationClass:string}>(k:T[])=>T[];communityConflicts:(e:[string,string[]][],r:{company_slug:string;domain:string}[]|null)=>string[]};
 const on='"vars":{"SAMPLE_EMPLOYERS":"on"}',off='"vars":{"ENVIRONMENT":"production","SAMPLE_EMPLOYERS":"off"}';
 assert.deepEqual([
  tool.samplesWanted({remote:true,wranglerText:off}),tool.samplesWanted({remote:true,wranglerText:on}),tool.samplesWanted({remote:true,wranglerText:'{}'}),
  tool.samplesWanted({remote:true,wranglerText:off,localVarsText:'SAMPLE_EMPLOYERS=on'}),tool.samplesWanted({wranglerText:off,localVarsText:'ENVIRONMENT=development\nSAMPLE_EMPLOYERS=on\n'}),
  tool.samplesWanted({wranglerText:on,localVarsText:'SAMPLE_EMPLOYERS="off"'}),tool.samplesWanted({wranglerText:on}),tool.samplesWanted({}),tool.samplesWanted({argv:['node','provision','--no-samples'],wranglerText:on,localVarsText:'SAMPLE_EMPLOYERS=on'}),
 ],[false,true,false,false,true,false,true,false,false],'exactly when the main worker shows samples; a remote run reads only wrangler.jsonc');
 const planned=tool.plannedKeys(tool.EMPLOYERS.filter(([,domains])=>domains.length),'2026-Q4');
 assert.equal(planned.some(k=>k.verificationClass==='demo'||/:(demo|juror:sandbox)$/.test(k.id)),false,'no sandbox key is planned without samples');
 assert.deepEqual(tool.withoutSamples(tool.plannedKeys(tool.EMPLOYERS,'2026-Q4')).map(k=>k.id),planned.map(k=>k.id),'and existing sandbox entries are dropped');
 const source=readFileSync('tools/provision-issuer.mjs','utf8');
 assert.match(source,/if\(!samples\)registry\.splice\(0,registry\.length,\.\.\.withoutSamples\(registry\)\);/,'dropped from the secrets file, so nothing purged is sealed or published again');
 assert.match(source,/samplesWanted\(\{argv:process\.argv,remote,wranglerText:readText\('wrangler\.jsonc'\)/);
 assert.deepEqual(tool.communityConflicts(tool.EMPLOYERS,[{company_slug:'stripe',domain:'stripe-community.com'}]),['stripe']);
 assert.deepEqual(tool.communityConflicts(tool.EMPLOYERS,[{company_slug:'facebook',domain:'fb.com'}]),['meta']);
 assert.deepEqual(tool.communityConflicts(tool.EMPLOYERS,[{company_slug:'acme-widgets',domain:'acmewidgets.com'}]),[]);assert.deepEqual(tool.communityConflicts(tool.EMPLOYERS,null),[]);
 assert.equal(tool.plannedKeys(tool.EMPLOYERS,'2026-Q4').some(k=>keySource(k)!=='curated'),false,'provisioning never plans a community id');
});

// ================= Review fixes: sample keys, key reads, email budget, scheduled job, parents, takedowns =================
import {COMMUNITY_EMAIL_LIMITS} from '../shared/proof.ts';

/** A fresh author key in the form a contribution proof binds. */
async function authorPublicKey() {
 const author=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',author.publicKey);
 return publicAuthorSchema.parse({kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y});
}
const keyIds=async(env:IssuerEnv,query='')=>{const r=await issuer.fetch(new Request(`https://verify.test/keys${query}`),env);assert.equal(r.status,200,query);return ((await r.json()) as {keys:IssuerKey[]}).keys.map(k=>k.id);};
const statsFor=async(env:IssuerEnv,query='')=>((await (await issuer.fetch(new Request(`https://verify.test/stats${query}`),env)).json()) as {employers:{company:string}[]}).employers.map(e=>e.company);

test('the fictional employers\' sandbox keys are listed and sign only while SAMPLE_EMPLOYERS is exactly on; production sets it off',async()=>{
 const {db,env}=await verifierEnv();
 const demo=await addKey(env,db,{id:'northwind-labs:q:demo',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo'},[]);
 const juror=await addKey(env,db,{id:'northwind-labs:q:juror:sandbox',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo',purpose:'juror'},[]);
 const real=await addKey(env,db,{id:'stripe:q:mailbox',companySlug:'stripe',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['stripe.com']);
 const sign=async(e:IssuerEnv)=>call(e,{action:'issue',keyId:demo.id,blinded:(await prepareProof(demo,await authorPublicKey())).blinded});
 const signJuror=async(e:IssuerEnv)=>jurorCall(e,{keyId:juror.id,blinded:(await jurorBatch(juror,1)).map(t=>t.blinded)});
 assert.deepEqual((await keyIds(env)).sort(),[demo.id,juror.id,real.id].sort(),'on: listed');
 assert.deepEqual(await statsFor(env),['northwind-labs','stripe']);
 assert.equal((await sign(env)).status,200);assert.equal((await signJuror(env)).status,200,'on: they sign');
 for(const value of ['off',undefined,'ON','true','']) {
  const hidden={...env,SAMPLE_EMPLOYERS:value} as IssuerEnv;
  assert.deepEqual(await keyIds(hidden),[real.id],`${String(value)}: only the real employer's key is listed`);
  assert.deepEqual(await statsFor(hidden),['stripe'],`${String(value)}: and only it has stats`);
  assert.deepEqual(await (await sign(hidden)).json(),{error:'issuer_key_unavailable'},`${String(value)}: a sandbox key signs nothing`);
  assert.deepEqual(await (await signJuror(hidden)).json(),{error:'issuer_key_unavailable'},`${String(value)}: nor a sandbox juror key`);
  // A sample employer's slug still cannot be registered as a community listing.
  assert.deepEqual(await (await register(hidden,{slug:'northwind-labs',domain:'northwindlabs.com'})).json(),{error:'sample_employer'});
 }
 // Production hides them on the verifier and on the site alike.
 const verifierVars=(JSON.parse(readFileSync('issuer.wrangler.jsonc','utf8')) as {vars:Record<string,string>}).vars;
 assert.deepEqual([verifierVars.SAMPLE_EMPLOYERS,verifierVars.ENVIRONMENT],['off','production']);
 assert.equal(/"SAMPLE_EMPLOYERS"\s*:\s*"([^"]*)"/.exec(readFileSync('wrangler.jsonc','utf8'))?.[1],'off','the main worker agrees');
});

test('/keys and /stats can be read for one employer (and /keys for one source), read only public columns, and list a community key only while its registration stands',async()=>{
 const {db,env}=await verifierEnv();
 const real=await addKey(env,db,{id:'stripe:q:mailbox',companySlug:'stripe',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['stripe.com']);
 const acme=await (await register(env,{slug:'acme-widgets',domain:'acmewidgets.com'})).json() as Registered;
 const globex=await (await register(env,{slug:'globex',domain:'globex.com'})).json() as Registered;
 const acmeIds=acme.keys.map(k=>k.id),globexIds=globex.keys.map(k=>k.id);
 assert.deepEqual(await keyIds(env,'?company=acme-widgets'),acmeIds);
 assert.deepEqual(await keyIds(env,'?source=curated'),[real.id]);
 assert.deepEqual(await keyIds(env,'?source=community'),[...acmeIds,...globexIds]);
 assert.deepEqual(await keyIds(env,'?company=stripe&source=community'),[]);
 assert.deepEqual(await keyIds(env,'?company=nobody-here'),[]);
 assert.deepEqual(await keyIds(env,'?watch=1'),[...acmeIds,...globexIds,real.id],'any other parameter is ignored');
 const full=await (await issuer.fetch(new Request('https://verify.test/keys?company=acme-widgets'),env)).json() as {keys:unknown[];pow:unknown};
 assert.deepEqual(full.keys,acme.keys,'one employer\'s keys exactly as registration answered');assert.deepEqual(full.pow,{version:1,bits:8,windowMinutes:2});
 for(const query of ['?company=Bad%20Slug','?company=a:b','?company=','?source=sample','?company=acme-widgets&source=Community']) {
  const r=await issuer.fetch(new Request(`https://verify.test/keys${query}`),env);assert.deepEqual([r.status,await r.json()],[400,{error:'invalid_request'}],query);
 }
 assert.deepEqual(await statsFor(env,'?company=acme-widgets'),['acme-widgets']);
 assert.equal((await issuer.fetch(new Request('https://verify.test/stats?source=community'),env)).status,400,'/stats has no source filter');
 // The key list never reads the sealed private keys.
 const seen:string[]=[];
 const watched={...env,VERIFIER:{prepare:(sql:string)=>{seen.push(sql);return db.prepare(sql);},batch:(s:never)=>db.batch(s)}} as unknown as IssuerEnv;
 await keyIds(watched);await keyIds(watched,'?company=acme-widgets');
 assert.ok(seen.length>=2&&seen.every(sql=>!/SELECT \*|sealed_private_key/.test(sql)),seen.join('\n'));
 // A community key whose registration is gone, or now names another domain, signs nothing, so it is not listed either.
 db.exec("DELETE FROM employer_domains WHERE company_slug='globex'");
 assert.deepEqual(await keyIds(env,'?source=community'),acmeIds);
 db.exec("UPDATE employer_domains SET domain='acme-widgets.net' WHERE company_slug='acme-widgets'");
 assert.deepEqual(await keyIds(env,'?source=community'),[]);
 assert.deepEqual(await statsFor(env),['stripe']);
});

test('an employer anyone listed has a daily email budget, per employer and for all of them together; over it /start answers the same and sends nothing',async()=>{
 const {db,env,sent}=await verifierEnv();
 const acme=(await (await register(env,{slug:'acme-widgets',domain:'acmewidgets.com'})).json() as Registered).keys;
 const contribution=acme.find(k=>k.purpose==='contribution')!,juror=acme.find(k=>k.purpose==='juror')!;
 const start=async(key:IssuerKey,email:string)=>{const r=await call(env,{action:'start',keyId:key.id,email});assert.equal(r.status,200,email);return Object.keys(await r.json() as object).sort();};
 const {perEmployerPerDay,allCommunityPerDay}=COMMUNITY_EMAIL_LIMITS;
 assert.ok(perEmployerPerDay>=2*(COMMUNITY_KEY_LIMITS.contribution.velocity+Math.ceil(COMMUNITY_KEY_LIMITS.juror.velocity/JUROR_QUOTA)),'room for every credential and juror batch a day allows, twice over');
 for(let i=0;i<perEmployerPerDay;i++) await start(contribution,`p${i}@acmewidgets.com`);
 assert.equal(sent.length,perEmployerPerDay);
 assert.deepEqual(await start(contribution,'late@acmewidgets.com'),['challengeId','expiresInMinutes'],'over budget: the same answer');
 assert.deepEqual(await start(juror,'jury@acmewidgets.com'),['challengeId','expiresInMinutes'],'the juror key shares the employer\'s budget');
 assert.equal(sent.length,perEmployerPerDay,'and no email');
 assert.equal(count(db,'SELECT COUNT(*) AS n FROM mailbox_challenges'),perEmployerPerDay+2,'but the same database work: a challenge whose code nobody was sent');
 // A curated employer is limited per mailbox and network only.
 const real=await addKey(env,db,{id:'stripe:q:mailbox',companySlug:'stripe',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['stripe.com']);
 await start(real,'jane@stripe.com');assert.equal(sent.length,perEmployerPerDay+1);
 // The budget all community employers share.
 const globex=(await (await register(env,{slug:'globex',domain:'globex.com'})).json() as Registered).keys.find(k=>k.purpose==='contribution')!;
 const day=new Date().toISOString().slice(0,10);
 assert.equal(count(db,`SELECT sent AS n FROM email_budget WHERE day='${day}' AND scope='*'`),perEmployerPerDay,'an employer over its own budget spends nothing of the shared one');
 db.prepare("UPDATE email_budget SET sent=? WHERE day=? AND scope='*'").bind(allCommunityPerDay-1,day).raw();
 await start(globex,'x@globex.com');assert.equal(sent.length,perEmployerPerDay+2,'the last shared email of the day');
 await start(globex,'y@globex.com');assert.equal(sent.length,perEmployerPerDay+2,'then none, for any listed employer');
 await start(real,'sam@stripe.com');assert.equal(sent.length,perEmployerPerDay+3,'curated employers are unaffected');
 // Counts only, per day and scope; the scheduled job keeps today and yesterday.
 assert.deepEqual((db.db.prepare('PRAGMA table_info(email_budget)').all() as {name:string}[]).map(c=>c.name),['day','scope','sent']);
 db.exec("INSERT INTO email_budget VALUES('2000-01-01','acme-widgets',3)");
 await issuer.scheduled({} as ScheduledController,env);
 assert.deepEqual([count(db,"SELECT COUNT(*) AS n FROM email_budget WHERE day='2000-01-01'"),count(db,`SELECT COUNT(*) AS n FROM email_budget WHERE day='${day}'`)],[0,3]);
 // An unreadable budget sends nothing (fail closed), with the same answer.
 db.exec('DROP TABLE email_budget');
 assert.deepEqual(await start(globex,'z@globex.com'),['challengeId','expiresInMinutes']);assert.equal(sent.length,perEmployerPerDay+3);
});

test('the scheduled job reaches every acceptable registration however many refused ones sort first, and one employer\'s failure never stops the rest',async()=>{
 const {db,env}=await verifierEnv();
 // More refused registrations (their domains are now disposable) than one page of the scan, all sorting first.
 for(let i=0;i<250;i++) db.exec(`INSERT INTO employer_domains VALUES('x${i}.mailinator.com','a-refused-${String(i).padStart(3,'0')}','2026-Q3')`);
 db.exec("INSERT INTO employer_domains VALUES('beta-corp.com','beta-corp','2026-Q3')");
 db.exec("INSERT INTO employer_domains VALUES('zeta-corp.com','zeta-corp','2026-Q3')");
 db.exec("CREATE TRIGGER fail_beta BEFORE INSERT ON issuer_keys WHEN NEW.company_slug='beta-corp' BEGIN SELECT RAISE(ABORT,'storage failure'); END");
 await issuer.scheduled({} as ScheduledController,env);
 const epoch=quarter();
 assert.deepEqual((db.db.prepare("SELECT id FROM issuer_keys WHERE source='community' ORDER BY id").all() as {id:string}[]).map(r=>r.id),[`zeta-corp:${epoch}:community`,`zeta-corp:${epoch}:juror:community`]);
 db.exec('DROP TRIGGER fail_beta');
 await issuer.scheduled({} as ScheduledController,env);
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM issuer_keys WHERE company_slug='beta-corp'"),2,'the failed employer is retried on the next run');
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM issuer_keys WHERE company_slug LIKE 'a-refused-%'"),0,'refused domains get no key');
});

test('registration refuses a parent domain of a registered or curated domain, as it refuses a subdomain',async()=>{
 const {db,env}=await verifierEnv();
 await addKey(env,db,{id:'initech:q:mailbox',companySlug:'initech',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['mail.initech.com']);
 assert.equal((await register(env,{slug:'acme-engineering',domain:'eng.acme-corp.com'})).status,200);
 for(const [body,what] of [[{slug:'acme-corp',domain:'acme-corp.com'},'the parent of a registered domain'],[{slug:'initech-fans',domain:'initech.com'},'the parent of a curated key\'s domain'],[{slug:'acme-mail',domain:'mail.eng.acme-corp.com'},'a subdomain of a registered domain']] as const) {
  const r=await register(env,body);assert.deepEqual([r.status,await r.json()],[409,{error:'domain_taken'}],what);
 }
 assert.equal((await register(env,{slug:'acme-corporation',domain:'notacme-corp.com'})).status,200,'a name that only ends the same way is another domain');
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM employer_domains"),2);
});

test('DELETE /internal/employers takes a community registration down: its keys stop and disappear, and neither its slug nor its domain can be registered again',async()=>{
 const {db,env,sent}=await verifierEnv();
 const token=(env as {INTERNAL_TOKEN:string}).INTERNAL_TOKEN;
 const withdraw=(e:IssuerEnv,body:unknown,with_:string|null=token)=>issuer.fetch(new Request('https://verify.test/internal/employers',{method:'DELETE',headers:{'content-type':'application/json',origin:SITE,...(with_===null?{}:{authorization:`Bearer ${with_}`})},body:JSON.stringify(body)}),e);
 const out=await (await register(env,{slug:'acme-widgets',domain:'acmewidgets.com'})).json() as Registered;
 const key=out.keys.find(k=>k.purpose==='contribution')!,start=()=>call(env,{action:'start',keyId:key.id,email:'pat@acmewidgets.com'});
 assert.equal((await start()).status,200);
 for(const [what,r] of [['a wrong token',await withdraw(env,{slug:'acme-widgets'},randomToken(32))],['no token',await withdraw(env,{slug:'acme-widgets'},null)]] as const) assert.deepEqual([r.status,await r.json()],[401,{error:'unauthorized'}],what);
 assert.deepEqual(await (await withdraw({...env,INTERNAL_TOKEN:'short'} as IssuerEnv,{slug:'acme-widgets'},'short')).json(),{error:'internal_unavailable'});
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM issuer_keys WHERE company_slug='acme-widgets'"),2,'nothing changed');
 const r=await withdraw(env,{slug:'acme-widgets'});
 assert.equal(r.headers.get('access-control-allow-origin'),null,'no CORS');
 assert.deepEqual(await r.json(),{withdrawn:true,companySlug:'acme-widgets',domain:'acmewidgets.com',keysRemoved:2});
 assert.deepEqual([count(db,"SELECT COUNT(*) AS n FROM issuer_keys WHERE company_slug='acme-widgets'"),count(db,'SELECT COUNT(*) AS n FROM employer_domains')],[0,0]);
 assert.deepEqual(await keyIds(env,'?company=acme-widgets'),[]);
 const before=sent.length;assert.deepEqual(await (await start()).json(),{error:'issuer_key_unavailable'});assert.equal(sent.length,before);
 assert.deepEqual(await (await withdraw(env,{slug:'acme-widgets'})).json(),{withdrawn:true,companySlug:'acme-widgets',domain:'acmewidgets.com',keysRemoved:0},'idempotent');
 for(const body of [{slug:'acme-widgets',domain:'acme-widgets.net'},{slug:'acme-two',domain:'acmewidgets.com'},{slug:'acme-mail',domain:'mail.acmewidgets.com'}]) {
  const again=await register(env,body);assert.deepEqual([again.status,await again.json()],[409,{error:'withdrawn'}],JSON.stringify(body));
 }
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM issuer_keys WHERE source='community'"),0,'no key id is ever created again for other key material');
 // Only what the community added can be taken down this way.
 await addKey(env,db,{id:'stripe:q:mailbox',companySlug:'stripe',epoch:quarter(),expiresAt:future,verificationClass:'mailbox'},['stripe.com']);
 await addKey(env,db,{id:'northwind-labs:q:demo',companySlug:'northwind-labs',epoch:quarter(),expiresAt:future,verificationClass:'demo'},[]);
 for(const slug of ['stripe','northwind-labs']) {const refused=await withdraw(env,{slug});assert.deepEqual([refused.status,await refused.json()],[409,{error:'not_community_employer'}],slug);}
 assert.equal(count(db,"SELECT COUNT(*) AS n FROM issuer_keys WHERE company_slug IN ('stripe','northwind-labs')"),2);
 for(const body of [{slug:'Bad Slug'},{slug:'acme-widgets',domain:'x.com'},{}]) assert.equal((await withdraw(env,body)).status,400,JSON.stringify(body));
 // A slug taken down before it registered stays out too, until an operator re-admits it.
 assert.deepEqual(await (await withdraw(env,{slug:'initech'})).json(),{withdrawn:true,companySlug:'initech',domain:null,keysRemoved:0});
 assert.deepEqual(await (await register(env,{slug:'initech',domain:'initech.com'})).json(),{error:'withdrawn'});
 db.exec("DELETE FROM withdrawn_employers WHERE company_slug='initech'");
 assert.equal((await register(env,{slug:'initech',domain:'initech.com'})).status,200);
 assert.equal((await issuer.fetch(new Request('https://verify.test/internal/employers',{method:'PUT',headers:{authorization:`Bearer ${token}`},body:'{}'}),env)).status,404,'no other method');
});

test('a remote provisioning run refuses when it cannot read the community registry, unless --skip-community-check; related domains conflict both ways',async()=>{
 const tool=await import('../tools/provision-issuer.mjs' as string) as {communityCheckProblem:(o:{remote:boolean;registered:unknown[]|null;argv?:string[]})=>string|null;communityConflicts:(e:[string,string[]][],r:{company_slug:string;domain:string}[]|null)=>string[]};
 assert.match(tool.communityCheckProblem({remote:true,registered:null})??'',/could not be read remotely[\s\S]*--skip-community-check/);
 assert.deepEqual([tool.communityCheckProblem({remote:true,registered:null,argv:['node','provision','--remote','--skip-community-check']}),tool.communityCheckProblem({remote:true,registered:[]}),tool.communityCheckProblem({remote:false,registered:null})],[null,null,null]);
 const source=readFileSync('tools/provision-issuer.mjs','utf8');
 assert.match(source,/const unchecked=communityCheckProblem\(\{remote,registered:community,argv:process\.argv\}\);\n if\(unchecked\)\{console\.error\(`Refusing: \$\{unchecked\} Nothing was written\.`\);process\.exit\(1\);\}/);
 assert.ok(source.indexOf('const unchecked=')<source.indexOf('writeFileSync(files.secrets'),'before anything is written');
 assert.deepEqual(tool.communityConflicts([['acme',['eng.acme.com']],['stripe',['stripe.com']]],[{company_slug:'acme-inc',domain:'acme.com'}]),['acme'],'a registered parent domain');
 assert.deepEqual(tool.communityConflicts([['stripe',['stripe.com']]],[{company_slug:'stripe-eng',domain:'eng.stripe.com'}]),['stripe'],'a registered subdomain');
 assert.deepEqual(tool.communityConflicts([['stripe',['stripe.com']]],[{company_slug:'notstripe',domain:'notstripe.com'}]),[]);
});
