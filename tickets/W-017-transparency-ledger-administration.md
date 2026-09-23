---
id: W-017
title: Transparency ledger administration
phase: Phase 5 - Trust
status: IN PROGRESS
depends_on: W-016
---

# W-017 - Transparency ledger administration

**Phase:** Phase 5 - Trust  
**Depends on:** W-016  
**Status:** IN PROGRESS

## Scope

Authenticated admin surface for recording moderation actions, legal requests, costs, and moderation statistics, with append-only semantics and public parity.

## Acceptance criteria

Admin writes require a secret; records cannot be edited or deleted through the API; public view matches ledger.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Ledger admin
- [2026-09-22 05:05 UTC] Admin queue and moderate endpoints behind an admin token; moderate() appends to the ledger and cannot edit or delete entries through the API; publish sweep.
- [2026-09-22 05:12 UTC] REOPENED: Audit: legal and financial append endpoints absent.
- [2026-09-22 21:11 UTC] Moderation admin routes are retired on principle (/api/admin answers 410; no moderator dashboard). Legal-request and cost entries are appended through /api/ledger/legal and /api/ledger/finance behind ADMIN_TOKEN (docs/operations.md, round 3), and the ledgers are append-only by database triggers (tests/acceptance.test.ts 'financial and legal ledgers reject updates and deletion'). Still open: no test proves that an append without the token is refused (audit E-17).
- [2026-09-22 22:32 UTC] Re-read docs/operations.md for this entry; it changed at 22:26 UTC, after the 21:11 entry. Its Secrets table says ADMIN_TOKEN 'Appends to the finance and legal ledgers only', and 'Routine work' shows an append to /api/ledger/legal with the bearer token, with corrections made as new entries. The 21:11 entry holds, including what is open: no file in tests/ calls /api/ledger, so an append without the token being refused is still untested (audit E-17). [read docs/operations.md sha256:6d78aad8dac8]
- [2026-09-23 01:26 UTC] Re-read docs/operations.md for this entry; it changed at 22:48 UTC, after the 22:32 entry. Its Secrets table still says ADMIN_TOKEN 'Appends to the finance and legal ledgers only', and 'Routine work' still shows the bearer-token append to /api/ledger/legal with corrections made as new entries; it now adds 'Removals the law requires' (RT-ABUSE-07: a content-rule report is filed as a public challenge, never acted on by direct access). The 22:32 entry holds, including what is open: no file under tests/ calls /api/ledger (checked again for this entry), so a refused append without the token is still untested (audit E-17). Moderation statistics changed in round 3 (RT-DIFF-03): counts that follow contributions are rounded like contribution counts ('<25' or a multiple of 25), refreshed at most once per UTC day, and /api/transparency contribution counts come from a daily snapshot (tests/moderation.test.ts 'RT-DIFF-03…', tests/publication.test.ts 'RT-DIFF-03…'; the tests/integration.mjs 'stats: …' checks passed at 01:15 UTC). [read docs/operations.md sha256:ec6c04369ea9]
- [2026-09-23 02:46 UTC] Re-read docs/operations.md after the 2026-09-22 production-fix pass: step 8 now makes the zone check as a browser, lists the zone settings (Web Analytics injection, Network Error Logging, Always Use HTTPS) and documents the code-side guard (no-transform, NEL max_age 0, worker HTTP redirect). The earlier entry still holds; the runbook only gained checks. [read docs/operations.md sha256:3894c372162e]
- [2026-09-23 05:16 UTC] Re-read docs/operations.md for this entry; it changed at 04:18 UTC, after the 02:46 entry. Step 8 (the zone check made as a browser, the zone settings, the code-side guard) and 'Removals the law requires' are unchanged, so the 02:46 entry holds. The runbook now also has the launch-release section with its own deploy order, 'Removing sample data' and 'Correcting an employer listing'; they concern W-079 to W-084, not the ledger administration this ticket covers. The append-only public ledgers are untouched by the new sample purge (tools/purge-samples.mjs PUBLIC_LEDGERS, which now also lists listing_corrections). [read docs/operations.md sha256:98f2532f049c]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/operations.md for this entry. Step 8 (the zone check made as a browser, the settings table, the no-transform, NEL and HTTPS code-side guard) and 'Removals the law requires' are unchanged, so the 02:46 and 05:16 entries hold. 'Removing sample data' still says the purge never touches the append-only public ledgers (finance, legal requests, moderation actions, release manifests, the exception log, the listing correction log); tools/purge-samples.mjs PUBLIC_LEDGERS also lists covenant_versions, which the runbook does not name. [read docs/operations.md sha256:23803f99bfdc]
- [2026-09-23 06:41 UTC] Re-read docs/operations.md after the launch deploy: the only change is the zone-check header grep in deploy step 8, which now accepts the workers' intentional 'nel: {"max_age":0}'. The earlier entry still holds. [read docs/operations.md sha256:b88f975dd416]
- [2026-09-23 17:37 UTC] Reviewed the open-source release edit to docs/operations.md: the prerequisites now require Node 24+ (26.5.0 pinned) and Bun 1.4.0 to match the dependencies. The remaining operational instructions and this ticket's recorded scope are unchanged. Clean-export build and typecheck passed; ticket reference checks are being refreshed for the updated document. [read docs/operations.md sha256:b0fe3595a3a9]
