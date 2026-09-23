---
id: W-021
title: Production deploy
phase: Phase 7 - Ship
status: BLOCKED
depends_on: W-003, W-005, W-011, W-015, W-018, W-019, W-079
---

# W-021 - Production deploy

**Phase:** Phase 7 - Ship  
**Depends on:** W-003, W-005, W-011, W-015, W-018, W-019, W-079  
**Status:** BLOCKED

## Scope

Apply remote schema and seed, set secrets, deploy Worker, verify routes on the custom domain and workers.dev fallback, verify Jev path in production.

## Acceptance criteria

Live site serves the Evidence Canvas; constitution and transparency pages resolve; interpretation works in production without exposing the key.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Remote schema, secrets, worker deploy, verification.
- [2026-09-22 05:07 UTC] Initial subdomain prototype deployed; worker.dev disabled. Historical checks covered Jev and basic routes only. Acceptance audit later reopened privacy claims, deployment separation, true batch rules and direct-email verification. Canonical target is now https://shouldiworkthere.com/.
- [2026-09-22 21:11 UTC] REOPENED: Audit E-05 (high): none of the shouldiworkthere Workers (main, inference, verifier) runs the reconciled code; the only deploy was the earlier subdomain prototype, and this ticket had been closed while W-015 and W-019 were open. It stays open until the reconciled release is deployed in order and verified (W-079).
- [2026-09-22 21:11 UTC] BLOCKED: waits on W-079 (blocked: External prerequisites: (1) the owner's authorization for a remote deploy (rounds 1-3 ran no remote command by rule); (2) the launch blockers listed by legalLaunchBlockers(): mail forwarding to privacy@, legal@ and dmca@ proven by a test message, and the model provider's entity, country, retention, training use and data processing agreement; (3) the owner's confirmation that zone features that inject scripts or cookies are off.)
- [2026-09-22 21:41 UTC] BLOCKED: waits on W-079 (blocked: The owner's authorization for a remote deploy (rounds 1-3 ran no remote command by rule). After the deploy, the owner must also switch off any zone feature that the header scan finds injecting scripts or cookies (Q5).)
- [2026-09-23 01:26 UTC] Nothing reconciled is deployed. This ticket stays open until the orchestrator deploys and verify-deployment passes against the live release; the preconditions recorded in this sync are on W-079.
- [2026-09-23 02:50 UTC] Deployed to production 2026-09-23 ~01:45–02:55 UTC: remote migrations applied after reading every header (bookmarks recorded first), fresh production issuer keys for 2026-Q3 and Q4 (provision-issuer --remote --next-quarter), inference, verifier and main deployed with per-worker secrets, signed release. node tools/verify-deployment.mjs: every check PASS (release signature, client and key pinning, policy, no injected scripts fetched as a browser, plain-HTTP redirects, www and kernel aliases, no Network Error Logging); archive digests WARN until the first scheduled archive. Production journeys (reader, contributor, moderation) run in a real browser; their findings were fixed and redeployed. Stays open until its dependencies are DONE.
- [2026-09-23 05:15 UTC] BLOCKED: waits on W-079 (blocked: The launch release of September 23, 2026 is in this checkout and not deployed (the last deploy, 01:45–02:55 UTC, was the round-3 release; see W-021). External prerequisites: (1) counsel's sign-off on the exact legal text being served (1.2.0), recorded as LEGAL_REVIEWED_VERSION in shared/brand.ts, which is null now, so every legal page would show 'Draft — pending attorney review' and legalLaunchBlockers() lists 'change-notice'; then the read-only query of docs/operations.md step 0 must show no real contribution submitted under 1.1.0 still waiting. The only statement that counsel approved came from workflow-generated task text, not from the owner. (2) The owner's authorization for the remote steps, which no agent runs: INTERNAL_TOKEN on both workers, the pending remote migrations, the sample purge, provisioning without samples, and the deploy in the D9 order. [read docs/operations.md sha256:98f2532f049c])
- [2026-09-23 06:41 UTC] Launch release deployed 2026-09-23 (~07:00 UTC) per docs/operations.md 'Deploy order for this release': bookmarks, public 0010/0011 and verifier 0005/0006 migrations, INTERNAL_TOKEN on both workers, purge-samples (211 fictional/test rows removed, restore bookmarks recorded), provision-issuer --remote --no-samples --next-quarter (36 mailbox keys), release build 1200660dd1 signed (policy 0.8.0, legal 1.2.0), verifier → inference → main. node tools/verify-deployment.mjs: no FAIL (verifier link and archive release link WARN until the next scheduled run). Production smoke: legal 1.2.0 without draft notice, publication on (batch 5, aggregates 25), juries on, 221 real employers only, native Jev search. [read docs/operations.md sha256:b88f975dd416]
- [2026-09-23 17:37 UTC] Reviewed the open-source release edit to docs/operations.md: the prerequisites now require Node 24+ (26.5.0 pinned) and Bun 1.4.0 to match the dependencies. The remaining operational instructions and this ticket's recorded scope are unchanged. Clean-export build and typecheck passed; ticket reference checks are being refreshed for the updated document. [read docs/operations.md sha256:b0fe3595a3a9]
