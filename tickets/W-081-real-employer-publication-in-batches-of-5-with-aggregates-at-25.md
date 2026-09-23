---
id: W-081
title: Real-employer publication in batches of 5 with aggregates at 25
phase: Phase 16 - Public launch
status: IN PROGRESS
depends_on: W-015, W-053
---

# W-081 - Real-employer publication in batches of 5 with aggregates at 25

**Phase:** Phase 16 - Public launch  
**Depends on:** W-015, W-053  
**Status:** IN PROGRESS

## Scope

Owner decision of September 23, 2026: real-employer publication and juries are switched on. Written accounts publish per employer and verification type in batches of TESTIMONY_BATCH_MIN (5 in production) after screening and the random delay; questionnaire percentages and answer bands keep MIN_COHORT_N (25); a real-employer jury forms only when enough jurors can serve, and otherwise the case stays honestly pending. Every page that states these rules says exactly this.

## Acceptance criteria

- [ ] Production sets REAL_PUBLICATION_ENABLED 'true', JURY_ENABLED 'true', TESTIMONY_BATCH_MIN '5' and MIN_COHORT_N '25' in wrangler.jsonc, and the published moderation policy carries the batch minimum of 5.
- [ ] Approved written accounts publish only in batches of at least TESTIMONY_BATCH_MIN for the same employer and verification type, after screening and the random 12 to 72 hour delay; a batch that would fall below the minimum is reverted, and an unbatched approved account is erased after 180 days.
- [ ] Questionnaire percentages and answer bands are published only for groups and answers of at least MIN_COHORT_N (25), and account counts from 1 to 4 are never stated.
- [ ] A real-employer jury opens only when juror keys of enough employers are live to reach a decision under the seat limits; otherwise the case stays held, and /api/config, /moderation and /transparency say whether a jury can form now.
- [ ] The privacy policy, terms, moderation and transparency pages, the contribution receipt and an empty employer record say: written accounts in batches of at least 5 per employer after screening and a random delay; survey figures need 25.
- [ ] A contribution accepted under legal version 1.1.0 (submitted before LEGAL_EFFECTIVE, 2026-09-23), which was promised a batch of at least 25, is never published in a smaller batch unless counsel decides otherwise, and the publication code enforces this rather than a manual query before the deploy.

## Implementation paths

- `wrangler.jsonc`
- `worker/src/flags.ts`
- `worker/src/submissions.ts`
- `worker/src/moderation.ts`
- `shared/policy.ts`
- `worker/src/legal.ts`
- `worker/src/pages.ts`
- `web/submit.tsx`

## Required verification

- tests/community.test.ts: 'written accounts publish in batches of 5 per employer and verification type; questionnaire aggregates keep their minimum of 25', 'production configuration: no fictional data, publication and juries on…'.
- tests/publication.test.ts: 'a batch that would drop below 5 after claims is reverted, not partially published', 'held cases expire after 30 days and unbatched approved cases after 180…', 'a group whose published count falls below 25 stays suppressed even after 5 changes'.
- tests/safety.test.ts: 'legal: retention, batch and jury numbers are rendered from the moderation policy', 'launch: the production review copy describes publication, juries, listings and proof of work as production runs them'.
- Still to add: a publication test that a contribution created before LEGAL_EFFECTIVE waits for a batch of 25.

## Log

- [2026-09-23 05:11 UTC] Ticket created.
- [2026-09-23 05:14 UTC] Started. State read for this entry (group E, 05:00–05:15 UTC). Done and tested: wrangler.jsonc sets REAL_PUBLICATION_ENABLED 'true', JURY_ENABLED 'true', TESTIMONY_BATCH_MIN '5' and MIN_COHORT_N '25'; policy 0.8.0 (shared/policy.ts, the current policy) publishes written accounts in batches of at least 5 per employer and verification type and keeps questionnaire figures at 25; the legal pages, the moderation and transparency pages, the receipt (web/submit.tsx) and the empty record (worker/src/pages.ts) state the rule from the same values. Tests: tests/community.test.ts 'written accounts publish in batches of 5 per employer and verification type; questionnaire aggregates keep their minimum of 25' and 'production configuration: no fictional data, publication and juries on…'; tests/publication.test.ts 'a batch that would drop below 5 after claims is reverted, not partially published'; tests/safety.test.ts 'launch: the production review copy describes publication, juries, listings and proof of work as production runs them'. All passed in node --test "tests/*.test.ts" at 05:01–05:02 UTC (602 of 604; the failures were tests/tickets.test.ts and one tests/web.test.ts listing-wording test, neither about publication).
  Open: the last criterion. worker/src/submissions.ts publishDue applies the batch of 5 to every approved contribution whatever its created_day, and nothing in the code refers to LEGAL_EFFECTIVE. Contributions accepted under legal 1.1.0 were promised batches of at least 25; today only the read-only query in docs/operations.md step 0 guards them (the legal group's requested edit for group B), and legalLaunchBlockers() lists 'change-notice' until counsel signs off on 1.2.0.
  Related, tracked on W-083: whether a real-employer jury 'can form' counts community-listed employers, so someone who lists 2 or 3 domains they control can staff and decide a jury. [read docs/operations.md sha256:98f2532f049c]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/operations.md for this entry. The launch section and step 0 now say a contribution submitted before September 23, 2026 keeps the 1.1.0 batch of 25 in code, and the step 0 query is only a count. In code, worker/src/submissions.ts publishDue now groups accounts with no created_day or a created_day before LEGAL_EFFECTIVE on their own, per employer, reporting period and verification type, and publishes them only at legacyBatchMin (25, policy 0.8.0 retention.legacyBatch); receipts state the rule that applies (batchRuleFor). tests/community.test.ts 'an account submitted before the launch terms keeps the 1.1.0 promise: batches of at least 25 such accounts per employer, reporting period and verification type' passed in node --test "tests/*.test.ts" at 06:17-06:18 UTC; it is the publication test the 'Required verification' list says is still to add. The last criterion therefore appears met in code; closing the ticket is left to the tickets group. The jury-capture item this ticket points to (W-083) is fixed in code. [read docs/operations.md sha256:23803f99bfdc]
- [2026-09-23 06:41 UTC] Re-read docs/operations.md after the launch deploy: the only change is the zone-check header grep in deploy step 8, which now accepts the workers' intentional 'nel: {"max_age":0}'. The earlier entry still holds. [read docs/operations.md sha256:b88f975dd416]
- [2026-09-23 17:37 UTC] Reviewed the open-source release edit to docs/operations.md: the prerequisites now require Node 24+ (26.5.0 pinned) and Bun 1.4.0 to match the dependencies. The remaining operational instructions and this ticket's recorded scope are unchanged. Clean-export build and typecheck passed; ticket reference checks are being refreshed for the updated document. [read docs/operations.md sha256:b0fe3595a3a9]
