---
id: W-070
title: Key and bundle transparency with a public log
ref: H1
phase: Phase 15 - Hardening
status: IN PROGRESS
depends_on: W-014
---

# W-070 - Key and bundle transparency with a public log

**Phase:** Phase 15 - Hardening  
**Brief ref:** H1  
**Depends on:** W-014  
**Status:** IN PROGRESS

## Scope

A signed release manifest (client asset hashes, source digests including the lockfile, issuer key fingerprints and purposes, policy, legal) signed with an offline Ed25519 key, append-only release records, a Rekor entry, and an issuer-key registry pinned in the client build.

## Acceptance criteria

- [ ] tools/transparency.mjs signs the manifest with the offline key, refuses a stale build, writes append-only docs/releases records, and a dry run creates no key.
- [ ] /.well-known/siwt-release.json serves the signed manifest verbatim, and the independent watcher verifies the signature, assets, sources, key fingerprints and purposes.
- [ ] Each release is recorded in Rekor in an entry type the public log accepts, and the watcher verifies inclusion.
- [ ] The client build pins the issuer-key registry digest and refuses keys outside it.
- [ ] A rotation and compromise procedure for the release key is documented.

## Implementation paths

- `tools/transparency.mjs`
- `tools/verify-deployment.mjs`
- `worker/src/release.ts`
- `shared/proof.ts`
- `tools/build.mjs`
- `web/submit.tsx`

## Required verification

- tests/transparency.test.ts: 'a signed release manifest verifies with both implementations…', 'the optional Rekor entry verifies locally before submission…', 'release records are append-only…', 'a dry run never creates a release key…', 'the deployment watcher fails each kind of tampering…'.
- tests/protocol.test.ts: 'the browser uses a key only when publisher and verifier describe it identically…'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented: tools/transparency.mjs signing, append-only records, the dry-run rule and the independent watcher (tests/transparency.test.ts), and in round 3 the client refuses a key that no release registered (tests/browser-contribute.spec.ts 'key registry: a key both services agree on but no release registered is refused…'). Still open: no release key or release record exists yet (the owner creates the offline key), no Rekor entry has been submitted (the public log may accept only hashedrekord or dsse), and no key-rotation procedure is documented.
- [2026-09-23 01:26 UTC] Round-3 red-team RT-KEY-02, WS-01 and RT-C1 (high, one issue) fixed: the checkout's 'production' issuer registry held the keys the local verifier signs with. tools/transparency.mjs now refuses to sign a registry that shares a modulus with any local key, and the watcher fails a deployment serving one (tests/transparency.test.ts 'a registry holding any local key cannot be signed, and the watcher fails a deployment that serves one…'); the build pins the local registry only with --local (tests/integration.mjs 'keys: the local client build pins the local registry', passed at 01:15 UTC). Residual: verify-deployment's local-key check compares against .wrangler/provision/local-issuer-public-keys.json and reports SKIP on a machine without it. RT-COPY-09 fixed: archives describe their registry as the keys in the public registry when written, since a key deleted after a compromise is omitted later. What was open is unchanged.
