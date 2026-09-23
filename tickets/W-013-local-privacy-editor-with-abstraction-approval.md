---
id: W-013
title: Local privacy editor with abstraction approval
phase: Phase 4 - Voice
status: DONE
depends_on: W-012
completed: 2026-09-22 05:05 UTC
---

# W-013 - Local privacy editor with abstraction approval

**Phase:** Phase 4 - Voice  
**Depends on:** W-012  
**Status:** DONE

## Scope

In-browser detection of exact dates, narrow locations, unique role/history details and direct identifiers; concrete findings; author-approved generalization with before/after diff; no invented anonymity score; identifiers never leave the device.

## Acceptance criteria

Detector runs client-side; every abstraction requires explicit author approval; original text is never silently rewritten.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Local privacy editor
- [2026-09-22 05:05 UTC] shared/privacy.ts detector runs in the browser and again server-side; concrete findings with per-item before/after approval; overlap dedupe so an email is not double-reported as a handle; no invented anonymity score.
- [2026-09-22 21:11 UTC] Re-verified in round 3: tests/privacy.test.ts detector tests ('the detector finds direct identifiers', 'the detector finds the details that deanonymize without naming anyone', 'applying a suggestion is surgical…') pass, and tests/browser-contribute.spec.ts 'privacy editor: typing sends nothing…' and 'make safer: each edit changes only what the author approved…' pass (npx playwright test tests/browser-contribute.spec.ts on 2026-09-22 21:06 UTC: 42 passed, 1 skipped (the opt-in screenshot pass)).
