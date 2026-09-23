---
id: W-067
title: Fictional data labeled everywhere
ref: L6
phase: Phase 14 - Legal and liability
status: DONE
depends_on: W-005
completed: 2026-09-22 21:11 UTC
---

# W-067 - Fictional data labeled everywhere

**Phase:** Phase 14 - Legal and liability  
**Brief ref:** L6  
**Depends on:** W-005  
**Status:** DONE

## Scope

Every surface that shows sample employers or data carries the fictional label; samples never appear unlabeled in real-employer records, discovery or share images; no testimonials about the product anywhere.

## Acceptance criteria

- [x] Every surface that shows a sample employer or sample data carries the fictional label.
- [x] Samples never appear unlabeled in real-employer records, discovery or share images, and discovery separates real from fictional rows.
- [x] Fictional corroboration clusters are labeled illustrative wherever they are shown.
- [x] There are no testimonials about the product anywhere.

## Implementation paths

- `web/app.tsx`
- `web/canvas/views.tsx`
- `worker/src/evidence.ts`
- `worker/src/og.ts`

## Required verification

- tests/browser.spec.ts: 'fictional employers are labeled on every surface they appear'.
- tests/web.test.ts: 'share images label fictional employers and carry no statistics', 'page metadata names fictional employers as fictional…'; tests/evidence.test.ts: 'fictional employers are labeled in every headline…', 'discovery matches survey_ keys so real employers are found, separated from fictional rows'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Verified: tests/browser.spec.ts 'fictional employers are labeled on every surface they appear' (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed); tests/web.test.ts 'share images label fictional employers and carry no statistics' and 'page metadata names fictional employers as fictional…'; tests/evidence.test.ts 'fictional employers are labeled in every headline…', 'discovery matches survey_ keys so real employers are found, separated from fictional rows' and 'clusters respect cohort, layer and time filters…' (fixture clusters read 'Potentially related illustrative accounts') (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)). A search of web/, worker/src/, shared/ and docs/ on 2026-09-22 found no product testimonials.
- [2026-09-23 01:26 UTC] Round-3 red-team RT-C4 fixed: for fixture numbers the Evidence Lens now says 'These illustrative numbers were written as demonstration data, not collected from anyone.' instead of 'Numbers come from explicit questionnaire answers.' (tests/browser.spec.ts 'the evidence lens shows wording, sample size, period and release ids, and Escape returns focus to the number', passed in npx playwright test tests/browser.spec.ts (53 passed, 2026-09-23 01:12–01:14 UTC)). This ticket's criteria still hold.
- [2026-09-23 05:16 UTC] Since the launch release, production shows no fictional data (SAMPLE_EMPLOYERS 'off'; W-080), so these criteria now apply where the switch is 'on': local development and tests. There the labeling tests still pass (tests/web.test.ts 'share images label fictional employers and carry no statistics' and tests/evidence.test.ts 'fictional employers are labeled in every headline…' in node --test "tests/*.test.ts" at 05:01–05:02 UTC).
