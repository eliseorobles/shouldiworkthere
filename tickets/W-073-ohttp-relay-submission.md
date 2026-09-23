---
id: W-073
title: OHTTP relay submission
ref: H4
phase: Phase 15 - Hardening
status: BLOCKED
depends_on: W-014
---

# W-073 - OHTTP relay submission

**Phase:** Phase 15 - Hardening  
**Brief ref:** H4  
**Depends on:** W-014  
**Status:** BLOCKED

## Scope

Contributions and verifier requests can travel through an Oblivious HTTP relay run by a party other than the operator, so the operator's account never sees the contributor's IP address for them.

## Acceptance criteria

- [ ] The browser can encapsulate submission and verifier requests to the gateway's published key configuration and send them through the relay.
- [ ] For relayed requests, the publisher's and verifier's logs, limiter keys and records contain no client address.
- [ ] The browser falls back to direct submission only with an explicit notice.
- [ ] The relay operator, its logging terms and the key configuration are disclosed in the privacy policy.

## Implementation paths

- `web/submit.tsx`
- `worker/src/app.ts`
- `worker/issuer.ts`
- `docs/hardening-roadmap.md`

## Required verification

- Browser test that relayed request bodies are encapsulated and carry no identifying headers; worker test that a relayed request produces no address-derived limiter key or record.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] BLOCKED: Needs an OHTTP relay run by a party independent of the operator under an agreement, and a gateway key configuration. No implementation exists; a design is to be recorded in docs/hardening-roadmap.md.
- [2026-09-22 21:41 UTC] Correction to the 21:11 entry: docs/hardening-roadmap.md already had an OHTTP design when it was written (section 3, 'Oblivious HTTP relay for search and screening'): an RFC 9458 gateway with a relay run by a third party, and Privacy Pass tokens (RFC 9576-9578) instead of IP-digest rate limits. That design covers /api/canvas and /api/screen only; relaying submissions and verifier requests, which this ticket is about, is not designed there yet. Nothing is implemented.
- [2026-09-22 22:32 UTC] Re-read docs/hardening-roadmap.md for this entry; it changed at 22:27 UTC, after the 21:41 entry. Section 3 ('Oblivious HTTP relay for search and screening') still designs an RFC 9458 gateway with a third-party relay and Privacy Pass tokens (RFC 9576-9578) for /api/canvas and /api/screen only; relaying submissions and verifier requests is still not designed, and no code under worker/, web/ or shared/ implements a relay. The 21:41 entry holds. [read docs/hardening-roadmap.md sha256:8d75d1eaf48b]
- [2026-09-23 01:26 UTC] Re-read docs/hardening-roadmap.md for this entry; it changed at 00:45 UTC. Section 3 ('Oblivious HTTP relay for search and screening') still designs an RFC 9458 gateway with a third-party relay and Privacy Pass tokens for /api/canvas and /api/screen only; relaying submissions and verifier requests is still not designed, and no code under worker/, web/ or shared/ implements a relay (worker/generated/client-assets.ts matches only because it bundles the source for download). The 22:32 entry holds. [read docs/hardening-roadmap.md sha256:169b354fe170]
- [2026-09-23 05:16 UTC] Re-read docs/hardening-roadmap.md for this entry; it changed at 04:19 UTC, after the 01:26 entry. Section 3 is unchanged: an RFC 9458 gateway with a third-party relay and Privacy Pass tokens for /api/canvas and /api/screen only; relaying submissions and verifier requests is still not designed, and no code under worker/, web/ or shared/ implements a relay (only worker/generated/client-assets.ts matches, as the downloadable source bundle). The 01:26 entry holds. [read docs/hardening-roadmap.md sha256:176123a1bbda]
- [2026-09-23 06:29 UTC] Final launch verification: re-read docs/hardening-roadmap.md for this entry. Section 3 is unchanged (an RFC 9458 gateway with a third-party relay and Privacy Pass tokens for /api/canvas and /api/screen only), and no code under worker/, web/ or shared/ implements a relay: a search for 'ohttp' or 'oblivious' matches only worker/generated/client-assets.ts, the downloadable source bundle. The 01:26 entry holds. [read docs/hardening-roadmap.md sha256:edf2eb228985]
