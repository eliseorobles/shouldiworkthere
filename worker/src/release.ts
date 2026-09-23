import {RELEASE_MANIFEST} from '../generated/release-manifest.ts';

/**
 * The signed release manifest (tools/transparency.mjs) embedded at build time, served verbatim so anyone can compare it
 * with the live client assets, source listing, issuer keys and archives (tools/verify-deployment.mjs). It lets outsiders
 * detect a served build or key set that the operator did not sign; it cannot prove which code the Worker executes.
 */
export function releaseManifestResponse(): Response {
 if(!RELEASE_MANIFEST)return Response.json({error:'no_release_manifest'},{status:404,headers:{'cache-control':'no-store'}});
 return new Response(RELEASE_MANIFEST,{headers:{'content-type':'application/json','cache-control':'public,max-age=300','access-control-allow-origin':'*'}});
}
