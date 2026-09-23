---
id: W-079
title: Ordered deploy and deployment verification
ref: H10
phase: Phase 15 - Hardening
status: BLOCKED
depends_on: W-003, W-005, W-011, W-015, W-018, W-019, W-062, W-063, W-069, W-080, W-081, W-082, W-083, W-084
---

# W-079 - Ordered deploy and deployment verification

**Phase:** Phase 15 - Hardening  
**Brief ref:** H10  
**Depends on:** W-003, W-005, W-011, W-015, W-018, W-019, W-062, W-063, W-069, W-080, W-081, W-082, W-083, W-084  
**Status:** BLOCKED

## Scope

Deploy the reconciled release in the documented order and prove what is live: remote migrations with backups and row counts, then inference, then the verifier, then the main worker, then verify-deployment.

## Acceptance criteria

- [ ] Remote migrations are applied with tools/db.mjs after a backup and recorded row counts; issuer keys are provisioned; then inference, the verifier and the main worker are deployed in that order.
- [ ] The release is built and signed with tools/transparency.mjs and its record is committed.
- [ ] node tools/verify-deployment.mjs --state=<file> reports no FAIL against https://shouldiworkthere.com and the verifier origin, and the state file is kept.
- [ ] Post-deploy checks pass: security headers on the apex (CSP connect-src, HSTS); no Cloudflare-injected script or cookie (Email Address Obfuscation, Rocket Loader, Web Analytics, Zaraz, __cf_bm, cf_clearance); the archive bucket is not publicly reachable; production row counts match what the privacy policy states.
- [ ] Switches (REAL_PUBLICATION_ENABLED, JURY_ENABLED, TRUSTEE_KEYS, the crisis switches, RATE_LIMIT_SECRET) are set as the policy discloses, and the three database bindings are verified against the account.
- [ ] Launch release (September 23, 2026): the legal gate in docs/operations.md step 0 is closed before anything remote runs (counsel has approved the exact legal text being served and LEGAL_REVIEWED_VERSION records it, and the query for contributions submitted under 1.1.0 still waiting returns no rows); INTERNAL_TOKEN is set on both workers; the sample purge is applied after a dry run and a bookmark, and a second dry run reports zero rows; issuer keys are provisioned without samples; verify-deployment reports fictional employers hidden, no sandbox key served by either host, listing open and identical community keys on both hosts; no listing, contribution or jury seat is created in production to test.

## Implementation paths

- `tools/db.mjs`
- `tools/provision-issuer.mjs`
- `tools/transparency.mjs`
- `tools/verify-deployment.mjs`
- `docs/operations.md`
- `wrangler.jsonc`
- `inference.wrangler.jsonc`
- `issuer.wrangler.jsonc`

## Required verification

- node tools/verify-deployment.mjs --state=.siwt-watch-state.json output with no FAIL; header and zone scan of the apex recorded in the ticket log.
- For the launch release: the purge dry-run output (zero rows) and the smoke checks of docs/operations.md step 12 (/api/config shows sampleEmployers false, /c/northwind-labs answers 404, a listing without a proof of work is refused with pow_missing) recorded in the ticket log.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] BLOCKED: External prerequisites: (1) the owner's authorization for a remote deploy (rounds 1-3 ran no remote command by rule); (2) the launch blockers listed by legalLaunchBlockers(): mail forwarding to privacy@, legal@ and dmca@ proven by a test message, and the model provider's entity, country, retention, training use and data processing agreement; (3) the owner's confirmation that zone features that inject scripts or cookies are off.
- [2026-09-22 21:41 UTC] Correction to the 21:11 BLOCKED entry: mail forwarding and the model provider's facts are not deploy gates. Forwarding to privacy@, legal@ and dmca@ was verified on 2026-09-22 (shared/brand.ts: CONTACT_MAIL.forwardingVerified is true). Under decision D13 the model provider's facts, the DMCA registration and the EU, EEA and UK items are follow-ups tracked in W-078, not launch blockers. legalLaunchBlockers() in worker/src/legal.ts returned no items at 21:41 UTC.
- [2026-09-22 21:41 UTC] BLOCKED: The owner's authorization for a remote deploy (rounds 1-3 ran no remote command by rule). After the deploy, the owner must also switch off any zone feature that the header scan finds injecting scripts or cookies (Q5).
- [2026-09-23 01:26 UTC] Deploy preconditions from round 3 and the pre-deploy pass, checked for this entry (none lifts the block):
  - Issuer keys: db/issuer-public-keys.json and .issuer-secrets.json are absent; the keys that were there were the local verifier's and now live under .wrangler/provision/ (RT-KEY-02, WS-01, RT-C1). Step 3 of docs/operations.md (ISSUER_MASTER_KEY=… node tools/provision-issuer.mjs --remote) must run before the release build, and --remote refuses any key without remote provenance or sharing a modulus with a local key.
  - Build: the client bundle now in worker/generated is a --local build that pins the local registry; the release needs a plain node tools/build.mjs after provisioning, and tools/transparency.mjs refuses a registry holding a local key.
  - Migrations: verifier 0004 drops the legacy tables and is a row change, so tools/db.mjs prints each table's row count and applies it remotely only with --accept-row-changes (RT-RET-08); intake 0005 is additive (the finality digests, the challenge queue and the stats snapshots).
  - WS-09: preview_urls is false in wrangler.jsonc and inference.wrangler.jsonc, but issuer.wrangler.jsonc pins nothing and tools/verify-deployment.mjs does not check for preview or workers.dev hostnames, so confirm in the dashboard that the inference and verifier Workers have none.
  - verify-deployment's 'issuer keys are not local keys' check needs the local registry file and reports SKIP without it.
  - RATE_LIMIT_SECRET is required for challenges and interest counting (docs/operations.md, Secrets) but is not listed under secrets.required in wrangler.jsonc.
  The local stack passed every suite for this entry. Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed. This ticket stays blocked on the owner's authorization for a remote deploy. [read docs/operations.md sha256:ec6c04369ea9]
- [2026-09-23 02:46 UTC] Re-read docs/operations.md after the 2026-09-22 production-fix pass: step 8 now makes the zone check as a browser, lists the zone settings (Web Analytics injection, Network Error Logging, Always Use HTTPS) and documents the code-side guard (no-transform, NEL max_age 0, worker HTTP redirect). The earlier entry still holds; the runbook only gained checks. [read docs/operations.md sha256:3894c372162e]
- [2026-09-23 05:15 UTC] BLOCKED: The launch release of September 23, 2026 is in this checkout and not deployed (the last deploy, 01:45–02:55 UTC, was the round-3 release; see W-021). External prerequisites: (1) counsel's sign-off on the exact legal text being served (1.2.0), recorded as LEGAL_REVIEWED_VERSION in shared/brand.ts, which is null now, so every legal page would show 'Draft — pending attorney review' and legalLaunchBlockers() lists 'change-notice'; then the read-only query of docs/operations.md step 0 must show no real contribution submitted under 1.1.0 still waiting. The only statement that counsel approved came from workflow-generated task text, not from the owner. (2) The owner's authorization for the remote steps, which no agent runs: INTERNAL_TOKEN on both workers, the pending remote migrations, the sample purge, provisioning without samples, and the deploy in the D9 order. [read docs/operations.md sha256:98f2532f049c]
- [2026-09-23 05:15 UTC] Re-read docs/operations.md for this entry; it changed at 04:18 UTC, after the 02:46 entry. Step 8 (the zone check made as a browser, the zone settings, the code-side guard) is unchanged, so the 02:46 entry holds. New: 'Launch release (September 23, 2026): the zero-data public launch' with its own deploy order (0 legal gate, 1 local checks, 2 INTERNAL_TOKEN on both workers, 3 snapshot, 4 migrations, 5 sample purge, 6 keys without samples, 7–9 inference, verifier, main, 10 verify, 11 zone check, 12 smoke checks that create no data), 'Removing sample data' and 'Correcting an employer listing'. Scope change recorded with this entry: the manifest adds W-080 to W-084 as dependencies and a launch-release acceptance item (legal gate, INTERNAL_TOKEN, purge with a zero-row second dry run, keys without samples, verify-deployment on hidden fictional employers, no sandbox key served, listing open, identical community keys, no test data created in production).
  Where the runbook disagrees with the code (docs corrections for group D): step 2 says both configs list INTERNAL_TOKEN in secrets.required, but wrangler.jsonc deliberately declares no secrets.required list (tests/community.test.ts 'production configuration…' asserts that), so only issuer.wrangler.jsonc does; step 4 names public 0010 and verifier 0005 and 0006 but not public 0011_listing_corrections, which the correction route needs; ADMIN_TOKEN is described only for the ledgers, not for POST /api/directory/correct; 'Removing sample data' and 'Correcting an employer listing' predate the purge's verifier step and the correction route (see W-080 and W-083).
  Internal work before the launch deploy, none of which lifts the block: W-080 (sandbox keys in the committed registry, verify-deployment FAIL on a served sandbox key, prepare-local, the jury-capacity count), W-081 (1.1.0 contributions held to 25 in code), W-082 (the difficulty the owner wants), W-083 (jury capture by community juror keys, the add-employer refusal wording that fails tests/web.test.ts, the label for a community domain on a curated listing), W-084 (docs/evaluation.md budgets). [read docs/operations.md sha256:98f2532f049c] [read docs/evaluation.md sha256:94776266f9a2]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/operations.md for this entry. Step 8 is unchanged. The launch-release section was rewritten after the 05:15 entry and now matches the code on every point that entry listed: only issuer.wrangler.jsonc lists INTERNAL_TOKEN in secrets.required (wrangler.jsonc has no secrets list); the migrate step names public 0010 and 0011 and verifier 0005 and 0006, all present; ADMIN_TOKEN is Required and covers POST /api/directory/correct; 'Removing sample data' describes the verifier step; step 7 says a release build refuses while db/issuer-public-keys.json lists sandbox keys and SAMPLE_EMPLOYERS is not 'on' (confirmed: node tools/build.mjs refused at 06:26 UTC on the 12 sandbox keys among the 48 committed, and left worker/generated unchanged); step 9 says verify-deployment fails 'sandbox keys retired' on any served sandbox key. The legal part of the 05:15 block reason is out of date: LEGAL_REVIEWED_VERSION is now '1.2.0' in shared/brand.ts on the owner's statement as relayed by the workflow, and legalLaunchBlockers() returns []; the owner has not confirmed counsel's approval of the exact current text directly. The remote steps still need the owner's authorization and none was run. Local checks for this entry: npx tsc --noEmit clean (06:17 UTC); node --test "tests/*.test.ts" 614 of 615 (06:17-06:18 UTC, the one failure tests/tickets.test.ts on stale citations); npx playwright test 131 passed and 1 skipped (06:19-06:23 UTC); node tests/integration.mjs 132 passed, 0 failed (06:24 UTC). [read docs/operations.md sha256:23803f99bfdc]
- [2026-09-23 06:41 UTC] Re-read docs/operations.md after the launch deploy: the only change is the zone-check header grep in deploy step 8, which now accepts the workers' intentional 'nel: {"max_age":0}'. The earlier entry still holds. [read docs/operations.md sha256:b88f975dd416]
- [2026-09-23 17:37 UTC] Reviewed the open-source release edit to docs/operations.md: the prerequisites now require Node 24+ (26.5.0 pinned) and Bun 1.4.0 to match the dependencies. The remaining operational instructions and this ticket's recorded scope are unchanged. Clean-export build and typecheck passed; ticket reference checks are being refreshed for the updated document. [read docs/operations.md sha256:b0fe3595a3a9]
