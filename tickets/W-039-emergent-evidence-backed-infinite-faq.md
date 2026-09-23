---
id: W-039
title: Emergent evidence-backed Infinite FAQ
phase: Phase 11 - Jev acceptance
status: IN PROGRESS
depends_on: W-036, W-038
---

# W-039 - Emergent evidence-backed Infinite FAQ

**Phase:** Phase 11 - Jev acceptance  
**Depends on:** W-036, W-038  
**Status:** IN PROGRESS

## Scope

Grow company question architecture from semantic equivalence and sufficient evidence, rather than a fixed FAQ list. Support related follow-ups and reversible question trails without storing search histories.

## Acceptance criteria

- [ ] Equivalent phrasings map to a canonical typed question specification; only approved public topic/cohort/event IDs persist.
- [ ] New canonical combinations can emerge beyond the starter list, with deterministic wording and traceable source coverage.
- [ ] Question counting is opt-in, coarse and rate-limited; raw question text, IP, email and credential are absent from FAQ storage.
- [ ] Publish a question only after the popularity and evidence thresholds both pass; no fabricated 'people asked' counts.
- [ ] Clicking a question or follow-up drives the existing intent/evidence pipeline and browser history remains reversible.

## Implementation paths

- `shared/faq.ts`
- `worker/src/evidence.ts`
- `worker/src/index.ts`
- `db/migrations/`
- `web/app.tsx`

## Required verification

- Three paraphrases of remote promotion fairness collapse into one canonical spec.
- A frequent question with no evidence does not appear as an answered FAQ.
- Rare/private identifiers never become canonical labels.
- Withdrawal/suppression removes FAQ evidence eligibility without retaining source text in query logs.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Verified: tests/evidence.test.ts 'question specs are deterministic, round-trip, and paraphrases with the same typed fields collapse' and 'a popular question needs both the interest threshold and evidence, and counts are never displayed'; tests/jev.test.ts 'FAQ interest counts once per client, employer, question and UTC day; the record is a keyed digest and a day, and earlier days are deleted'. Closes after W-036 and W-038.
- [2026-09-23 01:26 UTC] Correction to the 21:11 entry: 'FAQ interest counts once per client, employer, question and UTC day; the record is a keyed digest and a day, and earlier days are deleted' is in tests/api.test.ts, not tests/jev.test.ts. Round 3: that record is now keyed by the IPv6 /64 (WS-03), and the privacy policy discloses that the opt-in record names the employer and the standard question (RT-ABUSE-10, fixed by disclosure; de-duplicating without the employer would stop counting interest once per question). What was open is unchanged.
