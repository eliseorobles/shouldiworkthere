---
id: W-016
title: Constitution, privacy, moderation, transparency, legal requests, source, finances pages
phase: Phase 5 - Trust
status: IN PROGRESS
depends_on: W-015
---

# W-016 - Constitution, privacy, moderation, transparency, legal requests, source, finances pages

**Phase:** Phase 5 - Trust  
**Depends on:** W-015  
**Status:** IN PROGRESS

## Scope

Published Covenant with version history and the ten principles, threat model, moderation policy, live operating costs, donation ledger summary, legal request log, open-source statement.

## Acceptance criteria

All seven routes live; finances and moderation statistics render from real ledger data; legal request log is append-only and public.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Trust pages
- [2026-09-22 05:05 UTC] Seven server-rendered pages: constitution (versioned covenant from the ledger), privacy, moderation (rules + live ledger), transparency, legal-requests (append-only), source, finances. All render from the same databases the product uses.
- [2026-09-22 05:12 UTC] REOPENED: Audit: disclosures overstate anonymity; source availability and governance not implemented.
- [2026-09-22 21:11 UTC] Rounds 1-2: /privacy, /terms and /accessibility are generated from worker/src/legal.ts, and /moderation and /transparency state jury, challenge and trustee status from the same switches. Round 3 is updating worker/src/pages.ts; at the 21:00 UTC run tests/web.test.ts 'every server-rendered page carries the legal links, sentence-case headings and labelled tables' failed while that edit was in progress. The audit's page findings (E-01 verifier status, E-10 threat model, E-11 source claims, E-14 Covenant version history) are to be verified after it lands.
- [2026-09-23 01:26 UTC] Pre-deploy pass: the /moderation and /transparency status lines are built from the policy's own functions under 0.7.0, including the wording when no fictional employer publishes sandbox juror keys (per the legal fix report, with tests in tests/safety.test.ts); a failing trust page now answers with an HTML 503 page, and read-only trust pages are retried once (tests/api.test.ts 'a failing page route answers with a page, never a raw JSON body…'). This followed a /finances 503 with a raw JSON body seen during the moderation journey under concurrent local load, which did not reproduce. What was open is unchanged.
