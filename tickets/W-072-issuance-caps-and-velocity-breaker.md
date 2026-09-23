---
id: W-072
title: Issuance caps and velocity breaker
ref: H3
phase: Phase 15 - Hardening
status: DONE
depends_on: W-014
completed: 2026-09-22 21:11 UTC
---

# W-072 - Issuance caps and velocity breaker

**Phase:** Phase 15 - Hardening  
**Brief ref:** H3  
**Depends on:** W-014  
**Status:** DONE

## Scope

Per-employer quarterly caps and a rolling 24-hour velocity breaker on credential and juror-token issuance, scaled by headcount band, so one employer or mailbox farm cannot flood a record.

## Acceptance criteria

- [x] Per employer and purpose, the quarterly cap and the 24-hour velocity limit refuse an over-limit batch atomically; a contribution trip pauses both purposes for 24 hours and a juror trip pauses juror tokens only.
- [x] Limits scale with the published headcount band; re-provisioning raises or lowers them at once; a remote provisioning run refuses unreadable bands unless explicitly accepted.
- [x] Fictional-employer issuance is never capped, counted or paused; per-connection limits still apply.
- [x] GET /stats shows bands, caps, velocity limits and pause flags per purpose for the current quarter only, with no timestamps or exact counts.

## Implementation paths

- `worker/issuer.ts`
- `shared/proof.ts`
- `db/verifier-migrations/0002_juror_tokens_and_issuance_controls.sql`
- `tools/provision-issuer.mjs`

## Required verification

- tests/protocol.test.ts: 'the quarterly cap per employer is enforced atomically…', 're-provisioning with a larger headcount band raises the cap…', 'a contribution velocity trip pauses both purposes…', 'a juror velocity trip pauses juror tokens only…', 'sandbox (fictional employer) issuance is never capped…', '/stats shows coarse bands…', 'a remote provisioning run cannot silently put real employers on the smallest cap…'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented in round 2. Verified: tests/protocol.test.ts 'the quarterly cap per employer is enforced atomically…', 're-provisioning with a larger headcount band raises the cap…', 'a contribution velocity trip pauses both purposes…', 'a juror velocity trip pauses juror tokens only…', 'sandbox (fictional employer) issuance is never capped…', '/stats shows coarse bands, caps and pause flags per purpose…' and 'a remote provisioning run cannot silently put real employers on the smallest cap…' pass (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)). The numbers are provisional, as docs/protocol-poewi.md says.
- [2026-09-22 22:30 UTC] Re-read docs/protocol-poewi.md for this entry; it changed at 21:30 UTC, after the 21:11 entry. Its 'Issuance limits (real employers only)' section still says 'These numbers are provisional', and describes what the 21:11 entry verified: per-quarter caps by headcount band (50 to 2,000, juror tokens twice that), a 24-hour velocity breaker that pauses both purposes on a contribution trip and juror tokens only on a juror trip, coarse /stats bands, and no cap for fictional employers. The 21:11 entry holds. [read docs/protocol-poewi.md sha256:51dbbdb4435c]
- [2026-09-23 01:26 UTC] Re-read docs/protocol-poewi.md for this entry; it changed at 00:44 UTC. Its 'Issuance limits (real employers only)' section is unchanged: provisional per-quarter caps by headcount band (50 to 2,000, juror tokens twice that), the rolling 24-hour velocity breaker (a contribution trip pauses both purposes, a juror trip juror tokens only), coarse /stats bands and no cap for fictional employers. The 21:11 entry holds. Related red-team fixes: RT-ORACLE-06 (juror tokens are issued as one set per mailbox, employer and quarter; a later request is refused with one answer that never says how many were issued: tests/protocol.test.ts '/issue-juror issues a mailbox its juror tokens once per employer and quarter…') and WS-04 (sandbox juror tokens are limited per network, an IPv6 client counting as its /64: tests/protocol.test.ts 'sandbox juror tokens are limited per network…'). Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed. [read docs/protocol-poewi.md sha256:1a996f114d48]
- [2026-09-23 05:16 UTC] Re-read docs/protocol-poewi.md for this entry; it changed at 04:19 UTC, after the 01:26 entry. 'Issuance limits (real employers only)' keeps the headcount-band caps, the rolling 24-hour velocity breaker, the coarse /stats bands and no cap for fictional employers, so the 01:26 entry holds. It now adds that community-listed employers' keys carry COMMUNITY_KEY_LIMITS (50 credentials and 50 juror tokens a quarter, velocity 10 and 15) and that fictional employers exist only locally and in tests. tests/protocol.test.ts 'registering a domain creates the employer's contribution and juror keys on demand…' covers the community caps and passed in node --test "tests/*.test.ts" at 05:01–05:02 UTC. [read docs/protocol-poewi.md sha256:892e76c3f882]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/protocol-poewi.md for this entry. 'Issuance limits (real employers only)' is unchanged: the headcount-band caps, the rolling 24-hour velocity breaker, the coarse /stats bands, COMMUNITY_KEY_LIMITS (50 credentials and 50 juror tokens a quarter, velocity 10 and 15, as in shared/proof.ts) and no cap for fictional employers. The 01:26 and 05:16 entries hold. [read docs/protocol-poewi.md sha256:c8073876411e]
