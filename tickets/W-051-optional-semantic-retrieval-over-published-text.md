---
id: W-051
title: Optional semantic retrieval over published text
ref: G6
phase: Phase 12 - Brief gaps: evidence engine
status: IN PROGRESS
depends_on: W-040
---

# W-051 - Optional semantic retrieval over published text

**Phase:** Phase 12 - Brief gaps: evidence engine  
**Brief ref:** G6  
**Depends on:** W-040  
**Status:** IN PROGRESS

## Scope

Candidate retrieval with Workers AI embeddings and Vectorize for PUBLISHED text only, active only when the binding and its deletion ledger exist, with a deterministic lexical fallback. Drafts are never embedded.

## Acceptance criteria

- [ ] Only published, non-withdrawn, non-identifying text is embedded; drafts, screening inputs and challenge reasons never are.
- [ ] Without the VECTORIZE binding or the vector deletion-ledger migration, retrieval indexes nothing, calls nothing, and ranking falls back to the lexical order.
- [ ] A withdrawal sweeps its vector, a withdrawal racing an upsert leaves no orphan, and retrieval never returns a withdrawn account in the meantime.
- [ ] Semantic candidates are used only when they pass the page filters and never fill every ranking slot.
- [ ] The privacy policy and sub-processor list describe it before the binding is added.

## Implementation paths

- `worker/inference-core.ts`
- `worker/src/app.ts`
- `inference.wrangler.jsonc`
- `db/migrations/`

## Required verification

- tests/jev.test.ts: 'optional semantic retrieval embeds only published, non-identifying text…', 'without its deletion ledger or its bindings, semantic retrieval indexes nothing…', 'a failed embedding keeps its deletion ledger entry…', 'a withdrawal racing an upsert never leaves an orphaned vector', 'an account whose embedding keeps failing never starves the rest…'.
- tests/api.test.ts: 'semantic candidates are used only when they pass the page filters…'; tests/evidence.test.ts: 'semantic retrieval candidates are kept only when they pass the page filters…'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented and tested with stubs in round 2 (tests/jev.test.ts semantic-retrieval tests) but inactive: there is no VECTORIZE binding. Round 3 adds the deletion-ledger migration (db/migrations/0007_vector_index_and_interest_days.sql). The binding may be added only after the privacy policy and sub-processor list describe it. Closes after W-040.
