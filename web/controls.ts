import type {CanvasResponse,Overrides} from './api.ts';

/**
 * Typed control changes (tabs, chips, choices): the request each one makes, and what the page keeps from the view it
 * started from. Pure, so the rules are unit-tested (tests/web.test.ts) apart from the page that runs them (web/app.tsx).
 */

/** A change to the controls: `undefined` removes that key from the request and from the reader's pinned edits. */
export type Changes={[key:string]:Overrides[string]|undefined};
// Company and comparison choices navigate; they are never carried into later questions.
export const UNPINNED=['company','compareTo','page','scope'];
/** Edits that belong to the employer they were chosen on (the server drops them, with a note, for another employer). */
export const EMPLOYER_KEYS=['event','cohort','cohortFunction','cohortSeniority'];
export const employerBound=(o:Overrides)=>EMPLOYER_KEYS.some(k=>k in o)||o.timeframe==='before_event'||o.timeframe==='after_event';

/**
 * The controls request for `changes`, made from the view whose typed state is `base`, and the reader's pinned edits after
 * it. `pins` are the edits in effect for that view: for a held reply (a question the page asked instead of changing the
 * view) they are the edits that request carried, not the ones behind the view still on screen. Otherwise a choice made
 * on the held reply would lose the change that asked it (a Group tab asking which group, answered with a group, would
 * reopen the tab the reader left).
 */
export function controlsRequest(base:Overrides,pins:Overrides,requested:Changes,o:{pin:boolean;source:string|null}):{overrides:Overrides;nextPinned:Overrides} {
 let changes=requested;const from={...base};
 // One group chip (`cohort`) and the two per-slot chips never travel together: whichever the change names replaces the other.
 if('cohort'in changes&&!('cohortFunction'in changes)&&!('cohortSeniority'in changes))changes={...changes,cohortFunction:undefined,cohortSeniority:undefined};
 else if(('cohortFunction'in changes||'cohortSeniority'in changes)&&!('cohort'in changes))changes={...changes,cohort:undefined};
 if(typeof changes.company==='string'&&from.view==='discovery')delete from.view;
 const switching='company'in changes&&changes.company!==o.source;
 const nextPinned:Overrides=switching?{}:{...pins};
 for(const [key,value] of Object.entries(changes)){if(UNPINNED.includes(key))continue;if(o.pin&&value!==undefined)nextPinned[key]=value;else delete nextPinned[key];}
 const overrides:Overrides={...from,...nextPinned};
 for(const [key,value] of Object.entries(changes)){if(value===undefined)delete overrides[key];else overrides[key]=value;}
 // Group, event and before/after choices name the employer they were made on, so another employer never applies them.
 if(o.source&&employerBound(overrides))overrides.scope=o.source;
 return {overrides,nextPinned};
}

/**
 * A value a deterministic rule applied (an employer's only documented event of the kind a question names) stays labeled
 * as inferred until the reader changes or confirms it. Controls replies carry no interpretation of their own, so the
 * label, and the note that explains it, come from the view the change started from while the value is still applied
 * on the same employer and the change did not touch it. A reply that carries its own reading is left as it is.
 */
export function carryInferred(from:CanvasResponse|null,result:CanvasResponse,changed:readonly string[]):CanvasResponse {
 const before=from?.interpretation.inferred??[],i=result.interpretation;
 if(!from||!before.length||(i.inferred?.length??0)>0)return result;
 const sameEmployer=!!result.evidence&&from.evidence?.company.slug===result.evidence.company.slug;
 const kept=before.filter(v=>sameEmployer&&!changed.includes(v.field)&&i[v.field]?.value===v.value);
 if(!kept.length)return result;
 const notes=(from.interpretation.notes??[]).filter(n=>kept.some(v=>n.includes(v.label))&&from.notices.includes(n)&&!result.notices.includes(n));
 return {...result,notices:[...notes,...result.notices],interpretation:{...i,inferred:kept,notes:[...notes,...(i.notes??[])]}};
}

/**
 * The before/after choice in a view that shows every reporting period (the timeline): the choice stays one of the
 * reader's controls, but no result is filtered by it, and the chip and a notice say so.
 */
export function idleTimeframe(r:CanvasResponse|null):string|null {
 const e=r?.evidence,t=r?.interpretation.timeframe;
 return e&&(t==='before_event'||t==='after_event')&&e.timeStatus==='any'?t:null;
}
export const idleTimeframeNotice=(label:string)=>`This view shows every reporting period, so “${label}” is not applied to it.`;
