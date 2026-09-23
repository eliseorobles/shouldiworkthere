---
id: W-034
title: Low-maintenance independent operation
phase: Phase 10 - Constitutional moderation
status: IN PROGRESS
depends_on: W-015, W-018
---

# W-034 - Low-maintenance independent operation

**Phase:** Phase 10 - Constitutional moderation  
**Depends on:** W-015, W-018  
**Status:** IN PROGRESS

## Scope

Use Should I Work There branding and technical sender addresses on the chosen personal Cloudflare account. Bounded email/inference workloads, scheduled housekeeping, circuit breakers, expiring unresolved cases, release kill switch, public service status, and no permanent personal moderator queue.

## Acceptance criteria

- [ ] Real publication stays off until governance exceptions are operational.
- [ ] The legal operator appears only in legal text, never as product branding.
- [ ] No moderator inbox or moderator queue is introduced.
- [ ] Quotas, expiry, provider outage and disabled-release behavior are tested.
- [ ] Docs distinguish operational separation from legal entity/liability protection.

## Implementation paths

- `worker/src/submissions.ts`
- `worker/src/moderation.ts`
- `worker/src/ai.ts`
- `shared/brand.ts`
- `docs/operations.md`

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Dependency on W-023 replaced by W-015 and W-018 in round 3 (see W-023). Acceptance reworded in round 3 so the manifest no longer names the legal operator. Verified: tests/publication.test.ts 'real-employer groups never publish while publication is paused…' and 'held cases expire after 30 days…', tests/jev.test.ts 'provider failure returns a labeled degraded canvas…' and 'repeated native failures open the circuit…', tests/protocol.test.ts issuance-cap tests, and tests/safety.test.ts 'legal: the operator is named only in legal text, never as product branding'. Still open: the docs do not yet distinguish operational separation from legal entity or liability protection (docs/operations.md exists as of round 3 but does not cover it).
- [2026-09-22 22:32 UTC] Re-read docs/operations.md for this entry; it changed at 22:26 UTC, after the 21:11 entry. It still does not distinguish operational separation from a legal entity or liability protection. docs/threat-model.md calls the three services in one account 'separation, not independent custody', which is about custody, not the legal entity. The 21:11 entry holds; the last acceptance item is open. [read docs/operations.md sha256:6d78aad8dac8] [read docs/threat-model.md sha256:b82af5da5cf1]
- [2026-09-23 01:26 UTC] Re-read docs/operations.md (changed at 22:48 UTC) and docs/threat-model.md (changed at 00:45 UTC) for this entry. operations.md still does not distinguish operational separation from a legal entity or liability protection, and threat-model.md still calls the three services in one account 'separation, not independent custody'. The 22:32 entry holds; the last acceptance item is open.
  Round-3 red-team findings on bounded workloads: RT-ABUSE-02 fixed (anonymous draft checks may bring the screening counter only to 300 of 600, with a per-client daily share of 20: tests/jev.test.ts 'RT-ABUSE-02…'); RT-A3 fixed (ranking may bring the search counter only to 1000 of 1500: tests/jev.test.ts 'RT-A3…'); WS-05 mitigated (per-client daily shares of 60 searches, 40 Live readings and 20 draft checks, kept only with RATE_LIMIT_SECRET as a keyed digest and a count: tests/api.test.ts 'WS-05…'), with residual risk: there is no human check (such as Turnstile) and no alert when a budget is spent early, and because sandbox credentials are free, submissions and revisions can still use up the 300 screening calls reserved for them; RT-CFG-07 and WS-10 fixed (tests/protocol.test.ts 'every rate-limit namespace_id is unique…' and 'local tooling: .env with a secret is tightened to 0600…'; .env is 0600, checked for this entry).
  Pre-deploy pass: a failing page route now answers with an HTML 503 page (Retry-After, the security headers, no failure details) instead of a raw JSON body, and read-only trust pages are retried once (tests/api.test.ts 'a failing page route answers with a page, never a raw JSON body…'). The journey's /finances 503 did not reproduce (165 concurrent requests, all 200, per the server fix report), so the fix is verified by an injected D1 failure only. [read docs/operations.md sha256:ec6c04369ea9] [read docs/threat-model.md sha256:0449c1a76dd9]
- [2026-09-23 02:46 UTC] Re-read docs/operations.md after the 2026-09-22 production-fix pass: step 8 now makes the zone check as a browser, lists the zone settings (Web Analytics injection, Network Error Logging, Always Use HTTPS) and documents the code-side guard (no-transform, NEL max_age 0, worker HTTP redirect). The earlier entry still holds; the runbook only gained checks. [read docs/operations.md sha256:3894c372162e]
- [2026-09-23 02:46 UTC] Re-read docs/threat-model.md after the 2026-09-22 production-fix pass: it now records that Cloudflare zone features can inject scripts or headers for browser user agents and the no-transform/NEL/HTTP-redirect guard. The earlier entry still holds. [read docs/threat-model.md sha256:d45e1f335d37]
- [2026-09-23 05:16 UTC] Re-read docs/operations.md (changed at 04:18 UTC) and docs/threat-model.md (changed at 04:19 UTC) for this entry. Step 8 and the zone paragraph are unchanged, so the 02:46 entries hold. operations.md still has no passage distinguishing operational separation from a legal entity or liability protection, and threat-model.md still calls the one-account setup separation, not independent custody, so the last acceptance item stays open. The first item, 'Real publication stays off until governance exceptions are operational', does not hold for the launch release: wrangler.jsonc sets REAL_PUBLICATION_ENABLED 'true' while trustees are not operating (TRUSTEE_KEYS is not set; docs/product-principles.md says so). That follows the owner decision of September 23, 2026 as relayed in the workflow's task text; the criterion stays as written until the owner amends or keeps it. On the third item: correcting a community listing depends on a person reviewing requests sent to legal@ (the terms' 'Correcting a listing'), a manual queue for directory entries, not for content; whether that fits 'no moderator inbox or queue' is the owner's call. [read docs/operations.md sha256:98f2532f049c] [read docs/threat-model.md sha256:1813a789fc8f] [read docs/product-principles.md sha256:5a49bcc7a422]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/operations.md, docs/threat-model.md and docs/product-principles.md for this entry. Step 8 and the zone paragraph are unchanged. operations.md still has no passage distinguishing operational separation from a legal entity or liability protection, and threat-model.md still calls the one-account setup separation, not independent custody, so the last acceptance item stays open. The first item still does not hold for the launch release: wrangler.jsonc sets REAL_PUBLICATION_ENABLED 'true' while trustees are not operating (product-principles.md says so). On the third item, operations.md now has 'Staffing legal@ during the launch', which makes the manual review of listing-correction requests an explicit duty; whether that fits 'no moderator inbox or queue' is still the owner's call. [read docs/operations.md sha256:23803f99bfdc] [read docs/threat-model.md sha256:d4dfb76d64f7] [read docs/product-principles.md sha256:ee5134164660]
- [2026-09-23 06:41 UTC] Re-read docs/operations.md after the launch deploy: the only change is the zone-check header grep in deploy step 8, which now accepts the workers' intentional 'nel: {"max_age":0}'. The earlier entry still holds. [read docs/operations.md sha256:b88f975dd416]
- [2026-09-23 17:37 UTC] Reviewed the open-source release edit to docs/operations.md: the prerequisites now require Node 24+ (26.5.0 pinned) and Bun 1.4.0 to match the dependencies. The remaining operational instructions and this ticket's recorded scope are unchanged. Clean-export build and typecheck passed; ticket reference checks are being refreshed for the updated document. [read docs/operations.md sha256:b0fe3595a3a9]
