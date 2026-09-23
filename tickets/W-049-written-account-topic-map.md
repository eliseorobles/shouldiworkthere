---
id: W-049
title: Written-account topic map
ref: G4
phase: Phase 12 - Brief gaps: evidence engine
status: IN PROGRESS
depends_on: W-036
---

# W-049 - Written-account topic map

**Phase:** Phase 12 - Brief gaps: evidence engine  
**Brief ref:** G4  
**Depends on:** W-036  
**Status:** IN PROGRESS

## Scope

Optional panel: per dimension, the number of published accounts with a confident model reading and the positive/negative/mixed split, labeled as a model reading of written accounts and never as votes.

## Acceptance criteria

- [ ] Counts cover confident readings of published, non-withheld, non-withdrawn accounts on the page's filters, labeled 'model reading of written accounts, not votes'.
- [ ] A dimension with fewer than 5 readings, or with any positive/negative/mixed cell from 1 to 4, is omitted, so no count below 5 can be shown or derived by subtraction.
- [ ] Readings never enter survey aggregates, answers as votes, or moderation.

## Implementation paths

- `worker/src/evidence.ts`
- `worker/src/types.ts`
- `web/canvas/views.tsx`

## Required verification

- tests/evidence.test.ts: 'account readings count confident model readings per dimension, omit dimensions under five, and ignore withheld accounts'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented in round 2. Verified: tests/evidence.test.ts 'account readings count confident model readings per dimension, omit dimensions under five, and ignore withheld accounts'; the panel copy says 'A model reading of published written accounts, not votes'. Closes after W-036.
