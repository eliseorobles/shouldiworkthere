import {z} from 'zod';
import {BREAKER} from './interpretation.ts';
export {BREAKER};
export const JEV_TIMEOUT_MS=6500, MIN_FALLBACK_MS=2500, NATIVE_FLOOR_MS=1500, NATIVE_MODEL='typesafe/jev', HTTP_MODEL='jev-latest', DEFAULT_GATEWAY_ID='default';
export const TYPESAFE_URL='https://api.typesafe.ai/v1/systemone';
export type Provider='workers-ai'|'typesafe-api';
export type FallbackReason='native_failed'|'circuit_open'|'native_unavailable';
export interface AIBinding {run(model:string,input:unknown,options?:{gateway?:{id:string;skipCache?:boolean;collectLog?:boolean;requestTimeoutMs?:number};signal?:AbortSignal}):Promise<unknown>;}
export interface AIEnv {AI?:AIBinding;JEV_PROVIDER?:string;JEV_FALLBACK?:string;JEV_GATEWAY_ID?:string;TYPESAFE_API_KEY?:string;DB?:D1Database;}
export type Question={type:'choice';instructions:string;criteria:Record<string,string>}|{type:'noul';instructions:string;criteria?:{true?:string;false?:string}}|{type:'score';instructions:string;criteria:string[]};
const unit=z.number().finite().min(0).max(1);
const answerSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('choice'),choice:z.string().max(200),confidence:unit,probabilities:z.record(z.string(),unit)}),
 z.object({type:z.literal('noul'),noul:unit}),
 z.object({type:z.literal('score'),score:z.number().finite(),confidence:unit,probabilities:z.record(z.string(),unit),legend:z.record(z.string(),z.unknown()).optional()}),
]);
export type Answer=z.infer<typeof answerSchema>;
const responseSchema=z.object({model:z.string().min(1).max(120).optional(),answers:z.record(z.string(),z.unknown())});
const usageSchema=z.object({input_tokens:z.number().finite().nonnegative(),output_tokens:z.number().finite().nonnegative()});
export interface AIResponse {model:string;provider:Provider;answers:Record<string,Answer>;usage?:{input_tokens:number;output_tokens:number};fallbackReason?:FallbackReason;keySource?:string;}
const invalid=()=>new Error('invalid_model_response');
function distribution(p:Record<string,number>,allowed:(key:string)=>boolean) {
 const keys=Object.keys(p);
 if(!keys.length||keys.some(k=>!allowed(k)))throw invalid();
 const sum=keys.reduce((s,k)=>s+p[k]!,0);
 if(!(Math.abs(sum-1)<=.06))throw invalid();
 return sum;
}
/**
 * Fails closed on any answer that does not match its question; answers nobody asked for are dropped. An `optional`
 * question's missing or invalid answer is dropped instead, so it can never fail the answers the caller depends on.
 */
export function validateAnswers(questions:Record<string,Question>,answers:Record<string,unknown>,optional:readonly string[]=[]):Record<string,Answer> {
 const out:Record<string,Answer>={};
 for(const [id,q] of Object.entries(questions)) {
  try {out[id]=validAnswer(q,Object.hasOwn(answers,id)?answers[id]:undefined);}
  catch(error) {if(!optional.includes(id))throw error;}
 }
 return out;
}
function validAnswer(q:Question,raw:unknown):Answer {
 const parsed=answerSchema.safeParse(raw);
 if(!parsed.success||parsed.data.type!==q.type)throw invalid();
 const a=parsed.data;
 if(a.type==='choice'&&q.type==='choice') {
  const allowed=(k:string)=>Object.hasOwn(q.criteria,k);
  if(!allowed(a.choice))throw invalid();
  distribution(a.probabilities,allowed);
  const top=Math.max(...Object.values(a.probabilities));
  if(!Object.hasOwn(a.probabilities,a.choice)||a.probabilities[a.choice]!<top-1e-3)throw invalid();
 }
 if(a.type==='score'&&q.type==='score') {
  const levels=q.criteria.length;if(levels<2||levels>10)throw invalid();
  const allowed=(k:string)=>/^(0|[1-9]\d?)$/.test(k)&&Number(k)<levels;
  const sum=distribution(a.probabilities,allowed);
  if(a.score<-1e-6||a.score>levels-1+1e-6)throw invalid();
  const expected=Object.entries(a.probabilities).reduce((s,[k,p])=>s+Number(k)*p,0)/sum;
  if(Math.abs(expected-a.score)>.2)throw invalid();
  if(a.legend&&Object.keys(a.legend).some(k=>!allowed(k)))throw invalid();
 }
 return a;
}
const keySourceSchema=z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
/** Accepts the bare answer body or the Workers AI envelope {state:'Completed',result,gatewayMetadata}; any other envelope state fails closed. */
function parse(provider:Provider,raw:unknown,questions:Record<string,Question>,fallbackModel:string,optional:readonly string[]=[]):AIResponse {
 let body=typeof raw==='string'?JSON.parse(raw) as unknown:raw,keySource:string|undefined;
 if(body&&typeof body==='object'&&!('answers' in body)&&('result' in body||'state' in body)) {
  const envelope=body as {state?:unknown;result?:unknown;gatewayMetadata?:{keySource?:unknown}|null};
  if(envelope.state!==undefined&&envelope.state!=='Completed')throw invalid();
  const source=keySourceSchema.safeParse(envelope.gatewayMetadata?.keySource);if(source.success)keySource=source.data;
  body=envelope.result;
 }
 const parsed=responseSchema.safeParse(body);if(!parsed.success)throw invalid();
 const usage=usageSchema.safeParse((body as {usage?:unknown}).usage);
 return {model:parsed.data.model??fallbackModel,provider,answers:validateAnswers(questions,parsed.data.answers,optional),...(usage.success?{usage:usage.data}:{}),...(keySource?{keySource}:{})};
}
async function within<T>(work:Promise<T>,ms:number):Promise<T> {
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('inference_timeout')),Math.max(0,ms));})]);}
 finally {clearTimeout(timer);}
}
const bucket=(at:number)=>new Date(Math.floor(at/BREAKER.windowMs)*BREAKER.windowMs).toISOString().slice(0,16);
async function breakerOpen(env:AIEnv) {
 if(!env.DB)return false;
 try {const now=Date.now();const row=await env.DB.prepare("SELECT COALESCE(SUM(calls),0) AS n FROM inference_health WHERE outcome='native_failure' AND period IN (?,?)").bind(bucket(now),bucket(now-BREAKER.windowMs)).first<{n:number}>();return (row?.n??0)>=BREAKER.failures;}
 catch {return false;}
}
async function recordNativeFailure(env:AIEnv) {
 if(!env.DB)return;
 const now=Date.now();
 try {await env.DB.batch([
  env.DB.prepare("INSERT INTO inference_health(period,outcome,calls) VALUES(?,'native_failure',1) ON CONFLICT(period,outcome) DO UPDATE SET calls=calls+1").bind(bucket(now)),
  env.DB.prepare("DELETE FROM inference_health WHERE outcome='native_failure' AND period<?").bind(bucket(now-86400000)),
 ]);} catch {}
}
// Gateway options are always sent so per-request gateway logging stays off and nothing is served from or stored in its cache.
async function native(env:AIEnv,state:unknown,questions:Record<string,Question>,ms:number,optional:readonly string[]) {
 const gateway={id:env.JEV_GATEWAY_ID||DEFAULT_GATEWAY_ID,skipCache:true,collectLog:false,requestTimeoutMs:ms};
 const raw=await within(env.AI!.run(NATIVE_MODEL,{state,questions},{gateway,signal:AbortSignal.timeout(ms)}),ms);
 return parse('workers-ai',raw,questions,NATIVE_MODEL,optional);
}
/** With a fallback configured, native keeps MIN_FALLBACK_MS in reserve only while it still has NATIVE_FLOOR_MS itself; short deadlines split 60/40. */
export function nativeBudget(remaining:number,fallback:boolean) {
 const ms=!fallback?remaining:remaining-MIN_FALLBACK_MS>=NATIVE_FLOOR_MS?remaining-MIN_FALLBACK_MS:Math.floor(remaining*.6);
 return Math.max(1,Math.min(JEV_TIMEOUT_MS,ms));
}
async function http(env:AIEnv,state:unknown,questions:Record<string,Question>,ms:number,optional:readonly string[]) {
 if(!env.TYPESAFE_API_KEY)throw new Error('inference_not_configured');
 if(ms<500)throw new Error('inference_timeout');
 const budget=Math.min(ms,JEV_TIMEOUT_MS);
 const res=await within(fetch(TYPESAFE_URL,{method:'POST',headers:{authorization:`Bearer ${env.TYPESAFE_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:HTTP_MODEL,state,questions}),signal:AbortSignal.timeout(budget)}),budget);
 if(!res.ok)throw new Error('inference_unavailable');
 return parse('typesafe-api',await within(res.json() as Promise<unknown>,budget),questions,HTTP_MODEL,optional);
}
/** Workers AI text embeddings for optional semantic retrieval over PUBLISHED accounts only. */
export const EMBEDDING_MODEL='@cf/baai/bge-base-en-v1.5';
const embeddingSchema=z.object({data:z.array(z.array(z.number().finite()).min(8).max(4096)).min(1)});
export async function embed(env:AIEnv,texts:string[],options:{timeoutMs?:number}={}):Promise<number[][]> {
 if(!env.AI)throw new Error('inference_not_configured');
 const ms=Math.max(1,Math.min(JEV_TIMEOUT_MS,options.timeoutMs??JEV_TIMEOUT_MS));
 const gateway={id:env.JEV_GATEWAY_ID||DEFAULT_GATEWAY_ID,skipCache:true,collectLog:false,requestTimeoutMs:ms};
 const parsed=embeddingSchema.safeParse(await within(env.AI.run(EMBEDDING_MODEL,{text:texts},{gateway,signal:AbortSignal.timeout(ms)}),ms));
 if(!parsed.success||parsed.data.data.length!==texts.length||new Set(parsed.data.data.map(v=>v.length)).size!==1)throw invalid();
 return parsed.data.data;
}
/**
 * JEV_PROVIDER=cloudflare uses the Workers AI binding; the TypeSafe HTTP API serves only when JEV_FALLBACK=typesafe and a key
 * exists. Every result names its provider. `optional` question ids may be missing from the answers (see validateAnswers).
 */
export async function evaluate(env:AIEnv,state:unknown,questions:Record<string,Question>,options:{timeoutMs?:number;optional?:readonly string[]}={}):Promise<AIResponse> {
 const provider=env.JEV_PROVIDER??'typesafe',deadline=Date.now()+(options.timeoutMs??JEV_TIMEOUT_MS),optional=options.optional??[];
 if(provider==='typesafe')return http(env,state,questions,deadline-Date.now(),optional);
 if(provider!=='cloudflare')throw new Error('inference_not_configured');
 const fallback=env.JEV_FALLBACK==='typesafe'&&!!env.TYPESAFE_API_KEY;
 let reason:FallbackReason='native_unavailable';
 if(env.AI&&await breakerOpen(env))reason='circuit_open';
 else if(env.AI) {
  const ms=nativeBudget(deadline-Date.now(),fallback),started=Date.now();
  try {return await native(env,state,questions,ms,optional);}
  catch {reason='native_failed';if(ms>=BREAKER.minBudgetMs||Date.now()-started<ms-50)await recordNativeFailure(env);}
 }
 if(!fallback)throw new Error(env.AI?'inference_unavailable':'inference_not_configured');
 return {...await http(env,state,questions,deadline-Date.now(),optional),fallbackReason:reason};
}
