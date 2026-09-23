---
id: W-027
title: Anonymous juror eligibility and anti-Sybil proofs
phase: Phase 10 - Constitutional moderation
status: BLOCKED
depends_on: W-025, W-024
---

# W-027 - Anonymous juror eligibility and anti-Sybil proofs

**Phase:** Phase 10 - Constitutional moderation  
**Depends on:** W-025, W-024  
**Status:** BLOCKED

## Scope

Prove eligible established participation without public profiles; exclude the subject employer and prior case participants; domain-separated one-case nullifiers; private opt-in juror pool. Model credential strength honestly: mailbox possession is not proof of one human.

## Acceptance criteria

Cross-employer exclusion, credential replay, alias abuse, prior-interaction exclusion and eligibility-expiry tests pass; independent protocol review supports any one-human-one-vote claim.

## Log

- [2026-09-22 05:27 UTC] Ticket created.
- [2026-09-22 05:27 UTC] BLOCKED: Mailbox possession is not one-human-one-vote; requires reviewed anti-Sybil eligibility and private exclusion proofs.
- [2026-09-22 21:11 UTC] Rounds 2-3: juror tokens are blind, carry purpose 'juror' and one canonical nullifier, and are limited to 3 per mailbox, employer and quarter, with at most 2 seats per juror employer on one case (tests/protocol.test.ts '/issue-juror signs 1–5 tokens per mailbox challenge, within a per-quarter quota of 3…'; tests/moderation.test.ts seat tests). Still true, and the reason this stays blocked: mailbox possession is not one human, one mailbox holder can hold several unlinkable seats, and an employer that controls mailboxes can hold more. An independent protocol review is the prerequisite.
- [2026-09-23 01:26 UTC] Correction to the 21:11 entry. Its test '/issue-juror signs 1–5 tokens per mailbox challenge, within a per-quarter quota of 3…' was rewritten in round 3 (red-team RT-ORACLE-06) as tests/protocol.test.ts '/issue-juror issues a mailbox its juror tokens once per employer and quarter (one set of up to 3, separate from the contribution credential); a later request learns only that they were issued, never how many (RT-ORACLE-06)'. Under policy 0.7.0 the limit of 2 seats per juror employer on one case and the own-employer exclusion apply to real-employer juries only; practice (sandbox) juries have neither (see W-053). The reason this ticket is blocked is unchanged: mailbox possession is not one human, and an independent protocol review is the prerequisite.
