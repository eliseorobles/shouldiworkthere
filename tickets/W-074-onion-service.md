---
id: W-074
title: Onion service
ref: H5
phase: Phase 15 - Hardening
status: BLOCKED
depends_on: W-018
---

# W-074 - Onion service

**Phase:** Phase 15 - Hardening  
**Brief ref:** H5  
**Depends on:** W-018  
**Status:** BLOCKED

## Scope

Serve the site as a Tor onion service that serves the same signed release, for readers and contributors who need network anonymity.

## Acceptance criteria

- [ ] The site is reachable as an onion service serving the same signed release; the onion address is published on the site and in the release manifest.
- [ ] The onion front end forwards to the same Workers without adding logs, cookies or third-party scripts, and the watcher verifies it serves the same assets.
- [ ] Contributing through the onion address needs no clearnet-only resource.

## Implementation paths

- `docs/hardening-roadmap.md`
- `tools/verify-deployment.mjs`

## Required verification

- verify-deployment check that the onion address serves assets matching the signed manifest.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] BLOCKED: Cloudflare Workers cannot host a Tor onion service. Needs a separately hosted onion front end and the owner's decision on hosting and cost.
