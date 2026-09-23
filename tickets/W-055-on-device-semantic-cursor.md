---
id: W-055
title: On-device semantic cursor
ref: U2
phase: Phase 13 - Brief gaps: interface
status: IN PROGRESS
depends_on: W-008
---

# W-055 - On-device semantic cursor

**Phase:** Phase 13 - Brief gaps: interface  
**Brief ref:** U2  
**Depends on:** W-008  
**Status:** IN PROGRESS

## Scope

While typing, with Live off or on, deterministic local matching of directory names and aliases, group labels, event labels and a topic lexicon produces transient annotations under the matched words, with no network. Server annotations replace them on submit or Live.

## Acceptance criteria

- [ ] Local matching of names, aliases, groups, events and topics runs on the device with exact offsets and makes no network or storage call.
- [ ] Jev's annotations replace the local ones on submit or Live; they cover only applied concepts, never overlap, and never state a population count.
- [ ] Medium-confidence chips show a '?' affordance that opens the clarification.

## Implementation paths

- `web/canvas/composer.tsx`
- `web/local-intent.ts`
- `worker/src/jev.ts`

## Required verification

- tests/web.test.ts: 'the semantic cursor matches directory names, groups, events and topics on the device, with exact offsets', 'cursor segments reproduce the text exactly…', 'the on-device modules cannot reach the network or storage'.
- tests/jev.test.ts: 'annotations locate only applied concepts in the query text, without overlaps'; tests/browser.spec.ts: 'typing stays on this device until an explicit submit, and the semantic cursor recognises concepts locally'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented in round 2. Verified: tests/web.test.ts 'the semantic cursor matches directory names, groups, events and topics on the device, with exact offsets' and 'the on-device modules cannot reach the network or storage', tests/jev.test.ts 'annotations locate only applied concepts in the query text, without overlaps' (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)); tests/browser.spec.ts 'typing stays on this device until an explicit submit, and the semantic cursor recognises concepts locally' (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed).
- [2026-09-22 21:41 UTC] REOPENED: Acceptance item 3 (medium-confidence chips show a '?' affordance that opens the clarification) has no test. The code renders it (web/canvas/composer.tsx: the chip-tentative class, the chip-q mark and the hidden label 'uncertain: choose to confirm or change'), but no file in tests/ refers to it, and none of the tests cited at 21:11 covers it. Closes again with a tests/browser.spec.ts case, requested from the client group, that a tentative chip shows the '?' and opens its clarification.
