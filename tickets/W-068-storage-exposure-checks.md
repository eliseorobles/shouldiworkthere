---
id: W-068
title: Storage exposure checks
ref: L7
phase: Phase 14 - Legal and liability
status: PENDING
depends_on: W-018
---

# W-068 - Storage exposure checks

**Phase:** Phase 14 - Legal and liability  
**Brief ref:** L7  
**Depends on:** W-018  
**Status:** PENDING

## Scope

Prove that the transparency archive bucket is not publicly reachable and that the source download cannot leak secrets.

## Acceptance criteria

- [ ] A deploy check proves the ARCHIVES R2 bucket has no public r2.dev or custom-domain access and archives are served only through the worker.
- [ ] /api/source serves only an explicit allowlist of directories and extensions and never dotfiles, .dev.vars, .env, secrets or key files, proven by a test over the built bundle.

## Implementation paths

- `tools/verify-deployment.mjs`
- `tools/build.mjs`
- `worker/src/app.ts`
- `wrangler.jsonc`

## Required verification

- A test over SOURCE_FILES in worker/generated/client-assets.ts; a verify-deployment check against the r2.dev URL and the bucket's custom domains.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Not started. tools/verify-deployment.mjs has no R2 public-access check, and SOURCE_FILES is built from a directory and extension allowlist in tools/build.mjs with no explicit dotfile exclusion and no test (no dotfiles exist in those directories today).
