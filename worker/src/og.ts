import {OG_IMAGES} from '../generated/og-assets.ts';

/** Open Graph images are generated at build time by tools/og.mjs and embedded by tools/build.mjs; nothing is fetched or rendered per request. */
const NAME=/^\/og\/([a-z0-9][a-z0-9-]{0,99})\.jpg$/;
const decoded=new Map<string,Uint8Array<ArrayBuffer>>();
export const ogImageName=(slug:string)=>`c-${slug}`;
export const hasOgImage=(name:string)=>Object.hasOwn(OG_IMAGES,name);
export function ogImageResponse(path:string):Response|null {
 const name=NAME.exec(path)?.[1];
 if(!name||!hasOgImage(name))return null;
 let bytes=decoded.get(name);
 if(!bytes){bytes=Uint8Array.from(atob(OG_IMAGES[name]!),c=>c.charCodeAt(0));decoded.set(name,bytes);}
 return new Response(bytes,{headers:{'content-type':'image/jpeg','cache-control':'public,max-age=86400','x-content-type-options':'nosniff'}});
}
