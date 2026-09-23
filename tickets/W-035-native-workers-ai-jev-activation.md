---
id: W-035
title: Native Workers AI Jev activation
phase: Phase 11 - Jev acceptance
status: IN PROGRESS
depends_on: W-006
---

# W-035 - Native Workers AI Jev activation

**Phase:** Phase 11 - Jev acceptance  
**Depends on:** W-006  
**Status:** IN PROGRESS

## Scope

Activate typesafe/jev through the isolated inference Worker's AI binding after account billing is enabled. Until then use the existing TypeSafe key only in that service; never silently change providers or turn on gateway payload logging.

## Acceptance criteria

- [ ] AI.run('typesafe/jev') returns valid Noul, Choice and Score answers on the selected personal Cloudflare account.
- [ ] Provider is explicit in configuration and deployment status; source/model/prompt provenance is recorded.
- [ ] The inference Worker has no verifier or private-intake binding, and gateway payload logging/caching is off.
- [ ] Provider failure retains the last usable view and exposes manual controls; it does not invent answers.

## Implementation paths

- `worker/src/ai.ts`
- `inference.wrangler.jsonc`
- `docs/operations.md`

## Required verification

- Native endpoint currently returned API error 2021, insufficient balance. Record as BLOCKED until funded or BYOK is configured.
- Malformed choices, NaN probabilities, unknown enum values and timeouts fail closed.
- Verify no API key appears in HTML, client JS, source download or request payloads.

## Log

- [2026-09-22 21:11 UTC] Ticket created.
- [2026-09-22 21:11 UTC] Dependency on W-023 replaced in round 3 by the technical prerequisites (see W-023's log): W-023 is the reconciliation umbrella and its acceptance includes deployment, so as a prerequisite it made this ticket unclosable before deploy while W-023 cannot close before it. The 2021 insufficient-balance error is superseded: the round-1 record shows a successful native typesafe/jev probe through AI Gateway with BYOK. Verified: tests/jev.test.ts 'native Workers AI serves first with cache skipped and gateway logging off…', 'the verified Workers AI envelope is unwrapped only when Completed…' and 'the public worker cannot reach the provider client, and only the inference worker is configured for Jev'. Still open: the provider is not reported in deployment status (/api/config has no provider; audit E-13), and no native run is verified on the deployed inference worker (W-079).
