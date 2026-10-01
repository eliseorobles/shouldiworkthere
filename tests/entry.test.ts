import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';

// workerd treats every named export of a Worker's entry module as an entrypoint and refuses to start when one is not a
// function or handler (a constant crashed both workers at startup). Entry modules therefore export only `default`.
for(const entry of ['../worker/src/index.ts','../worker/inference.ts']) test(`${entry} exports only its default handler`,async()=>{
 const module=await import(entry);
 assert.deepEqual(Object.keys(module),['default']);
 assert.equal(typeof module.default.fetch,'function');
});
test('the verifier entry exports only functions besides its default handler',async()=>{
 const module=await import('../worker/issuer.ts');
 for(const [name,value] of Object.entries(module)) if(name!=='default') assert.equal(typeof value,'function',`${name} must be a function`);
});

type StartupChild=EventEmitter&{exitCode:number|null;signalCode:NodeJS.Signals|null};
const dev=await import('../tools/dev.mjs' as string) as {waitForWorker:(worker:{name:string;port:number},child:StartupChild,options?:{timeoutMs?:number;pollMs?:number;requestTimeoutMs?:number;request?:(url:string,options:{signal:AbortSignal})=>Promise<Response>})=>Promise<void>};
const startupChild=():StartupChild=>Object.assign(new EventEmitter(),{exitCode:null,signalCode:null});

test('local startup accepts inference 404 as readiness', {timeout:1000},async()=>{
 const response=new Response('Not found',{status:404}),child=startupChild();
 await dev.waitForWorker({name:'inference',port:8789},child,{timeoutMs:250,request:async url=>{
  assert.equal(url,'http://localhost:8789/');return response;
 }});
 assert.equal(response.bodyUsed,true,'the readiness response does not leave an open body');
 assert.equal(child.listenerCount('exit'),0);
});

test('local startup waits for a working verifier keys endpoint', {timeout:1000},async()=>{
 const responses=[new Response('Unavailable',{status:503}),new Response('keys',{status:200})];
 let probes=0;
 await dev.waitForWorker({name:'verifier',port:8790},startupChild(),{timeoutMs:250,pollMs:1,request:async url=>{
  assert.equal(url,'http://localhost:8790/keys');return responses[probes++]!;
 }});
 assert.equal(probes,2,'a responding but unavailable verifier is not ready');
 assert.ok(responses.every(response=>response.bodyUsed));
});

test('local startup aborts an outstanding readiness probe when its child exits', {timeout:1000},async()=>{
 const child=startupChild();let entered!:()=>void;
 const fetching=new Promise<void>(resolve=>{entered=resolve;});
 const pending=dev.waitForWorker({name:'verifier',port:8790},child,{timeoutMs:500,requestTimeoutMs:500,request:(_url,{signal})=>new Promise<Response>((_resolve,reject)=>{
  signal.addEventListener('abort',()=>reject(signal.reason),{once:true});entered();
 })});
 await fetching;child.exitCode=7;child.emit('exit',7,null);
 await assert.rejects(pending,/verifier exited before becoming ready \(7\).*local-verifier\.log/);
 assert.equal(child.listenerCount('exit'),0);assert.equal(child.listenerCount('error'),0);
});
