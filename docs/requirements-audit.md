# Should I Work There: acceptance audit

> **Historical.** This is the audit that started the rebuild, and its "confirmed defects" describe code that has since
> been replaced: for example, verification is now a blind-signed mailbox credential from a separate verifier, the
> publisher cannot rewrite testimony, publication is batched, and FAQ entries are typed specs. Do not read it as the
> current state; for that, read
> [protocol-poewi.md](protocol-poewi.md), [threat-model.md](threat-model.md),
> [constitutional-moderation.md](constitutional-moderation.md) and the ticket record in `tickets/`.

This supersedes the earlier blanket “22/22 complete” report. Completion means
tested behavior, not a component name or a comment promising the behavior.

## Confirmed defects at the start of this pass

- `issued_credentials.redeemed_by` and `pending_submissions.claim_id` hold the
  same value. The claimed absence of a shared join key was incorrect.
- Verification is a browser-visible demonstration challenge, not employment proof.
- One Worker has both database bindings; comments do not enforce isolation.
- Moderation can replace testimony without author approval and reset the delay.
- Publication does not enforce a minimum batch, and sends pending prose to Jev.
- Complementary suppression runs after filtering siblings out of the query.
- Dates/events are inferred but the timeline compares the last two periods anyway.
- Live typing updates chips only, has no stale-result guard, and does not morph views.
- Chip removal uses null-coalescing so removed filters can be applied again.
- FAQ entries are seeded text, not interactive or evidence-ranked.
- Source links, aggregation, legal/financial administration, PWA, and archives are incomplete.
- Tests previously called a moderator bypass “nothing before its window”; that test
  never asserted the original delay was preserved.
- The remote DB setup command reseeds by deleting tables. It is unsafe for updates.

## Acceptance map

| Requirement | Acceptance evidence |
|---|---|
| No ads, privileged employers, profiles, feed, paid suppression | No product paths for these; published covenant and governance proposal |
| No identity-to-testimony join | Independent verifier storage; blind issuance; publisher verifies offline; schema and adversarial tests |
| Real employment proof | **External prerequisite:** attestation provider, independent account/operator, reviewed protocol deployment |
| Local keys and recovery | Per-submission device key, signed author actions, explicit backup, no global reviewer identifier |
| Privacy inspection | Local findings, author-approved abstractions, server rejects direct identifiers before storage/inference |
| Delayed batch release | Original delay is never shortened; thresholded cohorts; no exact eligibility time in receipts |
| Health record | Structured response aggregation, explicit denominators, fixed time periods, no model probabilities counted as votes |
| Corroboration | Public-source pair judgments with source IDs; distinct credentials distinguished from independent humans |
| Intent-driven UI | One input; live opt-in; chips, ambiguity choices, event-aware charts, discovery, and stale-response tests |
| Infinite FAQ | Evidence-ranked canonical questions, interactive follow-ups, opt-in coarse counts; no stored raw questions |
| Jev background processing | Public or explicitly approved scrubbed inputs only; risk triage separated from descriptive sentiment |
| Transparency | Append-only ledgers, real/unknown costs, published source bundle and deployment-specific limitations |
| Anti-enshittification governance | Draft protected-principle amendment rules; **legal adoption/independent trustees are external prerequisites** |
| Donations | No product privilege; payment account/recipient required before enabling collection |
| Deployment | Safe additive migrations; browser/API/privacy tests; public disclosures match actual configured services |

## Release rule

Demonstration credentials cannot publish claims about real employers. Missing
attestation, legal formation, independent operators, or audit work stay visibly
blocked in tickets. A good-looking demo is not proof of anonymity.
