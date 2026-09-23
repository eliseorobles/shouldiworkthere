---
id: W-057
title: Split compare, cohort view and answer headline
ref: U4
phase: Phase 13 - Brief gaps: interface
status: DONE
depends_on: W-010, W-046, W-047
completed: 2026-09-23 01:26 UTC
---

# W-057 - Split compare, cohort view and answer headline

**Phase:** Phase 13 - Brief gaps: interface  
**Brief ref:** U4  
**Depends on:** W-010, W-046, W-047  
**Status:** DONE

## Scope

Compare physically splits the canvas; the cohort view renders; a deterministic answer headline sits above every view with facts that open the lens; the footer states that no answers are generated.

## Acceptance criteria

- [x] Compare renders two aligned sides with per-side availability for each metric.
- [x] The cohort view renders the group beside the whole company.
- [x] Every view has the deterministic answer headline above it, and each fact opens the Evidence Lens.
- [x] The canvas footer reads 'No generated answers. Jev classified your intent; published evidence built this view.' (or the controls variant when Jev did not classify).

## Implementation paths

- `web/app.tsx`
- `web/canvas/views.tsx`
- `web/canvas/lens.tsx`
- `web/styles.css`

## Required verification

- tests/browser.spec.ts: 'the answer is assembled from published numbers, and each fact opens its evidence', 'one orchestrated morph between views…'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented in round 2: compare renders split cells per side, the cohort view renders, the answer headline sits above each view, and the footer states that no answers are generated. Verified: tests/browser.spec.ts 'the answer is assembled from published numbers, and each fact opens its evidence' (which also asserts the 'No generated answers.' footer), 'each number in the group-and-company view opens its own release, group and provenance' and 'one orchestrated morph between views…' (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed); tests/evidence.test.ts 'comparison covers the union of metrics with explicit per-side availability'.
- [2026-09-22 22:29 UTC] REOPENED: prerequisite W-046 was reopened; this ticket closes again after it does.
- [2026-09-23 01:26 UTC] Closed again after W-046: tests/browser.spec.ts 'the answer is assembled from published numbers, and each fact opens its evidence' (it also asserts the 'No generated answers.' footer), 'each number in the group-and-company view opens its own release, group and provenance' and 'one orchestrated morph between views, and none when reduced motion is requested' passed in npx playwright test tests/browser.spec.ts (53 passed, 2026-09-23 01:12–01:14 UTC), and tests/evidence.test.ts 'comparison covers the union of metrics with explicit per-side availability' and 'the cohort view puts the group beside the whole company for the same period and never substitutes' passed in node --test "tests/*.test.ts" at 01:10 UTC. The client's polish re-check reports the compare-on-workload answer leading with typical weekly hours, with fact tiles that open their evidence.
