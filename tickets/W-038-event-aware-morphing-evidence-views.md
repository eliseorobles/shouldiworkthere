---
id: W-038
title: Event-aware morphing evidence views
phase: Phase 11 - Jev acceptance
status: IN PROGRESS
depends_on: W-037
---

# W-038 - Event-aware morphing evidence views

**Phase:** Phase 11 - Jev acceptance  
**Depends on:** W-037  
**Status:** IN PROGRESS

## Scope

Implement company, comparison, timeline, distribution, cohort, source-reader and discovery views from a finite typed contract. Jev selects a view and parameters; SQL and code compute every value.

## Acceptance criteria

- [ ] A before/after question selects a real documented event; overlapping periods are excluded from before/after claims.
- [ ] Two-company comparisons align periods, metrics, cohort definitions and units; unavailable cells are explicit.
- [ ] Compensation market-perception answers never become invented pay percentiles.
- [ ] FAQ clicks transform the canvas into the corresponding visual grammar without generating prose.
- [ ] Unsupported views show an honest no-evidence state instead of a plausible-looking chart.

## Implementation paths

- `worker/src/evidence.ts`
- `web/app.tsx`
- `shared/faq.ts`

## Required verification

- For the example February 2025 restructuring, annual 2025 is not a clean before or after period.
- Compare fictional employers with unequal period coverage and inspect all n values.
- Choose a different event and verify the timeline changes to that event.
- Current/former and geography filters cannot be approximated by unrelated cohort dimensions.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Verified: tests/acceptance.test.ts 'event comparisons exclude periods overlapping the event and select the actual event', tests/evidence.test.ts 'before/after windows are bounded by adjacent documented events…' and 'comparison covers the union of metrics with explicit per-side availability', tests/api.test.ts 'a foreign event is refused by the evidence compiler…', and the single-documented-event rule (tests/jev.test.ts 'live-probe regression (D8c)…'; tests/browser.spec.ts 'an event chosen by the single-documented-event rule is an editable chip labeled as inferred'). Closes after W-037.
- [2026-09-23 01:26 UTC] Pre-deploy pass (reader journey and server fixes, with tests): the single-documented-event rule now decides whenever it applies, so 'after the 2025 restructuring at Northwind Labs' is labeled inferred whatever Jev's own confidence in the event (0.94 to 0.96 live), and a question naming a different year from the event's label asks instead (tests/jev.test.ts 'e2e regression (D8c): the inferred label follows the rule, not Jev's confidence, and never picks an event of another year'); the Inferred label and its note stay through other changes until the reader changes or confirms the event (tests/web.test.ts 'an inferred event keeps its label and note until the reader changes or confirms it'; tests/browser.spec.ts 'an inferred event keeps its label and note through other changes…'); in the timeline view a before/after chip the view does not apply reads '(not applied in this view)' with a notice, and an edited event chip puts the event's name, not its id, in the path (tests/web.test.ts 'a before/after choice the timeline does not apply is marked as not applied'; tests/browser.spec.ts 'an edited event chip names the event in the path, and a before/after choice the timeline does not apply says so'). Residual (server fix report): the year check reads the year only from the event label, so for an event whose label has no year a dated question is not checked. The doc comment on Chip in web/canvas/composer.tsx still says an inferred value is 'never Jev's own confident choice' (checked for this entry); the server fix report asks group C to reword it. Readers never see it. Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed.
