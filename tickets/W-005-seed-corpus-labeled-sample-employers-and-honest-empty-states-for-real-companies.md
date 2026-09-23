---
id: W-005
title: Seed corpus: labeled sample employers and honest empty states for real companies
phase: Phase 1 - Data
status: DONE
depends_on: W-004
completed: 2026-09-22 04:53 UTC
---

# W-005 - Seed corpus: labeled sample employers and honest empty states for real companies

**Phase:** Phase 1 - Data  
**Depends on:** W-004  
**Status:** DONE

## Scope

Fictional employers with rich multi-year structured evidence for demonstration; real companies present only with verified-coverage metadata and honest insufficient-evidence states. No fabricated claims about real employers.

## Acceptance criteria

Sample data is visibly labeled everywhere it appears; real companies show coverage counts and privacy-gated or empty states only.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 04:53 UTC] Seed corpus.
- [2026-09-22 04:53 UTC] 3 labeled fictional employers, 59 releases (all n>=25), 14 layered testimony, 22 Jev topics, 4 corroboration clusters, 7 question trails, 12 real employers with honest empty states.
- [2026-09-22 21:11 UTC] Re-verified in round 3: tests/browser.spec.ts 'fictional employers are labeled on every surface they appear' and 'a real employer with nothing published shows the opens-after rule, an invite action and no counts' pass (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed); tests/web.test.ts 'share images label fictional employers and carry no statistics' and tests/evidence.test.ts 'fictional employers are labeled in every headline…' pass. Real employers now show the opens-after rule with no counts. Outside this acceptance: a stale local database file from the prototype still holds fictional PII (audit D-27); the operator should delete it.
