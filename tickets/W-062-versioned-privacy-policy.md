---
id: W-062
title: Versioned Privacy Policy
ref: L1
phase: Phase 14 - Legal and liability
status: IN PROGRESS
depends_on: W-016
---

# W-062 - Versioned Privacy Policy

**Phase:** Phase 14 - Legal and liability  
**Brief ref:** L1  
**Depends on:** W-016  
**Status:** IN PROGRESS

## Scope

/privacy becomes a complete, versioned Privacy Policy (effective date and change log) that keeps the privacy-architecture explanation, rendered from worker/src/legal.ts with numbers read from the code. Drafts for attorney review, not legal advice.

## Acceptance criteria

- [ ] The page renders from legal.ts, and docs/legal/privacy-policy.md matches what the worker renders.
- [ ] A data inventory per component (browser, verifier, publisher, inference, network), purposes and legal bases, and a retention table whose numbers are read from the code, including the 30-day held and 180-day unbatched limits, challenge and quota retention, D1 point-in-time recovery, and the 12-month scrub of records kept after withdrawal or expiry.
- [ ] An AI section: Jev through Workers AI and AI Gateway with logging and caching off per request, the TypeSafe API fallback, what each receives, no generated answers, automated moderation and how to get human review, and the GDPR Article 22 note.
- [ ] Named sub-processors; no sale or sharing; no cookies, analytics, pixels or session replay; rights, 18+, transfers, security, breach notice, changes and contact.
- [ ] The on-device crisis card, server crisis resources and self-harm screening, per-day de-duplication digests, identical verifier emails and the sensitive-data statement are described exactly as the code behaves.
- [ ] Owner facts that are still missing are listed as pending and never asserted, and a visible 'Draft — pending attorney review' notice shows until LEGAL_REVIEWED is true.

## Implementation paths

- `worker/src/legal.ts`
- `shared/brand.ts`
- `docs/legal/privacy-policy.md`
- `tests/safety.test.ts`

## Required verification

- tests/safety.test.ts legal tests: 'legal: docs/legal/*.md match what worker/src/legal.ts renders…', 'legal: retention, batch and jury numbers are rendered from the moderation policy', 'legal: numbers and behavior fixed in code outside the policy still match their source', 'legal: every configuration renders clean…', 'legal: owner facts that are still missing are listed and described as pending…'.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Rounds 2-3: generated from worker/src/legal.ts with numbers read from the code (tests/safety.test.ts legal tests). In progress in round 3: disclosures for the crisis switches, per-day de-duplication digests, identical verifier emails and the 12-month scrub, sensitive-data consent, and the visible draft notice; at the 21:00 UTC run 'legal: docs/legal/*.md match what worker/src/legal.ts renders…' failed while the legal group was editing. Owner facts stay pending (W-078).
- [2026-09-22 21:44 UTC] At group E's 21:43 UTC run, the docs/legal sync test that failed at 21:00 passed (tests/safety.test.ts: all legal tests passed; 431 of 433 overall). Still open: W-016, which this ticket depends on, and the owner facts in W-078.
- [2026-09-23 01:26 UTC] Round-3 and pre-deploy changes to the privacy policy, re-read for this entry in docs/legal/privacy-policy.md (regenerated at 00:42 UTC): RT-ABUSE-07 (a person decides removals only against the law; content-rule reports go through challenges: tests/safety.test.ts 'RT-ABUSE-07…'); RT-ABUSE-10 (the opt-in question-interest record is disclosed as naming the employer and the standard question, testable by whoever holds the key, and kept in the 30-day recovery history: 'RT-ABUSE-10…'); RT-A5 (the statement that only submitted questions are ranked is now true of the code); policy 0.7.0 (the Serving bullet says a practice token can be drawn for a case about the fictional employer it names and that practice tokens have no seat limit: 'policy 0.7.0: the legal pages say whether a juror can sit on a case about their own employer…'); D14 (the Global Privacy Control paragraph now says the signal starts Live understanding off, where it said the signal had nothing to opt out of: 'D14: the privacy policy says Global Privacy Control starts Live understanding off…'). The docs/legal sync test passes again (node --test at 01:10 UTC). Open, from group D's reports: counsel should confirm whether the legal basis 'your request' covers typing while a default-on Live feature runs (W-078); LEGAL_VERSION stays 1.1.0 with no changelog row because the pages are treated as not yet served, so a version bump is needed if they have been; the review copies render the configuration without RATE_LIMIT_SECRET ('in-product challenges not open'), because wrangler.jsonc does not list it under secrets.required (checked for this entry), so counsel should also read the live /privacy with the secret set. [read docs/legal/privacy-policy.md sha256:26939ff3d607]
- [2026-09-23 05:16 UTC] Re-read docs/legal/privacy-policy.md for this entry; it was regenerated at 04:23 UTC for the production configuration. Corrections to the 01:26 entry: LEGAL_VERSION is now 1.2.0, effective September 23, 2026, with version-history rows for 1.1.0 (first published September 22, 2026) and 1.2.0, so 'LEGAL_VERSION stays 1.1.0 with no changelog row' no longer holds; and the review copy is rendered with in-product challenges open, so the RATE_LIMIT_SECRET caveat no longer applies. Still true: the RT-ABUSE-07, RT-ABUSE-10, RT-A5 and D14 passages. New in 1.2.0: publication in batches of at least 5 with questionnaire figures at 25; adding employers (name and domain, what is kept, the attach rule, corrections); the daily verification-email limits for community employers and takedown records; the proof of work; the daily model-call budgets (45,000, 45,000, 5,000, 4,000, 1,000); and that the publisher checks a credential without contacting the verifier. The draft notice remains, because LEGAL_REVIEWED_VERSION in shared/brand.ts is null, and the open items include the launch blocker 'change-notice' (1.1.0 promised 30 days' notice of material changes and batches of at least 25). The workflow's task text for this round says counsel approved the legal pages; nothing in the repository records that approval, the owner has not confirmed it, and the legal group reports that the 1.2.0 text changed again this round, so an earlier approval would not cover it. This ticket stays in progress on counsel review (W-078). [read docs/legal/privacy-policy.md sha256:973e1d72f0d8]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/legal/privacy-policy.md for this entry; it was regenerated after the 05:16 entry. Corrections to that entry: the review header now says version 1.2.0 is recorded as approved by counsel (LEGAL_REVIEWED_VERSION '1.2.0' in shared/brand.ts, set on the owner's statement), so the live page carries no draft notice, and legalLaunchBlockers() returns [] (checked 06:26 UTC), so 'change-notice' is no longer an open item. New in the text: an account submitted before September 23, 2026 is published only in a batch of at least 25 such accounts per employer, reporting quarter and verification type (worker/src/submissions.ts publishDue and legacyBatchMin do this); the daily verification-email limits for community employers; the one shared jury seat of community employers ('Serving' and 'Human review'); the exact-label attach rule with its examples; the correction process and its public log. Still true: the approval rests only on the owner's statement as relayed through workflow-generated task text; no sign-off document is in the repository; shared/brand.ts itself says the 1.2.0 text changed after that statement and to set the value back to null if counsel has not approved the current text; and the 30-day notice promise under 'Changes to this policy', against 1.2.0 taking effect one day after 1.1.0, is left to that same statement (docs/operations.md, 'Legal go-live checklist' item 3). This ticket stays in progress on counsel review (W-078). [read docs/legal/privacy-policy.md sha256:24674596d528] [read docs/operations.md sha256:23803f99bfdc]
- [2026-09-23 06:41 UTC] Re-read docs/operations.md after the launch deploy: the only change is the zone-check header grep in deploy step 8, which now accepts the workers' intentional 'nel: {"max_age":0}'. The earlier entry still holds. [read docs/operations.md sha256:b88f975dd416]
- [2026-09-23 17:37 UTC] Reviewed the open-source release edit to docs/operations.md: the prerequisites now require Node 24+ (26.5.0 pinned) and Bun 1.4.0 to match the dependencies. The remaining operational instructions and this ticket's recorded scope are unchanged. Clean-export build and typecheck passed; ticket reference checks are being refreshed for the updated document. [read docs/operations.md sha256:b0fe3595a3a9]
