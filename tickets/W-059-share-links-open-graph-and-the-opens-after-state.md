---
id: W-059
title: Share links, Open Graph and the opens-after state
ref: U6
phase: Phase 13 - Brief gaps: interface
status: DONE
depends_on: W-054
completed: 2026-09-22 21:11 UTC
---

# W-059 - Share links, Open Graph and the opens-after state

**Phase:** Phase 13 - Brief gaps: interface  
**Brief ref:** U6  
**Depends on:** W-054  
**Status:** DONE

## Scope

'Share this view' with typed-state URLs, per-company Open Graph metadata and images, and a real-employer empty state that says the record opens after 25 verified coworkers contribute, with an invite action and no counts.

## Acceptance criteria

- [x] 'Share this view' uses the Web Share API or copies a typed-state link; the question text is never in the link.
- [x] Open Graph metadata and images label fictional employers and carry no statistics.
- [x] A real employer with nothing published shows 'This record opens after 25 verified coworkers contribute' as its only heading, with an invite/share action and no counts.

## Implementation paths

- `web/share.ts`
- `web/app.tsx`
- `worker/src/og.ts`
- `tools/og.mjs`

## Required verification

- tests/browser.spec.ts: 'sharing copies a typed-state link and never the question', 'a real employer with nothing published shows the opens-after rule, an invite action and no counts'.
- tests/web.test.ts: 'share images label fictional employers and carry no statistics', 'page metadata names fictional employers as fictional…', 'seeded employers have their own Open Graph image…', 'every employer in the directory the worker serves names an Open Graph image the worker serves…', 'Open Graph images are served only for known names, as JPEG'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented in round 2. Verified: tests/browser.spec.ts 'sharing copies a typed-state link and never the question' and 'a real employer with nothing published shows the opens-after rule, an invite action and no counts' (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed); tests/web.test.ts 'share images label fictional employers and carry no statistics', 'page metadata names fictional employers as fictional…', 'every directory employer has an Open Graph image…' and 'Open Graph images are served only for known names, as JPEG' (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)).
- [2026-09-23 01:26 UTC] Round-3 red-team RT-C5: the test named 'every directory employer has an Open Graph image…' read only db/seed.sql, while the 212 employers added by migration 0009 have no image of their own and their pages use home.jpg. Rendering about 212 more images would add about 12 MB to the main Worker bundle, so group C split the test instead: tests/web.test.ts 'seeded employers have their own Open Graph image within the size and dimension limits' and 'every employer in the directory the worker serves names an Open Graph image the worker serves: its own, or the home image'; tools/og.mjs documents the limit. The manifest's required-verification line now names these two tests. This ticket's acceptance (fictional employers labeled, no statistics in images) does not require an image per employer and still holds; the added real employers sharing the home image is a recorded residual. Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed.
