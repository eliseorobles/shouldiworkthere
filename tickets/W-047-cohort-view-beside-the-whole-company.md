---
id: W-047
title: Cohort view beside the whole company
ref: G2
phase: Phase 12 - Brief gaps: evidence engine
status: DONE
depends_on: W-007, W-010
completed: 2026-09-22 21:11 UTC
---

# W-047 - Cohort view beside the whole company

**Phase:** Phase 12 - Brief gaps: evidence engine  
**Brief ref:** G2  
**Depends on:** W-007, W-010  
**Status:** DONE

## Scope

New view 'cohort': the selected group beside the company-wide figure for the same metrics and periods, with unavailable cells explicit and suppression respected.

## Acceptance criteria

- [x] The cohort view shows the selected group beside the whole company for the same metrics and periods.
- [x] Missing or suppressed cells are stated as unavailable; nothing is substituted from another group or period.
- [x] Without a chosen group the canvas asks which published group before any retrieval or ranking; an employer with no published groups is told so.
- [x] Every cohort cell opens in the Evidence Lens with its group label, verification method and provenance.

## Implementation paths

- `worker/src/evidence.ts`
- `worker/src/app.ts`
- `worker/src/jev.ts`
- `web/canvas/views.tsx`

## Required verification

- tests/evidence.test.ts: 'the cohort view puts the group beside the whole company…', 'the cohort view on an employer without published groups says so…', 'every cohort fact opens in the lens…'.
- tests/api.test.ts: 'a cohort question without a group asks before anything is ranked…'; tests/jev.test.ts: 'the cohort view asks which published group to compare…'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented in round 2. Verified: tests/evidence.test.ts 'the cohort view puts the group beside the whole company…', 'the cohort view on an employer without published groups says so…' and 'every cohort fact opens in the lens…', tests/api.test.ts 'a cohort question without a group asks before anything is ranked…' (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)); tests/browser.spec.ts 'each number in the group-and-company view opens its own release, group and provenance' (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed).
- [2026-09-23 01:26 UTC] Pre-deploy pass: a cohort answer uses the asked topic, or says plainly that the group has no published measure for it (tests/evidence.test.ts 'a comparison answers the asked topic…', which covers the cohort view), and a selected group is named in sentence form, 'the engineering group' (tests/evidence.test.ts 'an empty record reads…'). This ticket's criteria still hold; both tests passed in node --test at 01:10 UTC.
