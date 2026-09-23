---
id: W-011
title: Evidence Lens and source panel
phase: Phase 3 - Evidence Canvas
status: DONE
depends_on: W-010
completed: 2026-09-22 21:11 UTC
---

# W-011 - Evidence Lens and source panel

**Phase:** Phase 3 - Evidence Canvas  
**Depends on:** W-010  
**Status:** DONE

## Scope

Every metric opens to its question wording, denominator, period, verification method, exclusions, supporting testimony, and sampling limits. Jev-derived themes visually separated from employee answers.

## Acceptance criteria

No displayed statistic lacks traceable provenance; themes are labeled as interpretations, never counted as votes.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Evidence Lens
- [2026-09-22 05:05 UTC] Lens opens every metric to question wording, group, n, verification method, exclusions, full period table with intervals, and related published accounts; Jev topic labels visually separated from employee answers and never counted as votes.
- [2026-09-22 21:11 UTC] REOPENED: Audit D-11, D-12 and E-19 (confirmed): the lens lacked release ids and the release-level verification method, and related accounts were the latest unrelated testimony.
- [2026-09-22 21:11 UTC] Fixed in rounds 1-2: tests/evidence.test.ts 'lens provenance: release ids per point and release-level verification method' and 'the Evidence Lens relates accounts and clusters to a metric by topic only, never by recency' pass (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)), and tests/browser.spec.ts 'the evidence lens shows wording, sample size, period and release ids, and Escape returns focus to the number' passes (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed).
