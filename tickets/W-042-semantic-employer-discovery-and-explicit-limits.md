---
id: W-042
title: Semantic employer discovery and explicit limits
phase: Phase 11 - Jev acceptance
status: IN PROGRESS
depends_on: W-038, W-040
---

# W-042 - Semantic employer discovery and explicit limits

**Phase:** Phase 11 - Jev acceptance  
**Depends on:** W-038, W-040  
**Status:** IN PROGRESS

## Scope

Interpret multi-metric employer requests into bounded database predicates, preserving role/period/region and opposing preferences such as good direct managers but poor executive trust.

## Acceptance criteria

- [ ] Distinct direct-manager and executive-leadership preferences remain distinct controls.
- [ ] Ranking uses database-derived comparable metrics and explicit units, not Jev-generated employer scores.
- [ ] All requested filters apply or an unsupported/insufficient-evidence explanation appears; none are silently ignored.
- [ ] Real and fictional records are clearly separated. The directory grows without invented evidence (D12 replaces the earlier 200–500 tech-employer target, see below).
- [ ] One input navigates named companies, compares two, explores distributions and requests source records.
- [ ] D12: A question naming an employer the directory does not list ('charlesschwab', 'Charles Schwab', 'schwab' before expansion) shows a dedicated state: '<name as typed, normalized> isn’t in the directory yet', what opening a record takes, and a share or invite action; never fictional results in its place and never an error.
- [ ] D12: An additive migration (db/migrations/0009_directory.sql, INSERT OR IGNORE) lists about 150–250 well-known real employers across tech, finance, healthcare, retail, consulting and the public companies people ask about most, with name, slug and sector only, plus aliases ('schwab', 'jpm', 'chase') used by the on-device cursor and the Jev company prefilter; the company Choice stays within 255 options.
- [ ] D12: A real employer without a configured verification domain says 'Verification for this employer isn’t set up yet' in the contribution flow; no mailbox domain is added unless it is certainly the employer's primary corporate domain.

## Implementation paths

- `worker/src/jev.ts`
- `worker/src/index.ts`
- `worker/src/evidence.ts`
- `web/app.tsx`

## Required verification

- Highest-paying fintechs for staff engineers cannot be answered using company-wide market-perception percentages.
- No known company plus a generic query does not silently pick a fictional employer as the answer.
- Multi-metric comparison includes each requested metric or marks it unavailable.
- D12: an employer outside the directory shows the unlisted state and no other company (tests/browser.spec.ts 'choosing an employer we do not list shows the unlisted answer, never an error' covers the chosen-fork path); aliases match on the device and in the Jev prefilter; tests/jev.test.ts 'the company question stays within 255 options…' passes after the expansion; a contribution-flow test for an employer without a verification domain.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Verified: tests/evidence.test.ts 'discovery applies or explicitly reports every requested filter', 'discovery ranks focus metrics one at a time…' and 'discovery matches survey_ keys so real employers are found, separated from fictional rows'. Still open: the directory lists 12 employers against the 200-500 target, with no evidence invented.
- [2026-09-22 21:42 UTC] Scope change (user feedback in round 3, decision D12): acceptance items and verification added for employers the directory does not list, directory expansion with aliases, and employers without verification. D12's list of about 150-250 employers across sectors replaces the earlier target of 200-500 tech employers. As of 21:42 UTC it had landed: db/migrations/0009_directory.sql (212 real employers with name, slug and sector only, and a company_aliases table, INSERT OR IGNORE), an unlisted-employer state in web/canvas/views.tsx ('<name> isn’t in the directory yet', what opening a record takes, and a share action) and a 'Verification for this employer isn’t set up yet' notice in web/submit.tsx. Named tests exist: tests/privacy.test.ts 'migration 0009 only adds…'; tests/api.test.ts 'the directory lists the added real employers with their curated aliases…'; tests/jev.test.ts 'curated aliases name listed employers, and common words never do…' and 'through the inference worker, "charlesschwab" and "schwab" resolve to the listed employer…'; tests/browser.spec.ts 'an employer the directory does not list gets its own state, named as typed…'; tests/browser-contribute.spec.ts 'a real employer without work-mailbox verification says it isn’t set up yet…'. Group E has not run them since they landed. This ticket also waits on W-038 and W-040.
- [2026-09-23 01:26 UTC] Round-3 red-team fixes, with tests: RT-A2 ('Acme Widgets vs Stripe' now gets the unlisted state with Stripe's record offered, never fictional discovery rows: tests/jev.test.ts 'RT-A2 live-probe regression…'); RT-A1 in discovery (it ranks by the question's own topic and reports only that topic as unsupported: tests/jev.test.ts 'RT-A1: discovery ranks by the question’s own topic…'); RT-A4 (preference suggestions appear only in discovery); WS-02 (a link can carry only published criteria, and only to discovery). Pre-deploy pass: company forks list only employers the question plausibly names, at 0.12 or more (tests/jev.test.ts 'fork noise (round-3 verification, failure 4)…'). RT-C5 (Open Graph images for the added directory employers) is recorded on W-059. The open items of earlier entries were not re-checked for this entry.
