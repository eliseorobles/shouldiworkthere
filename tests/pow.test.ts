import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchPow,solvePow,checkPow,powPrefix,powSubject,powBits,powMinute,powDomain,leadingZeroBits,powWorkerSource,powSchema,POW_BITS,POW_MIN_BITS,POW_MAX_BITS,POW_WINDOW_MINUTES,type PowBinding} from '../shared/pow.ts';
import {normalizeDomain} from '../shared/domains.ts';

const origin='https://shouldiworkthere.com';
const sha256=async(text:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
async function binding(over:Partial<PowBinding>={}):Promise<PowBinding> {return {origin,action:'start',keyId:'stripe:2026-Q3:mailbox',subject:await powSubject.email('jane@stripe.com'),...over};}

test('the in-page search is SHA-256: every nonce it finds verifies with WebCrypto, for prefixes of every length up to three blocks',async()=>{
 // Prefix lengths 0..200 bytes cover a tail that fits one final block, a tail that spills into a second block, a counter
 // that straddles the block boundary, and a constant first tail block (the midstate branches of searchPow).
 for(let length=0;length<=200;length++) {
  const prefix='p'.repeat(length),found=searchPow(prefix,12,(length*2654435761)>>>0,1<<20);
  assert.ok(found,`a 12-bit nonce exists within 2^20 tries (length ${length})`);
  assert.match(found.nonce,/^[0-9a-f]{16}$/);
  assert.ok(leadingZeroBits(await sha256(prefix+found.nonce))>=12,`WebCrypto agrees at length ${length}`);
 }
 // Multi-byte UTF-8 in a prefix is hashed as bytes, as the server hashes it.
 const found=searchPow('Zürich — 東京\n',10,7,1<<20)!;assert.ok(leadingZeroBits(await sha256(`Zürich — 東京\n${found.nonce}`))>=10);
 assert.equal(searchPow('x',0,1,1)?.tries,1,'zero bits: the first nonce');
 assert.equal(searchPow('x',32,1,16),null,'a bounded search that finds nothing says so');
});

test('leading zero bits are counted bit by bit across bytes',()=>{
 assert.deepEqual([[0x80],[0x40],[0x01],[0x00,0xff],[0x00,0x00,0x10],[0,0,0,0]].map(b=>leadingZeroBits(new Uint8Array(b))),[0,1,7,8,19,32]);
});

test('a stamp is bound to origin, action, key id and subject: changing any of them refuses it',async()=>{
 const base=await binding(),stamp=await solvePow(base,{bits:16});
 assert.equal(await checkPow(stamp,base,16),null);
 const others:PowBinding[]=[
  {...base,origin:'https://evil.example'},{...base,origin:'http://localhost:8788'},
  {...base,action:'issue-juror'},{...base,action:'add-employer'},
  {...base,keyId:'stripe:2026-Q4:mailbox'},{...base,keyId:''},
  {...base,subject:await powSubject.email('sam@stripe.com')},{...base,subject:await powSubject.domain('stripe.com')},
 ];
 for(const other of others) assert.equal(await checkPow(stamp,other,16),'pow_insufficient',JSON.stringify(other).slice(0,90));
 // Each kind of subject is domain-separated and normalized the same way on both sides.
 assert.equal(await powSubject.email('  Jane@Stripe.COM '),await powSubject.email('jane@stripe.com'));
 assert.equal(await powSubject.domain('Acme.COM.'),await powSubject.domain('acme.com'));
 for(const typed of [' @Acme.COM. ','acme.com','ACME.com..','@@acme.com',' mail.Schwab.com '])assert.equal(powDomain(typed),normalizeDomain(typed),`the main worker binds the domain it normalizes: ${typed}`);
 assert.notEqual(await powSubject.email('acme.com'),await powSubject.domain('acme.com'));
 assert.notEqual(await powSubject.blinded(['a','b']),await powSubject.blinded(['b','a']),'a batch is bound in order');
 assert.notEqual(await powSubject.blinded(['ab']),await powSubject.blinded(['a','b']));
 assert.throws(()=>powPrefix({...base,keyId:'k\nstart'},1),/invalid_pow_binding/,'no field can smuggle another field');
 assert.throws(()=>powPrefix({...base,action:'issue' as never},1),/invalid_pow_binding/);
});

test('a stamp expires: accepted within the window either side of the server clock, refused outside it',async()=>{
 const base=await binding(),now=Date.parse('2026-09-23T12:00:30Z'),minute=powMinute(now);
 for(const offset of [-POW_WINDOW_MINUTES,0,POW_WINDOW_MINUTES]) {
  const stamp=await solvePow(base,{bits:10,minute:minute+offset});
  assert.equal(await checkPow(stamp,base,10,now),null,`offset ${offset}`);
 }
 for(const offset of [-POW_WINDOW_MINUTES-1,POW_WINDOW_MINUTES+1,-60]) {
  const stamp=await solvePow(base,{bits:10,minute:minute+offset});
  assert.equal(await checkPow(stamp,base,10,now),'pow_stale',`offset ${offset}`);
 }
 // A stamp cannot be moved to another minute: the minute is inside the hash.
 const stamp=await solvePow(base,{bits:16,minute});
 assert.equal(await checkPow({...stamp,minute:minute+1},base,16,now),'pow_insufficient');
});

test('difficulty: a stamp passes exactly up to the zero bits it has, and the configured difficulty is clamped',async()=>{
 const base=await binding();
 for(let i=0;i<5;i++) {
  const stamp=await solvePow(base,{bits:12});
  const bits=leadingZeroBits(await sha256(powPrefix(base,stamp.minute)+stamp.nonce));
  assert.ok(bits>=12);
  assert.equal(await checkPow(stamp,base,bits),null);assert.equal(await checkPow(stamp,base,bits+1),'pow_insufficient');
 }
 assert.equal(POW_BITS,20,'owner decision 5: about 20 bits');
 assert.deepEqual([undefined,null,'','abc','12','4','40',12.5,24].map(v=>powBits(v as never)),[20,20,20,20,12,POW_MIN_BITS,POW_MAX_BITS,20,24]);
});

test('malformed stamps are refused as missing, before any hashing',async()=>{
 const base=await binding();
 for(const bad of [undefined,null,'stamp',{minute:1},{nonce:'0123456789abcdef'},{minute:-1,nonce:'0123456789abcdef'},{minute:1,nonce:'0123456789ABCDEF'},{minute:1,nonce:'0123'},{minute:1.5,nonce:'0123456789abcdef'},{minute:1,nonce:'0123456789abcdef',bits:40}])
  assert.equal(await checkPow(bad,base,8),'pow_missing',JSON.stringify(bad));
 assert.equal(powSchema.safeParse({minute:powMinute(),nonce:'0123456789abcdef'}).success,true);
});

test('the Web Worker script is self-contained and finds a stamp the server accepts',async()=>{
 const source=powWorkerSource();
 assert.doesNotMatch(source,/\bimport\b|\brequire\(/,'no imports: it runs as a classic worker script from the site origin');
 const base=await binding({action:'issue-juror',keyId:'stripe:2026-Q3:juror:mailbox',subject:await powSubject.blinded(['AAAA','BBBB'])});
 const minute=powMinute(),prefix=powPrefix(base,minute);
 const answer=await new Promise<{nonce:string;tries:number}>((resolve,reject)=>{
  const self:{onmessage?:(event:{data:unknown})=>void;postMessage:(data:{nonce:string;tries:number;error?:string})=>void}={postMessage:data=>data.error?reject(new Error(data.error)):resolve(data)};
  new Function('self',source)(self);
  self.onmessage!({data:{prefix,bits:12}});
 });
 assert.ok(answer.tries>=1);
 assert.equal(await checkPow({minute,nonce:answer.nonce},base,12),null);
 // A request the worker cannot read is answered, never left hanging.
 const refused=await new Promise<unknown>(resolve=>{const self:{onmessage?:(e:{data:unknown})=>void;postMessage:(d:unknown)=>void}={postMessage:resolve};new Function('self',source)(self);self.onmessage!({data:{bits:12}});});
 assert.deepEqual(refused,{error:'invalid_request'});
});

test('the Web Worker script still runs when the worker that serves it is bundled with kept names or minified (wrangler keeps names by default)',async()=>{
 const esbuild=await import('esbuild');
 for(const options of [{keepNames:true,minify:false},{keepNames:true,minify:true},{keepNames:false,minify:true}]) {
  const built=await esbuild.build({stdin:{contents:"export {powWorkerSource} from './shared/pow.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'neutral',mainFields:['module','main'],write:false,...options});
  const bundled=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0]!.text).toString('base64')}`) as {powWorkerSource:()=>string};
  const answer=await new Promise<unknown>((resolve,reject)=>{
   const self:{onmessage?:(e:{data:unknown})=>void;postMessage:(d:unknown)=>void}={postMessage:resolve};
   try {new Function('self',bundled.powWorkerSource())(self);self.onmessage!({data:{prefix:'siwt-pow-v1\n',bits:8}});} catch(error) {reject(error);}
  });
  assert.match((answer as {nonce?:string}).nonce??'',/^[0-9a-f]{16}$/,JSON.stringify(options));
 }
});

test('solvePow can be aborted and tracks a server-supplied minute',async()=>{
 const base=await binding(),controller=new AbortController();controller.abort();
 await assert.rejects(solvePow(base,{bits:32,signal:controller.signal}),/pow_aborted/);
 const serverMinute=powMinute()+7,stamp=await solvePow(base,{bits:8,minute:serverMinute});
 assert.equal(stamp.minute,serverMinute,'a device with a skewed clock stamps the verifier\'s minute');
});
