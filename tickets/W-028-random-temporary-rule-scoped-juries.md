---
id: W-028
title: Random temporary rule-scoped juries
phase: Phase 10 - Constitutional moderation
status: BLOCKED
depends_on: W-026, W-027
---

# W-028 - Random temporary rule-scoped juries

**Phase:** Phase 10 - Constitutional moderation  
**Depends on:** W-026, W-027  
**Status:** BLOCKED

## Scope

Randomly select 7 eligible jurors, no reputation or permanent moderator role. Present one constitutional YES/NO/UNSURE question with minimum necessary scrubbed passage. Hide author, exact time, employer unless necessary, prior votes and other jurors. Bounded assignment, expiry and replacement.

## Acceptance criteria

Selection and quorum rules are auditable; votes are blind until close; duplicate voting and conflicted credentials fail; insufficient jurors yields an honest pending state, never simulated votes.

## Log

- [2026-09-22 05:27 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Implemented and verified for practice juries on the fictional employers: tests/moderation.test.ts 'votes are blind and single…', 'a full jury closes the case…', 'after 7 days a case closes on a 70% quorum…', 'a held case opens no jury case… while no juror could be seated', 'conflicted or misused credentials never seat a juror…'. Real-employer juries stay off (JURY_ENABLED unset).
- [2026-09-22 21:11 UTC] BLOCKED: waits on W-027 (blocked: Mailbox possession is not one-human-one-vote; requires reviewed anti-Sybil eligibility and private exclusion proofs.)
- [2026-09-23 01:26 UTC] Round-3 red-team RT-B1: on the running stack no practice jury could form (three fictional employers, too few eligible seats under the own-employer exclusion and the 2-seat cap). Policy 0.7.0 lets any fictional employer's sandbox juror tokens staff a practice case, including one about the employer the token names, with no per-employer seat limit (tests/moderation.test.ts 'practice juries (0.7.0, RT-B1)…'; tests/integration.mjs 'jury: a published sandbox juror key is enough for a practice jury (policy 0.7.0)' and 'jury: practice juries are reported only when enough fictional employers can reach a decision', passed at 01:15 UTC). One person can therefore hold several seats on a practice case; docs/threat-model.md and docs/protocol-poewi.md say practice juries are not Sybil-resistant and demonstrate the procedure only. RT-RET-05 fixed: a case keeps only the UTC day it opened, and withdrawal or expiry erases its links to the contribution (tests/moderation.test.ts 'RT-RET-05…', tests/publication.test.ts 'RT-RET-05…'). Still blocked on W-027. [read docs/threat-model.md sha256:0449c1a76dd9] [read docs/protocol-poewi.md sha256:1a996f114d48]
- [2026-09-23 02:46 UTC] Re-read docs/threat-model.md after the 2026-09-22 production-fix pass: it now records that Cloudflare zone features can inject scripts or headers for browser user agents and the no-transform/NEL/HTTP-redirect guard. The earlier entry still holds. [read docs/threat-model.md sha256:d45e1f335d37]
- [2026-09-23 05:16 UTC] Re-read docs/threat-model.md and docs/protocol-poewi.md for this entry; both changed at 04:19 UTC, after the 01:26 and 02:46 entries. Both still say practice juries are not Sybil-resistant and only demonstrate the procedure, and the threat model keeps the zone-injection paragraph, so those entries hold; both now add that sandbox tokens exist only where fictional employers are shown, never in production. Correction to the 21:11 entry's 'Real-employer juries stay off (JURY_ENABLED unset)': wrangler.jsonc now sets JURY_ENABLED 'true' for the launch release (the owner decision of September 23, 2026 that docs/product-principles.md records), so real-employer juries form whenever enough employers have live juror keys, while W-027, the anti-Sybil prerequisite this ticket waits on, is still blocked. A new Sybil path the documents state only in part: anyone who controls a domain can list an employer and obtain community juror tokens (up to 50 a quarter), and worker/src/moderation.ts treats each community-listed employer as a separate employer with 2 seats, so 2 such domains fill the 4 seats that uphold a first jury (4 of 7) and 3 the 5 that uphold an appeal (5 of 9). The fix is a criterion on W-083. Still blocked on W-027. [read docs/threat-model.md sha256:1813a789fc8f] [read docs/protocol-poewi.md sha256:892e76c3f882] [read docs/product-principles.md sha256:5a49bcc7a422]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/threat-model.md, docs/protocol-poewi.md and docs/product-principles.md for this entry. Both technical documents still say practice juries are not Sybil-resistant and exist only where fictional employers are shown. Correction to the 05:16 entry's new Sybil path: it no longer holds in code. shared/policy.ts policy 0.8.0 sets jury.communitySeatsPerCase 1; worker/src/moderation.ts seatGroup puts every community-key token (source 'community', whichever listing it names, including a domain attached to a curated listing) in one keyed seat group per case capped at 1, and jurorEmployers ignores community keys when deciding whether a jury can form. tests/moderation.test.ts 'jury capture: tokens of employers added by the community, however many, share one seat per case and never make a jury formable' passed in node --test "tests/*.test.ts" at 06:17-06:18 UTC; a scratch test by the final verifier (4 community domains, 3 tokens each, against one real-employer case) seated 1 of the 12 tokens and could not make a jury formable until 3 other curated employers held keys. threat-model.md section 4 and protocol-poewi.md 'Seats' and 'Limits' now state this. Remaining residual: one curated employer's mailboxes still fill up to 2 seats. Still blocked on W-027. [read docs/threat-model.md sha256:d4dfb76d64f7] [read docs/protocol-poewi.md sha256:c8073876411e] [read docs/product-principles.md sha256:ee5134164660]
