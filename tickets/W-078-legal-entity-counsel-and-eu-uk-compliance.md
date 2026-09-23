---
id: W-078
title: Legal entity, counsel and EU/UK compliance
ref: H9
phase: Phase 15 - Hardening
status: BLOCKED
depends_on: W-062, W-063
---

# W-078 - Legal entity, counsel and EU/UK compliance

**Phase:** Phase 15 - Hardening  
**Brief ref:** H9  
**Depends on:** W-062, W-063  
**Status:** BLOCKED

## Scope

The legal prerequisites the code cannot supply: counsel review, owner facts, the operator's entity and liability position, and the EU, EEA and UK duties if the service is offered there.

## Acceptance criteria

- [ ] Counsel reviews the Privacy Policy and Terms, and LEGAL_REVIEWED is set only after sign-off, which removes the draft notice.
- [ ] Owner facts are recorded in shared/brand.ts: mail forwarding verified for privacy@, legal@ and dmca@; the model provider's entity, country, retention, training use and data processing agreement; the DMCA agent registered with the US Copyright Office; the telephone provider.
- [ ] For the EU, EEA and UK: GDPR Article 27 representatives (EU and UK), the DSA legal representative, a data protection impact assessment, the UK Online Safety Act illegal-content and children's-access assessments, and the legal basis for sensitive information about other people; or those regions are not served (SERVES_EU_UK=false), or counsel accepts the risk in writing.
- [ ] Counsel confirms the legal entity's liability position, and the docs distinguish operational separation from legal protection.

## Implementation paths

- `shared/brand.ts`
- `worker/src/legal.ts`
- `docs/legal/`

## Required verification

- tests/safety.test.ts: 'legal: owner facts that are still missing are listed and described as pending…' and 'legal: EU and UK duties are pending on the pages until brand.ts records them…' pass, and legalOpenItems() in worker/src/legal.ts no longer lists any item named above.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] BLOCKED: Owner and counsel inputs: attorney review of the Privacy Policy and Terms (LEGAL_REVIEWED); mail forwarding proven for privacy@, legal@ and dmca@; the model provider's entity, country, retention, training use and data processing agreement; DMCA agent registration; the telephone provider; the EU, EEA and UK decision (representatives, DPIA, Online Safety Act assessments, sensitive-data basis) or geoblocking; the legal entity's liability position.
- [2026-09-22 21:41 UTC] Correction to the 21:11 BLOCKED entry: mail forwarding is no longer pending. Forwarding to privacy@, legal@ and dmca@ was verified on 2026-09-22 and the destination mailbox provider is named (shared/brand.ts CONTACT_MAIL). Under decision D13 none of the remaining items blocks launch; legalOpenItems() in worker/src/legal.ts listed them at 21:41 UTC as model-provider, telephone-provider, dmca-agent, counsel-review, registered-agent, eu-representative, uk-representative, dsa-legal-representative, dpia, uk-online-safety-assessments, third-party-sensitive-data-basis and support-checks-sensitive-data-basis.
- [2026-09-22 21:41 UTC] BLOCKED: Owner and counsel inputs: attorney review of the Privacy Policy and Terms (LEGAL_REVIEWED); the model provider's entity, country, retention, training use and data processing agreement; DMCA agent registration; the telephone provider; whether to name a registered agent; the EU, EEA and UK decision (Article 27 and DSA representatives, a DPIA, the Online Safety Act assessments, the basis for sensitive data about other people and for support checks) or not serving those regions; and counsel's view of the legal entity's liability position.
- [2026-09-23 01:26 UTC] Counsel and owner follow-ups from the pre-deploy legal fixes (group D's report): the privacy policy's legal basis for interpreting searches now reads 'Your request when you submit a question, or when you type while Live understanding is on (it is on by default, starts off under Global Privacy Control, and you can switch it off)'; whether 'your request' covers typing while a default-on feature runs is a question for counsel. LEGAL_VERSION stays 1.1.0 with no new changelog row because the pages are treated as not yet served; if they have been served publicly, this change needs a version bump and a changelog entry in shared/brand.ts. The review copies in docs/legal render without RATE_LIMIT_SECRET (challenges shown as not open), so counsel should also read the live pages with the secret set.
- [2026-09-23 05:16 UTC] Launch-release update. LEGAL_VERSION is 1.2.0 (effective 2026-09-23) and LEGAL_REVIEWED_VERSION in shared/brand.ts is null, so the live pages would carry 'Draft — pending attorney review'. The workflow's task text for this round says counsel approved the legal pages and asks for LEGAL_REVIEWED=true; the legal group left it null because that statement came only from script-generated text, not from the owner, and because the 1.2.0 text changed again this round. The tracker records no counsel approval. legalLaunchBlockers() now lists 'change-notice' as a launch blocker (1.1.0, first served September 22, promised 30 days' notice of material changes and batches of at least 25), which closes only with counsel's sign-off on 1.2.0. The 01:26 entry's 'LEGAL_VERSION stays 1.1.0' and its RATE_LIMIT_SECRET caveat no longer hold (see W-062). Still blocked on counsel and owner inputs.
