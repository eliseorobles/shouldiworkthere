import {detectCrisis} from '../shared/safety.ts';
import {exactCompany} from './local-intent.ts';
import type {Matchable} from '../worker/src/interpretation.ts';

/**
 * Live understanding: what happens when someone pauses while typing with Live on. Pure, so the rules are unit-tested
 * (tests/web.test.ts) apart from the page that runs them (web/app.tsx).
 */
export const LIVE_MIN_CHARS=5;
/**
 * - `skip`: nothing is sent. Words the on-device check reads as a crisis are never sent while someone types: the support
 *   card is shown on the device instead, and only pressing Enter sends a question.
 * - `navigate`: the words are exactly a listed employer's name or alias, so its record opens with a controls request,
 *   which carries no words; hosted Jev never reads a bare employer name (as on submit).
 * - `read`: hosted Jev reads the words.
 */
export type LiveStep={kind:'skip';why:'short'|'same'|'crisis'}|{kind:'navigate';slug:string}|{kind:'read'};
export function liveStep(raw:string,o:{submitted:string;last:string;directory:ReadonlyArray<Matchable>}):LiveStep {
 const text=raw.trim();
 if(text.length<LIVE_MIN_CHARS)return {kind:'skip',why:'short'};
 if(text===o.last||text===o.submitted)return {kind:'skip',why:'same'};
 if(detectCrisis(text))return {kind:'skip',why:'crisis'};
 const slug=exactCompany(text,o.directory);
 return slug?{kind:'navigate',slug}:{kind:'read'};
}

/**
 * How a view joins this tab's history. One entry per view the reader committed to:
 * - A Live reading is provisional. The first one after a committed view adds an entry (so Back returns to that view,
 *   including the home page); later readings replace that same provisional entry while it is the one on screen.
 * - Pressing Enter settles the provisional entry on screen: the submitted view replaces it instead of adding a second.
 * - Anything else (a tab, a chip, a choice) adds an entry, and the provisional entry it started from stays as a view the
 *   reader acted on.
 * `provisional` is the key of the provisional entry this page added and has not left; `current` the key on screen.
 */
export function historyKind(o:{live?:boolean;settles?:boolean;requested:'push'|'replace';current:string|null|undefined;provisional:string|null}):'push'|'replace' {
 const onProvisional=!!o.provisional&&o.current===o.provisional;
 if(o.live)return onProvisional?'replace':'push';
 if(o.settles&&onProvisional)return 'replace';
 return o.requested;
}
