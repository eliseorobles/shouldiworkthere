---
id: W-024
title: Independent production launch
phase: Phase 9 - Production trust
status: BLOCKED
depends_on: W-023
---

# W-024 - Independent production launch

**Phase:** Phase 9 - Production trust  
**Depends on:** W-023  
**Status:** BLOCKED

## Scope

Independent verifier and attestation, cryptographic review, legal entity and adopted bylaws, donation recipient, verified inaugural corpus.

## Acceptance criteria

External prerequisites evidenced before enabling real employment intake. Details in tickets/W-024-independent-production-launch.md.

## Log

- [2026-09-22 05:16 UTC] Ticket created.
- [2026-09-22 05:16 UTC] BLOCKED: Independent governance and protocol review require external adoption; user approved same-account isolated verifier and Cloudflare email setup.
- [2026-09-22 21:11 UTC] Unchanged prerequisites, each external: an independent verifier operator (W-077), an independent cryptographic review of the proof and juror protocols, a legal entity with adopted bylaws and counsel (W-078), a donation recipient, and a verified inaugural corpus. Real-employer publication stays off (REAL_PUBLICATION_ENABLED=false).
- [2026-09-23 05:16 UTC] Correction to the 21:11 entry's 'Real-employer publication stays off (REAL_PUBLICATION_ENABLED=false)': for the launch release, wrangler.jsonc sets REAL_PUBLICATION_ENABLED 'true' and JURY_ENABLED 'true' (the owner decision of September 23, 2026 as relayed in the workflow's task text and written into docs/product-principles.md), although none of this ticket's prerequisites (an independent verifier operator, a cryptographic review, a legal entity with counsel, a donation recipient, a verified inaugural corpus) is met. The block and its reason are unchanged: the launch is a public preview run in one Cloudflare account by one operator, not the independent launch this ticket describes. [read docs/product-principles.md sha256:5a49bcc7a422]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/product-principles.md for this entry. It now says real-employer publication is on in batches of at least 5 with survey figures at 25 (accounts submitted before the launch keep the batch of 25), real-employer juries are on and form only when enough jurors of curated employers can serve, employers added by the community share one seat per case, and trustees are not operating. wrangler.jsonc still sets REAL_PUBLICATION_ENABLED 'true' and JURY_ENABLED 'true' (checked 06:26 UTC), so the 05:16 correction holds; none of this ticket's prerequisites is met and the block stands. [read docs/product-principles.md sha256:ee5134164660]
