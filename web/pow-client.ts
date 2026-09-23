import {powPrefix,powMinute,powBits,solvePow,leadingZeroBits,POW_BITS,type PowBinding,type PowStamp} from '../shared/pow.ts';

/**
 * The browser side of the proof of work (shared/pow.ts) that /start, /issue-juror and POST /api/employers require. The
 * search runs in a Web Worker served from this site's own origin (the CSP allows only same-origin workers), so the page
 * stays responsive; a browser that cannot start it searches on the page in short slices instead. Every nonce is checked
 * with one SHA-256 before it is sent. A stamp holds the origin, the action, the key id, a digest of the email address,
 * blinded messages or domain, and the minute: nothing that is not already in the request it travels with.
 */
export const POW_WORKER_PATH='/pow-worker.js';
/** What the page says while the stamp is computed. */
export const POW_NOTE='A short calculation runs on this device first, usually about a second. It makes automated requests expensive; nothing about you is in it.';
/**
 * The refusals a server gives for a missing, expired or too-easy stamp (shared/pow.ts PowProblem): either as the error
 * code itself, or as {error:'pow_required', reason:<problem>, bits, minute} (the verifier's form).
 */
export const POW_CODES=['pow_missing','pow_stale','pow_insufficient'] as const;
export const POW_ERRORS:Record<string,string>={
 pow_required:'The calculation this device runs first was not accepted (it may have expired; check this device’s clock), so nothing was done. Try again.',
 pow_missing:'The request arrived without the calculation this device runs first, so nothing was done. Reload the page and try again.',
 pow_stale:'The calculation this device ran first had expired by the time the request arrived (check this device’s clock), so nothing was done. Try again.',
 pow_insufficient:'The calculation this device ran first was not accepted, so nothing was done. Reload the page and try again.',
 pow_unavailable:'This device could not finish the short calculation the request needs, so nothing was sent. Try again.',
 pow_too_hard:'The site asked this device for a calculation far longer than usual, so it was not started and nothing was sent. Try again later.',
 pow_stopped:'The calculation was stopped, so nothing was sent.',
};
/**
 * The hardest calculation this page will start: 2^24 hashes on average, 16 times the default (shared/pow.ts POW_BITS, 20),
 * roughly 5 to 25 seconds on a laptop. The difficulty comes from the site's config or the verifier's key list; a larger
 * value (a misconfiguration, or a service trying to stall visitors) is refused rather than left running for minutes or hours.
 */
export const POW_CLIENT_MAX_BITS=24;
/** A refusal made on this device: the calculation was too hard to start, was stopped, or could not run. */
export class PowError extends Error {
 code:'pow_too_hard'|'pow_stopped'|'pow_unavailable';
 constructor(code:PowError['code']){super(POW_ERRORS[code]);this.code=code;}
}
/** What a PoW refusal may carry: the difficulty the server wants and its current minute (for a device with a wrong clock). */
export interface PowHint {code:string;bits:number|null;minute:number|null;}
const int=(value:unknown)=>typeof value==='number'&&Number.isInteger(value)?value:null;
/** Reads a refusal (any error with a `code` and optional `detail` body) as a PoW problem, or null when it is something else. */
export function powHint(error:unknown):PowHint|null {
 const e=error as {code?:unknown;detail?:Record<string,unknown>|null}|null;
 if(!e||typeof e!=='object'||typeof e.code!=='string')return null;
 const reason=e.code==='pow_required'?(typeof e.detail?.reason==='string'?e.detail.reason:'pow_required'):e.code;
 if(e.code!=='pow_required'&&!(POW_CODES as readonly string[]).includes(reason))return null;
 return {code:reason,bits:int(e.detail?.bits),minute:int(e.detail?.minute)};
}
/** The difficulty to ask for: the site's configured value within the shared bounds, else the default. */
export const powDifficulty=(configured?:number|null)=>powBits(configured??null);
/** One SHA-256 of the prefix and nonce: whether it has at least `bits` leading zero bits. */
export async function stampHolds(prefix:string,nonce:string,bits:number) {
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(prefix+nonce)));
 return leadingZeroBits(hash)>=bits;
}
/** The worker's search, or null when no worker could run it (none available, the script did not load, or it answered nonsense). */
function inWorker(prefix:string,bits:number,signal?:AbortSignal):Promise<string|null> {
 return new Promise((resolve,reject)=>{
  if(typeof Worker==='undefined'){resolve(null);return;}
  let worker:Worker;
  try {worker=new Worker(POW_WORKER_PATH);} catch {resolve(null);return;}
  let settled=false;
  const finish=(nonce:string|null)=>{if(settled)return;settled=true;worker.terminate();signal?.removeEventListener('abort',abort);resolve(nonce);};
  const abort=()=>{if(settled)return;settled=true;worker.terminate();reject(new Error('pow_aborted'));};
  if(signal?.aborted){abort();return;}
  signal?.addEventListener('abort',abort,{once:true});
  worker.onmessage=(event:MessageEvent<{nonce?:unknown}>)=>{const nonce=event.data?.nonce;finish(typeof nonce==='string'&&/^[0-9a-f]{16}$/.test(nonce)?nonce:null);};
  worker.onerror=(event)=>{event.preventDefault();finish(null);};
  worker.onmessageerror=()=>finish(null);
  worker.postMessage({prefix,bits});
 });
}
/**
 * A stamp for this binding. `minute` is the server's current minute when a refusal said it (so a device with a wrong
 * clock still produces an acceptable stamp); otherwise this device's clock is used.
 */
export async function computeStamp(binding:PowBinding,o:{bits?:number;minute?:number|null;signal?:AbortSignal}={}):Promise<PowStamp> {
 const bits=o.bits??POW_BITS,minute=o.minute??powMinute(),prefix=powPrefix(binding,minute);
 const nonce=await inWorker(prefix,bits,o.signal);
 if(nonce&&await stampHolds(prefix,nonce,bits))return {minute,nonce};
 const skew=o.minute==null?{}:{minute:o.minute};
 return solvePow(binding,{bits,...skew,...(o.signal?{signal:o.signal}:{})});
}
/**
 * Sends a request that needs a stamp: computes it (announcing the work through `working`), sends, and when the server
 * refuses the stamp itself (expired, too easy, or its clock differs) computes one more with the server's hints and sends
 * once more. Any other refusal is the caller's to report. A difficulty above POW_CLIENT_MAX_BITS is refused before any
 * work (PowError 'pow_too_hard'); aborting `signal` stops the calculation (PowError 'pow_stopped') and nothing is sent.
 */
export async function withPow<T>(binding:()=>Promise<PowBinding>|PowBinding,request:(pow:PowStamp)=>Promise<T>,o:{bits?:number|null;working?:(on:boolean)=>void;signal?:AbortSignal}={}):Promise<T> {
 let bits=powDifficulty(o.bits),minute:number|null=null;
 for(let attempt=0;;attempt++) {
  if(bits>POW_CLIENT_MAX_BITS)throw new PowError('pow_too_hard');
  if(o.signal?.aborted)throw new PowError('pow_stopped');
  const bound=await binding();
  o.working?.(true);
  let pow:PowStamp;
  try {pow=await computeStamp(bound,{bits,minute,...(o.signal?{signal:o.signal}:{})});}
  catch(error) {throw new PowError(o.signal?.aborted||(error as Error).message==='pow_aborted'?'pow_stopped':'pow_unavailable');}
  finally {o.working?.(false);}
  // Stopped just as the calculation finished: still nothing is sent.
  if(o.signal?.aborted)throw new PowError('pow_stopped');
  try {return await request(pow);}
  catch(error) {
   // One more try, and only when the refusal says something a new stamp can fix: an expired stamp, the server's clock or a harder target.
   const hint=powHint(error);
   if(!hint||attempt>0||!(hint.code==='pow_stale'||hint.minute!==null||(hint.bits!==null&&hint.bits>bits)))throw error;
   bits=hint.bits!==null?Math.max(bits,powDifficulty(hint.bits)):bits;minute=hint.minute;
  }
 }
}
