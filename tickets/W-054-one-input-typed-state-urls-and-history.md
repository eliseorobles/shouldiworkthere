---
id: W-054
title: One input, typed-state URLs and history
ref: U1
phase: Phase 13 - Brief gaps: interface
status: DONE
depends_on: W-008, W-010
completed: 2026-09-22 21:11 UTC
---

# W-054 - One input, typed-state URLs and history

**Phase:** Phase 13 - Brief gaps: interface  
**Brief ref:** U1  
**Depends on:** W-008, W-010  
**Status:** DONE

## Scope

One input with no modes. A sole company match navigates to /c/<slug> with history.pushState; comparisons, discovery and timelines keep typed URL state; back and forward restore views without re-running inference.

## Acceptance criteria

- [x] A question that is exactly one listed name navigates to /c/<slug> on the device with history.pushState and no hosted inference.
- [x] Comparisons, discovery and timelines keep only typed public ids in the URL; raw query text lives only in history.state, never in the URL.
- [x] Back and forward restore each view without asking Jev again.
- [x] A crafted link cannot put unpublished group or industry words on a page or into a shared address.

## Implementation paths

- `web/app.tsx`
- `web/share.ts`
- `web/canvas/composer.tsx`

## Required verification

- tests/web.test.ts: 'typed-state URLs carry only typed public identifiers…', 'a typed state round-trips through its URL…', 'only a question that is exactly a listed name navigates…', 'a link cannot put unpublished group or industry words on a page…'.
- tests/browser.spec.ts: 'back and forward restore each view without asking Jev again…', 'a question that is only a listed employer name navigates on the device…', 'a crafted link cannot put its own words…'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented in round 2. Verified: tests/web.test.ts 'typed-state URLs carry only typed public identifiers…', 'only a question that is exactly a listed name navigates…' and 'a link cannot put unpublished group or industry words on a page…' (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)); tests/browser.spec.ts 'back and forward restore each view without asking Jev again…', 'a question that is only a listed employer name navigates on the device…' and 'a crafted link cannot put its own words…' (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed).
- [2026-09-23 01:26 UTC] Round-3 and pre-deploy findings, recorded for this entry. RT-DEV-04 fixed: at most one history entry holds a question (the entry where it was asked), the path saved in history names views, and the reader's words for Back, Forward and the breadcrumb stay in page memory (tests/browser.spec.ts 'session history keeps only the last question, on its own entry…'). WS-02 fixed: a crafted ?pref= link keeps only published criteria, only on discovery views, and never puts its own words on a page (tests/web.test.ts 'a link or a reading cannot put its own words on a page as a criterion…'; tests/browser.spec.ts 'a crafted link cannot put its own words on a page as a criterion…'). Reader journey: with Live on (the default), typing 'Stripe', Enter, then Back stayed on /c/stripe and a second Back left the site; a Live reading now adds a provisional entry that Enter replaces, so Back returns to the page the question was typed on, and a bare listed name still opens its record on the device with no hosted inference (tests/web.test.ts 'history keeps one entry per committed view…'; tests/browser.spec.ts 'with Live on, a listed name opens its record without hosted Jev, and Enter then Back returns to the page it was typed on', 'a Live reading followed by Enter is one step in the path and one entry in history' and 'Back while a question is still loading abandons it…'). This ticket's criteria still hold. Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed.
