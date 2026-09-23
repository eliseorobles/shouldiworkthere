---
id: W-063
title: Terms of Use
ref: L2
phase: Phase 14 - Legal and liability
status: IN PROGRESS
depends_on: W-016, W-025
---

# W-063 - Terms of Use

**Phase:** Phase 14 - Legal and liability  
**Brief ref:** L2  
**Depends on:** W-016, W-025  
**Status:** IN PROGRESS

## Scope

/terms: eligibility, content rules as the executable constitution, ownership and license of testimony, attributed allegations, notice and challenge, legal notices, DMCA, disclaimers and liability, governing law and venue in Texas, USA. Drafts for attorney review, not legal advice.

## Acceptance criteria

- [ ] Users must be 18 or older; the content rules are the executable constitution (linked); accounts must be truthful and firsthand; no naming private individuals, doxxing, threats, trade secrets or confidential information, or harassment.
- [ ] Testimony stays the author's (license to display and aggregate; withdrawal); allegations are attributed testimony that the platform does not verify or endorse; no affiliation with any employer, names used descriptively, no logos.
- [ ] Notice and challenge follow the published rules with equal access, and juries and appeals are described as they actually run; legal notices and court orders go to legal@ and the legal-requests ledger; trustee break-glass is described only as it is enabled.
- [ ] A DMCA policy with a designated agent at dmca@, with registration with the US Copyright Office stated as pending until it is done.
- [ ] Jurors are volunteers; no payments, subscriptions or trials; disclaimers, limitation of liability and indemnity; governing law and venue in Texas, USA; changes with notice; contact.
- [ ] The legal operator is named only in legal text, never as product branding.

## Implementation paths

- `worker/src/legal.ts`
- `shared/brand.ts`
- `docs/legal/terms.md`
- `tests/safety.test.ts`

## Required verification

- tests/safety.test.ts: 'legal: challenges and juries are described as they run…', 'legal: the operator is named only in legal text, never as product branding', 'legal: every site path a legal page links to is served by the worker', 'legal: the version and changelog agree…'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Rounds 2-3: generated from worker/src/legal.ts; governing law and venue in Texas, USA; DMCA agent registration stated as pending; tests/safety.test.ts 'legal: challenges and juries are described as they run…' and 'legal: the operator is named only in legal text…' pass. In progress in round 3 with the policy changes; counsel review is W-078.
- [2026-09-23 01:26 UTC] Round-3 and pre-deploy changes to the terms, re-read for this entry in docs/legal/terms.md (regenerated at 00:44 UTC): RT-ABUSE-07 (content rules are enforced through challenges; a person acts only on legal notices), RT-D1 (practice juries 'decide cases about fictional sample employers only when enough jurors can serve', pointing to /moderation#juries: tests/safety.test.ts 'RT-D1: practice juries and appeals are described as deciding only when one can form' and 'RT-D1: the status line says a jury is switched on but cannot form…'), and policy 0.7.0 (the moderation journey found /terms still describing the 0.6.0 rule that practice jurors must come from other fictional employers; the text is now built from the same policy functions moderation.ts uses: 'policy 0.7.0: the legal pages say whether a juror can sit on a case about their own employer, and which seats are limited, as moderation.ts applies it'). Per the legal fix report, the /moderation and /transparency status line no longer reads 'one other fictional employers' or 'counting the case's own employer' when no sandbox keys are published. These tests passed in node --test at 01:10 UTC. What was open is unchanged. [read docs/legal/terms.md sha256:b17069faf939]
- [2026-09-23 05:16 UTC] Re-read docs/legal/terms.md for this entry; it was regenerated at 04:23 UTC as version 1.2.0 for the production configuration. That copy says there are no fictional or sample employers on the site, so the RT-D1 practice-jury passages the 01:26 entry quoted are not in it; the tests the entry cites still pass (tests/safety.test.ts in node --test "tests/*.test.ts" at 05:01–05:02 UTC). New: 'Employers added by the community' with 'Correcting a listing' (a person reviews each request sent to legal@). The text is the project's own and keeps its protective clauses: the contribution license, 'We do not verify or endorse what contributors say', the content rules, no affiliation with or endorsement by employers, the DMCA section, disclaimers, limitation of liability, indemnity, and Texas law and venue. The draft notice stays: LEGAL_REVIEWED_VERSION is null and legalLaunchBlockers() lists 'change-notice'. The statement that counsel approved the terms appears only in workflow-generated task text; nothing in the repository records it and the owner has not confirmed it (W-078). [read docs/legal/terms.md sha256:f0ba162f0b98]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/legal/terms.md for this entry; it was regenerated after the 05:16 entry. The review header now says 1.2.0 is recorded as approved by counsel on the owner's statement, so the live page carries no draft notice, and legalLaunchBlockers() returns []. New: earlier accounts keep the 1.1.0 batch of 25 ('What the service is'); daily verification-email limits for community domains ('Verification' and 'Employers added by the community'); 'Correcting a listing' now describes the operator route with the administrator key, the verifier-first detach, the mirrored direct takedown and the public correction log; 'Jurors' states the single shared community seat. It still says there are no fictional or sample employers on the site. The protective clauses the 05:16 entry lists are all still present (the contribution license, 'We do not verify or endorse what contributors say', the content rules, no affiliation or endorsement, the DMCA section, disclaimers, the US$100 liability cap, indemnity, Texas law and venue). Counsel's approval is still only the owner's relayed statement (W-078). [read docs/legal/terms.md sha256:7add14e0469a]
