import {suite,prepareProof,encode,decode,publicAuthorSchema,type IssuerKey} from '../shared/proof.ts';
/** A blind-signed contribution credential. Defaults to a sandbox (demo) key for the fictional employer northwind-labs. */
export async function proofFixture(options:{slug?:string;verificationClass?:'demo'|'mailbox'}={}) {
 const slug=options.slug??'northwind-labs', verificationClass=options.verificationClass??'demo';
 const pair=await suite().generateKey({modulusLength:2048,publicExponent:new Uint8Array([1,0,1])});
 const issuer:IssuerKey={id:`${slug}:2026-Q3:${verificationClass}`,companySlug:slug,epoch:'2026-Q3',expiresAt:'2027-07-01T00:00:00Z',verificationClass,publicKey:await crypto.subtle.exportKey('jwk',pair.publicKey)};
 const author=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',author.publicKey);
 const publicKey=publicAuthorSchema.parse({kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y});
 const prepared=await prepareProof(issuer,publicKey);
 const blinded=decode(prepared.blinded),signature=await suite().blindSign(pair.privateKey,blinded);
 return {issuer,author,publicKey,blinded,signature,proof:await prepared.finalize(encode(signature))};
}
