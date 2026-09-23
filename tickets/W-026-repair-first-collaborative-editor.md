---
id: W-026
title: Repair-first collaborative editor
phase: Phase 10 - Constitutional moderation
status: DONE
depends_on: W-025
completed: 2026-09-22 21:11 UTC
---

# W-026 - Repair-first collaborative editor

**Phase:** Phase 10 - Constitutional moderation  
**Depends on:** W-025  
**Status:** DONE

## Scope

Local privacy highlighting, author-approved generalizations, separate flags for private names, contextual identifiers, personal characterizations and broad allegations. Explicit consent before hosted Jev sees scrubbed text; never silently rewrite testimony.

## Acceptance criteria

Raw draft produces no outbound requests; exact span edits preserve meaning and require approval; numeric anonymity guarantees are absent; factual criticism survives the repair process.

## Log

- [2026-09-22 05:27 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Dependency on W-023 replaced in round 3 by the technical prerequisites (see W-023's log): W-023 is the reconciliation umbrella and its acceptance includes deployment, so as a prerequisite it made this ticket unclosable before deploy while W-023 cannot close before it. Verified: tests/browser-contribute.spec.ts 'privacy editor: typing sends nothing…', 'make safer…', 'adversarial: a medium detail can be kept as written, a high one cannot…', 'write it my way…' and 'the draft reaches Jev only after explicit consent…' pass (npx playwright test tests/browser-contribute.spec.ts on 2026-09-22 21:06 UTC: 42 passed, 1 skipped (the opt-in screenshot pass)); numeric anonymity guarantees are absent (the meter says it is not a guarantee), and allegations are coached, never removed.
- [2026-09-22 22:30 UTC] Round-3 red-team findings RT-C2 and RT-C3 (Make safer leaves surnames and produces broken text) are tracked on W-058, reopened at 22:29 UTC with the reproductions. This ticket's criteria were re-checked against them: a raw draft still sends nothing, every change still needs its own approval and replaces only its exact span, no numeric anonymity guarantee is shown, and the criticism in the drafts survives. The approved generalizations break grammar ('on during that period', 'an staff engineer') while stating the same facts in general terms, and the unflagged full names ('Priya Raman', 'Tom Becker') are a detection gap now written into W-058's acceptance. So this ticket stays DONE; it is re-verified when W-058 closes.
- [2026-09-23 01:26 UTC] Round-3 and pre-deploy findings on the repair cards, recorded for this entry. The contributor journey found that the note-to-checks and personal-characterization cards could only reword, so the author could not simply delete the words; both cards now also offer removal, applied only on the author's approval (tests/browser-contribute.spec.ts 'make safer: a note addressed to the checks is marked whole, counted apart from identifying details, and its card removes it' and 'make safer: a personal characterization can be reworded or its sentence removed, each only when the author approves'). This ticket's criteria (author-approved changes only, exact spans, no invented anonymity score, consent before hosted Jev) still hold; the name-detection gap (RT-C2) is tracked on W-058. Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed.
