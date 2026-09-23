---
id: W-037
title: Live semantic controls and confidence-native UI
phase: Phase 11 - Jev acceptance
status: IN PROGRESS
depends_on: W-008, W-009
---

# W-037 - Live semantic controls and confidence-native UI

**Phase:** Phase 11 - Jev acceptance  
**Depends on:** W-008, W-009  
**Status:** IN PROGRESS

## Scope

One input selects a bounded interface and interprets employer, comparison employer, function, seniority, geography, period and event. Live mode (on by default by owner decision D14) updates actual evidence views, not just chips.

## Acceptance criteria

- [ ] Live is on by default by owner decision with visible disclosure; switching it off persists, and while off typing produces zero requests; GPC starts it off.
- [ ] With Live on, paused input triggers one bounded request after 450ms; new input and switching off cancel stale results.
- [ ] High-confidence interpretations morph views, medium confidence exposes alternatives, and unsupported/low confidence asks rather than guessing.
- [ ] Every inferred dimension is an editable chip; removing it stays authoritative until cleared; manual overrides cannot be silently restored.
- [ ] Semantic cursor annotations use typed concepts and source spans only; they never fabricate a population count.
- [ ] Retain focus, keyboard navigation, reduced-motion behavior and the last valid canvas during ambiguity.
- [ ] D11: Live understanding never shows an error while typing. Live requests have their own per-client budget (about 60 a minute) and never spend the explicit-search budget or the global POST limit; at most one live request is in flight, sent after a 450 ms pause and cancelled by new input.
- [ ] D11: A live 429 pauses Live quietly for 60 seconds with an inline note ('Live understanding paused for a minute — press Enter to search') and keeps the last view, never the error banner; an explicit search that is rate limited shows a calm inline message.

## Implementation paths

- `worker/src/jev.ts`
- `worker/src/index.ts`
- `web/app.tsx`
- `tests/browser.spec.ts`

## Required verification

- Type senior engineers in NYC last year; unsupported intersections must offer broader evidence, not relabel company totals.
- Slow first response arrives after a newer response; the newer view must remain.
- Political engineering yields a promotion/culture clarification without silently choosing.
- Mobile 390px and desktop 1440px show usable input and no overflow.
- D11 server: tests/api.test.ts 'live understanding has its own budget…' and tests/jev.test.ts 'Live understanding is charged to its own daily budget…'.
- D11 client: a tests/browser.spec.ts case that stubs a live 429 and asserts the quiet pause note, the kept view, no error banner, and that Enter still searches.
- D14: tests/browser.spec.ts 'Live understanding is on by default, starts off under Global Privacy Control, and the visitor's choice is remembered' and 'typing stays on this device until an explicit submit…' (with Live switched off).

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Dependency on W-023 replaced in round 3 by the technical prerequisites (see W-023's log): W-023 is the reconciliation umbrella and its acceptance includes deployment, so as a prerequisite it made this ticket unclosable before deploy while W-023 cannot close before it. Verified: Live off sends nothing, Live sends one bounded request after a pause, a stale reading never replaces a newer one, asks keep the last canvas, the ambiguous-meaning fork works, and function and seniority are separate chips (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed; tests/jev.test.ts). Still open: location shares the second group slot with seniority and employment type, so a request naming function, seniority and location cannot hold all three, and there is no named test for 'senior engineers in NYC last year'.
- [2026-09-22 21:42 UTC] Scope change (user feedback in round 3, decision D11): acceptance items and verification added so that Live understanding never shows an error while typing. As of 21:42 UTC it had landed: a LIVE_LIMIT binding (60 per 60 s per client, wrangler.jsonc) separate from the global POST limit, a separate live budget in the inference worker, a 429 with mode 'live' and retry-after 60 (worker/src/app.ts), and a quiet pause with an inline note in web/app.tsx. Named tests exist: tests/api.test.ts 'live understanding has its own budget…', 'live calls are marked live all the way to the inference worker…' and 'without a LIVE_LIMIT binding live requests fall back to the POST limit…'; tests/jev.test.ts 'Live understanding is charged to its own daily budget…'; tests/browser.spec.ts 'a Live reading over its own budget pauses Live quietly: no error, the last view stays, and Enter still searches'. Group E has not run them since they landed. The open items in the previous entry still stand.
- [2026-09-23 01:26 UTC] Scope change (owner decision D14): the manifest's first acceptance item now reads 'Live is on by default by owner decision with visible disclosure; switching it off persists, and while off typing produces zero requests; GPC starts it off.', the scope no longer says opt-in, and the required verification names the D14 tests; both passed (see W-008).
  Round-3 red-team findings in this ticket's scope, fixed with tests: RT-A5 (Live typing reads the question but never retrieves or ranks accounts: tests/api.test.ts 'live calls are marked live all the way to the inference worker…'), RT-ABUSE-09 (the degraded note names Live only for Live requests: tests/api.test.ts 'RT-ABUSE-09 and RT-A3…'), RT-A4 (no suggestion below 0.45, and preference suggestions only in discovery: tests/jev.test.ts 'RT-A4…').
  Pre-deploy pass (reader journey, fixed with tests): a Live reading is a provisional history entry that Enter settles, so Back returns to the page the question was typed on and the path never repeats a question (tests/web.test.ts 'history keeps one entry per committed view…'; tests/browser.spec.ts 'a Live reading followed by Enter is one step in the path and one entry in history'); Live never sends words the on-device crisis check matches, nor a bare listed employer name, which opens its record with a request carrying no words (tests/web.test.ts 'Live understanding never sends crisis words or a bare listed name to hosted Jev while someone types'; tests/browser.spec.ts 'with Live on (the default), crisis words show the on-device card and are never sent while typing' and 'with Live on, a listed name opens its record without hosted Jev…'); the Group tab after another tab opens the group view (tests/browser.spec.ts 'the Group tab after another tab opens the group view…'); removing a chip with the keyboard moves focus to a remaining control (tests/browser.spec.ts 'removing a chip with the keyboard moves focus…'); Back while a question is loading abandons it (tests/browser.spec.ts 'Back while a question is still loading abandons it…'); a published group named by its whole label applies from 0.45, and a named group that is not applied is offered under 'Not applied, one tap away', the same for Live and Enter (tests/jev.test.ts 'e2e regression: a published group the question names by its label…' and 'e2e regression: Live and Enter read a named group alike…').
  Residuals: a crisis phrase paused on before it is complete (for example 'honestly I want to') can still be read by Live; Enter still sends the words by design, and the server's crisis resources answer them (W-065); opening a record from an exact employer name clears pinned edits, as the Enter path does. The open items of the 21:11 entry (location shares the second group slot; no named test for 'senior engineers in NYC last year') were not re-checked for this entry. Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed.
