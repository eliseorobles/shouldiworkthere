---
id: W-015
title: Moderation queue, delayed release, and withdrawal
phase: Phase 4 - Voice
status: DONE
depends_on: W-012, W-014
completed: 2026-09-22 21:11 UTC
---

# W-015 - Moderation queue, delayed release, and withdrawal

**Phase:** Phase 4 - Voice  
**Depends on:** W-012, W-014  
**Status:** DONE

## Scope

Privacy pre-screen, serious-allegation human review, spam/astroturf triage with sentiment-neutral rules, randomized publication delay with batch release, withdrawal and redaction receipts.

## Acceptance criteria

Nothing publishes before its release window; moderation cannot suppress criticism, only route it; every action is logged for the transparency ledger.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Moderation + release
- [2026-09-22 05:05 UTC] Rule-based routing R-1..R-7 (claims held, high-severity privacy held, threats held, sentiment never inspected), randomized 12-72h window with batched release, append-only moderation ledger, redaction required before releasing a high-severity item, capability-based withdrawal.
- [2026-09-22 05:12 UTC] REOPENED: Audit: moderator bypasses delay, modifies testimony, no batch threshold, pending prose sent to Jev.
- [2026-09-22 21:11 UTC] Round 1 fixed the reopen reasons: no admin release path, the original eligibility time plus a full batch of 25, author-approved revisions only, and no pending prose sent to Jev. tests/acceptance.test.ts 'publication requires the original time AND a full batch; no admin release path exists' and tests/publication.test.ts (including 'a batch that would drop below 25 after claims is reverted…', 'withdrawal erases text, answers, author key and fingerprints…', 'every rule fires at its threshold and not just below it') pass (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)).
- [2026-09-23 01:26 UTC] Round-3 red-team RT-LINK-01 (high) fixed in two parts. Publication (group B): batch members are read in random public-id order and shuffled before the public inserts and the analysis queue, and each analysis message waits a random 0 to 6 hours (tests/publication.test.ts 'RT-LINK-01: neither the public insert order nor the analysis queue follows submission order, and each analysis waits a random delay'). Readings (group A, pre-deploy pass): a release group's readings, reading-based topics, pair judgments and semantic retrieval appear together, once every account in it is analysed or its release quarter has ended (tests/evidence.test.ts 'RT-LINK-01: readings, reading-based topics, pair judgments and semantic retrieval of a release group appear together…'). RT-RET-05: expiry, like withdrawal, erases the links from decided jury cases to the contribution (tests/publication.test.ts 'RT-RET-05…'). This ticket's criteria still hold. Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed.
