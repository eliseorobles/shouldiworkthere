import { RSABSSA } from '@cloudflare/blindrsa-ts';
import { z } from 'zod';

export const suite = () => RSABSSA.SHA384.PSS.Randomized();
export const publicAuthorSchema = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().length(43), y: z.string().length(43) }).strict();
export const proofSchema = z.object({ keyId: z.string().max(120), prepared: z.string().max(2400), signature: z.string().max(800) }).strict();
export type Proof = z.infer<typeof proofSchema>;
export type KeyPurpose = 'contribution' | 'juror';
/**
 * 'curated': provisioned by tools/provision-issuer.mjs, in the registry a release is built with, and pinned by that
 * release's client. 'community': created by the verifier on demand for an employer domain registered after a release
 * (owner decision 4, 2026-09-23); it cannot be pinned by a build that predates it, so the browser accepts it only when the
 * publisher's and the verifier's copies agree exactly (sameIssuerKey compares the source too) and says it was added after
 * this release.
 */
export type KeySource = 'curated' | 'community';
/** purpose is absent on rows published before juror keys existed; those are contribution keys. source is absent on curated keys published before community keys existed. */
export interface IssuerKey { id: string; companySlug: string; epoch: string; expiresAt: string; verificationClass: 'demo' | 'mailbox'; purpose?: KeyPurpose; source?: KeySource; publicKey: JsonWebKey; }
export const jurorProofSchema = z.object({ keyId: z.string().max(120), prepared: z.string().max(2400), signature: z.string().max(800) }).strict();
export type JurorProof = z.infer<typeof jurorProofSchema>;
/**
 * Juror tokens per mailbox, employer and issuance quarter (policy 0.6.0: 3, issued as one batch, so a mailbox gets juror
 * tokens once a quarter and a refused request reveals only that they were already issued; tokens of one employer fill at
 * most 2 seats on a case). A batch never asks for more than the quota, for mailbox and sandbox keys alike.
 */
export const JUROR_QUOTA = 3;
export const JUROR_BATCH_MAX = JUROR_QUOTA;

/**
 * The network a connecting address belongs to, for every per-client limit and daily budget: an IPv4 address as it is,
 * an IPv6 address as its /64 prefix (one subscriber line or server usually holds a whole /64, so rotating addresses
 * inside it must not buy fresh budgets), and an IPv4-mapped IPv6 address as its IPv4 address. A missing address is
 * 'local'; an unparsable one is returned lowercased. Never stored: callers only hash it.
 */
export function networkKey(address: string | null | undefined): string {
  const raw = (address ?? '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/%.*$/, '');
  if (!raw) return 'local';
  if (!raw.includes(':')) return raw;
  let text = raw;
  const dotted = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (dotted) {
    const b = dotted.slice(1).map(Number);
    if (b.some(x => x > 255)) return raw;
    text = `${text.slice(0, dotted.index)}${((b[0]! << 8) | b[1]!).toString(16)}:${((b[2]! << 8) | b[3]!).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return raw;
  const part = (p: string) => (p ? p.split(':') : []);
  const head = part(halves[0]!), tail = halves.length === 2 ? part(halves[1]!) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (halves.length === 2 ? fill < 1 : head.length !== 8) return raw;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return raw;
  const g = groups.map(x => parseInt(x, 16));
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) return `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  return `${g.slice(0, 4).map(x => x.toString(16)).join(':')}::/64`;
}

/**
 * Reads a request body as UTF-8 without ever buffering more than `max` bytes: a larger declared Content-Length is
 * refused before reading, and a chunked or undeclared body is cancelled as soon as it passes the cap. Throws
 * Error('request_too_large').
 */
export async function readCapped(request: Request, max: number): Promise<string> {
  const declared = Number(request.headers.get('content-length') ?? NaN);
  if (Number.isFinite(declared) && declared > max) throw new Error('request_too_large');
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => undefined); throw new Error('request_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export function encode(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
/**
 * Strict base64url: only the one canonical spelling of each byte string is accepted. atob ignores the unused low bits of
 * the last character, so without this check one token could be resubmitted under several spellings (and nullifiers).
 */
export function decode(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) throw new Error('invalid_encoding');
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)); } catch { throw new Error('invalid_encoding'); }
  if (encode(bytes) !== text) throw new Error('invalid_encoding');
  return bytes;
}
export function randomToken(bytes = 32) { return encode(crypto.getRandomValues(new Uint8Array(bytes))); }
export async function digest(text: string | Uint8Array<ArrayBuffer>) {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof text === 'string' ? new TextEncoder().encode(text) : text)));
}
export async function importIssuer(key: JsonWebKey, privateKey = false) {
  return crypto.subtle.importKey('jwk', key, {name:'RSA-PSS',hash:'SHA-384'}, true, [privateKey ? 'sign' : 'verify']);
}
export function quarter(date = new Date()) { return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth()/3)+1}`; }
export function quarterStart(date = new Date(), offset = 0) { return new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth()/3)*3 + offset*3, 1)); }
/** The reporting periods an author may choose: the current quarter and the 11 before it. */
export function recentQuarters(count = 12, now = new Date()) { return Array.from({length:count},(_,index)=>quarter(quarterStart(now,-index))); }
export const MAX_CONCURRENT_KEYS = 4;
/**
 * Juror key ids are `${slug}:${epoch}:juror:${class}`; contribution key ids never contain ':juror:'. A key whose declared
 * purpose disagrees with its id is unusable for either purpose (null), so a relabelled key cannot cross over.
 */
export function keyPurpose(key: Pick<IssuerKey, 'id' | 'purpose'>): KeyPurpose | null {
  const byId: KeyPurpose = key.id.includes(':juror:') ? 'juror' : 'contribution';
  return key.purpose == null || key.purpose === byId ? byId : null;
}
/** Sandbox juror keys belong to fictional employers and carry verificationClass 'demo'. */
export const jurorClass = (key: Pick<IssuerKey, 'verificationClass'>): 'mailbox' | 'sandbox' => key.verificationClass === 'mailbox' ? 'mailbox' : 'sandbox';
/**
 * Community key ids are `${slug}:${epoch}:community` (contribution) and `${slug}:${epoch}:juror:community` (juror); no
 * curated id ends in ':community'. A key whose declared source disagrees with its id is unusable (null), as for purpose.
 */
export function keySource(key: Pick<IssuerKey, 'id' | 'source'>): KeySource | null {
  const byId: KeySource = key.id.endsWith(':community') ? 'community' : 'curated';
  return key.source == null || key.source === byId ? byId : null;
}
/** The ids of an employer's community keys for one issuance quarter. */
export const communityKeyId = (companySlug: string, epoch: string, purpose: KeyPurpose) => `${companySlug}:${epoch}:${purpose === 'juror' ? 'juror:' : ''}community`;
/** Employer slugs as the public directory writes them: lowercase words joined by single hyphens, at most 80 characters. */
export const EMPLOYER_SLUG = /^(?=.{1,80}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A key covers its issuance quarter plus one quarter of redemption grace. */
export function issuerKeyExpiry(epoch: string) {
  const start = epochStart(epoch);
  if (!Number.isFinite(start)) throw new Error('invalid_epoch');
  const first = new Date(start);
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 6, 1)).toISOString();
}
// The record of a curated key is unchanged by the source field (so fingerprints pinned by earlier releases still match);
// a community key's record ends with 'community', so a copy that drops or changes its source is a different key.
const keyRecord = (key: IssuerKey) => JSON.stringify([key.id, key.companySlug, key.epoch, key.expiresAt, key.verificationClass, keyPurpose(key), key.publicKey.kty ?? null, key.publicKey.n ?? null, key.publicKey.e ?? null, ...(key.source === 'community' ? ['community'] : [])]);
/** Publisher and verifier must describe the exact same key; any difference could be a per-visitor tagging key. */
export function sameIssuerKey(a: IssuerKey, b: IssuerKey) { return keyRecord(a) === keyRecord(b); }
/** Stable public fingerprint of one issuer key (the fields sameIssuerKey compares), used by release manifests and archives. */
export function issuerKeyFingerprint(key: IssuerKey) { return digest(`siwt-issuer-key-v1:${keyRecord(key)}`); }
/** Digest of a set of issuer keys, independent of order: sha256 over the JSON array of sorted fingerprints. */
export async function issuerKeySetDigest(keys: IssuerKey[]) { return digest(JSON.stringify((await Promise.all(keys.map(issuerKeyFingerprint))).sort())); }
/** First instant (ms, UTC) of an issuance quarter such as '2026-Q3'; NaN for any other spelling. */
export function epochStart(epoch: string) {
  const match = /^(\d{4})-Q([1-4])$/.exec(epoch);
  return match ? Date.UTC(Number(match[1]), (Number(match[2]) - 1) * 3, 1) : Number.NaN;
}
/**
 * Whether a key's issuance quarter has begun. Keys provisioned ahead of their quarter (tools/provision-issuer.mjs
 * --next-quarter) are published, and pinned by the next client release, before anyone uses them: the browser never
 * chooses one and the verifier never signs with one until its quarter starts, so a quarterly rotation never makes the
 * deployed client meet a key its release did not pin. An epoch in any other form counts as started, as before.
 */
export const issuerKeyStarted = (key: Pick<IssuerKey, 'epoch'>, now = Date.now()) => !(epochStart(key.epoch) > now);
/**
 * The key the browser blinds against: the newest live key of that employer and purpose whose quarter has begun. More
 * than MAX_CONCURRENT_KEYS live keys (counting ones whose quarter has not begun) could tag visitors, so it throws.
 */
export function currentIssuerKey(keys: IssuerKey[], companySlug: string, now = Date.now(), purpose: KeyPurpose = 'contribution') {
  const live = keys.filter(k => k.companySlug === companySlug && keyPurpose(k) === purpose && Date.parse(k.expiresAt) > now);
  if (live.length > MAX_CONCURRENT_KEYS) throw new Error('too_many_issuer_keys');
  return live.filter(k => issuerKeyStarted(k, now)).sort((a, b) => b.epoch.localeCompare(a.epoch) || b.expiresAt.localeCompare(a.expiresAt))[0];
}
export interface IssuanceLimits { cap: number; velocity: number; }
/**
 * Provisional anti-astroturf limits for real employers, embedded in each sealed key row when keys are provisioned (the
 * verifier never reads the public database). cap: credentials (contribution) or tokens (juror) per employer, purpose and
 * issuance quarter. velocity: the most issued for one employer and purpose within a rolling 24 hours. A request that would
 * exceed it is refused and pauses issuance for 24 hours: a contribution trip pauses both purposes for that employer, a
 * juror trip pauses juror tokens only, so juror demand never shuts off contributions. Mailbox caps scale with the lower
 * bound of the published headcount band; an unknown band gets the smallest cap. Sandbox keys (fictional employers) have
 * no cap, count or pause: anyone can obtain them, so a cap would only let one person lock everyone out of the demo; the
 * per-connection rate limits apply instead.
 */
export const ISSUANCE_POLICY = {
  mailboxCredentialsByHeadcount: [[100001, 2000], [50001, 1200], [10001, 600], [5001, 300], [1001, 150], [0, 50]] as const,
  jurorTokensPerCredential: 2,
  velocityShareOfCap: 0.1,
  minimumVelocity: {contribution: 10, juror: 25},
  pausedByTrip: {contribution: ['contribution', 'juror'], juror: ['juror']} as const,
  pauseHours: 24,
  windowHours: 24,
} as const;
export function headcountFloor(band: string | null | undefined): number | null {
  const match = /^\s*(\d[\d,]*)/.exec(band ?? '');
  return match ? Number(match[1]!.replace(/,/g, '')) : null;
}
/** null: no issuance limits (sandbox keys for fictional employers). */
export function issuanceLimits(band: string | null | undefined, verificationClass: 'demo' | 'mailbox', purpose: KeyPurpose): IssuanceLimits | null {
  if (verificationClass !== 'mailbox') return null;
  const floor = headcountFloor(band);
  const credentials = floor === null ? 50 : ISSUANCE_POLICY.mailboxCredentialsByHeadcount.find(([min]) => floor >= min)![1];
  const cap = purpose === 'juror' ? credentials * ISSUANCE_POLICY.jurorTokensPerCredential : credentials;
  return {cap, velocity: Math.max(ISSUANCE_POLICY.minimumVelocity[purpose], Math.ceil(cap * ISSUANCE_POLICY.velocityShareOfCap))};
}
/**
 * Limits of a community key (an employer anyone listed with its work-email domain, owner decision 4). Whoever controls a
 * listed domain controls every mailbox in it, so these stay at the smallest real-employer contribution cap, and juror
 * tokens get no more than that (about 16 mailboxes' worth a quarter, at most 5 mailboxes' batches a day).
 */
export const COMMUNITY_KEY_LIMITS: Readonly<Record<KeyPurpose, IssuanceLimits>> = { contribution: { cap: 50, velocity: 10 }, juror: { cap: 50, velocity: 15 } };
/**
 * Verification emails the verifier sends per UTC day for employers anyone listed (community keys): at most
 * perEmployerPerDay for one employer (both purposes together; about 2.5 times what its daily issuance limits can use) and
 * allCommunityPerDay for all of them together, so listing a domain cannot turn the verifier into a mass mailer to
 * addresses at it. Over either budget, /start still answers exactly as usual (like the per-mailbox throttle) and sends
 * nothing. Curated employers' emails are limited per mailbox and per network only.
 */
export const COMMUNITY_EMAIL_LIMITS = { perEmployerPerDay: 40, allCommunityPerDay: 1000 } as const;
/** A fresh RSA-2048 key pair for the blind-signature suite (RSA-PSS, SHA-384, randomized), exported as JWK. */
export async function generateIssuerKeyPair(): Promise<{ publicKey: JsonWebKey; privateKey: JsonWebKey }> {
  const pair = await suite().generateKey({ modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) });
  return { publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey) as JsonWebKey, privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey) as JsonWebKey };
}
/** Coarse public band for issuance counts; exact counts are never published. */
export function issuanceBand(n: number): '<25' | '25–99' | '100–249' | '250+' { return n < 25 ? '<25' : n < 100 ? '25–99' : n < 250 ? '100–249' : '250+'; }
async function sealingKey(masterKey: string) {
  // An operator-set secret, not attacker input, so any base64url spelling of its 32 bytes is accepted as before.
  let raw: Uint8Array<ArrayBuffer>;
  try { if (!/^[A-Za-z0-9_-]+$/.test(masterKey)) throw new Error(); raw = Uint8Array.from(atob(masterKey.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0)); } catch { throw new Error('invalid_master_key'); }
  if (raw.length !== 32) throw new Error('invalid_master_key');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
/** AES-256-GCM with the key id as associated data, so a sealed private key cannot be moved to another key row. */
export async function sealIssuerKey(masterKey: string, keyId: string, privateKey: JsonWebKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:new TextEncoder().encode(keyId)}, await sealingKey(masterKey), new TextEncoder().encode(JSON.stringify(privateKey))));
  const out = new Uint8Array(iv.length + sealed.length); out.set(iv); out.set(sealed, iv.length);
  return encode(out);
}
export async function openIssuerKey(masterKey: string, keyId: string, sealed: string): Promise<JsonWebKey> {
  const bytes = decode(sealed);
  const plain = await crypto.subtle.decrypt({name:'AES-GCM', iv:bytes.slice(0,12), additionalData:new TextEncoder().encode(keyId)}, await sealingKey(masterKey), bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(plain));
}
/**
 * The in-progress state of one blind issuance: the prepared message and the blinding inverse. With the blind signature it
 * finishes the credential, and it links the blinded request the verifier saw to the finished credential. Keep it only on
 * the author's device, only with their opt-in (e.g. so a reload after a lost /issue response does not lose the quarter's
 * credential), and delete it once the credential is finished.
 */
export interface BlindingState { keyId: string; prepared: string; inv: string; }
export const blindingStateSchema = z.object({ keyId: z.string().max(120), prepared: z.string().max(2400), inv: z.string().max(800) }).strict();
async function blind(key: IssuerKey, payload: object) {
  const prepared = suite().prepare(new TextEncoder().encode(JSON.stringify(payload)));
  const {blindedMsg,inv} = await suite().blind(await importIssuer(key.publicKey),prepared);
  const state: BlindingState = {keyId:key.id,prepared:encode(prepared),inv:encode(inv)};
  return {blinded:encode(blindedMsg), state, finalize:(blindSignature: string) => finalizeBlinding(key,state,blindSignature)};
}
/** Finishes a credential or juror token from a (possibly restored) blinding state; finalization verifies the signature. */
export async function finalizeBlinding(key: IssuerKey, state: BlindingState, blindSignature: string): Promise<Proof> {
  const s = blindingStateSchema.parse(state);
  if (s.keyId !== key.id) throw new Error('unknown_issuer_key');
  const prepared = decode(s.prepared);
  return {keyId:key.id,prepared:s.prepared,signature:encode(await suite().finalize(await importIssuer(key.publicKey),prepared,decode(blindSignature),decode(s.inv)))};
}
export async function prepareProof(key: IssuerKey, authorKey: z.infer<typeof publicAuthorSchema>) {
  return blind(key,{v:1,scope:key.id,nonce:randomToken(),authorKey});
}
/** A retry for the same mailbox challenge and key must resend the identical blinded message: the verifier re-signs only that, and a fresh one would be refused for the rest of the quarter. */
export function reusableIssuance<T extends {challengeId: string; keyId: string}>(pending: T | null, challengeId: string, keyId: string): T | null {
  return pending && challengeId && pending.challengeId === challengeId && pending.keyId === keyId ? pending : null;
}
/**
 * One anonymous juror token. The signed payload names purpose 'juror' and carries no author key, so it can never parse
 * as a contribution proof (or the reverse), and juror keys are refused for contributions.
 */
export async function prepareJurorToken(key: IssuerKey): Promise<{blinded: string; state: BlindingState; finalize: (blindSignature: string) => Promise<JurorProof>}> {
  if (keyPurpose(key) !== 'juror') throw new Error('unknown_issuer_key');
  return blind(key,{v:1,scope:key.id,nonce:randomToken(),purpose:'juror'});
}
/**
 * The nullifier is computed over the signed bytes (never their text spelling) and is domain-separated from contribution
 * nullifiers, so one spent-token table can hold both and one token yields exactly one nullifier.
 */
export async function validateJurorToken(input: unknown, key: IssuerKey, now = Date.now()) {
  const token = jurorProofSchema.parse(input);
  if (token.keyId !== key.id || keyPurpose(key) !== 'juror') throw new Error('unknown_issuer_key');
  if (Date.parse(key.expiresAt) <= now) throw new Error('credential_expired');
  const prepared = decode(token.prepared);
  if (prepared.length < 33 || !(await suite().verify(await importIssuer(key.publicKey),decode(token.signature),prepared))) throw new Error('invalid_signature');
  z.object({v:z.literal(1),scope:z.literal(key.id),nonce:z.string().length(43),purpose:z.literal('juror')}).strict().parse(JSON.parse(new TextDecoder().decode(prepared.slice(32))));
  return {nullifier:await digest(`siwt-juror-v1:${encode(prepared)}`), key};
}
export async function validateProof(proofInput: unknown, key: IssuerKey, expectedCompany: string, now = Date.now()) {
  const proof = proofSchema.parse(proofInput);
  if (keyPurpose(key) !== 'contribution') throw new Error('unknown_issuer_key');
  if (proof.keyId !== key.id || key.companySlug !== expectedCompany) throw new Error('credential_employer_mismatch');
  if (Date.parse(key.expiresAt) <= now) throw new Error('credential_expired');
  const prepared = decode(proof.prepared);
  if (prepared.length < 33 || !(await suite().verify(await importIssuer(key.publicKey),decode(proof.signature),prepared))) throw new Error('invalid_signature');
  const payload = z.object({v:z.literal(1),scope:z.literal(key.id),nonce:z.string().length(43),authorKey:publicAuthorSchema}).strict().parse(JSON.parse(new TextDecoder().decode(prepared.slice(32))));
  return {nullifier:await digest(prepared), authorKey:payload.authorKey, key};
}
/** subject is digest(capability): signatures never carry a receipt or public id. */
export function authorMessage(subject: string, action: string, revision: number, payloadHash: string, screeningConsent = false) {
  return new TextEncoder().encode(JSON.stringify({v:2,subject,action,revision,payloadHash,screeningConsent}));
}
export async function verifyAuthor(key: JsonWebKey, signature: string, message: Uint8Array<ArrayBuffer>) {
  try { return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'}, await crypto.subtle.importKey('jwk',key,{name:'ECDSA',namedCurve:'P-256'},false,['verify']),decode(signature),message); } catch { return false; }
}
