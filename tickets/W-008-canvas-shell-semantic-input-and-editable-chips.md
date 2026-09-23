---
id: W-008
title: Canvas shell, semantic input, and editable chips
phase: Phase 3 - Evidence Canvas
status: DONE
depends_on: W-006
completed: 2026-09-22 21:11 UTC
---

# W-008 - Canvas shell, semantic input, and editable chips

**Phase:** Phase 3 - Evidence Canvas  
**Depends on:** W-006  
**Status:** DONE

## Scope

Persistent intent dock, chips with provenance, manual overrides that stick, live interpretation disclosure (on by default by owner decision D14, off under Global Privacy Control, the visitor's choice remembered), debounce and stale-response rejection, keyboard access.

## Acceptance criteria

Typing a multi-concept question produces editable chips; overrides survive re-interpretation. Live is on by default by owner decision with visible disclosure; switching it off persists, and while off typing produces zero requests; GPC starts it off.

## Log

- [2026-09-22 04:51 UTC] Ticket created.
- [2026-09-22 05:05 UTC] Canvas + chips
- [2026-09-22 05:05 UTC] Evidence Canvas dock with live-interpretation opt-in (off by default, 420ms debounce, stale-response rejection by request id), editable chips with provenance and confidence.
- [2026-09-22 05:12 UTC] REOPENED: Audit: live mode updates chips only; null overrides and stale responses not handled.
- [2026-09-22 21:11 UTC] Rounds 1-3 fixed the reopen reasons (audit C-04, C-05, C-06, C-11, C-20): Live off sends nothing, Live updates the evidence view, removed chips stay removed, stale responses are dropped, and function and seniority are separate authoritative chips. tests/browser.spec.ts 'typing stays on this device until an explicit submit…', 'view switches, chip edits and question clicks never send an unsubmitted draft' and 'Live understanding reads only after opt-in…' pass (npx playwright test tests/browser.spec.ts against the local three-worker stack on 2026-09-22 21:05 UTC: 31 passed); tests/jev.test.ts 'industry, preference and salary constraints are editable overrides and removal is authoritative' and 'function and seniority group chips are separate, authoritative overrides…' pass.
- [2026-09-23 01:26 UTC] Scope change (owner decision D14, CONTRACT-3): the manifest's scope and acceptance now read 'Live is on by default by owner decision with visible disclosure; switching it off persists, and while off typing produces zero requests; GPC starts it off.' in place of the opt-in wording. Verified: tests/browser.spec.ts 'Live understanding is on by default, starts off under Global Privacy Control, and the visitor's choice is remembered' (the switch is on with the visible note 'Live understanding is on: when you pause…', nothing is stored by default, switching off stores only siwt-live 'off' and survives a reload, and a browser sending Global Privacy Control starts with Live off) and 'typing stays on this device until an explicit submit…' (Live off: no canvas request while typing), both in npx playwright test tests/browser.spec.ts (53 passed, 2026-09-23 01:12–01:14 UTC); the privacy policy says Global Privacy Control starts Live off (tests/safety.test.ts 'D14: the privacy policy says Global Privacy Control starts Live understanding off, as web/app.tsx does…', fixed after the reader journey found the policy saying the signal had nothing to opt out of). Correction to the 21:11 entry: 'function and seniority group chips are separate, authoritative overrides…' is in tests/api.test.ts, not tests/jev.test.ts; it passed in node --test "tests/*.test.ts" at 01:10 UTC.
