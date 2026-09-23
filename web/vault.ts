import {publicAuthorSchema,encode,digest,authorMessage,type Proof,type BlindingState} from '../shared/proof.ts';
// Nothing here stores a receipt id or a public id. The device database exists only while the author has chosen to keep
// something: reading never creates it, and it is deleted once nothing is kept, because its mere existence would show that
// this browser contributed. Entries are keyed by digest('siwt-vault-v1:'+capability), unlike the server's digest(capability).
const STORES=['keys','pending','jurors','issuing'] as const;
type Store=typeof STORES[number];
export const DEVICE_STORE='siwt-device';
const VERSION=3;
const LEGACY_STORE='shouldiworkthere-author-vault';
const settle=(request:IDBRequest|IDBOpenDBRequest)=>new Promise<void>(resolve=>{request.onsuccess=()=>resolve();request.onerror=event=>{event.preventDefault();resolve();};if('onblocked' in request)request.onblocked=()=>resolve();});
let legacyRemoved:Promise<void>|undefined;
/** Version 1 keyed signing keys by receipt ids that were also public testimony ids. It is deleted outright; deleting a database that does not exist creates nothing. */
function removeLegacy() {return legacyRemoved??=(async()=>{try {await settle(indexedDB.deleteDatabase(LEGACY_STORE));} catch {}})();}
/** Whether the device database exists, determined without creating it. */
export async function deviceStoreExists():Promise<boolean> {
 try {if(typeof indexedDB.databases==='function')return (await indexedDB.databases()).some(entry=>entry.name===DEVICE_STORE);} catch {}
 return new Promise(resolve=>{
  let request:IDBOpenDBRequest;
  try {request=indexedDB.open(DEVICE_STORE);} catch {resolve(false);return;}
  // Opening a missing database would create it; aborting that first upgrade leaves nothing behind.
  request.onupgradeneeded=()=>request.transaction?.abort();
  request.onsuccess=()=>{request.result.close();resolve(true);};
  request.onerror=event=>{event.preventDefault();resolve(false);};
 });
}
function database():Promise<IDBDatabase> {
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open(DEVICE_STORE,VERSION);
  request.onupgradeneeded=()=>{const db=request.result;for(const store of STORES)if(!db.objectStoreNames.contains(store))db.createObjectStore(store);};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('Local key storage unavailable'));
 });
}
/** Opens the database only if it exists. A version-less open that would create it is aborted, so a read racing a deletion cannot bring it back. */
function openExisting():Promise<IDBDatabase|null> {
 return new Promise(resolve=>{
  let request:IDBOpenDBRequest,created=false;
  try {request=indexedDB.open(DEVICE_STORE);} catch {resolve(null);return;}
  request.onupgradeneeded=()=>{created=true;request.transaction?.abort();};
  request.onsuccess=()=>{if(created){request.result.close();resolve(null);}else resolve(request.result);};
  request.onerror=event=>{event.preventDefault();resolve(null);};
 });
}
/** Only an explicit opt-in (create) may bring the database into existence; every other call is a no-op when it is absent. */
async function withStore<T>(store:Store,mode:IDBTransactionMode,work:(s:IDBObjectStore)=>IDBRequest<T>|void,create=false):Promise<T|undefined> {
 await removeLegacy();
 let existing:IDBDatabase|null=null;
 if(!create) {
  if(!(await deviceStoreExists()))return undefined;
  existing=await openExisting();if(!existing)return undefined;
  // A database kept by the previous version lacks the newer stores; it exists, so upgrading it creates nothing new.
  if(!existing.objectStoreNames.contains(store)){existing.close();existing=null;}
 }
 const db=existing??await database();
 try {
  return await new Promise<T|undefined>((resolve,reject)=>{const tx=db.transaction(store,mode);const request=work(tx.objectStore(store));tx.oncomplete=()=>resolve(request?request.result:undefined);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
 } finally {db.close();}
}
async function counts():Promise<Record<Store,number>> {
 const values=await Promise.all(STORES.map(store=>withStore<number>(store,'readonly',s=>s.count())));
 return Object.fromEntries(STORES.map((store,index)=>[store,values[index]??0])) as Record<Store,number>;
}
async function removeIfEmpty() {
 if(Object.values(await counts()).every(count=>!count))await settle(indexedDB.deleteDatabase(DEVICE_STORE));
}
/** What this device keeps, counted without creating the database. */
export async function deviceHoldings():Promise<Record<Store,number>> {
 if(!(await deviceStoreExists()))return {keys:0,pending:0,jurors:0,issuing:0};
 return counts();
}
/** Deletes everything this site kept on this device, including the earlier version's database. */
export async function forgetDevice() {await settle(indexedDB.deleteDatabase(DEVICE_STORE));await settle(indexedDB.deleteDatabase(LEGACY_STORE));}
export const vaultKey=(capability:string)=>digest(`siwt-vault-v1:${capability}`);
export async function createAuthor() {
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',pair.publicKey);
 const publicKey=publicAuthorSchema.parse({kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y});
 return {privateKey:pair.privateKey,publicKey};
}
export type Author=Awaited<ReturnType<typeof createAuthor>>;
export async function saveAuthor(capability:string,key:CryptoKey) {const id=await vaultKey(capability);await withStore('keys','readwrite',s=>{s.put(key,id);},true);}
export async function forgetAuthor(capability:string) {const id=await vaultKey(capability);if(!(await deviceStoreExists()))return;await withStore('keys','readwrite',s=>{s.delete(id);});await removeIfEmpty();}
async function loadAuthor(capability:string) {const id=await vaultKey(capability);return withStore<CryptoKey>('keys','readonly',s=>s.get(id));}
export async function hasAuthor(capability:string) {try {return Boolean(await loadAuthor(capability));} catch {return false;}}
/** Signs an author action over digest(capability). Uses the in-memory key when given, otherwise the opted-in device key. */
export async function signAction(capability:string,action:'withdraw'|'revise',revision:number,payloadHash:string,key?:CryptoKey) {
 const signingKey=key??await loadAuthor(capability);
 if(!signingKey)throw new Error('This device does not hold the signing key for this contribution. You can still withdraw with the capability alone.');
 return encode(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signingKey,authorMessage(await digest(capability),action,revision,payloadHash,action==='revise'))));
}
/** A finished blind proof kept on this device (opt-in) so submission can happen later, decoupled from issuance timing. */
export interface PendingProof {handle:string;companySlug:string;keyId:string;expiresAt:string;proof:Proof;author:Author;}
export async function savePendingProof(entry:Omit<PendingProof,'handle'>) {
 const handle=encode(crypto.getRandomValues(new Uint8Array(16)));
 await withStore('pending','readwrite',s=>{s.put({...entry,handle},handle);},true);
 return handle;
}
export async function deletePendingProof(handle:string) {if(!(await deviceStoreExists()))return;await withStore('pending','readwrite',s=>{s.delete(handle);});await removeIfEmpty();}
export async function listPendingProofs(companySlug:string):Promise<PendingProof[]> {
 const all=(await withStore<PendingProof[]>('pending','readonly',s=>s.getAll()))??[];
 const expired=all.filter(p=>Date.parse(p.expiresAt)<=Date.now());
 for(const p of expired)await deletePendingProof(p.handle);
 return all.filter(p=>p.companySlug===companySlug&&!expired.includes(p));
}
/** Unused anonymous juror tokens kept on this device (opt-in), so serving can happen later than issuance. They carry no author key. */
export interface KeptJurorToken {handle:string;keyId:string;companySlug:string;verificationClass:string;expiresAt:string;token:unknown;}
export async function saveJurorTokens(entries:Omit<KeptJurorToken,'handle'>[]) {
 const handles:string[]=[];
 for(const entry of entries) {const handle=encode(crypto.getRandomValues(new Uint8Array(16)));await withStore('jurors','readwrite',s=>{s.put({...entry,handle},handle);},true);handles.push(handle);}
 return handles;
}
export async function deleteJurorToken(handle:string) {if(!(await deviceStoreExists()))return;await withStore('jurors','readwrite',s=>{s.delete(handle);});await removeIfEmpty();}
export async function listJurorTokens():Promise<KeptJurorToken[]> {
 const all=(await withStore<KeptJurorToken[]>('jurors','readonly',s=>s.getAll()))??[];
 const expired=all.filter(t=>Date.parse(t.expiresAt)<=Date.now());
 for(const t of expired)await deleteJurorToken(t.handle);
 return all.filter(t=>!expired.includes(t));
}
/**
 * An unfinished blind issuance kept on this device (opt-in), so a reload or a lost verifier reply cannot lose what the
 * verifier signs. It holds the blinded messages the verifier saw and the blinding states that finish them, so it links
 * that request to the finished credential or tokens: it never leaves the device and is deleted once they are finished or
 * the author gives up. The work email and the code are never kept.
 */
export interface PendingIssuance {handle:string;purpose:'contribution'|'juror';companySlug:string;keyId:string;challengeId:string|null;blinded:string[];states:BlindingState[];author?:Author;expiresAt:string;savedAt:string;}
export async function saveIssuance(entry:Omit<PendingIssuance,'handle'|'savedAt'>) {
 const handle=encode(crypto.getRandomValues(new Uint8Array(16)));
 await withStore('issuing','readwrite',s=>{s.put({...entry,handle,savedAt:new Date().toISOString()},handle);},true);
 return handle;
}
export async function deleteIssuance(handle:string) {if(!(await deviceStoreExists()))return;await withStore('issuing','readwrite',s=>{s.delete(handle);});await removeIfEmpty();}
/** Kept issuances for one employer and purpose; expired ones are deleted as they are found. */
export async function listIssuances(companySlug:string,purpose:PendingIssuance['purpose']):Promise<PendingIssuance[]> {
 const all=(await withStore<PendingIssuance[]>('issuing','readonly',s=>s.getAll()))??[];
 const expired=all.filter(p=>Date.parse(p.expiresAt)<=Date.now());
 for(const p of expired)await deleteIssuance(p.handle);
 return all.filter(p=>p.companySlug===companySlug&&p.purpose===purpose&&!expired.includes(p));
}
