---
id: W-069
title: Legal links and consent in the submit flow
ref: L8
phase: Phase 14 - Legal and liability
status: IN PROGRESS
depends_on: W-012
---

# W-069 - Legal links and consent in the submit flow

**Phase:** Phase 14 - Legal and liability  
**Brief ref:** L8  
**Depends on:** W-012  
**Status:** IN PROGRESS

## Scope

Privacy, Terms, Accessibility and Legal requests links on every page; the submit flow links Terms and Privacy before submit and requires an 18+ confirmation; consent fields are enforced by the server.

## Acceptance criteria

- [ ] Every page carries Privacy, Terms, Accessibility and Legal requests links.
- [ ] The submit flow links Terms and Privacy before submit and requires an explicit 18+ confirmation, and the server refuses a submission without adultConfirmed:true.
- [ ] An explicit, unchecked statement about sensitive information concerning the author is sent as sensitiveConsent and stored only as a boolean on the intake row, erased with it; juryReviewConsent is enforced by the server.

## Implementation paths

- `web/submit.tsx`
- `worker/src/pages.ts`
- `worker/src/submissions.ts`

## Required verification

- tests/browser.spec.ts: 'every page carries the privacy, terms, accessibility and legal-requests links'; tests/web.test.ts: 'every server-rendered page carries the legal links…'.
- tests/browser-contribute.spec.ts: 'submitting needs an explicit 18+ confirmation beside Terms and Privacy links…'; server tests for adultConfirmed and sensitiveConsent in tests/publication.test.ts.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Verified: tests/browser.spec.ts 'every page carries the privacy, terms, accessibility and legal-requests links' (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed); tests/browser-contribute.spec.ts 'submitting needs an explicit 18+ confirmation beside Terms and Privacy links…' and 'permissions: juror review and sensitive information are off by default, sent exactly as set…' (npx playwright test tests/browser-contribute.spec.ts on 2026-09-22 21:06 UTC: 42 passed, 1 skipped (the opt-in screenshot pass)); tests/publication.test.ts 'every consent is an explicit field the server enforces: adult confirmation, juror review and the sensitive-data choice…'. Still open: tests/web.test.ts 'every server-rendered page carries the legal links…' failed at the 21:00 UTC run while pages.ts was being edited.
