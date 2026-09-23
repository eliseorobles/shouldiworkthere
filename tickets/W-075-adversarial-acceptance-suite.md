---
id: W-075
title: Adversarial acceptance suite
ref: H6
phase: Phase 15 - Hardening
status: IN PROGRESS
depends_on: W-019
---

# W-075 - Adversarial acceptance suite

**Phase:** Phase 15 - Hardening  
**Brief ref:** H6  
**Depends on:** W-019  
**Status:** IN PROGRESS

## Scope

One suite that attacks the running three-worker stack the way an employer, a coordinated group or a curious operator would, and records what it cannot prevent.

## Acceptance criteria

- [ ] tests/integration.mjs runs against the local three-worker stack with one command and covers forged, expired, replayed and wrong-employer proofs; differencing by withdrawal; crafted links; identifier-bearing payloads toward inference; prompt injection in challenge reasons and passages; coordinated and duplicate challenges; juror-token replay and seat concentration; and trustee-signature abuse.
- [ ] Every case asserts the refusal, and outcomes the system cannot prevent (for example one person holding several juror tokens) are recorded in the docs, not hidden.
- [ ] The suite fails on any regression.

## Implementation paths

- `tests/integration.mjs`
- `tests/acceptance.test.ts`
- `tests/moderation.test.ts`

## Required verification

- tests/integration.mjs against http://localhost:8788, :8789 and :8790; tests/acceptance.test.ts; tests/moderation.test.ts 'prompt-injection text…', 'frivolous challenges cannot suppress…'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] The in-process adversarial cases pass (tests/acceptance.test.ts; tests/moderation.test.ts 'prompt-injection text in a reason or a passage cannot change a deterministic outcome', 'frivolous challenges cannot suppress…'). In progress in round 3: tests/integration.mjs rewritten against the local three-worker stack.
- [2026-09-23 01:26 UTC] node tests/integration.mjs against the local three-worker stack at 01:15 UTC: 106 passed, 0 failed, no WARN, with one command and a random TEST-NET client address. Covered live: consents enforced, identifier gates before any hosted call, a blind sandbox credential redeemed once, withdrawal by the device key only, challenges (protection, practice case, daily budget of 5, one budget per IPv6 /64), the local-key checks, the juror no-case path, the disabled trustee route, the verifier's exact routes and body cap, and no identifier, cookie or risk signal in any reply. Still missing from the suite against this ticket's acceptance: forged, expired and wrong-employer proofs, differencing by withdrawal, crafted links, prompt injection in challenge reasons and passages, juror-token replay and seat concentration, and trustee-signature abuse run against the live stack (they are covered in-process by tests/acceptance.test.ts, tests/moderation.test.ts, tests/protocol.test.ts and tests/web.test.ts, and crafted links also by the Playwright suite). This ticket stays in progress.
