import {z} from 'zod';
import {canonicalJson,policy} from './policy.ts';
import {decode,digest} from './proof.ts';
import {CANONICAL_ORIGIN} from './brand.ts';

// Break-glass: a valid legal order or a credible imminent-safety issue can withhold one named account for a bounded time,
// and only with signatures from two distinct, unrevoked trustees of three. There is no other removal path.
const b64url=(length:number)=>z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${length}}$`));
export const exceptionActionSchema=z.object({
 kind:z.enum(policy.exceptions.kinds),
 target:z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
 scope:z.enum(policy.exceptions.scopes),
 expiresAt:z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/),
 nonce:z.string().regex(/^[A-Za-z0-9_-]{22,86}$/),
}).strict();
export type ExceptionAction=z.infer<typeof exceptionActionSchema>;
export type ExceptionKind=ExceptionAction['kind'];
export const signedExceptionSchema=z.object({
 action:exceptionActionSchema,
 signatures:z.array(z.object({trustee:z.string().regex(/^[a-z0-9-]{1,40}$/),signature:b64url(86)}).strict()).min(1).max(6),
}).strict();
export type SignedException=z.infer<typeof signedExceptionSchema>;
const trusteeSchema=z.object({id:z.string().regex(/^[a-z0-9-]{1,40}$/),publicKey:b64url(43),revoked:z.boolean().optional()}).strict();
export type Trustee=z.infer<typeof trusteeSchema>;
export type ExceptionVerdict={ok:true;action:ExceptionAction;signers:string[]}|{ok:false;error:'invalid_action'|'expired'|'expiry_too_far'|'replayed'|'insufficient_signatures'};

/** The configured trustees (TRUSTEE_KEYS, a JSON array), or null (disabled) unless there are exactly the policy's number of distinct trustees and keys. */
export function parseTrustees(config:string|undefined|null):Trustee[]|null {
 if(!config)return null;
 try {
  const list=z.array(trusteeSchema).parse(JSON.parse(config));
  if(list.length!==policy.exceptions.trustees||new Set(list.map(t=>t.id)).size!==list.length||new Set(list.map(t=>t.publicKey)).size!==list.length)return null;
  return list;
 } catch {return null;}
}
/**
 * Trustees sign 'siwt-exception-v1:' + the deployment's origin + ':' + the canonical JSON of the action. The prefix keeps
 * these signatures from meaning anything under another use of the same keys; the origin keeps a signature made for one
 * deployment from being replayed at another, whose nonce table is separate.
 */
export const exceptionMessage=(action:ExceptionAction,origin:string=CANONICAL_ORIGIN)=>new TextEncoder().encode(`siwt-exception-v1:${origin}:${canonicalJson(action)}`);
export const actionDigest=(action:ExceptionAction)=>digest(canonicalJson(action));
async function verifyEd25519(publicKey:string,signature:string,message:Uint8Array<ArrayBuffer>) {
 try {
  const key=await crypto.subtle.importKey('raw',decode(publicKey),{name:'Ed25519'},false,['verify']);
  return await crypto.subtle.verify({name:'Ed25519'},key,decode(signature),message);
 } catch {return false;}
}
/**
 * Accepts an action only with signatures from `requiredSignatures` distinct, unrevoked trustees (a repeated signature or
 * key counts once), an expiry in the future and within the kind's maximum, and a nonce not seen before. The caller must
 * still record the nonce atomically before acting.
 */
export async function verifyExceptionAction(input:unknown,trustees:readonly Trustee[],now:number,seen:{has(nonce:string):boolean|Promise<boolean>},origin:string=CANONICAL_ORIGIN):Promise<ExceptionVerdict> {
 const parsed=signedExceptionSchema.safeParse(input);
 if(!parsed.success)return {ok:false,error:'invalid_action'};
 const {action,signatures}=parsed.data;
 const expires=Date.parse(action.expiresAt);
 if(!Number.isFinite(expires)||expires<=now)return {ok:false,error:'expired'};
 if(expires-now>policy.exceptions.maxDays[action.kind]*86400000)return {ok:false,error:'expiry_too_far'};
 if(await seen.has(action.nonce))return {ok:false,error:'replayed'};
 const message=exceptionMessage(action,origin),signers=new Set<string>(),keys=new Set<string>();
 for(const {trustee,signature} of signatures) {
  const holder=trustees.find(t=>t.id===trustee);
  if(!holder||holder.revoked||signers.has(holder.id)||keys.has(holder.publicKey))continue;
  if(await verifyEd25519(holder.publicKey,signature,message)){signers.add(holder.id);keys.add(holder.publicKey);}
 }
 if(signers.size<policy.exceptions.requiredSignatures)return {ok:false,error:'insufficient_signatures'};
 return {ok:true,action,signers:[...signers].sort()};
}
