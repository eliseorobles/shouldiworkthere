---
id: W-020
title: Jev intent evaluation harness
phase: Phase 6 - Assurance
status: DONE
depends_on: W-006
completed: 2026-09-22 21:11 UTC
---

# W-020 - Jev intent evaluation harness

**Phase:** Phase 6 - Assurance  
**Depends on:** W-006  
**Status:** DONE

## Scope

Labeled query corpus covering view selection, cohort extraction, company disambiguation, clarification cases, and adversarial phrasing; reports accuracy and confidence calibration; documents thresholds chosen from results.

## Acceptance criteria

Harness runs against live Jev and reports per-class accuracy plus the thresholds actually used; mismatches are recorded, not hidden.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Jev eval harness
- [2026-09-22 05:05 UTC] tools/eval-intents.mjs imports the real interpreter; 12-case labeled corpus; 10/12 (83%) with 126ms median; both mismatches recorded in docs/evaluation.md including the one where a fork saves it and the one where it does not.
- [2026-09-22 21:11 UTC] REOPENED: Audit E-07 (high) and C-15: the harness counted fallbacks as Jev runs, covered intent only, and docs/evaluation.md recorded an earlier prompt version with no p95.
- [2026-09-22 21:11 UTC] Round 1 made fallbacks and malformed answers ERROR rows that are never counted as Jev results, and the harness builds each case with the inference worker's own intentInput (tests/jev.test.ts 'the evaluation harness interprets exactly the input production builds…'). Round 3 ran it live: docs/evaluation.md: a live run of node tools/eval-intents.mjs by the Jev group on 2026-09-22 (TypeSafe API, jev-1.13.0, intent prompt v5, 27 cases run 3 times): 65 of 81 calls fully correct, route 79 of 79, p50 178 ms and p95 345 ms, thresholds imported from the code, 5 misses and 2 validation errors recorded, with per-field and per-group accuracy. Relevance ranking and policy signals are not measured by it; that is W-044.
- [2026-09-22 21:41 UTC] Correction to the 21:11 entry: its evaluation figures (27 cases run 3 times, 65 of 81 calls fully correct, route 79 of 79, p50 178 ms and p95 345 ms) came from the first three runs and are not what the cited source says. docs/evaluation.md (re-read at 21:41 UTC; last changed at 20:58 UTC) states: 27 labeled cases run 4 times (108 calls) on the TypeSafe HTTP API, jev-1.13.0, intent prompt v5; 88 of 108 calls fully correct; route 106 of 106 answered calls; 2 validation errors (invalid_model_response); p50 169 ms and p95 297 ms pooled over the 106 answered calls (provider round trip from a development machine); 5 recorded misses. It measures the TypeSafe path only, not the Workers AI binding that production tries first.
- [2026-09-22 22:30 UTC] Correction to the 21:41 entry. docs/evaluation.md was rewritten at 21:48 UTC, after the 21:41 entry, so the figures that entry quotes are no longer its latest result (red-team finding RT-E1). Re-read for this entry, it states: 33 labeled cases run 4 times (132 calls) on the TypeSafe HTTP API, requested jev-latest and served jev-1.13.0, intent prompt shouldiworkthere-intent-v5, over the 224-employer directory; 111 of 132 cases correct (84%); 1 validation error (invalid_model_response, 'charlesschwab', fourth run); per-field rates over the calls whose case labels the field: employer 119 of 119, route 79 of 79, view 63 of 75, topic 64 of 68, case-specific checks 59 of 63; p50 193 ms and p95 269 ms pooled over the 131 answered calls (provider round trip from a development machine, not end to end). The 88 of 108, 2 errors, route 106 of 106 and p50 169 ms / p95 297 ms quoted at 21:41 are now given only as the same day's runs before the round-3 fixes (12-employer directory), rescored there with labeled-only denominators (route 27 of 27, not 106 of 106). The doc still measures only the TypeSafe path, not the Workers AI binding production tries first. The harness change behind the rescoring (a field a case leaves open is never counted as correct) is documented under 'How cases are scored'; it is not covered by a test (tests/jev.test.ts only checks that the harness builds production's intentInput). Per-class accuracy, the thresholds in force and every miss are still recorded, which is this ticket's acceptance. [read docs/evaluation.md sha256:e191adc39c3f]
- [2026-09-23 01:26 UTC] Correction to the 22:30 entry. docs/evaluation.md was rewritten again at 23:01 UTC, after that entry; the figures it quotes (33 cases, 111 of 132, 1 validation error, p50 193 ms, p95 269 ms) are now given as the same day's earlier run. Re-read for this entry, the latest result is 37 labeled cases (4 red-team cases added) run 4 times: 128 of 148 correct (86%), 2 validation errors, employer 134 of 134, route 88 of 88, view 72 of 82, topic 63 of 67, case-specific checks 64 of 68, answer checks 15 of 15, p50 219 ms and p95 788 ms over the 146 answered calls, TypeSafe path only. The harness gained answer checks (the main worker's canvas assembles the answer from the interpretation Jev returned, with no second model call), a --runs option and a --screen mode: 8 labeled drafts run twice, 16 of 16 correct, 6 held before any model call, 10 model calls at p50 129 ms and p95 353 ms, which the doc calls a regression net for RT-ABUSE-01, not a moderation accuracy claim. Per-group results, the thresholds in force and every miss (5 recorded misses, the 2 errors and 1 observation) are still recorded, which is this ticket's acceptance. No cases were added in the pre-deploy pass; group A's fix report proposes an 'inferred' check on the restructuring cases and a named-group check on the D8d home-page case. Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed. [read docs/evaluation.md sha256:94776266f9a2]
