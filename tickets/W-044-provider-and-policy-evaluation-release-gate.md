---
id: W-044
title: Provider and policy evaluation release gate
phase: Phase 11 - Jev acceptance
status: IN PROGRESS
depends_on: W-036, W-037, W-040, W-043
---

# W-044 - Provider and policy evaluation release gate

**Phase:** Phase 11 - Jev acceptance  
**Depends on:** W-036, W-037, W-040, W-043  
**Status:** IN PROGRESS

## Scope

Evaluate the actual runtime contracts with labeled normal, ambiguous, adversarial and privacy-sensitive cases. Separate deterministic guarantees from model quality and publish all misses.

## Acceptance criteria

- [ ] Intent, per-dimension classification, relevance ranking and policy signals have separate measured results.
- [ ] Fallbacks are not counted as successful Jev runs, and malformed responses fail closed.
- [ ] Publish sample size, model version, p50/p95 end-to-end latency, mismatch list and threshold rationale.
- [ ] Human/peer/trustee features are not labeled done without operating eligibility and custody evidence.

## Implementation paths

- `tools/eval-intents.mjs`
- `tests/acceptance.test.ts`
- `tests/browser.spec.ts`
- `docs/evaluation.md`

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Intent is measured: docs/evaluation.md: a live run of node tools/eval-intents.mjs by the Jev group on 2026-09-22 (TypeSafe API, jev-1.13.0, intent prompt v5, 27 cases run 3 times): 65 of 81 calls fully correct, route 79 of 79, p50 178 ms and p95 345 ms, thresholds imported from the code, 5 misses and 2 validation errors recorded. Still open: relevance ranking, per-dimension analysis and policy (screening and relevance) signals have no separate measured results, and the native Workers AI path is unmeasured. Human, peer and trustee features stay labeled off.
- [2026-09-22 21:41 UTC] Correction to the 21:11 entry: its evaluation figures (27 cases run 3 times, 65 of 81 calls fully correct, route 79 of 79, p50 178 ms and p95 345 ms) came from the first three runs and are not what the cited source says. docs/evaluation.md (re-read at 21:41 UTC; last changed at 20:58 UTC) states: 27 labeled cases run 4 times (108 calls) on the TypeSafe HTTP API, jev-1.13.0, intent prompt v5; 88 of 108 calls fully correct; route 106 of 106 answered calls; 2 validation errors (invalid_model_response); p50 169 ms and p95 297 ms pooled over the 106 answered calls (provider round trip from a development machine); 5 recorded misses. It measures the TypeSafe path only, not the Workers AI binding that production tries first.
- [2026-09-22 22:30 UTC] Correction to the 21:41 entry. docs/evaluation.md was rewritten at 21:48 UTC, after the 21:41 entry, so the figures that entry quotes are no longer its latest result (red-team finding RT-E1). Re-read for this entry, it states: 33 labeled cases run 4 times (132 calls) on the TypeSafe HTTP API, requested jev-latest and served jev-1.13.0, intent prompt shouldiworkthere-intent-v5, over the 224-employer directory; 111 of 132 cases correct (84%); 1 validation error (invalid_model_response, 'charlesschwab', fourth run); per-field rates over the calls whose case labels the field: employer 119 of 119, route 79 of 79, view 63 of 75, topic 64 of 68, case-specific checks 59 of 63; p50 193 ms and p95 269 ms pooled over the 131 answered calls (provider round trip from a development machine, not end to end). The 88 of 108, 2 errors, route 106 of 106 and p50 169 ms / p95 297 ms quoted at 21:41 are now given only as the same day's runs before the round-3 fixes (12-employer directory), rescored there with labeled-only denominators (route 27 of 27, not 106 of 106). The doc still measures only the TypeSafe path, not the Workers AI binding production tries first. What is still open is unchanged: relevance ranking, per-dimension analysis and the policy signals have no separate measured results, and the native Workers AI path is unmeasured. [read docs/evaluation.md sha256:e191adc39c3f]
- [2026-09-23 01:26 UTC] Correction to the 22:30 entry. docs/evaluation.md was rewritten again at 23:01 UTC, after that entry. Re-read for this entry, its latest intent result is 37 labeled cases run 4 times on the TypeSafe path: 128 of 148 correct, 2 validation errors, employer 134 of 134, route 88 of 88, view 72 of 82, topic 63 of 67, answer checks 15 of 15, p50 219 ms and p95 788 ms over 146 answered calls; the 33-case figures the 22:30 entry quotes are now the same day's earlier run. New since that entry: a screening evaluation (red-team RT-ABUSE-01), 8 drafts run twice, 16 of 16 correct, 6 held before any model call, TypeSafe only. It records that the guarded prompt alone does not hold the original reviewer-note payload (personal attack 0.69 to 0.74, cleared), and that the candidate addressed_to_checks signal read 0.93 to 0.99 on the notes and up to 0.75 on a review-vocabulary control; the signal is not in the published policy, so it is not asked. Still open, unchanged: relevance ranking and per-dimension analysis have no measured results, screening is measured on 8 drafts only, and the native Workers AI path is unmeasured. The interpreter changes of the pre-deploy pass are covered by tests but not re-measured (see W-006). [read docs/evaluation.md sha256:94776266f9a2]
