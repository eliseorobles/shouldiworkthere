---
id: W-040
title: Evidence retrieval ranking and inspectable answers
phase: Phase 11 - Jev acceptance
status: IN PROGRESS
depends_on: W-036
---

# W-040 - Evidence retrieval ranking and inspectable answers

**Phase:** Phase 11 - Jev acceptance  
**Depends on:** W-036  
**Status:** IN PROGRESS

## Scope

Bounded candidate retrieval followed by Jev relevance judgments and deterministic assembly of sources, charts and denominators. Every displayed number and quote opens to its provenance.

## Acceptance criteria

- [ ] Retrieve candidate IDs first, then resolve only published nonwithdrawn text in the isolated inference Worker.
- [ ] Score query/candidate pairs on relevance including contradictory evidence; model relevance is labeled separately from truth/confidence in facts.
- [ ] Evidence Lens exposes question wording, group, n, period, verification method, exclusions and source IDs.
- [ ] No generated answer prose, made-up employees, missing-field guesses or synthesized ratings reach the UI.
- [ ] Ranker timeout preserves available evidence with an explicit unavailable state.

## Implementation paths

- `worker/inference.ts`
- `worker/src/evidence.ts`
- `web/app.tsx`

## Required verification

- An older relevant account outranks a newer irrelevant one.
- Evidence contradicting the query premise remains eligible.
- A private submission ID cannot be used to fetch or rank an unpublished draft.
- Click a percentage and trace its survey definition; a written quote is not incorrectly claimed to be the vote behind the percentage.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Verified: tests/evidence.test.ts 'an older relevant account outranks newer irrelevant ones in bounded candidate retrieval', tests/acceptance.test.ts 'inference boundary … never resolves private submission IDs', tests/jev.test.ts 'ranking runs only after a confident interpretation'. No named test found for 'evidence contradicting the query premise remains eligible' or for a ranker timeout keeping the available evidence.
- [2026-09-23 01:26 UTC] Round-3 red-team fixes: RT-A5 (Live typing never retrieves or ranks accounts; only submitted questions are ranked: tests/api.test.ts 'live calls are marked live all the way to the inference worker…') and RT-A3 (ranking and retrieval may bring the day's search counter only to 1000 of 1500, so the question itself is still read: tests/jev.test.ts 'RT-A3…'). What was open is unchanged.
