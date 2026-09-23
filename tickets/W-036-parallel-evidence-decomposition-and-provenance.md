---
id: W-036
title: Parallel evidence decomposition and provenance
phase: Phase 11 - Jev acceptance
status: IN PROGRESS
depends_on: W-006, W-015
---

# W-036 - Parallel evidence decomposition and provenance

**Phase:** Phase 11 - Jev acceptance  
**Depends on:** W-006, W-015  
**Status:** IN PROGRESS

## Scope

Run 20–50 independent narrow judgments over eligible text: firsthand reporting, specific allegation, layoff/reorg/pay/workload/promotion/retaliation/harassment/discrimination, identity risk, abuse signals, six sentiment dimensions, and specificity. Preserve the author's exact approved words.

## Acceptance criteria

- [ ] A published source ID resolves to public text inside the inference service; arbitrary private IDs yield no model request.
- [ ] One typed request evaluates independent predicates; missing dimensions return unknown, not neutral or negative.
- [ ] Persist source hash, actual returned model version, prompt version and typed answers separately from original testimony.
- [ ] Source edits/withdrawals invalidate derived data; Jev never rewrites testimony or counts model sentiment as questionnaire votes.

## Implementation paths

- `worker/inference.ts`
- `db/migrations/0001_reconciliation.sql`
- `web/app.tsx`

## Required verification

- Positive direct manager + negative executives + unclear promotion yields distinct dimension values.
- Unknown compensation/workload remains unknown.
- Before and after processing, testimony bytes and source hash are identical.
- Withdraw a source during inference; late results must not republish its analysis.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Dependency on W-023 replaced in round 3 by the technical prerequisites (see W-023's log): W-023 is the reconciliation umbrella and its acceptance includes deployment, so as a prerequisite it made this ticket unclosable before deploy while W-023 cannot close before it. Each published account gets 17 descriptive judgments (firsthand, specific allegation, 8 topic mentions, 6 dimensions, specificity) after the 7 risk judgments asked once at screening; risk answers are never stored on published text. Verified: tests/evidence.test.ts 'public testimony carries a typed reading, never risk signals, and low-confidence dimensions read as unknown', tests/jev.test.ts 'published text is analyzed descriptively…' and 'a withdrawal during analysis leaves no derived analysis or pairs behind', tests/acceptance.test.ts 'inference boundary rejects credentials/identity fields and never resolves private submission IDs'. No named test yet for 'testimony bytes and source hash are identical before and after processing' or for the manager/executive/promotion scenario.
- [2026-09-23 01:26 UTC] Round-3 findings on analysis: the analysis and pair questions now say the contributor text is untrusted data (prompt versions shouldiworkthere-evidence-v4 and shouldiworkthere-pairs-v3, RT-ABUSE-01); readings of a release group are withheld until every account in it is analysed or its release quarter ends, so the order in which readings appear no longer follows submission order (RT-LINK-01; tests/evidence.test.ts 'RT-LINK-01: readings…'). What was open is unchanged.
