import { z } from 'zod';

/**
 * Proof of work for the requests anyone can send without an account (owner decision 5, 2026-09-23): a mailbox code
 * (verifier /start), a juror token batch (verifier /issue-juror) and a new employer listing (main worker /api/employers).
 *
 * Hashcash over SHA-256: the browser finds a nonce such that SHA-256(prefix ‖ nonce) begins with `bits` zero bits, where
 * the prefix binds the stamp to the requesting origin, the action, the issuer key id (empty for a listing), a digest of
 * what the request is about (the normalized email address, the exact blinded messages, or the domain) and the UTC minute
 * it was made in. A server accepts a stamp for up to POW_WINDOW_MINUTES either side of its own clock, and recomputes one
 * hash to check it. A stamp is useless for anything but the request it was made for: replaying it within the window
 * repeats the same request for the same address, batch or domain, which the per-mailbox email throttle, the one-batch
 * juror quota (an identical batch is re-signed identically) and the one-listing-per-domain rule already absorb,
 * so no spent-stamp table is kept: stamps are checked and forgotten, never stored.
 *
 * The work is done off the page's main thread: powWorkerSource() is a self-contained Web Worker script (serve it from the
 * site's own origin, since the CSP allows only same-origin workers); solvePow() runs the same search in-thread for tests
 * and for browsers without workers. Nothing about the person is in a stamp: the email address and domain enter only as a
 * digest, and the verifier already receives the address itself.
 */
export const POW_VERSION = 1;
/**
 * The default difficulty: 2^20 (about a million) hashes on average. Measured with searchPow in Node on an Apple-silicon
 * laptop (2026-09-23, two runs of 100 solves, 2.2–4.4 million hashes a second depending on load): median 0.23–0.44 s,
 * mean 0.4–0.5 s, 90th percentile about 1 s, and a long tail (2.5–3.2 s at most). Slower laptops, phones and other
 * browsers take roughly 2–4 times as long. Native or GPU code solves it far faster, so it only slows browser-speed
 * abuse: the rate limits are the real control.
 */
export const POW_BITS = 20;
/** A deployment may configure another difficulty only within these bounds (tests use the minimum). */
export const POW_MIN_BITS = 8;
export const POW_MAX_BITS = 32;
/** Minutes a stamp stays acceptable either side of the server's clock. */
export const POW_WINDOW_MINUTES = 2;
export type PowAction = 'start' | 'issue-juror' | 'add-employer';
export const POW_ACTIONS: readonly PowAction[] = ['start', 'issue-juror', 'add-employer'];
/** The stamp a request carries (as its `pow` field). nonce: 16 lowercase hex characters. */
export const powSchema = z.object({ minute: z.number().int().min(0).max(2 ** 32), nonce: z.string().regex(/^[0-9a-f]{16}$/) }).strict();
export type PowStamp = z.infer<typeof powSchema>;
/** What a stamp is bound to. subject is one of the powSubject digests below. */
export interface PowBinding { origin: string; action: PowAction; keyId: string; subject: string; }

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha256 = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
const subjectDigest = async (label: string, value: string) => b64url(await sha256(new TextEncoder().encode(`siwt-pow-${label}-v1:${value}`)));
/** Normalizations both sides apply before digesting, so the browser and the server bind the same text. */
export const powEmail = (email: string) => email.trim().toLowerCase();
/** As shared/domains.ts normalizeDomain: trimmed, lowercased, a leading '@' and trailing dots removed. */
export const powDomain = (domain: string) => domain.trim().toLowerCase().replace(/^@+/, '').replace(/\.+$/, '');
/** The subject of a stamp: a digest of the normalized email (/start), the blinded messages in order (/issue-juror) or the domain (/api/employers). */
export const powSubject = {
  email: (email: string) => subjectDigest('email', powEmail(email)),
  blinded: (blinded: readonly string[]) => subjectDigest('blinded', blinded.join('.')),
  domain: (domain: string) => subjectDigest('domain', powDomain(domain)),
};
/** The current UTC minute (minutes since the Unix epoch). */
export const powMinute = (now = Date.now()) => Math.floor(now / 60000);
/** The text hashed before the nonce. Newlines separate fields, and none may contain one. */
export function powPrefix(binding: PowBinding, minute: number) {
  const fields = [binding.origin, binding.action, binding.keyId, binding.subject];
  if (fields.some(f => typeof f !== 'string' || /[\r\n]/.test(f)) || !POW_ACTIONS.includes(binding.action)) throw new Error('invalid_pow_binding');
  return `siwt-pow-v${POW_VERSION}\n${fields.join('\n')}\n${minute}\n`;
}
/** A configured difficulty (a Worker var), clamped to [POW_MIN_BITS, POW_MAX_BITS]; POW_BITS when unset or unreadable. */
export function powBits(configured?: string | number | null) {
  const n = typeof configured === 'number' ? configured : configured == null || configured === '' ? Number.NaN : Number(configured);
  return Number.isInteger(n) ? Math.min(POW_MAX_BITS, Math.max(POW_MIN_BITS, n)) : POW_BITS;
}
/** Leading zero bits of a digest. */
export function leadingZeroBits(bytes: Uint8Array) {
  let n = 0;
  for (const byte of bytes) { if (byte === 0) { n += 8; continue; } return n + Math.clz32(byte) - 24; }
  return n;
}
export type PowProblem = 'pow_missing' | 'pow_stale' | 'pow_insufficient';
/**
 * Server-side check of a stamp for this exact binding: null when it is acceptable. One SHA-256 and no storage, so it can
 * run before anything else is read. A malformed stamp is 'pow_missing'.
 */
export async function checkPow(input: unknown, binding: PowBinding, bits: number, now = Date.now()): Promise<PowProblem | null> {
  const parsed = powSchema.safeParse(input);
  if (!parsed.success) return 'pow_missing';
  const {minute, nonce} = parsed.data;
  if (Math.abs(minute - powMinute(now)) > POW_WINDOW_MINUTES) return 'pow_stale';
  const digest = await sha256(new TextEncoder().encode(powPrefix(binding, minute) + nonce));
  return leadingZeroBits(digest) >= bits ? null : 'pow_insufficient';
}

/**
 * The search, self-contained so powWorkerSource() can embed its source text: it references nothing outside itself.
 * SHA-256 of `prefix ‖ seedHex ‖ counterHex` for counter = 0, 1, …, count-1, with the prefix's full 64-byte blocks
 * hashed once (a midstate). Returns the first 16-hex-character nonce whose digest starts with `bits` zero bits, or null.
 * seed is a random 32-bit value so concurrent searches for the same prefix do not repeat each other's work.
 *
 * Its one inner function is written as an array element, `[(…) => {…}][0]`, on purpose: a bundler that keeps function
 * names (esbuild keepNames, which wrangler enables by default) wraps a function assigned to a named constant in a call to
 * a helper defined outside this function, and the embedded source would then fail in the worker. tests/pow.test.ts
 * bundles this module that way and runs the worker script.
 */
export function searchPow(prefix: string, bits: number, seed: number, count: number): { nonce: string; tries: number } | null {
  const K = new Int32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  const W = new Int32Array(64);
  const compress = [(h: Int32Array, bytes: Uint8Array, offset: number) => {
    for (let i = 0; i < 16; i++) { const j = offset + i * 4; W[i] = (bytes[j]! << 24) | (bytes[j + 1]! << 16) | (bytes[j + 2]! << 8) | bytes[j + 3]!; }
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15]!, b = W[i - 2]!;
      W[i] = (W[i - 16]! + (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + W[i - 7]! + (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10))) | 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, k = h[7]!;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i]! + W[i]!) | 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0]! + a) | 0; h[1] = (h[1]! + b) | 0; h[2] = (h[2]! + c) | 0; h[3] = (h[3]! + d) | 0;
    h[4] = (h[4]! + e) | 0; h[5] = (h[5]! + f) | 0; h[6] = (h[6]! + g) | 0; h[7] = (h[7]! + k) | 0;
  }][0]!;
  const HEX = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 97, 98, 99, 100, 101, 102];
  const text = new TextEncoder().encode(prefix);
  const tail = text.length % 64, whole = text.length - tail;
  // The prefix's tail, the 16 nonce characters, the 0x80 terminator and the 64-bit length fill one or two blocks.
  const blocks = tail + 16 + 1 + 8 <= 64 ? 1 : 2;
  const buffer = new Uint8Array(blocks * 64);
  buffer.set(text.subarray(whole));
  for (let i = 0; i < 8; i++) buffer[tail + i] = HEX[((seed >>> 0) >>> (28 - i * 4)) & 15]!;
  buffer[tail + 16] = 0x80;
  const length = (text.length + 16) * 8;
  const end = blocks * 64;
  buffer[end - 5] = Math.floor(length / 2 ** 32) & 255;
  buffer[end - 4] = (length >>> 24) & 255; buffer[end - 3] = (length >>> 16) & 255; buffer[end - 2] = (length >>> 8) & 255; buffer[end - 1] = length & 255;
  const midstate = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  for (let offset = 0; offset < whole; offset += 64) compress(midstate, text, offset);
  // A first tail block that ends before the counter characters never changes: hash it once too.
  let first = 0;
  if (blocks === 2 && tail + 8 >= 64) { compress(midstate, buffer, 0); first = 64; }
  const state = new Int32Array(8);
  const wanted = Math.max(0, Math.min(32, bits | 0));
  const counterAt = tail + 8;
  for (let n = 0; n < count; n++) {
    for (let i = 0; i < 8; i++) buffer[counterAt + i] = HEX[(n >>> (28 - i * 4)) & 15]!;
    state.set(midstate);
    for (let offset = first; offset < end; offset += 64) compress(state, buffer, offset);
    if (wanted === 0 || (state[0]! >>> (32 - wanted)) === 0 && (wanted < 32 || state[0] === 0)) {
      let nonce = '';
      for (let i = 0; i < 16; i++) nonce += String.fromCharCode(buffer[tail + i]!);
      return { nonce, tries: n + 1 };
    }
  }
  return null;
}

const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]!;
/**
 * Finds a stamp in the current thread, in slices (each with a fresh random seed) that yield to the event loop so it can be
 * aborted. On a page, prefer the Web Worker (powWorkerSource()); this is for tests, tools and browsers without workers.
 * options.minute is the server's current minute when known (a verifier refusal carries it), so a device with a wrong
 * clock still produces an acceptable stamp; the minute advances with the local clock while the search runs.
 */
export async function solvePow(binding: PowBinding, options: { bits?: number; minute?: number; signal?: AbortSignal; slice?: number } = {}): Promise<PowStamp> {
  const bits = options.bits ?? POW_BITS, slice = options.slice ?? 65536, skew = options.minute === undefined ? 0 : options.minute - powMinute();
  for (;;) {
    if (options.signal?.aborted) throw new Error('pow_aborted');
    const minute = powMinute() + skew, found = searchPow(powPrefix(binding, minute), bits, randomSeed(), slice);
    if (found) return { minute, nonce: found.nonce };
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}
/**
 * A self-contained Web Worker script. Post it {prefix, bits}; it answers {nonce, tries} once found (it searches with
 * fresh random seeds until one succeeds). Serve it from the site's origin, for example as /pow-worker.js with
 * content-type text/javascript, and compute the prefix on the page with powPrefix().
 */
export function powWorkerSource() {
  return `"use strict";const searchPow=${searchPow.toString()};\nself.onmessage=(event)=>{const {prefix,bits}=event.data||{};if(typeof prefix!=="string"||typeof bits!=="number"){self.postMessage({error:"invalid_request"});return;}let tries=0;for(;;){const seed=crypto.getRandomValues(new Uint32Array(1))[0];const found=searchPow(prefix,bits,seed,1<<24);if(found){self.postMessage({nonce:found.nonce,tries:tries+found.tries});return;}tries+=1<<24;}};`;
}
