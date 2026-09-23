---
id: W-030
title: Equal-access challenges and anonymous budgets
phase: Phase 10 - Constitutional moderation
status: BLOCKED
depends_on: W-028
---

# W-030 - Equal-access challenges and anonymous budgets

**Phase:** Phase 10 - Constitutional moderation  
**Depends on:** W-028  
**Status:** BLOCKED

## Scope

Any reader including employers uses the same published-rule challenge flow. Jev checks relevance to the cited rule; reputational discomfort is not a valid ground. Anonymous token budgets, duplicate-case merging, and deterministic friction for abuse; no paid priority or employer account.

## Acceptance criteria

Frivolous and duplicate challenges cannot suppress a review; budget redemption is atomic; rule relevance and counterexamples are evaluated; no organization gets privileged handling.

## Log

- [2026-09-22 05:27 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Challenges run today for every citable rule, with practice juries for fictional employers and a daily budget of 5 per client under keyed digests deleted after the day: tests/moderation.test.ts 'frivolous challenges cannot suppress…', 'equal access: no organization, priority or override field is accepted…', 'a reason that does not map to the cited rule is rejected… reputational discomfort is not a ground', 'each client may send 5 challenges per UTC day…'. Jury-range challenges on real employers wait for juries.
- [2026-09-22 21:11 UTC] BLOCKED: waits on W-028 (blocked: Mailbox possession is not one-human-one-vote; requires reviewed anti-Sybil eligibility and private exclusion proofs.)
- [2026-09-23 01:26 UTC] Round-3 red-team fixes on challenges, with tests: RT-ABUSE-03 and WS-04 (the daily budget of 5 and the burst limiter count an IPv6 client by its /64: tests/moderation.test.ts 'RT-ABUSE-03…'; tests/integration.mjs 'challenge: addresses in one IPv6 /64 share one daily budget'); RT-ABUSE-04 (privacy and safety rules get 50 re-checks of their own before the shared 100, a failed re-check is not counted, a relevant challenge with no capacity is queued with a receipt and re-checked by the scheduled job, and a challenge refused before it is considered costs no budget: tests/moderation.test.ts 'RT-ABUSE-04…'). Residual: a flood of relevant challenges against many accounts can still delay a genuine privacy challenge behind others of its kind (docs/threat-model.md). Still blocked on W-028. [read docs/threat-model.md sha256:0449c1a76dd9]
- [2026-09-23 02:46 UTC] Re-read docs/threat-model.md after the 2026-09-22 production-fix pass: it now records that Cloudflare zone features can inject scripts or headers for browser user agents and the no-transform/NEL/HTTP-redirect guard. The earlier entry still holds. [read docs/threat-model.md sha256:d45e1f335d37]
- [2026-09-23 05:16 UTC] Re-read docs/threat-model.md for this entry; it changed at 04:19 UTC, after the 02:46 entry. Section 9 still records the zone-injection risk and the no-transform, NEL and HTTP-redirect guard, so the 02:46 entry holds. Section 5 still says challenges need RATE_LIMIT_SECRET and are limited to 5 per network per UTC day. New for this ticket: a relevant challenge can now reach a real-employer jury (JURY_ENABLED is 'true'), and such juries can be staffed with community juror tokens from domains one person lists (W-028, W-083). [read docs/threat-model.md sha256:1813a789fc8f]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/threat-model.md for this entry. Section 5 still says challenges need RATE_LIMIT_SECRET and are limited to 5 per network per UTC day, and section 9 still records the zone-injection risk and the no-transform, NEL and HTTPS guard, so the 02:46 entry holds. Correction to the 05:16 entry: community juror tokens can no longer staff a real-employer jury that a challenge reaches beyond one seat; all community-key tokens share one seat per case and never make a jury formable (policy 0.8.0, worker/src/moderation.ts; see W-028). [read docs/threat-model.md sha256:d4dfb76d64f7]
