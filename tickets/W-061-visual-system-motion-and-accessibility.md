---
id: W-061
title: Visual system, motion and accessibility
ref: U8
phase: Phase 13 - Brief gaps: interface
status: IN PROGRESS
depends_on: W-003
---

# W-061 - Visual system, motion and accessibility

**Phase:** Phase 13 - Brief gaps: interface  
**Brief ref:** U8  
**Depends on:** W-003  
**Status:** IN PROGRESS

## Scope

Keep the DeepSeek-inspired direction; remove all-caps eyebrow chrome and middle-dot meta strings; WCAG AA contrast for trust microcopy; dark mode; one orchestrated motion moment (canvas morph through view transitions) plus action-driven motion only; reduced motion respected; visible keyboard focus; no overflow at 390px.

## Acceptance criteria

- [ ] No all-caps eyebrow chrome and no middle-dot meta strings in the product UI or trust pages.
- [ ] Trust microcopy meets WCAG AA contrast in light and dark, and keyboard focus is visible, including in forced-colors mode.
- [ ] Dark mode follows the system and the theme switch stores only an explicit choice.
- [ ] Exactly one orchestrated canvas morph through view transitions, with none (including the view-transition group) when reduced motion is requested.
- [ ] At 390px no page scrolls sideways.

## Implementation paths

- `web/styles.css`
- `web/app.tsx`
- `worker/src/pages.ts`

## Required verification

- tests/browser.spec.ts: 'dark mode follows the system…', 'one orchestrated morph between views, and none when reduced motion is requested', 'at 390px wide nothing overflows horizontally…'.
- tests/browser-contribute.spec.ts: '390px: contribution, jury and status pages do not scroll sideways'; tests/web.test.ts: 'every server-rendered page carries the legal links, sentence-case headings and labelled tables'.
- Run against the real three-worker stack, not only a harness.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Verified: tests/browser.spec.ts 'dark mode follows the system…', 'one orchestrated morph between views, and none when reduced motion is requested' and 'at 390px wide nothing overflows horizontally…' (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed); reduced motion also stops ::view-transition-group. Still open: no automated contrast check runs in the suites (round 2 used scratch scripts), and tests/web.test.ts 'every server-rendered page carries the legal links, sentence-case headings and labelled tables' failed at the 21:00 UTC run while pages.ts was being edited.
- [2026-09-23 01:26 UTC] Round-3 verification failure 2 fixed in the pre-deploy polish: the dark-mode test contradicted the suite's own Live setup; it now checks storage before and after each theme action (before, only the siwt-live 'off' the suite seeds; choosing light adds only siwt-theme 'light'; returning to the system theme leaves storage as it started): tests/browser.spec.ts 'dark mode follows the system, and the theme switch stores only an explicit choice', passed in npx playwright test tests/browser.spec.ts (53 passed, 2026-09-23 01:12–01:14 UTC). What was open is unchanged.
