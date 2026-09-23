---
id: W-077
title: Independent verifier operator
ref: H8
phase: Phase 15 - Hardening
status: BLOCKED
depends_on: W-014
---

# W-077 - Independent verifier operator

**Phase:** Phase 15 - Hardening  
**Brief ref:** H8  
**Depends on:** W-014  
**Status:** BLOCKED

## Scope

Move the verifier Worker, its database and the issuer keys to an organization independent of the publisher's operator, so mailbox verification and testimony no longer share one cloud account.

## Acceptance criteria

- [ ] The verifier, its database and issuer keys run in an account controlled by an independent organization under a written agreement, and the publisher's operator has no access.
- [ ] The publisher trusts the verifier's keys only through the signed registry, and the watcher checks the verifier's deployment against its published release.
- [ ] The product and privacy policy name the verifier's operator and drop the same-account limitation only after the move.

## Implementation paths

- `issuer.wrangler.jsonc`
- `worker/issuer.ts`
- `tools/provision-issuer.mjs`
- `docs/operations.md`

## Required verification

- verify-deployment checks against the independent verifier origin; tests/protocol.test.ts key cross-check tests.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] BLOCKED: Needs an independent organization willing to operate the verifier, its database and the issuer keys under a written agreement.
