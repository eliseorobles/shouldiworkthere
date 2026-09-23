---
id: W-064
title: Accessibility statement and fixes
ref: L3
phase: Phase 14 - Legal and liability
status: IN PROGRESS
depends_on: W-061
---

# W-064 - Accessibility statement and fixes

**Phase:** Phase 14 - Legal and liability  
**Brief ref:** L3  
**Depends on:** W-061  
**Status:** IN PROGRESS

## Scope

/accessibility states the WCAG 2.2 AA target, the known gaps and a contact, and the contrast, focus and keyboard issues are actually fixed.

## Acceptance criteria

- [ ] /accessibility states the WCAG 2.2 AA target, lists only gaps that still exist, and gives a contact.
- [ ] The contrast, focus and keyboard issues found in the audit are fixed and covered by browser specs run against the real stack.

## Implementation paths

- `worker/src/legal.ts`
- `worker/src/pages.ts`
- `web/styles.css`
- `docs/legal/accessibility.md`

## Required verification

- tests/browser.spec.ts: 'the evidence lens shows wording, sample size, period and release ids, and Escape returns focus to the number', 'every page carries the privacy, terms, accessibility and legal-requests links'.
- tests/web.test.ts: 'every server-rendered page carries the legal links, sentence-case headings and labelled tables'; tests/safety.test.ts legal render tests.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] The statement exists (docs/legal/accessibility.md), and tests/browser.spec.ts 'the evidence lens … Escape returns focus to the number' and 'every page carries the privacy, terms, accessibility and legal-requests links' pass (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed). Still open: re-audit the listed gaps after the U8 work (W-061).
- [2026-09-22 22:32 UTC] Re-read docs/legal/accessibility.md for this entry; it changed at 21:34 and 22:28 UTC, after the 21:11 entry. Version 1.1.0 states the WCAG 2.2 AA target and partial conformance, a contact, and five known gaps (checkboxes of 18 to 20 pixels, charts other than the trend charts not yet checked for text equivalents, the canvas needs JavaScript, no screen-reader or voice-control testing, contrast not checked over images or inside charts). It also says an automated check of the main pages in both themes found no text below 4.5:1, but no file in tests/ checks contrast, so that check is not reproducible from the repository and does not meet the second acceptance item ('covered by browser specs run against the real stack'). Still open as the 21:11 entry says. [read docs/legal/accessibility.md sha256:1d68bc8c3c5e]
- [2026-09-23 01:26 UTC] Accessibility fixes from the pre-deploy journeys, with tests: removing a chip with the keyboard dropped focus to the page body; focus now moves to the first remaining chip or the composer once the new view is shown (tests/browser.spec.ts 'removing a chip with the keyboard moves focus to a remaining control, never the page body'); the contribution receipt replaced the form while the page stayed scrolled down with focus on the body, so a screen-reader user got no confirmation; it now opens at the top with focus on its heading (tests/browser-contribute.spec.ts 'the receipt opens at the top with focus on its heading, so the outcome is seen and announced'). Both passed in the Playwright runs of 01:12–01:15 UTC. What was open is unchanged.
- [2026-09-23 05:16 UTC] Re-read docs/legal/accessibility.md for this entry; it was regenerated at 04:23 UTC, after the 22:32 entry. Changes: version 1.2.0, effective September 23, 2026; a sixth known gap, that the add-employer form and the proof-of-work wait (added September 23) have not been through the self-review or the automated scan and that the wait can take several seconds on a slow device; and 'the last review was on September 22, 2026'. It still says an automated check found no text below 4.5:1, and tests/ still has no contrast check, so the 22:32 entry holds. [read docs/legal/accessibility.md sha256:291bb9c81f5d]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/legal/accessibility.md for this entry. Version 1.2.0, effective September 23, 2026; the header now says it is recorded as approved by counsel on the owner's statement, so no draft notice. The known gaps still include the add-employer form and the proof-of-work wait, and it still says 'the last review was on September 22, 2026'. It still says an automated check found no text below 4.5:1, and tests/ still has no contrast check (no file under tests/ mentions contrast), so the 22:32 entry holds. [read docs/legal/accessibility.md sha256:71692d7206e6]
