---
id: W-010
title: Morphing evidence views
phase: Phase 3 - Evidence Canvas
status: DONE
depends_on: W-008
completed: 2026-09-22 21:11 UTC
---

# W-010 - Morphing evidence views

**Phase:** Phase 3 - Evidence Canvas  
**Depends on:** W-008  
**Status:** DONE

## Scope

Canonical view set rendered from the same query contract: overview, compare, timeline, distribution, clusters, testimony reader. Transitions preserve selection and focus.

## Acceptance criteria

Each intent class renders its view with correct data; rapid input cannot render stale results; reduced-motion users get instant swaps.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Morphing views
- [2026-09-22 05:05 UTC] Six canonical views (overview, compare, timeline, distribution, clusters, reader) rendered from one query contract, with fallbacks and notices when a view has no matching evidence.
- [2026-09-22 21:11 UTC] REOPENED: Audit C-11 and C-12 (confirmed) contradicted this acceptance: a Live reading could discard an explicit request, and view changes lost focus.
- [2026-09-22 21:11 UTC] Fixed in rounds 1-2: tests/browser.spec.ts 'Live understanding reads only after opt-in, and a slow stale reading cannot replace a newer one', 'a Live reading never discards an explicit question that is still loading' and 'one orchestrated morph between views, and none when reduced motion is requested' pass (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed).
