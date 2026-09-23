---
id: W-009
title: Confidence forks and question trails
phase: Phase 3 - Evidence Canvas
status: DONE
depends_on: W-008
completed: 2026-09-22 21:11 UTC
---

# W-009 - Confidence forks and question trails

**Phase:** Phase 3 - Evidence Canvas  
**Depends on:** W-008  
**Status:** DONE

## Scope

Medium-confidence interpretation exposed as a fork between named meanings; low confidence asks; high confidence renders directly. Trail breadcrumbs that are reversible and locally persisted.

## Acceptance criteria

Ambiguous query yields fork labeled in plain language; choosing an interpretation preserves context; trail supports backtracking.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Forks + trails
- [2026-09-22 05:05 UTC] Fork panel rendered when topic/company/event confidence < 0.52 with shares shown; low confidence asks, high confidence renders; reversible question trail with local history.
- [2026-09-22 05:12 UTC] REOPENED: Audit: FAQs are static and trail is not navigable; fork selection incomplete.
- [2026-09-22 21:11 UTC] Rounds 1-3 fixed the reopen reasons. The question trail is browser history (tests/browser.spec.ts 'back and forward restore each view without asking Jev again…'); forks show model probabilities; FAQ questions are emergent typed specs; an ambiguous question such as 'how political is engineering?' forks between meanings (tests/jev.test.ts 'live-probe regression (D8d): an ambiguous word forks between meanings…'; tests/browser.spec.ts 'an ambiguous word asks which meaning was intended, with model probabilities, on the home page and on a record') (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed).
- [2026-09-23 01:26 UTC] Pre-deploy pass: the meaning fork now leads every clarification it is part of, and forks list only readings Jev gave a real share (see W-056 for the changes and their tests, including round-3 verification failures 3 and 4). This ticket's criteria still hold; the tests named on W-056 passed in the runs recorded there.
