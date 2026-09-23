import * as proof from '../../shared/proof.ts';
import {validateProof, jurorProofSchema, type IssuerKey} from '../../shared/proof.ts';
import type {Env} from './types.ts';
import {samplesEnabled} from './flags.ts';

type Purpose='contribution'|'juror';
type Row={id:string;company_slug:string;epoch:string;expires_at:string;verification_class:'demo'|'mailbox';public_key_json:string;purpose?:string|null;source?:string|null};
/** A published key with its source: 'community' for a key the verifier created for a community-added domain (no release can pin it). */
export type PublishedIssuerKey=IssuerKey&{source:'curated'|'community'};
/** Same rule as shared/proof.ts keyPurpose: the id decides, and a stored purpose that disagrees makes the key unusable. */
function purposeOf(key:{id:string;purpose?:string|null}):Purpose|null {
 const byId:Purpose=key.id.includes(':juror:')?'juror':'contribution';
 return key.purpose==null||key.purpose===byId?byId:null;
}
/**
 * Live keys only; a community key only while the listing it was copied for still has a community-added domain that the
 * verifier acknowledged. A listing corrected (its domain detached) or withdrawn therefore stops being served and stops
 * verifying at once, even if a copied key row were left behind. A database from before migration 0010 has no community
 * keys, so there every live key is served.
 */
async function liveKeyRows(env:Pick<Env,'DB'>):Promise<Row[]> {
 const now=new Date().toISOString();
 try {
  return (await env.DB.prepare("SELECT t.* FROM trusted_issuers t WHERE t.expires_at>? AND (COALESCE(t.source,'curated')<>'community' OR EXISTS(SELECT 1 FROM employer_domains d JOIN companies c ON c.id=d.company_id WHERE c.slug=t.company_slug AND d.source='community' AND d.registered=1))").bind(now).all<Row>()).results;
 } catch {
  return (await env.DB.prepare('SELECT * FROM trusted_issuers WHERE expires_at>?').bind(now).all<Row>()).results.filter(r=>r.source!=='community');
 }
}
/**
 * Every live key, with its stored purpose when the column exists; pass a purpose to get only usable keys of that kind.
 * Sandbox ('demo') keys belong to the fictional sample employers only, so they are left out while those are hidden
 * (SAMPLE_EMPLOYERS not 'on'). Every key states its source, as the verifier's /keys does ('curated' or 'community').
 */
export async function publicIssuerKeys(env:Pick<Env,'DB'>&Partial<Pick<Env,'SAMPLE_EMPLOYERS'>>,purpose?:Purpose):Promise<PublishedIssuerKey[]> {
 const results=await liveKeyRows(env);
 const shown=samplesEnabled(env)?results:results.filter(r=>r.verification_class!=='demo');
 // The fields in the verifier's order (worker/issuer.ts describe), so the two copies of a key also serialize alike.
 const keys=shown.map(r=>({id:r.id,companySlug:r.company_slug,epoch:r.epoch,expiresAt:r.expires_at,verificationClass:r.verification_class,...(r.purpose?{purpose:r.purpose as Purpose}:{}),source:r.source==='community'?'community' as const:'curated' as const,publicKey:JSON.parse(r.public_key_json) as JsonWebKey}));
 return purpose?keys.filter(k=>purposeOf(k)===purpose):keys;
}
type KeyEnv=Pick<Env,'DB'>&Partial<Pick<Env,'SAMPLE_EMPLOYERS'>>;
/**
 * The published key a credential or token names, or undefined. The check never contacts the verifier: a community key is
 * usable once the publisher copied it (at registration, or by the 6-hourly job) and only while its listing's community
 * domain stays registered (liveKeyRows), and the browser blinds only against a community key both copies publish
 * identically.
 */
async function findKey(env:KeyEnv,purpose:Purpose,keyId:unknown):Promise<PublishedIssuerKey|undefined> {
 return (await publicIssuerKeys(env,purpose)).find(k=>k.id===keyId);
}
export async function inspectCredential(env:KeyEnv,input:unknown,companySlug:string) {
 const keyId=(input as {keyId?:unknown})?.keyId;
 const key=await findKey(env,'contribution',keyId);
 if(!key) throw new Error('unknown_issuer_key');
 return validateProof(input,key,companySlug);
}

type JurorValidator=(input:unknown,key:IssuerKey,now?:number)=>Promise<{nullifier:string;key:IssuerKey}>;
// Read through the namespace so this module compiles whether or not the protocol module exports the validator yet.
const jurorValidator=():JurorValidator|undefined=>(proof as unknown as {validateJurorToken?:JurorValidator}).validateJurorToken;
/** Juries can run only when the anonymous juror token protocol is present. */
export const jurorProtocolAvailable=()=>typeof jurorValidator()==='function';
export type JurorClass='sandbox'|'mailbox';
/**
 * source is the published key's: 'community' when the verifier created the key for a domain someone added to the
 * directory (anyone who controls a domain can hold such tokens), 'curated' otherwise. Juries seat community tokens
 * together under one small cap (moderation.ts assignJuror).
 */
export interface JurorCredential {nullifier:string;keyId:string;companySlug:string;jurorClass:JurorClass;expiresAt:string;source:'curated'|'community';}
/**
 * Validates one anonymous juror token. The result names only the token's employer, class and key source, never a person.
 * Something that is not a token at all (not the {keyId, prepared, signature} object) is invalid_token, never
 * unknown_issuer_key, which means only that a well-formed token names a key that is not published.
 */
export async function inspectJurorToken(env:KeyEnv,input:unknown,now=Date.now()):Promise<JurorCredential> {
 const validate=jurorValidator();
 if(!validate) throw new Error('juror_tokens_unavailable');
 if(!jurorProofSchema.safeParse(input).success) throw new Error('invalid_token');
 const keyId=(input as {keyId?:unknown})?.keyId;
 const key=await findKey(env,'juror',keyId);
 if(!key) throw new Error('unknown_issuer_key');
 const {nullifier}=await validate(input,key,now);
 return {nullifier,keyId:key.id,companySlug:key.companySlug,jurorClass:key.verificationClass==='mailbox'?'mailbox':'sandbox',expiresAt:key.expiresAt,source:key.source};
}
