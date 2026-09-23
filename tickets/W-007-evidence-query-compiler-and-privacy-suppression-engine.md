---
id: W-007
title: Evidence query compiler and privacy suppression engine
phase: Phase 2 - Inference
status: DONE
depends_on: W-004, W-006
completed: 2026-09-22 21:11 UTC
---

# W-007 - Evidence query compiler and privacy suppression engine

**Phase:** Phase 2 - Inference  
**Depends on:** W-004, W-006  
**Status:** DONE

## Scope

Compile validated intent into parameterized D1 queries; cohort minimums, complementary suppression, release-window gating, denominator and limitation reporting, refusal with a broader-cohort suggestion.

## Acceptance criteria

Suppressed combinations never leak counts; every response carries n, period, and method; unit tests prove thresholds hold.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Query compiler + suppression
- [2026-09-22 05:05 UTC] worker/src/evidence.ts: parameterized reads over published rows only, pure suppressCells() with complementary suppression, cohort fallback with an honest notice for thin groups, topic-prioritized metric ordering, provenance on every metric.
- [2026-09-22 05:12 UTC] REOPENED: Audit: suppression is scoped after cohort filtering; event/timeframe fields ignored; directory leaks unsuppressed cells.
- [2026-09-22 21:11 UTC] Round 1 fixed the reopen reasons. Suppression is checked across siblings before a cohort is chosen (tests/acceptance.test.ts 'suppression checks all siblings before selecting a cohort, and unknown cohorts never silently broaden'); event and time filters apply or are reported (tests/evidence.test.ts 'after_event filters metrics and testimony…', 'last_year applies to testimony as well as metrics', 'an unapplied before/after filter is reported as such…'); /api/directory returns only id, slug, name, kind and sector, never cells; thresholds are proven by the tests/privacy.test.ts suppression tests (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)).
