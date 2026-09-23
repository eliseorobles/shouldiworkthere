---
id: W-065
title: Crisis resources
ref: L4
phase: Phase 14 - Legal and liability
status: IN PROGRESS
depends_on: W-058
---

# W-065 - Crisis resources

**Phase:** Phase 14 - Legal and liability  
**Brief ref:** L4  
**Depends on:** W-058  
**Status:** IN PROGRESS

## Scope

A deterministic on-device lexicon for self-harm, suicide and imminent danger shows a calm resource card in the composer and the contribution editor without blocking, storing or sending anything. Optional server-side resources and a Jev self_harm judgment only ever show resources to the author.

## Acceptance criteria

- [ ] The on-device detector suppresses clear workplace idioms but shows the card for explicit self-harm phrases, including comparatives such as "I'd rather be dead than …".
- [ ] The card (988 call, text and chat in the US, findahelpline.com elsewhere, emergency numbers labeled by region) never blocks, stores or sends anything.
- [ ] With CRISIS_RESOURCES_ENABLED the server lexicon adds resources to canvas, screen, submit and revise replies; with SELF_HARM_SCREENING Jev's self_harm judgment only shows resources to the author, is never stored and is never a moderation outcome; server-provided resources use their own privacy copy.
- [ ] The card and both switches are enabled together and disclosed in the privacy policy.

## Implementation paths

- `shared/safety.ts`
- `web/canvas/composer.tsx`
- `web/submit.tsx`
- `worker/src/app.ts`
- `worker/inference-core.ts`
- `wrangler.jsonc`
- `inference.wrangler.jsonc`

## Required verification

- tests/safety.test.ts crisis-detector tests; tests/api.test.ts: 'crisis language returns support resources to the asker only…', 'server-side crisis resources stay off until CRISIS_RESOURCES_ENABLED is set…', 'submit and revise replies carry support resources…'.
- tests/publication.test.ts: 'Jev’s self-harm answer only offers the author support resources…'; tests/browser.spec.ts: 'crisis resources come from an on-device check and send nothing'; tests/browser-contribute.spec.ts crisis specs.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Verified: tests/safety.test.ts crisis tests (including 'explicit self-harm statements show the card even inside "rather … than"' and 'server-side crisis resources come from the same lexicon and are never stored, logged or used as a signal'), tests/api.test.ts crisis-resource tests and tests/publication.test.ts 'Jev’s self-harm answer only offers the author support resources…' (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)); tests/browser.spec.ts 'crisis resources come from an on-device check and send nothing' and 'support resources the server adds are shown with their own privacy line…' (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed). CRISIS_CARD_ENABLED, CRISIS_RESOURCES_ENABLED and SELF_HARM_SCREENING are on as of round 3. Closes when the legal group's round-3 disclosure pass lands with docs/legal in sync.
- [2026-09-22 21:44 UTC] At group E's 21:43 UTC run, tests/publication.test.ts 'Jev’s self-harm answer only offers the author support resources…', cited above, failed at line 368; the file was being edited at that moment. The ticket stays open until it passes again with docs/legal in sync.
- [2026-09-22 21:47 UTC] At group E's 21:47 UTC run the test passed again, now titled 'Jev’s self-harm answer only offers the author support resources, on screening, submit and revise replies…' (node --test "tests/*.test.ts": 432 of 433 passed). The ticket stays open until the round's work is verified as a whole.
- [2026-09-23 01:26 UTC] Pre-deploy pass (reader journey): with Live on, which is the default, a crisis phrase typed in the composer showed the on-device card, and 450 ms later Live sent the phrase to hosted Jev and the canvas changed to an unrelated layoffs ranking. Fixed by the client: Live never sends words the on-device crisis check matches, so typing them makes no request (tests/web.test.ts 'Live understanding never sends crisis words or a bare listed name to hosted Jev while someone types'; tests/browser.spec.ts 'with Live on (the default), crisis words show the on-device card and are never sent while typing'). Residuals: a phrase paused on before the lexicon matches it can still be read by Live; pressing Enter still sends the words, by design, and with CRISIS_RESOURCES_ENABLED the server's lexicon adds resources to that reply. This ticket stays in progress with W-058. Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed.
