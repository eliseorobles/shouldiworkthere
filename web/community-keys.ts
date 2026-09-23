import {keySource,keyPurpose,currentIssuerKey,sameIssuerKey,type IssuerKey,type KeyPurpose} from '../shared/proof.ts';
import {CANONICAL_ORIGIN} from '../shared/brand.ts';

/*
 * Community keys (owner decision 4): the verifier creates an employer's keys on demand once a visitor lists it with its
 * work-email domain, after the release was built, so no release can pin them. The browser uses one only when the
 * publisher's copy and the verifier's copy agree exactly, and says the key was added after this release. Because that
 * agreement is the only thing vouching for such a key, two further rules hold: the verifier must be the one this release
 * names (pinnedVerifier), and a community key never stands in for an employer that has a curated work-mailbox key.
 */
/** A community key, by its declared source and its id alike (shared/proof.ts keySource: a mismatch is neither). */
export const isCommunityKey=(key:Pick<IssuerKey,'id'|'source'>)=>keySource(key)==='community';
/** A value as JSON with every object's keys sorted, so two copies of one key compare member for member whatever their field order. */
export function canonicalJson(value:unknown):string {
 if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalJson((value as Record<string,unknown>)[k])}`).join(',')}}`;
 return JSON.stringify(value)??'null';
}
/**
 * Publisher and verifier copies of a community key: both community keys, the same key record (sameIssuerKey: id,
 * employer, quarter, expiry, class, purpose, modulus, exponent and source) and the same public key, member for member
 * (every member present in both, with equal values). Anything else is refused.
 */
export const sameCommunityKey=(a:IssuerKey,b:IssuerKey)=>isCommunityKey(a)&&isCommunityKey(b)&&sameIssuerKey(a,b)&&canonicalJson(a.publicKey)===canonicalJson(b.publicKey);
export const COMMUNITY_KEY_NOTE='This employer’s key was added after this release, so it is not in the key registry this release was built with. The verifier and this site published it identically, member for member.';

/** A live curated work-mailbox key of this employer and purpose: the kind a release pins. */
export const curatedMailboxKey=(keys:ReadonlyArray<IssuerKey>,companySlug:string,purpose:KeyPurpose,now=Date.now())=>keys.find(k=>k.companySlug===companySlug&&keyPurpose(k)===purpose&&keySource(k)==='curated'&&k.verificationClass==='mailbox'&&Date.parse(k.expiresAt)>now)??null;
/**
 * The key the browser blinds against (shared/proof.ts currentIssuerKey), except that an employer and purpose with a
 * curated work-mailbox key never gets a community key or a key of unreadable source: a key added after the release
 * (which only the two services' agreement vouches for) must not replace one the release pinned, whatever order the
 * publisher lists them in. Throws as currentIssuerKey does when an employer has more live keys than published.
 */
export function chooseIssuerKey(keys:IssuerKey[],companySlug:string,now=Date.now(),purpose:KeyPurpose='contribution') {
 const usable=curatedMailboxKey(keys,companySlug,purpose,now)?keys.filter(k=>k.companySlug!==companySlug||keySource(k)==='curated'):keys;
 return currentIssuerKey(usable,companySlug,now,purpose);
}

/**
 * The verifier this release was built for. tools/build.mjs may define __SIWT_VERIFIER_ORIGIN__ from the release; without
 * it, the production site (shared/brand.ts CANONICAL_ORIGIN) names the production verifier, which issuer.wrangler.jsonc
 * serves and wrangler.jsonc's VERIFIER_ORIGIN states. Elsewhere (local development and tests) nothing is pinned.
 */
declare const __SIWT_VERIFIER_ORIGIN__:string|null|undefined;
export const RELEASE_VERIFIERS:Readonly<Record<string,string>>={[CANONICAL_ORIGIN]:'https://verify.shouldiworkthere.com'};
export function pinnedVerifier(pageOrigin:string=typeof location==='undefined'?'':location.origin):string|null {
 if(typeof __SIWT_VERIFIER_ORIGIN__==='string'&&__SIWT_VERIFIER_ORIGIN__)return __SIWT_VERIFIER_ORIGIN__;
 return RELEASE_VERIFIERS[pageOrigin]??null;
}
/**
 * Why the verifier address the site's config gives cannot be used, or null. Every work email, blinded request and key
 * check goes to that address, and a community key is trusted only because the verifier's copy matches the site's, so a
 * config that points elsewhere (a publisher serving its own "verifier") is refused before anything is sent to it.
 */
export function verifierProblem(verifier:string,pinned:string|null=pinnedVerifier()):string|null {
 if(!verifier)return 'The verifier address is unavailable, so nothing was sent. Reload the page and try again.';
 let origin:string;
 try {origin=new URL(verifier).origin;} catch {return 'The verifier address this site gave is not a web address, so nothing was sent.';}
 // Exactly the pinned origin: the requests go to `${verifier}/start` and so on, so a path or another host is another service.
 if(pinned&&verifier.replace(/\/+$/,'')!==pinned)return `This site named ${origin} as its verifier, but this release was built for ${pinned}. Nothing was sent to either. Do not continue; this is what an attempt to read work emails or tag visitors would look like.`;
 return null;
}
