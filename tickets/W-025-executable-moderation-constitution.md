---
id: W-025
title: Executable moderation constitution
phase: Phase 10 - Constitutional moderation
status: DONE
depends_on: W-015
completed: 2026-09-22 21:11 UTC
---

# W-025 - Executable moderation constitution

**Phase:** Phase 10 - Constitutional moderation  
**Depends on:** W-015  
**Status:** DONE

## Scope

Versioned machine-readable rules at /moderation/vX.Y.Z.json, policy digests, protected amendments, narrow Jev predicates, deterministic clear/repair/jury actions. Criticism and opinion uncertainty favor publication; factual allegations remain attributed testimony.

## Acceptance criteria

Boundary tests cover every threshold; policy is pinned per decision; sentiment cannot influence eligibility; public receipts reference the exact policy digest; thresholds labeled provisional until evaluated.

## Log

- [2026-09-22 05:27 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Dependency on W-023 replaced in round 3 by the technical prerequisites (see W-023's log): W-023 is the reconciliation umbrella and its acceptance includes deployment, so as a prerequisite it made this ticket unclosable before deploy while W-023 cannot close before it. shared/policy.ts is at 0.5.0 (personal-attack uncertainty repairs at 0.85 and publishes below; juries only for spam, manipulation and challenges), every earlier version is kept verbatim with its digest, and each is labeled provisional. tests/moderation.test.ts 'the constitution keeps every version verbatim…' and 'each rule’s uncertain band follows its category: … a clear personal attack repairs and anything less publishes…', tests/acceptance.test.ts 'policy maps privacy uncertainty to repair, manipulation to jury, a clear personal attack to repair…', tests/publication.test.ts 'every rule fires at its threshold and not just below it' and 'decisions pin policy version, digest…', and tests/moderation.test.ts 'author receipts pin rule, policy version and digest…' pass (node --test "tests/*.test.ts" on 2026-09-22 21:00 UTC: 411 of 413 passed (the 2 failures were legal-page tests under edit by the legal group)).
- [2026-09-23 01:26 UTC] Policy versions 0.6.0 (round-3 hardening: queued re-checks, one juror-token set, /64 network keys, rounded daily counts, finality for identical words, exception renewal) and 0.7.0 (pre-deploy pass: practice juries without the per-employer and own-employer limits) were added; every earlier version stays published verbatim (tests/moderation.test.ts 'the constitution keeps every version verbatim, and no later version drops or rewords a protected principle'; tests/integration.mjs 'policy: …' checks, passed at 01:15 UTC). This ticket's criteria still hold.
