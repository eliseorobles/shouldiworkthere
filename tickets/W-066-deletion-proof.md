---
id: W-066
title: Deletion proof
ref: L5
phase: Phase 14 - Legal and liability
status: IN PROGRESS
depends_on: W-015
---

# W-066 - Deletion proof

**Phase:** Phase 14 - Legal and liability  
**Brief ref:** L5  
**Depends on:** W-015  
**Status:** IN PROGRESS

## Scope

Tests prove that withdrawal and expiry leave nothing behind except inside the disclosed D1 point-in-time-recovery window, and that the client clears its vault on withdraw.

## Acceptance criteria

- [ ] After withdrawal and after expiry, no body, answers, fingerprints, analysis, pairs, clusters, FAQ evidence, jury passage, vector or device vault entry remains, proven by one test that inspects every table keyed to the account.
- [ ] The client clears kept keys and vault entries on withdraw.
- [ ] Records kept after withdrawal or expiry are scrubbed after 12 months: the capability hash is replaced and company, period and publication period are removed, keeping only status, verification class and revision.

## Implementation paths

- `worker/src/submissions.ts`
- `worker/inference-core.ts`
- `worker/src/moderation.ts`
- `web/vault.ts`
- `tests/publication.test.ts`

## Required verification

- tests/publication.test.ts: 'withdrawal erases text, answers, author key and fingerprints, removes the public copy…', 'held cases expire after 30 days and unbatched approved cases after 180…'.
- tests/jev.test.ts: 'a withdrawal during analysis leaves no derived analysis or pairs behind', 'a withdrawal racing an upsert never leaves an orphaned vector'; tests/moderation.test.ts: 'withdrawal ends open cases, erases the passage jurors could see…'.
- tests/browser-contribute.spec.ts: 'a kept signing key and the device database are cleared when the contribution is withdrawn'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Verified in part: tests/publication.test.ts 'withdrawal erases text, answers, author key and fingerprints, removes the public copy…' and '12 months after a withdrawal or expiry, the kept record loses its capability hash, employer and periods…', tests/jev.test.ts 'a withdrawal during analysis leaves no derived analysis or pairs behind', tests/moderation.test.ts 'withdrawal ends open cases, erases the passage jurors could see…', and the device-clearing spec in tests/browser-contribute.spec.ts. Still open: one test that inspects every table keyed to an account after withdrawal and after expiry, FAQ evidence included.
- [2026-09-23 01:26 UTC] Round-3 red-team retention fixes, with tests: RT-RET-05 (a jury case keeps only the UTC day it opened, and withdrawal or expiry gives the subject's cases a random alias and clears their public id, content hash and passage: tests/moderation.test.ts 'RT-RET-05…', tests/publication.test.ts 'RT-RET-05…'); RT-RET-08 (verifier migration 0004 drops legacy tables with exact issuance and redemption times: tests/protocol.test.ts 'verifier 0004 drops the legacy tables…'; a row change applied remotely only with --accept-row-changes, see W-079). Pre-deploy pass: a withdrawn receipt no longer states the juror-review or sensitive-information permissions as still given (tests/browser-contribute.spec.ts 'after withdrawal the receipt describes the erased state…'). The tests/integration.mjs withdrawal checks passed at 01:15 UTC. What was open is unchanged.
