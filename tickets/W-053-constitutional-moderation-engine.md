---
id: W-053
title: Constitutional moderation engine
ref: G8
phase: Phase 12 - Brief gaps: evidence engine
status: DONE
depends_on: W-014, W-025
completed: 2026-09-22 21:11 UTC
---

# W-053 - Constitutional moderation engine

**Phase:** Phase 12 - Brief gaps: evidence engine  
**Brief ref:** G8  
**Depends on:** W-014, W-025  
**Status:** DONE

## Scope

The running engine behind Phase 10: executable policy, equal-access challenges, anonymous juror tokens, random 7-seat juries, automatic 9-seat appeals, receipts and public statistics. Real-employer juries stay off until W-027's eligibility proofs exist; practice juries run for the fictional employers.

## Acceptance criteria

- [x] The executable policy (jury ranges, thresholds, juror counts, ground terms) is served at /moderation/vX.Y.Z.json with a verifiable digest, and every decision pins the version and digest.
- [x] Challenges: any reader, no organization, priority or override field; a cited published rule; a relevance check by Jev or, when it is unavailable, the published ground terms; reputational discomfort is not a ground; a re-check under the pinned policy; anonymous per-client daily budgets (5 per client per UTC day) kept only as keyed digests deleted after the day; duplicate merge; decided rules are final for the same published words.
- [x] Personal-attack uncertainty (ABUSE-02) asks the author to repair at 0.85 or above and publishes below it; juries decide only spam and manipulation uncertainty and challenges.
- [x] Seeded fictional fixtures cannot be withheld by a challenge or a jury; such challenges are recorded as practice cases with an honest receipt.
- [x] Juror tokens are blind, use per-employer juror keys and staff one seat each; at most 3 tokens per mailbox, employer and quarter. On real-employer juries a token is never drawn for a case about its own employer and one employer's tokens fill at most 2 seats on a case; practice juries (fictional employers, policy 0.7.0) have neither limit.
- [x] Juries: 7 random seats, one YES/NO/UNSURE question on one rule with a masked passage, votes blind until close, quorum, expiry and seat replacement, and an honest pending state when jurors are insufficient, never simulated votes.
- [x] Appeals: the author appeals with the capability; 9 fresh seats decide without seeing the first result (the case payload omits stage and juror count); the result is final.
- [x] Receipts are author-visible per item; public statistics (published automatically, repairs, jury, rejected, legal, appeals, overturned, held by reason) reconcile to the outcome records and show counts below 5 as <5.

## Implementation paths

- `shared/policy.ts`
- `worker/src/moderation.ts`
- `worker/src/submissions.ts`
- `worker/issuer.ts`
- `shared/proof.ts`
- `db/intake-migrations/`
- `db/migrations/0005_moderation_public.sql`

## Required verification

- tests/moderation.test.ts (policy history, challenge flow, budgets, juries, appeals, receipts, statistics, prompt injection).
- tests/publication.test.ts: 'decisions pin policy version, digest, matched rules…', 'every rule fires at its threshold and not just below it'.
- tests/protocol.test.ts juror-token tests; tests/browser-contribute.spec.ts 'jury: …', 'challenge: …', 'status: …' specs.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented in round 2 and completed with round 3's decisions. Verified (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)): tests/moderation.test.ts policy, challenge, jury, appeal, receipt and statistics tests, including 'one token staffs one seat, and a juror sees one rule, one question and a masked passage — never the stage…', 'each client may send 5 challenges per UTC day, counted only under a keyed digest…', 'a seeded fictional sample account can never be withheld by a challenge or a jury…', 'tokens of one fictional employer fill at most 2 seats on a case…' and 'real-employer cases take only work-mailbox tokens from other employers, at most two seats per employer…'; tests/protocol.test.ts '/issue-juror signs 1–5 tokens per mailbox challenge, within a per-quarter quota of 3…'; tests/jev.test.ts '/relevance judges a masked reason against the published rule…'; the jury, challenge and status specs in tests/browser-contribute.spec.ts (npx playwright test tests/browser-contribute.spec.ts on 2026-09-22 21:06 UTC: 42 passed, 1 skipped (the opt-in screenshot pass)). Real-employer juries stay off until W-027.
- [2026-09-23 01:26 UTC] Scope change and corrections (policy 0.7.0, pre-deploy pass). Red-team RT-B1 found that juries and appeals could not form anywhere: with three fictional employers, the own-employer exclusion and the 2-seat cap per juror employer left too few eligible seats. Policy 0.7.0 (shared/policy.ts) removes both limits for practice juries only: a sandbox token may sit on a case about the fictional employer it names, and sandbox seats have no per-employer limit; real-employer juries keep both limits. This departs from CONTRACT-3 D4 as written ('at most 2 seats per juror-employer per case (real and sandbox)') for practice juries; the pre-deploy polish made the change, and docs/protocol-poewi.md and docs/threat-model.md now say practice juries are not Sybil-resistant and demonstrate the procedure only. The acceptance item on juror tokens was reworded in the manifest to match.
  Corrections to the 21:11 entry: its test 'tokens of one fictional employer fill at most 2 seats on a case…' no longer exists; it is replaced by tests/moderation.test.ts 'practice juries (0.7.0, RT-B1): one fictional employer's tokens can fill every seat of a case about it, and its appeal; real-employer limits are unchanged' and 'a juror is drawn only for an open case of their class; a practice juror may sit on a case about the fictional employer their token names (0.7.0)…', with 'real-employer cases take only work-mailbox tokens from other employers, at most two seats per employer…' unchanged. Its '/issue-juror signs 1–5 tokens per mailbox challenge, within a per-quarter quota of 3' is now tests/protocol.test.ts '/issue-juror issues a mailbox its juror tokens once per employer and quarter (one set of up to 3…)…' (RT-ORACLE-06). Its 'practice juries run for the fictional employers' held only in unit tests until 0.7.0; the live stack now reports that a practice jury can form (tests/integration.mjs 'jury: a published sandbox juror key is enough for a practice jury (policy 0.7.0)').
  Other round-3 red-team fixes in the engine, with tests in tests/moderation.test.ts: RT-ABUSE-03 (daily challenge budgets per IPv6 /64), RT-ABUSE-04 (urgent privacy and safety re-checks, failed re-checks not counted, relevant challenges queued with a receipt; residual: a flood of relevant challenges can delay a genuine privacy challenge behind others of its kind), RT-ABUSE-05 (identical words after a final result never draw a new jury), RT-ABUSE-06 (exception renewal), RT-RET-05 (cases keep only the UTC day opened), RT-DIFF-03 (rounded, daily moderation counts), WS-07 (413 for oversized bodies). Residual from RT-ABUSE-01, read in the code for this entry: published words whose only finding is a note to the checks are not withheld by the local scan (it counts identifying findings only), and /screen refuses them before any model call, which the re-check reads as checks unavailable (worker/src/moderation.ts rescreen, worker/src/submissions.ts screenApprovedText); a challenge against them is queued, not answered with 503, but its re-check cannot run. Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed. [read docs/protocol-poewi.md sha256:1a996f114d48] [read docs/threat-model.md sha256:0449c1a76dd9]
- [2026-09-23 02:46 UTC] Re-read docs/threat-model.md after the 2026-09-22 production-fix pass: it now records that Cloudflare zone features can inject scripts or headers for browser user agents and the no-transform/NEL/HTTP-redirect guard. The earlier entry still holds. [read docs/threat-model.md sha256:d45e1f335d37]
- [2026-09-23 05:16 UTC] Re-read docs/protocol-poewi.md and docs/threat-model.md for this entry; both changed at 04:19 UTC. Both still state what the 01:26 and 02:46 entries rely on (the policy 0.7.0 seat classes, practice juries not Sybil-resistant, the zone paragraph); the current policy in shared/policy.ts is 0.8.0, whose jury settings extend 0.7.0's with the same seat classes. Scope note: this ticket's scope says 'Real-employer juries stay off until W-027's eligibility proofs exist'. That no longer describes the launch configuration, where wrangler.jsonc sets JURY_ENABLED 'true' by owner decision while W-027 is blocked. The acceptance criteria still hold as tested (tests/moderation.test.ts passed in node --test "tests/*.test.ts" at 05:01–05:02 UTC), but the seat limit does not tell community-listed employers apart, so listed domains can capture a jury; that criterion is on W-083. [read docs/protocol-poewi.md sha256:892e76c3f882] [read docs/threat-model.md sha256:1813a789fc8f]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/protocol-poewi.md and docs/threat-model.md for this entry. Both still state the seat classes and that practice juries are not Sybil-resistant; policy 0.8.0 in shared/policy.ts keeps 0.7.0's seat classes and adds communitySeatsPerCase 1. Correction to the 05:16 entry's 'the seat limit does not tell community-listed employers apart, so listed domains can capture a jury': that no longer holds, because worker/src/moderation.ts seatGroup and jurorEmployers now treat community keys separately (see W-028; tests/moderation.test.ts passed in node --test "tests/*.test.ts" at 06:17-06:18 UTC). The scope note stands: JURY_ENABLED is 'true' while W-027 is blocked. [read docs/protocol-poewi.md sha256:c8073876411e] [read docs/threat-model.md sha256:d4dfb76d64f7]
