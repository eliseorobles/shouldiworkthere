---
id: W-029
title: Automatic disjoint appeals
phase: Phase 10 - Constitutional moderation
status: BLOCKED
depends_on: W-028
---

# W-029 - Automatic disjoint appeals

**Phase:** Phase 10 - Constitutional moderation  
**Depends on:** W-028  
**Status:** BLOCKED

## Scope

Author capability starts an appeal without staff discretion. Select 9 entirely different eligible jurors who cannot see the original result. Define finality, UNSURE, timeout and remedy semantics.

## Acceptance criteria

Appeal jury has no member overlap or outcome leakage; state machine and finality tests pass; overturn counts are recorded without exposing a contributor.

## Log

- [2026-09-22 05:27 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented and verified for practice juries: tests/moderation.test.ts 'appeals: the author appeals once with the capability; nine fresh seats decide without seeing the first result; the appeal is final' and 'appeal disjointness as implemented: first-jury tokens are spent and cannot sit again, but one person holding several tokens is not detectable'.
- [2026-09-22 21:11 UTC] BLOCKED: waits on W-028 (blocked: Mailbox possession is not one-human-one-vote; requires reviewed anti-Sybil eligibility and private exclusion proofs.)
- [2026-09-23 01:26 UTC] Round-3 red-team RT-ABUSE-05 fixed: re-submitting identical words after a final, upheld appeal no longer opens a new jury; the final result for those words is applied again (tests/moderation.test.ts 'RT-ABUSE-05: identical words revised after a final result never draw a new jury…' and the two other RT-ABUSE-05 tests). Under policy 0.7.0 a practice appeal can be staffed from any fictional employer's sandbox tokens (see W-028). Still blocked on W-028.
