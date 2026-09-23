---
id: W-018
title: Security and privacy hardening
phase: Phase 6 - Assurance
status: DONE
depends_on: W-010, W-015
completed: 2026-09-22 21:11 UTC
---

# W-018 - Security and privacy hardening

**Phase:** Phase 6 - Assurance  
**Depends on:** W-010, W-015  
**Status:** DONE

## Scope

CSP and security headers, no sensitive caching, invocation-log suppression, payload-free error handling, rate limiting, secret handling, no third-party analytics, dependency audit.

## Acceptance criteria

Security header audit passes; intake and credential routes are rate limited; no draft or credential material appears in logs or caches.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Security hardening
- [2026-09-22 05:05 UTC] CSP (default-src none, self only for script/style/font), nosniff, DENY framing, no-referrer, permissions-policy, invocation logs disabled, no third-party scripts or analytics, hashed-IP rate limits on interpret/verify/submit/withdraw, secrets server-side only.
- [2026-09-22 21:11 UTC] REOPENED: Audit A-07, A-14, A-18 and E-20: the CSP allowed localhost in production, and the earlier log's 'hashed-IP rate limits on interpret/verify/submit/withdraw' was inaccurate.
- [2026-09-22 21:11 UTC] Correction and re-verification: limiter keys are daily digests, HMAC-SHA-256 under RATE_LIMIT_SECRET when it is set, never the raw address, and /api/verify is retired (tests/jev.test.ts 'rate-limit keys are daily digests, never the raw client address', 'with RATE_LIMIT_SECRET configured, limiter keys are keyed digests…'). Production CSP names only the configured https verifier and sends HSTS (tests/jev.test.ts 'production CSP names only the configured https verifier and sends HSTS…'; tests/api.test.ts 'trust, legal and app routes are wired with security headers…'); observability and invocation logs are off in all three configs (tests/safety.test.ts); tests/browser.spec.ts 'canvas requests carry only the question, typed controls and mode, and the site sets no cookies' passes (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed). The header audit of the deployed apex is part of W-079.
- [2026-09-23 01:26 UTC] Round-3 red-team fixes in this ticket's scope, with tests: WS-03 (main-worker limits and daily records keyed by the IPv6 /64, worker/src/network.ts), RT-ABUSE-03 and WS-04 (the same in moderation and the verifier: tests/protocol.test.ts 'networkKey…'), WS-06 and WS-07 (bodies streamed and refused over their cap without buffering: tests/protocol.test.ts 'readCapped never buffers more than its cap…', tests/moderation.test.ts 'WS-07…'), WS-08 (client mistakes get 400, 413 or 405 with Allow, never 503: tests/api.test.ts 'WS-08…'), RT-CFG-07 (unique rate-limit namespaces), WS-10 (.env with a secret set to 0600). Pre-deploy pass: a failing page route answers with an HTML 503 page carrying every security header and no failure details, never a raw JSON body (tests/api.test.ts 'a failing page route answers with a page, never a raw JSON body…'). The tests/integration.mjs header and privacy checks passed at 01:15 UTC. This ticket's criteria still hold. Runs for this entry (group E, 2026-09-23 01:10–01:16 UTC, local three-worker stack with the local build): npx tsc --noEmit clean; node --test "tests/*.test.ts" 511 of 512 passed (the one failure was tests/tickets.test.ts, on the stale citations this sync settles); npx playwright test tests/browser.spec.ts 53 passed; npx playwright test tests/browser-contribute.spec.ts 53 passed, 1 skipped (the opt-in screenshot pass); node tests/integration.mjs 106 passed, 0 failed.
