---
id: W-019
title: Test suite and privacy invariants
phase: Phase 6 - Assurance
status: DONE
depends_on: W-007, W-014
completed: 2026-09-23 01:28 UTC
---

# W-019 - Test suite and privacy invariants

**Phase:** Phase 6 - Assurance  
**Depends on:** W-007, W-014  
**Status:** DONE

## Scope

Unit tests for suppression thresholds, query compilation, credential lifecycle, privacy detector, intent validation, and release gating.

## Acceptance criteria

bun run test passes; each invariant has a named failing case that the test proves is blocked.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Tests
- [2026-09-22 05:05 UTC] 10 privacy/suppression unit tests and a 22 assertion integration suite (single-use credential, employer binding, claims held, privacy held, redaction required, nothing before its window, withdrawal, no sub-threshold cell published). All passing.
- [2026-09-22 05:12 UTC] REOPENED: Audit: need adversarial lifecycle and browser tests, not just same-path success tests.
- [2026-09-22 21:11 UTC] Rounds 1-3 grew the suite to 413 node tests and two Playwright suites with named failing cases for the invariants (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group); npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed; npx playwright test tests/browser-contribute.spec.ts on 2026-09-22 21:06 UTC: 42 passed, 1 skipped (the opt-in screenshot pass); an earlier back-to-back run of both suites at 21:01 UTC had 3 browser.spec.ts failures that did not recur). Still open: the suite must pass in full, and tests/integration.mjs, which used retired endpoints (audit E-04), is being rewritten against the local three-worker stack in round 3 (W-075).
- [2026-09-22 21:44 UTC] Group E's run at 21:43 UTC while other groups were still editing: npx tsc --noEmit exited 0; node --test "tests/*.test.ts": 431 of 433 passed. The 2 failures: tests/publication.test.ts 'Jev’s self-harm answer only offers the author support resources…' (edited at 21:43) and tests/web.test.ts 'every server-rendered page carries the legal links…' (/moderation lacks 'Challenges to published accounts: open to anyone.'). tests/integration.mjs was being edited at 21:43 and was not run.
- [2026-09-22 21:47 UTC] Group E's run at 21:47 UTC: npx tsc --noEmit exited 0; node --test "tests/*.test.ts": 432 of 433 passed. The one failure is tests/web.test.ts 'every server-rendered page carries the legal links…' (/moderation lacks 'Challenges to published accounts: open to anyone.'). This ticket still needs the full suite and tests/integration.mjs to pass.
- [2026-09-23 01:28 UTC] Closed: the two items the 21:11 and 21:47 entries left open are met. The full unit suite passes: node --test "tests/*.test.ts" at 2026-09-23 01:27–01:28 UTC ran 512 tests, 512 passed, 0 failed (npx tsc --noEmit was clean at 01:10 UTC). tests/integration.mjs, rewritten in round 3 against the local three-worker stack (W-075), passes: node tests/integration.mjs at 01:15 UTC, 106 passed, 0 failed. The browser suites passed too: npx playwright test tests/browser.spec.ts 53 passed and tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass), 01:12–01:15 UTC. Round 3 and the pre-deploy pass added named failing cases for each red-team finding they fixed (see W-023's round-3 red-team entry and the tickets it names). W-075's own acceptance, which asks more of tests/integration.mjs, stays open there.
