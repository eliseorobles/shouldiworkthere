---
id: W-045
title: Should I Work There brand and apex cutover
phase: Phase 11 - Jev acceptance
status: BLOCKED
depends_on: W-003, W-079
---

# W-045 - Should I Work There brand and apex cutover

**Phase:** Phase 11 - Jev acceptance  
**Depends on:** W-003, W-079  
**Status:** BLOCKED

## Scope

Use Should I Work There everywhere, canonical HTTPS shouldiworkthere.com, rename cloud services and preserve existing data during the cutover.

## Acceptance criteria

- [ ] Page titles, wordmark, PWA, favicon, source download, emails, docs and ticket index use the current brand.
- [ ] Apex custom domain serves the tested release; verifier is on verify.shouldiworkthere.com with strict CORS to the apex.
- [ ] Database migration is backed up and row counts verified; no production reseed or silent data loss.
- [ ] Desktop/mobile screenshots have no former branding; local preview remains available at localhost:8788.

## Implementation paths

- `shared/brand.ts`
- `web/main.tsx`
- `worker/src/pages.ts`
- `wrangler.jsonc`
- `issuer.wrangler.jsonc`
- `inference.wrangler.jsonc`
- `docs/`
- `tickets/`

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] BLOCKED: waits on W-079 (blocked: External prerequisites: (1) the owner's authorization for a remote deploy (rounds 1-3 ran no remote command by rule); (2) the launch blockers listed by legalLaunchBlockers(): mail forwarding to privacy@, legal@ and dmca@ proven by a test message, and the model provider's entity, country, retention, training use and data processing agreement; (3) the owner's confirmation that zone features that inject scripts or cookies are off.)
- [2026-09-22 21:41 UTC] BLOCKED: waits on W-079 (blocked: The owner's authorization for a remote deploy (rounds 1-3 ran no remote command by rule). After the deploy, the owner must also switch off any zone feature that the header scan finds injecting scripts or cookies (Q5).)
- [2026-09-23 02:50 UTC] Apex cutover done 2026-09-23 UTC: shouldiworkthere.com serves the release; verify.shouldiworkthere.com serves the verifier with HSTS; kernel.shouldiworkthere.com and www.shouldiworkthere.com 301 to the same path on the apex (tools/redirect-worker, the former kernel Worker, whose old databases are untouched). node tools/verify-deployment.mjs checks the aliases and plain-HTTP redirects.
- [2026-09-23 05:15 UTC] BLOCKED: waits on W-079 (blocked: The launch release of September 23, 2026 is in this checkout and not deployed (the last deploy, 01:45–02:55 UTC, was the round-3 release; see W-021). External prerequisites: (1) counsel's sign-off on the exact legal text being served (1.2.0), recorded as LEGAL_REVIEWED_VERSION in shared/brand.ts, which is null now, so every legal page would show 'Draft — pending attorney review' and legalLaunchBlockers() lists 'change-notice'; then the read-only query of docs/operations.md step 0 must show no real contribution submitted under 1.1.0 still waiting. The only statement that counsel approved came from workflow-generated task text, not from the owner. (2) The owner's authorization for the remote steps, which no agent runs: INTERNAL_TOKEN on both workers, the pending remote migrations, the sample purge, provisioning without samples, and the deploy in the D9 order. [read docs/operations.md sha256:98f2532f049c])
