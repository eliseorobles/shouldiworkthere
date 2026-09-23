---
id: W-002
title: Cloudflare project bootstrap
phase: Phase 0 - Foundation
status: BLOCKED
depends_on: W-001, W-079
---

# W-002 - Cloudflare project bootstrap

**Phase:** Phase 0 - Foundation  
**Depends on:** W-001, W-079  
**Status:** BLOCKED

## Scope

D1 database creation, wrangler binding, isolated inference secrets, shouldiworkthere.com deployment, and local D1 parity.

## Acceptance criteria

Database IDs and bindings verified; local schema+migrations apply without deleting records; deploy target documented.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 04:52 UTC] Public and verifier D1 databases created; bindings wired.
- [2026-09-22 04:52 UTC] Public database (0ffebfaf) and verifier database (fd1a3561) created in account 4926f383. This first-pass shared deployment was superseded by the acceptance reconciliation.
- [2026-09-22 21:11 UTC] REOPENED: Audit E-05: the database ids logged at 04:52 were superseded by the shouldiworkthere-public, -intake and -verifier databases. Their bindings have not been verified against the account (rounds 1-3 ran no remote command by rule), the documented deploy target was the prototype, and the apex is not deployed. Closes when W-079 verifies the bindings and the apex.
- [2026-09-22 21:11 UTC] BLOCKED: waits on W-079 (blocked: External prerequisites: (1) the owner's authorization for a remote deploy (rounds 1-3 ran no remote command by rule); (2) the launch blockers listed by legalLaunchBlockers(): mail forwarding to privacy@, legal@ and dmca@ proven by a test message, and the model provider's entity, country, retention, training use and data processing agreement; (3) the owner's confirmation that zone features that inject scripts or cookies are off.)
- [2026-09-22 21:41 UTC] BLOCKED: waits on W-079 (blocked: The owner's authorization for a remote deploy (rounds 1-3 ran no remote command by rule). After the deploy, the owner must also switch off any zone feature that the header scan finds injecting scripts or cookies (Q5).)
- [2026-09-23 05:15 UTC] BLOCKED: waits on W-079 (blocked: The launch release of September 23, 2026 is in this checkout and not deployed (the last deploy, 01:45–02:55 UTC, was the round-3 release; see W-021). External prerequisites: (1) counsel's sign-off on the exact legal text being served (1.2.0), recorded as LEGAL_REVIEWED_VERSION in shared/brand.ts, which is null now, so every legal page would show 'Draft — pending attorney review' and legalLaunchBlockers() lists 'change-notice'; then the read-only query of docs/operations.md step 0 must show no real contribution submitted under 1.1.0 still waiting. The only statement that counsel approved came from workflow-generated task text, not from the owner. (2) The owner's authorization for the remote steps, which no agent runs: INTERNAL_TOKEN on both workers, the pending remote migrations, the sample purge, provisioning without samples, and the deploy in the D9 order. [read docs/operations.md sha256:98f2532f049c])
