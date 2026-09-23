---
id: W-076
title: zkEmail/DKIM employment proofs
ref: H7
phase: Phase 15 - Hardening
status: PENDING
depends_on: W-014
---

# W-076 - zkEmail/DKIM employment proofs

**Phase:** Phase 15 - Hardening  
**Brief ref:** H7  
**Depends on:** W-014  
**Status:** PENDING

## Scope

Let a contributor prove control of a work mailbox from a DKIM-signed email with a zero-knowledge proof in the browser, so no verifier learns the address at all.

## Acceptance criteria

- [ ] A browser-generated zero-knowledge proof over a DKIM-signed email proves the employer domain without revealing the mailbox, and the publisher verifies it offline.
- [ ] The proof binds a quarter and a nullifier so one mailbox yields one credential per employer per quarter.
- [ ] DKIM key rotation and domain aliases are handled and tested; an employer that controls mailboxes is disclosed as a limit.
- [ ] The circuit (and any trusted setup) is reviewed independently before the product claims its strength.

## Implementation paths

- `docs/hardening-roadmap.md`
- `shared/proof.ts`
- `web/submit.tsx`

## Required verification

- Proof round-trip, forged-DKIM, wrong-domain, replayed-nullifier and rotated-key tests.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Not started. A design is to be recorded in docs/hardening-roadmap.md. Any claim about proof strength waits for an independent review of the circuit.
- [2026-09-22 21:41 UTC] Correction to the 21:11 entry: docs/hardening-roadmap.md section 2 ('Mailbox proof without an email step (DKIM)') already recorded the design when it was written: a zkEmail-style circuit over the DKIM signature, the From domain and a verifier nonce with the local part hidden, or an interim, weaker check of a pasted DKIM-signed message. Its plan: (a) survey DKIM coverage for listed employers, (b) prototype the circuit and measure proving time, (c) add a second issuance path, flagged per employer, (d) have the circuit reviewed externally before any real employer uses it. Nothing is implemented, and no claim about proof strength is made.
- [2026-09-22 22:32 UTC] Re-read docs/hardening-roadmap.md for this entry; it changed at 22:27 UTC, after the 21:41 entry. Section 2 still records the zkEmail-style design, the weaker interim check of a pasted DKIM-signed message and the plan (a) to (d); no code under worker/, web/ or shared/ handles DKIM. The 21:41 entry holds. [read docs/hardening-roadmap.md sha256:8d75d1eaf48b]
- [2026-09-23 01:26 UTC] Re-read docs/hardening-roadmap.md for this entry; it changed at 00:45 UTC. Section 2 still records the zkEmail-style design, the weaker interim check of a pasted DKIM-signed message and the plan (a) to (d); no code under worker/, web/ or shared/ handles DKIM (worker/generated/client-assets.ts matches only because it bundles the source for download). The 22:32 entry holds. [read docs/hardening-roadmap.md sha256:169b354fe170]
- [2026-09-23 05:16 UTC] Re-read docs/hardening-roadmap.md for this entry; it changed at 04:19 UTC, after the 01:26 entry. Section 2 is unchanged (the zkEmail-style design, the weaker interim check of a pasted DKIM-signed message, plan (a) to (d)), and no code under worker/, web/ or shared/ handles DKIM (only worker/generated/client-assets.ts matches, as the downloadable source bundle). The 01:26 entry holds. [read docs/hardening-roadmap.md sha256:176123a1bbda]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/hardening-roadmap.md for this entry. Section 2 is unchanged (the zkEmail-style design, the weaker interim check of a pasted DKIM-signed message, plan (a) to (d)), and no code under worker/, web/ or shared/ handles DKIM: a search for 'dkim' matches only worker/generated/client-assets.ts, the downloadable source bundle. The 01:26 entry holds. [read docs/hardening-roadmap.md sha256:edf2eb228985]
