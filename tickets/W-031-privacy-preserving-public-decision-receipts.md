---
id: W-031
title: Privacy-preserving public decision receipts
phase: Phase 10 - Constitutional moderation
status: BLOCKED
depends_on: W-025, W-028, W-029, W-030
---

# W-031 - Privacy-preserving public decision receipts

**Phase:** Phase 10 - Constitutional moderation  
**Depends on:** W-025, W-028, W-029, W-030  
**Status:** BLOCKED

## Scope

Append-only audit receipts with rule, policy version/hash, Jev/model version, decision path, rounded vote result, appeal and outcome. Publish aggregate privacy/abuse/spam/legal breakdowns and overturns. Never expose unpublished text, juror identifiers or precise case timing.

## Acceptance criteria

Ledger integrity and privacy thresholds verified; public counts reconcile to outcomes; small categories and timing-sensitive records are suppressed or delayed; readers can inspect the applicable specification.

## Log

- [2026-09-22 05:27 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented: tests/moderation.test.ts 'author receipts pin rule, policy version and digest, model, decision path, vote summary and outcome' and 'public moderation statistics come from the outcome records, reconcile to them, and show every count below 5 as <5'.
- [2026-09-22 21:11 UTC] BLOCKED: waits on W-028 (blocked: Mailbox possession is not one-human-one-vote; requires reviewed anti-Sybil eligibility and private exclusion proofs.)
- [2026-09-23 01:26 UTC] Round-3 red-team fixes on public statistics: RT-DIFF-03 (exact per-quarter submission counts republished every 6 hours allowed differencing; counts that follow contributions are now rounded like contribution counts and refreshed at most once per UTC day: tests/moderation.test.ts 'RT-DIFF-03…', tests/publication.test.ts 'RT-DIFF-03…') and RT-COPY-09 (archives no longer claim to list every issuer key ever published, since a key deleted after a compromise is omitted from later archives). Still blocked on W-028.
