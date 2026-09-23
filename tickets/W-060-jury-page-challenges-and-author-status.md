---
id: W-060
title: Jury page, challenges and author status
ref: U7
phase: Phase 13 - Brief gaps: interface
status: DONE
depends_on: W-053
completed: 2026-09-22 21:11 UTC
---

# W-060 - Jury page, challenges and author status

**Phase:** Phase 13 - Brief gaps: interface  
**Brief ref:** U7  
**Depends on:** W-053  
**Status:** DONE

## Scope

The /jury page, a challenge action on every published account, the author status and receipt page by capability, and the appeal action.

## Acceptance criteria

- [x] /jury uses blind juror tokens, one case at a time, an explicit YES/NO/UNSURE choice, says 'no case' in the server's words without spending the token, and discards refused or spent tokens.
- [x] Every published account offers a challenge under a cited published rule, with no special employer button; identifying reasons are blocked on the device.
- [x] /status shows receipts, jury state and the appeal from the server using only the capability, which never enters the address bar.
- [x] When no jury is operational the page says so and offers no token flow.

## Implementation paths

- `web/jury.tsx`
- `web/app.tsx`
- `worker/src/moderation.ts`

## Required verification

- tests/browser-contribute.spec.ts: 'jury: …', 'status: …', 'challenge: …', 'jury seam: the real /api/jury/assign reply…'.
- tests/browser.spec.ts: 'every published account offers a challenge under a published rule…', 'the jury and status routes render inside the site frame'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented in round 2. Verified: the 'jury:', 'status:' and 'challenge:' specs, 'jury seam: the real /api/jury/assign reply…' and 'juror tokens: a quota refusal says how many remain…' in tests/browser-contribute.spec.ts (npx playwright test tests/browser-contribute.spec.ts on 2026-09-22 21:06 UTC: 42 passed, 1 skipped (the opt-in screenshot pass)); tests/browser.spec.ts 'every published account offers a challenge under a published rule, with no special employer button' and 'the jury and status routes render inside the site frame' (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed).
- [2026-09-23 01:26 UTC] Pre-deploy pass (contributor and moderation journeys, fixed by the client with tests in tests/browser-contribute.spec.ts): the receipt now opens at the top with focus on its heading, so the outcome is seen and announced ('the receipt opens at the top with focus on its heading…'); after withdrawal the receipt no longer states the juror-review or sensitive-information permissions as still given ('after withdrawal the receipt describes the erased state…'); /status after withdrawal has one heading and a distinct explanation ('status: a withdrawn contribution has one heading and a distinct explanation…'); a practice challenge's Outcome field reads 'Recorded as a practice case', matching its heading, instead of 'Not accepted' ('challenge: a seeded fictional account is recorded as a practice case…'). Under policy 0.7.0 a published sandbox juror key is enough for a practice jury (tests/integration.mjs 'jury: a published sandbox juror key is enough for a practice jury (policy 0.7.0)'). This ticket's criteria still hold. Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed.
