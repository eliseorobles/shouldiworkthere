---
id: W-041
title: Corroboration without truth inflation
phase: Phase 11 - Jev acceptance
status: IN PROGRESS
depends_on: W-036, W-040
---

# W-041 - Corroboration without truth inflation

**Phase:** Phase 11 - Jev acceptance  
**Depends on:** W-036, W-040  
**Status:** IN PROGRESS

## Scope

Retrieve similar public accounts, judge same alleged event versus copied text using independent Jev predicates, and count distinct eligible credentialed sources. Vectorize is a scale option for public text only.

## Acceptance criteria

- [ ] Shared topic alone cannot establish same-event corroboration.
- [ ] Copied accounts are excluded or shown as duplicates, never multiplied into witnesses.
- [ ] Cluster membership and source IDs are inspectable; withdrawal removes the source and recomputes eligible counts.
- [ ] The UI says potentially related/credentialed accounts unless a stronger independence proof exists; it never says AI verified the allegation.
- [ ] Candidate limits and pair counts are bounded and measured; embeddings never include raw private drafts.

## Implementation paths

- `worker/inference.ts`
- `db/migrations/0001_reconciliation.sql`
- `worker/src/evidence.ts`
- `web/app.tsx`

## Required verification

- Retroactive Q3 quota paraphrases cluster; unrelated Q4 quota and ordinary quota complaints do not.
- Copy/paste campaigns do not increase an independent-source count.
- Test transitive A≈B, B≈C, A≠C so clustering does not silently assert a shared event.
- Removing one source below the privacy threshold suppresses the cluster.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Verified: tests/evidence.test.ts 'A~B and B~C with A!~C never form a cluster…', 'copy-paste accounts merge into one source and never add a witness', 'an account with a direct identifier never counts toward a cluster…' and 'clusters respect cohort, layer and time filters…', tests/jev.test.ts 'pair candidates prefer described-topic overlap… and stay bounded'. Closes after W-036 and W-040.
- [2026-09-23 01:26 UTC] Round-3 red-team RT-A6 (low), open: the clusters view is always empty for the fictional employers, because the local public database has no pair judgments, the backfill never newly analyzes fixtures and a cluster needs 5 sources. Group A rejected the proposed fix of seeding evidence_pairs, which are model probabilities, because it would fabricate model judgments; the view stays honestly empty until at least 5 sandbox or real accounts about one event are analyzed. docs/demo.md does not yet say that the clusters view has no demonstration data (see W-022). [read docs/demo.md sha256:ca16c79e5c74]
- [2026-09-23 05:16 UTC] Re-read docs/demo.md for this entry; it changed at 04:23 UTC, after the 01:26 entry. It still does not say that the clusters view has no demonstration data, so the 01:26 entry holds. The demo now runs only on a local copy, where the fictional employers are shown. [read docs/demo.md sha256:a7ff05b71df5]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/demo.md for this entry. It still does not mention the clusters view or say it has no demonstration data, so the 01:26 entry holds. [read docs/demo.md sha256:a62c6afdddb8]
