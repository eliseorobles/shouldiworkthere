---
id: W-004
title: D1 schema for public evidence, restricted intake, and transparency ledgers
phase: Phase 1 - Data
status: DONE
depends_on: W-001
completed: 2026-09-22 04:53 UTC
---

# W-004 - D1 schema for public evidence, restricted intake, and transparency ledgers

**Phase:** Phase 1 - Data  
**Depends on:** W-001  
**Status:** DONE

## Scope

Tables: companies, cohorts, metric_definitions, metric_releases, testimony, testimony_topics, corroborations, moderation_actions, legal_requests, financial_entries, releases, credentials, redemption_ledger, rate_limits, question_trails.

## Acceptance criteria

Schema applies cleanly; every published metric traces to its question wording, denominator, period, and verification method.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 04:53 UTC] Public and verifier schemas.
- [2026-09-22 04:53 UTC] db/schema.sql + db/schema-verify.sql; no user table, no join between published items and redemption.
- [2026-09-22 21:11 UTC] Dependency corrected in round 3: W-004 needs the build and a local D1 (W-001), not W-002, which stays open only for the remote bindings and the apex. Re-verified: every migration applies to a fresh database in tests/d1.ts; tests/moderation.test.ts 'the moderation migrations are additive…', tests/privacy.test.ts 'the legacy scrub migration only updates rows…', tests/publication.test.ts 'verification method is recorded per release…' and tests/evidence.test.ts 'lens provenance: release ids per point and release-level verification method' pass.
