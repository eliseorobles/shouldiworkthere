---
id: W-043
title: End-to-end private-zone inference boundary
phase: Phase 11 - Jev acceptance
status: IN PROGRESS
depends_on: W-026, W-036
---

# W-043 - End-to-end private-zone inference boundary

**Phase:** Phase 11 - Jev acceptance  
**Depends on:** W-026, W-036  
**Status:** IN PROGRESS

## Scope

Enforce the boundary from local draft to explicitly approved scrubbed material to isolated inference. Email, credentials, private keys, IPs and attestation requests never enter Jev state or logs.

## Acceptance criteria

- [ ] Draft typing is local; each suggested replacement requires explicit author approval and preserves meaning.
- [ ] No direct identifiers are forwarded when the local/server detector flags them; contextual risk is described honestly.
- [ ] Inference ingress accepts only strict allowlisted schemas and public source IDs or explicit approved-text consent.
- [ ] Browser/network tests inspect actual bodies and verify no email, proof, author key or identity metadata crosses to inference.
- [ ] No analytics, session replay, cross-service request ID or persistent query/IP history is added.

## Implementation paths

- `shared/privacy.ts`
- `web/submit.tsx`
- `worker/issuer.ts`
- `worker/inference.ts`
- `worker/src/index.ts`
- `tests/browser.spec.ts`

## Required verification

- Paste a named colleague, employer email, precise date and unique role; no draft leaves the browser until approved.
- Spoof consent with an email-bearing payload; server still blocks before inference.
- Withdraw or revise during an in-flight analysis; stale results cannot restore removed content.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Verified: tests/jev.test.ts 'bodies sent toward inference never carry emails, phone numbers, proofs, author keys, capabilities or client addresses', tests/acceptance.test.ts 'privacy findings are rejected before inference or persistence', tests/browser-contribute.spec.ts 'the draft reaches Jev only after explicit consent…' (npx playwright test tests/browser-contribute.spec.ts on 2026-09-22 21:06 UTC: 42 passed, 1 skipped (the opt-in screenshot pass)). Closes after W-036.
- [2026-09-23 01:26 UTC] Round-3 red-team findings on the inference boundary. RT-ABUSE-01 (critical) mitigated: shared/privacy.ts holds a draft with a note addressed to reviewers, moderators or automated checks, or a street address, before any model call (/screen and /api/screen answer 422), widened in the pre-deploy pass to notes anywhere in a draft; every question that reads contributor text says it is untrusted data (tests/jev.test.ts 'RT-ABUSE-01: every question that reads contributor text treats it as data…' and 'RT-ABUSE-01 live-probe regression…'; tests/privacy.test.ts 'notes addressed to reviewers or automated checks are held as high-severity findings' and 'a note to reviewers is caught anywhere in a draft…'). Residual: docs/evaluation.md measures that the guarded prompt alone does not hold the original payload, and a paraphrase that evades the detector can reach the model; the candidate addressed_to_checks signal is not in the published policy. WS-09 mitigated: preview_urls is false for the main and inference Workers and the inference config sets workers_dev false (tests/api.test.ts 'WS-09: no preview or workers.dev hostname is enabled by the main or inference configuration'), and an opt-in INFERENCE_CALLER_SECRET makes the inference worker answer only calls that carry it (tests/jev.test.ts 'WS-09: with INFERENCE_CALLER_SECRET set…'); issuer.wrangler.jsonc pins neither, and tools/verify-deployment.mjs does not check for such hostnames (both checked for this entry). WS-06 fixed: the main worker reads request bodies as a stream and cuts them at 16 KB. What was open is unchanged. [read docs/evaluation.md sha256:94776266f9a2]
