---
id: W-003
title: Product brand system and design tokens
phase: Phase 0 - Foundation
status: DONE
depends_on: W-001
completed: 2026-09-22 05:05 UTC
---

# W-003 - Product brand system and design tokens

**Phase:** Phase 0 - Foundation  
**Depends on:** W-001  
**Status:** DONE

## Scope

Institutional research-desk identity: type pairing, locked palette, rules, density, component chrome, motion tokens, reduced-motion fallbacks.

## Acceptance criteria

Single stylesheet defines tokens; no banned palette families; every interactive element styled by bespoke chrome, no default component skin.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Design tokens
- [2026-09-22 05:05 UTC] web/styles.css: locked cool-paper/ink/deep-green palette, Instrument Sans + JetBrains Mono self-hosted via tools/fonts.mjs, hairline rules, bespoke chrome per CTA, reduced-motion gating.
- [2026-09-22 21:11 UTC] Re-verified in round 3: tokens are defined once in web/styles.css. tests/browser.spec.ts 'brand, self-hosted fonts and trust navigation load with no script or policy errors' and 'dark mode follows the system, and the theme switch stores only an explicit choice' pass (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed). Contrast and motion work continues under W-061 (U8).
