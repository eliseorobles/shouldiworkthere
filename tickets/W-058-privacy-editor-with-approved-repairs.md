---
id: W-058
title: Privacy editor with approved repairs
ref: U5
phase: Phase 13 - Brief gaps: interface
status: IN PROGRESS
depends_on: W-013
---

# W-058 - Privacy editor with approved repairs

**Phase:** Phase 13 - Brief gaps: interface  
**Brief ref:** U5  
**Depends on:** W-013  
**Status:** IN PROGRESS

## Scope

Risk tokens highlighted inline, a sequential 'Make safer' approval flow, an identifying-details meter from real findings with a not-a-guarantee note, the Jev contextual check after consent, repair cards for names, personal characterizations and broad allegations, and undo.

## Acceptance criteria

- [ ] Risk tokens are marked inline (high/medium) from on-device findings, and typing sends nothing.
- [ ] 'Make safer' walks each proposed edit in order and changes only what the author approves; a medium detail may be kept as written, a high one may not.
- [ ] The meter counts only real findings and says it is not an anonymity guarantee.
- [ ] Repair cards ask what specifically happened and change the text only with the author's own approved words.
- [ ] Undo restores exactly the edited words and refuses visibly when later typing touched them.
- [ ] The hosted Jev check runs only after explicit consent and never while a must-change detail remains.
- [ ] A person's full name is found and replaced as a whole, including a name set off by commas ('Our director, Priya Raman, …'); approving it leaves no first name or surname of that person elsewhere in the draft ('… Lee said', '… Becker was').
- [ ] Approved suggestions leave grammatical text: no stranded preposition ('on during that period'), 'a' and 'an' agree with the next word ('an staff engineer'), and a replacement at the start of a sentence keeps its capital.

## Implementation paths

- `web/submit.tsx`
- `shared/privacy.ts`

## Required verification

- tests/browser-contribute.spec.ts: 'privacy editor: typing sends nothing…', 'make safer: …', 'adversarial: a medium detail can be kept as written…', 'write it my way: …', 'the draft reaches Jev only after explicit consent…', 'invariant: …', 'undo refuses…'.
- A test (tests/web.test.ts or tests/browser-contribute.spec.ts) that approving every suggestion for the docs/demo.md Flow 2 draft and for 'Our director, Priya Raman, yelled at Tom Becker … Later Raman said Becker was lazy' leaves no name part and no broken grammar (red-team RT-C2 and RT-C3).

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Verified: npx playwright test tests/browser-contribute.spec.ts on 2026-09-22 21:06 UTC: 42 passed, 1 skipped (the opt-in screenshot pass), including 'privacy editor: typing sends nothing; inline marks and the meter come only from on-device findings', 'make safer: each edit changes only what the author approved, one at a time, and undo restores the words', 'adversarial: a medium detail can be kept as written, a high one cannot…', 'write it my way…', 'the draft reaches Jev only after explicit consent, never while a must-change detail remains…', 'undo refuses, visibly and without changing anything…' and the three 'invariant:' specs.
- [2026-09-22 22:29 UTC] REOPENED: Red-team findings RT-C2 and RT-C3 (round 3 hardening), reproduced in Chromium on the local stack just before this entry (/submit, approving every 'Make safer' suggestion in order). RT-C3, broken text: the docs/demo.md Flow 2 draft becomes 'my manager told me on during that period that an staff engineer in a field location would be let go before the review. Call me at a phone number if you need details.' (a stranded 'on', 'an staff', and the sentence's capital lost). RT-C2, surnames left: 'Dana Lee' is split into two suggestions ('My manager Dana' to 'my manager', then 'my manager Lee' to 'my manager'), so approving the first leaves the surname; in 'Our director, Priya Raman, yelled at Tom Becker in front of the team. Later Raman said Becker was lazy and should quit.' the only suggestion is 'Later Raman' to 'the person involved' (leaving 'the person involved said' in lower case), after which 'Priya Raman', 'Tom Becker' and 'Becker' remain and the review list is empty. What the 21:11 entry verified still holds (nothing changes without approval, undo, consent before the Jev check); the U5 repair for names and the quality of approved edits do not. The acceptance now includes the whole-name and grammar criteria; this ticket closes again when tests for them pass. [read docs/demo.md sha256:ba459b57bb03]
- [2026-09-22 22:33 UTC] Re-read docs/demo.md for this entry; it changed at 22:32 UTC, after the reopening entry. Flow 2 keeps the same draft, now quotes the broken result of approving every suggestion ('my manager told me on during that period that an staff engineer in a field location …'), records that the name took two approvals, and scripts a workaround on camera ('Write it my way' for the role and the date, then direct edits). The reproductions in the reopening entry still match the doc and the code (web/submit.tsx last modified 21:45 UTC, shared/privacy.ts 06:16 UTC). [read docs/demo.md sha256:1a161b09a61d]
- [2026-09-22 22:40 UTC] Re-read docs/demo.md for this entry; it changed again at 22:34 UTC (Flow 1 wording only); the 22:33 entry holds. Observed in Chromium on the local stack just before this entry, after web/submit.tsx and shared/privacy.ts changed at 22:36 and 22:34 UTC and the client was rebuilt at 22:37 UTC: approving every suggestion for the docs/demo.md Flow 2 draft now gives 'My manager told me around then that a staff engineer in a field location would be let go before the review.', so RT-C3 no longer reproduces on that draft. RT-C2 still does: for 'Our director, Priya Raman, yelled at Tom Becker in front of the team. Later Raman said Becker was lazy and should quit.' the only suggestion is 'Our director, Priya Raman,' to 'The person involved', after which 'Tom Becker', 'Raman' and 'Becker' remain and the review list is empty. No test for the new criteria exists yet (tests/web.test.ts last changed at 22:00 UTC, tests/browser-contribute.spec.ts at 21:35 UTC). This ticket stays IN PROGRESS. [read docs/demo.md sha256:1d9b868b8833]
- [2026-09-23 01:26 UTC] Re-read docs/demo.md for this entry (changed at 00:45 UTC; see W-022: its Flow 2 quote of the all-approve output is from an earlier build). Status of the two red-team criteria added at 22:29 UTC:
  - RT-C3 (grammar) is fixed and tested: tests/browser-contribute.spec.ts 'invariant: suggested edits read as sentences: articles, sentence capitals, dates with their preposition, contact sentences removed' and 'make safer: approving every edit of the demonstration draft leaves a grammatical account with no name, date or contact detail'; tests/web.test.ts 'suggested generalizations read as sentences…'.
  - RT-C2 (names) is fixed only in part. Tested and passing: a role followed by a full name, two-letter surnames, appositive commas and 'reporting to' (tests/browser-contribute.spec.ts 'invariant: approving every suggested edit removes a name whole…', tests/web.test.ts 'the on-device detector takes a whole name…'). Still failing, reproduced for this entry at 01:09 UTC by bundling the page's own reviewItems and applyEdit (web/submit.tsx) and scanText (shared/privacy.ts) and approving every suggestion: 'Our director, Priya Raman, yelled at Tom Becker in front of the team. Later Raman said Becker was lazy and should quit.' becomes 'The person involved yelled at Tom Becker in front of the team. Later Raman said Becker was lazy and should quit.' with no finding left, so the meter reads zero while 'Tom Becker', 'Raman' and 'Becker' remain. A full name after a preposition and a later bare surname are not detected. The criterion '… leaves no first name or surname of that person elsewhere in the draft' is not met, so this ticket stays IN PROGRESS.
  Pre-deploy pass (contributor journey, fixed by the client and server with tests): a note addressed to the checks is highlighted whole, counted apart from identifying details, and its card removes it; a personal characterization can be reworded or its sentence removed, with a preview; the meter and the approval message count identifying details only; notes to reviewers are now caught anywhere in a draft, by the same shared/privacy.ts code on the device and in both server scans (tests/browser-contribute.spec.ts 'make safer: a note addressed to the checks is marked whole…', 'make safer: the approval message counts identifying details only…', 'make safer: a personal characterization can be reworded or its sentence removed…'; tests/privacy.test.ts 'a note to reviewers is caught anywhere in a draft…' and 'the wider reviewer-note detection still leaves narrative about reviews, notes and moderation alone'). Residuals: 'Remove the sentence' removes the whole sentence around a characterization, including account content (a preview is shown first); a note paraphrased past the detector can still reach the hosted check (RT-ABUSE-01). Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed. [read docs/demo.md sha256:ca16c79e5c74]
- [2026-09-23 05:16 UTC] Re-read docs/demo.md for this entry; it changed at 04:23 UTC, after the 01:26 entry. Flow 2 keeps the same demonstration draft and still quotes the earlier build's all-approve output with two manual edits (see W-022). The document's change does not affect RT-C2 or RT-C3, so the 01:26 entry holds; the flows now run on a local copy only. [read docs/demo.md sha256:a7ff05b71df5]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/demo.md for this entry. Flow 2 keeps the same demonstration draft and the earlier build's all-approve output with two edits by hand, and step 4 still names policy 0.6.0. RT-C2 and RT-C3 are unaffected, so the 01:26 entry holds. [read docs/demo.md sha256:a62c6afdddb8]
