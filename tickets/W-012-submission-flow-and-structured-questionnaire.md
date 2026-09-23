---
id: W-012
title: Submission flow and structured questionnaire
phase: Phase 4 - Voice
status: DONE
depends_on: W-004
completed: 2026-09-22 05:05 UTC
---

# W-012 - Submission flow and structured questionnaire

**Phase:** Phase 4 - Voice  
**Depends on:** W-004  
**Status:** DONE

## Scope

Three-layer submission: experience (verbatim), claim (specific factual allegation), opinion (labeled). Structured multiple-choice health-record questions plus optional narrative. Delayed publication disclosure.

## Acceptance criteria

Verbatim text is stored unmodified; layers are distinguishable end to end; opinion is never scored as fact.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Submission flow
- [2026-09-22 05:05 UTC] Layer picker (experience/claim/opinion), verbatim storage, optional structured answers, period field, receipt with randomized release window and routing rules.
- [2026-09-22 21:11 UTC] Re-verified in round 3: tests/publication.test.ts 'a batch publishes under fresh random public ids…', 'a revision that lands before the claim is never published as the stale body…' and 'decisions pin policy version, digest, matched rules…', and tests/acceptance.test.ts 'policy maps privacy uncertainty to repair… and does not gate on sentiment or allegations' pass. Allegations stay attributed testimony; model readings are labeled as readings, never facts or votes. The consent fields added in round 3 are tracked in W-069 (L8).
