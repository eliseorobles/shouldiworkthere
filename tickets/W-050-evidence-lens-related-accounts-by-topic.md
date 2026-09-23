---
id: W-050
title: Evidence Lens related accounts by topic
ref: G5
phase: Phase 12 - Brief gaps: evidence engine
status: IN PROGRESS
depends_on: W-011, W-036
---

# W-050 - Evidence Lens related accounts by topic

**Phase:** Phase 12 - Brief gaps: evidence engine  
**Brief ref:** G5  
**Depends on:** W-011, W-036  
**Status:** IN PROGRESS

## Scope

For a metric, the Evidence Lens lists the related accounts and clusters by topic mapping, not the latest unrelated testimony.

## Acceptance criteria

- [ ] Related accounts and clusters for a metric come from the accounts the page's filters select, by topic mapping, never by recency.
- [ ] At most 12 related ids, current page first, and every related id is reachable by paging.
- [ ] A cluster counts as related only when at least half of its sources mention the topic.

## Implementation paths

- `worker/src/evidence.ts`
- `web/canvas/lens.tsx`

## Required verification

- tests/evidence.test.ts: 'the Evidence Lens relates accounts and clusters to a metric by topic only, never by recency', 'Evidence Lens relations stay inside the page…'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented in round 2. Verified: tests/evidence.test.ts 'the Evidence Lens relates accounts and clusters to a metric by topic only, never by recency' and 'Evidence Lens relations stay inside the page…'. Closes after W-036.
