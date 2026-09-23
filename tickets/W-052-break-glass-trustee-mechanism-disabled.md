---
id: W-052
title: Break-glass trustee mechanism, disabled
ref: G7
phase: Phase 12 - Brief gaps: evidence engine
status: DONE
depends_on: W-015
completed: 2026-09-22 21:11 UTC
---

# W-052 - Break-glass trustee mechanism, disabled

**Phase:** Phase 12 - Brief gaps: evidence engine  
**Brief ref:** G7  
**Depends on:** W-015  
**Status:** DONE

## Scope

The 2-of-3 trustee exception mechanism implemented and tested but switched off: no trustee keys are configured, so the product says trustee exceptions are off. Enabling it with independent trustees is W-032.

## Acceptance criteria

- [x] Trustees sign a domain-separated message bound to the deployment origin over action, one named account, expiry and nonce; one signature, a repeated trustee, a revoked trustee, a forged or expired action, an over-long expiry and another deployment's origin are refused; two distinct trustees pass.
- [x] A nonce works once; the expiry is recorded before the public transparency entry and the account is withheld only after that entry; the account returns when the exception lapses; an interrupted exception is completed only if it was logged, and never acts otherwise.
- [x] With TRUSTEE_KEYS unset the route answers 503, no normal route can remove an account, and every page that mentions trustee exceptions says they are off.

## Implementation paths

- `shared/trustees.ts`
- `worker/src/moderation.ts`
- `shared/policy.ts`

## Required verification

- tests/moderation.test.ts: 'trustee signatures: one signature, the same trustee twice…', 'break-glass is disabled while TRUSTEE_KEYS is unset…', 'with three trustee keys, two signatures withhold one named account…', 'an interrupted trustee exception never leaves a hold without an end…', 'the site worker serves the moderation routes with its origin check, and break-glass stays disabled through it'.
- tests/safety.test.ts: 'legal: switches come from env and the same checks the moderation module applies'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented in round 2 and disabled (TRUSTEE_KEYS unset). Verified: tests/moderation.test.ts 'trustee signatures: one signature, the same trustee twice, a revoked trustee…', 'break-glass is disabled while TRUSTEE_KEYS is unset, and no normal route can remove an account', 'with three trustee keys, two signatures withhold one named account until expiry…', 'an interrupted trustee exception never leaves a hold without an end…' and 'the site worker serves the moderation routes with its origin check, and break-glass stays disabled through it' pass (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)).
- [2026-09-23 01:26 UTC] Round-3 red-team RT-ABUSE-06 fixed: an exception can be renewed while it is in force (its own record, public log entry and receipt), and the account is restored only when the last exception naming it lapses (tests/moderation.test.ts 'RT-ABUSE-06: a trustee exception is renewed while in force…'). The mechanism stays disabled: /api/exception answers 503 without trustee keys (tests/integration.mjs 'exception: the trustee route answers 503 while no trustee keys are configured', passed at 01:15 UTC).
