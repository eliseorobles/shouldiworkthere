---
id: W-056
title: Confidence panel with probabilities
ref: U3
phase: Phase 13 - Brief gaps: interface
status: DONE
depends_on: W-009
completed: 2026-09-22 21:11 UTC
---

# W-056 - Confidence panel with probabilities

**Phase:** Phase 13 - Brief gaps: interface  
**Brief ref:** U3  
**Depends on:** W-009  
**Status:** DONE

## Scope

The confidence panel shows model probabilities; low confidence asks; the last valid canvas stays.

## Acceptance criteria

- [x] Tentative readings list each alternative as 'N% model probability' with the note that model probability says nothing about the evidence.
- [x] Low confidence asks, listing the weak options and an unset choice, and the last valid canvas stays in place.
- [x] An ambiguous-meaning question such as 'how political is engineering?' forks between meanings (promotion politics, team culture, leadership politics) with probabilities, on the home page and on company pages.

## Implementation paths

- `web/app.tsx`
- `web/canvas/parts.tsx`
- `worker/src/jev.ts`

## Required verification

- tests/jev.test.ts: 'mid-confidence primary readings apply tentatively…', 'low-confidence primary readings are never applied…'.
- tests/browser.spec.ts: 'an ask keeps the last view in place, a tentative reading replaces it, and chips describe the view on screen'.
- An ambiguous-meaning case in tools/eval-intents.mjs and a browser or jev test for the fork on the home page and on a company page.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Verified: tests/jev.test.ts 'mid-confidence primary readings apply tentatively…', 'low-confidence primary readings are never applied…' and 'live-probe regression (D8d): an ambiguous word forks between meanings…' (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)); tests/browser.spec.ts 'an ask keeps the last view in place, a tentative reading replaces it…' and 'an ambiguous word asks which meaning was intended, with model probabilities, on the home page and on a record' (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed); the D8d cases in docs/evaluation.md: a live run of node tools/eval-intents.mjs by the Jev group on 2026-09-22 (TypeSafe API, jev-1.13.0, intent prompt v5, 27 cases run 3 times): 65 of 81 calls fully correct, route 79 of 79, p50 178 ms and p95 345 ms, thresholds imported from the code, 5 misses and 2 validation errors recorded.
- [2026-09-22 21:41 UTC] Correction to the 21:11 entry: its evaluation figures (27 cases run 3 times, 65 of 81 calls fully correct, route 79 of 79, p50 178 ms and p95 345 ms) came from the first three runs and are not what the cited source says. The D8d meaning-fork cases in it passed in every run. docs/evaluation.md (re-read at 21:41 UTC; last changed at 20:58 UTC) states: 27 labeled cases run 4 times (108 calls) on the TypeSafe HTTP API, jev-1.13.0, intent prompt v5; 88 of 108 calls fully correct; route 106 of 106 answered calls; 2 validation errors (invalid_model_response); p50 169 ms and p95 297 ms pooled over the 106 answered calls (provider round trip from a development machine); 5 recorded misses. It measures the TypeSafe path only, not the Workers AI binding that production tries first.
- [2026-09-22 22:30 UTC] Correction to the 21:41 entry. docs/evaluation.md was rewritten at 21:48 UTC, after the 21:41 entry, so the figures that entry quotes are no longer its latest result (red-team finding RT-E1). Re-read for this entry, it states: 33 labeled cases run 4 times (132 calls) on the TypeSafe HTTP API, requested jev-latest and served jev-1.13.0, intent prompt shouldiworkthere-intent-v5, over the 224-employer directory; 111 of 132 cases correct (84%); 1 validation error (invalid_model_response, 'charlesschwab', fourth run); per-field rates over the calls whose case labels the field: employer 119 of 119, route 79 of 79, view 63 of 75, topic 64 of 68, case-specific checks 59 of 63; p50 193 ms and p95 269 ms pooled over the 131 answered calls (provider round trip from a development machine, not end to end). The 88 of 108, 2 errors, route 106 of 106 and p50 169 ms / p95 297 ms quoted at 21:41 are now given only as the same day's runs before the round-3 fixes (12-employer directory), rescored there with labeled-only denominators (route 27 of 27, not 106 of 106). The doc still measures only the TypeSafe path, not the Workers AI binding production tries first. Meaning forks: in the current four runs D8d is 12 of 12 with the route labeled, and the D8d controls ('are promotions fair', 'how toxic is …') 8 of 8. The 21:41 statement that the D8d cases passed in every earlier run held for the fork only: those runs did not label the route, and on the home page the fork came with the no-generation notice in 4 of 4 runs, fixed in round 3 (rule 5) and covered by tests/jev.test.ts 'live-probe regression (D8d)…' (passed in node --test "tests/*.test.ts" at 22:28 UTC). On the home page the view Choice was also unsure in all four current runs (asked in three, a view fork at 0.49 in one), so that page asks which view as well as offering the meanings. [read docs/evaluation.md sha256:e191adc39c3f]
- [2026-09-23 01:26 UTC] Correction to the 22:30 entry, and a pre-deploy change. docs/evaluation.md was rewritten again at 23:01 UTC; re-read for this entry, its latest four runs give D8d 12 of 12 with the route labeled and the D8d controls 8 of 8 (the 22:30 entry quotes the same counts from the earlier run, which the doc now gives as 'Earlier on the same day'). Its rule 5 still says that on the home page 'the interface asks which view as well'; that describes the behavior before the pre-deploy pass and is now out of date (a docs/evaluation.md correction for group A).
  Round-3 verification failure 3 (on the home page the meaning fork was not shown in 3 of 4 browser runs, because the view question hid it) and failure 4 (company forks listing zero-share employers such as '3M' and 'Abbott') were fixed in the pre-deploy pass: the meaning fork is the main clarification, asked first with its probabilities when another field must be asked, with no view question beside it, and no view is asked on the home page when no employer is in play (worker/src/jev.ts); forks other than meaning forks list only options at 0.12 or more, and company forks only employers the question plausibly names; the client shows the meaning first under 'What did you mean?', keeps the last canvas, hides a tentative fork with nothing left to offer and labels a share under 0.5% '<1% model probability' (web/forks.ts).
  Verified: tests/jev.test.ts 'D8d: a meaning fork takes precedence over an unsure view…', 'D8d: when another field must be asked…' and 'fork noise (round-3 verification, failure 4)…'; tests/web.test.ts 'a held reply leads with the meaning fork, whatever its tier…', 'tentative readings show a meaning first…', 'a fork option’s share is always labelled as the model’s…' and 'a reply without an employer offers no view that needs one'; tests/browser.spec.ts 'a held reply that hinges on an ambiguous word asks what was meant first…', 'an applied tentative meaning is offered first among tentative readings…' and 'with no employer named, the home page offers the meanings and never a view that needs an employer'; and, against live Jev, the tests/integration.mjs checks 'canvas D8d: …' (home page and northwind-labs) and 'canvas fork noise: …'. Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed. [read docs/evaluation.md sha256:94776266f9a2]
