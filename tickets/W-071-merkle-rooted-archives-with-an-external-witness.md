---
id: W-071
title: Merkle-rooted archives with an external witness
ref: H2
phase: Phase 15 - Hardening
status: BLOCKED
depends_on: W-070
---

# W-071 - Merkle-rooted archives with an external witness

**Phase:** Phase 15 - Hardening  
**Brief ref:** H2  
**Depends on:** W-070  
**Status:** BLOCKED

## Scope

Transparency archives publish RFC 6962 roots and chain to each other; an independent witness outside the operator's account keeps and countersigns them so a consistent rewrite of history is detectable by anyone.

## Acceptance criteria

- [ ] Each archive publishes RFC 6962 roots over published-account and metric-release leaves, the issuer key registry digest, the release manifest digest and the previous archive's digest, recomputable from the documented method; leaves are never archived.
- [ ] verify-deployment.mjs --state pins archive history, and a consistent rewrite of every archive or a fork after the newest pinned archive FAILs.
- [ ] At least one witness outside the operator's Cloudflare account fetches each archive and publishes or countersigns its digest, and the watcher checks the witness.

## Implementation paths

- `worker/src/ledger.ts`
- `tools/verify-deployment.mjs`

## Required verification

- tests/transparency.test.ts: 'Merkle roots follow RFC 6962…', 'v4 archives are recomputable by the independent watcher…', 'with a state file, the watcher pins archive history…', 'the archive method states every field and encoding…'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented: RFC 6962 roots, chained v3 archives and --state pinning in the watcher (tests/transparency.test.ts 'Merkle roots follow RFC 6962…', 'v3 archives are recomputable…', 'with a state file, the watcher pins archive history…'). Archives are not signed, because the release key stays offline.
- [2026-09-22 21:11 UTC] BLOCKED: Needs at least one witness outside the operator's Cloudflare account that fetches and countersigns each archive digest; none is arranged.
- [2026-09-22 21:41 UTC] Round 3 moved the archive format to v4 (worker/src/ledger.ts: shouldiworkthere-transparency-v4, which is v3 plus the quarter's coarse moderation statistics and the public exception log, with digests computed as in v3). The cited test is now tests/transparency.test.ts 'v4 archives are recomputable by the independent watcher…'. tools/verify-deployment.mjs accepts v3 and v4 and FAILs moderation data in a v4 archive that is not coarse. The external witness is still missing.
- [2026-09-23 01:26 UTC] Correction to the 21:11 entry: 'v3 archives are recomputable…' is now tests/transparency.test.ts 'v4 archives are recomputable by the independent watcher, chain to the previous archive, publish roots but no leaves, and carry the coarse moderation statistics and the public exception log'. The reason this ticket is blocked is unchanged.
