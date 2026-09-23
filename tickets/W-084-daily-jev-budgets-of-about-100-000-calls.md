---
id: W-084
title: Daily Jev budgets of about 100,000 calls
phase: Phase 16 - Public launch
status: IN PROGRESS
depends_on: W-006
---

# W-084 - Daily Jev budgets of about 100,000 calls

**Phase:** Phase 16 - Public launch  
**Depends on:** W-006  
**Status:** IN PROGRESS

## Scope

Owner decision of September 23, 2026: hosted Jev calls total about 100,000 a UTC day, split by purpose so no purpose can starve another: search 45,000, live 45,000, screen 5,000, analysis 4,000, relevance 1,000.

## Acceptance criteria

- [ ] BUDGETS in worker/inference-core.ts is {search:45000, live:45000, screen:5000, analysis:4000, relevance:1000}, 100,000 calls a UTC day, each charged atomically; relevance equals the published daily cap on hosted relevance checks.
- [ ] Reserves keep their earlier proportions: optional search work (ranking, retrieval, checks of new listings) may bring the search counter only to 30,000, and anonymous draft checks the screening counter only to 2,500.
- [ ] Live understanding spends only the live budget and pauses quietly when it is spent; explicit searches spend only the search budget; a spent budget never reaches the provider, and queued analysis waits for budget instead of being dropped.
- [ ] Every document that states the budgets (the privacy policy, docs/evaluation.md) gives the numbers the code applies.

## Implementation paths

- `worker/inference-core.ts`
- `worker/src/app.ts`
- `worker/src/legal.ts`
- `docs/evaluation.md`

## Required verification

- tests/community.test.ts 'daily Jev budgets total about 100,000 calls, and reserves keep their earlier proportions'.
- tests/jev.test.ts: 'search traffic cannot exhaust the screening budget', 'queued analysis under a spent budget never calls the provider and is not dropped…', '/relevance has its own daily budget…', 'Live understanding is charged to its own daily budget…', 'RT-ABUSE-02: anonymous draft checks spend only their share of the screening budget…'.
- tests/api.test.ts: 'live understanding has its own budget…', 'live calls are marked live all the way to the inference worker…'; tests/safety.test.ts 'legal: numbers and behavior fixed in code outside the policy still match their source'.

## Log

- [2026-09-23 05:11 UTC] Ticket created.
- [2026-09-23 05:14 UTC] Started. State read for this entry (group E, 05:00–05:15 UTC). Done and tested: BUDGETS in worker/inference-core.ts is {search:45000, live:45000, screen:5000, analysis:4000, relevance:1000}, 100,000 in all, with RESERVES {search:15000, screen:2500}, so optional search work stops at 30,000 and anonymous draft checks at 2,500; checks of new listings are charged to search as optional work; the privacy policy states the five numbers. Tests: tests/community.test.ts 'daily Jev budgets total about 100,000 calls, and reserves keep their earlier proportions'; tests/safety.test.ts 'legal: numbers and behavior fixed in code outside the policy still match their source'; the budget tests in tests/jev.test.ts and tests/api.test.ts named on this ticket. All passed in node --test "tests/*.test.ts" at 05:01–05:02 UTC.
  Open: the documents criterion. docs/evaluation.md 'Budgets' still says 'The daily model-call budgets are unchanged (search 1500, Live 1000, screening 600, analysis 800, challenge relevance 100)', gives the old reserves (ranking up to 1000 of 1500, draft checks up to 300 of 600) and the old per-client shares (60 submitted questions, 40 Live readings, 20 draft checks). worker/src/app.ts CLIENT_DAILY is now {search:150, live:200, precheck:20}; the main group raised the first two this round and left keeping or reverting them to the owner. A docs correction for group A. [read docs/evaluation.md sha256:94776266f9a2]
