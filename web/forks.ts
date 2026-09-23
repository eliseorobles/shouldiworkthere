import type {Interpretation} from './api.ts';

/**
 * Which of a reply's forks the page shows, and in what order. Pure, so the ordering rules are unit-tested
 * (tests/web.test.ts) apart from the components that render them (web/canvas/composer.tsx).
 */
export type ForkView=Interpretation['forks'][number];

/** Views that show one employer's evidence. Without an employer only discovery can open. */
const EMPLOYER_VIEWS:ReadonlySet<string>=new Set(['overview','compare','timeline','distribution','clusters','reader','cohort']);
/**
 * The forks a reply can offer on the page it would show. A reply without an employer (no evidence: the server shows
 * discovery) cannot open a view of one employer's evidence, so those views are not offered ("Workplace record" on the
 * home page would only open discovery again), and a view fork left with nothing to offer is dropped.
 */
export function offerable(forks:readonly ForkView[],hasEmployer:boolean):ForkView[] {
 if(hasEmployer)return [...forks];
 return forks.map(f=>f.field==='view'?{...f,options:f.options.filter(o=>!EMPLOYER_VIEWS.has(o.id))}:f).filter(f=>f.options.length>0);
}

/**
 * A fork option's share as shown: always labelled as the model's, never bare beside evidence numbers. A share the server
 * offered (above zero) never reads as 0%: under half a percent it is "<1%".
 */
export const probabilityLabel=(share:number)=>`${share>0&&share<.005?'<1':Math.round(share*100)}% model probability`;

/** The heading of the primary question when a question hinges on an ambiguous word (a meaning fork). */
export const MEANING_HEADING='What did you mean?';
export const isMeaning=(f:ForkView)=>f.kind==='meaning';

/**
 * The questions a held reply (keepCanvas: the last view stays in place) puts to the reader, primary first.
 * - A meaning fork is the primary question whatever its tier. A held reply shows no tentative reading, so a meaning the
 *   server applied tentatively ('fork') would otherwise never be offered: its meanings, with the model's probabilities,
 *   are the first thing asked.
 * - With a meaning on the table, a generic view question is not asked in its place or beside it: the reader's choice of
 *   meaning opens the view the reply already describes (on a record, the record; with no employer, discovery), and every
 *   other view stays one tap away. Most views also need an employer, which a question like "how political is
 *   engineering?" on the home page does not name.
 * - Otherwise, as before: every fork that asks ('ask', or a fork without a tier from an older server), in the server's
 *   order; tentative forks are not questions.
 */
export function heldQuestions(forks:readonly ForkView[]):ForkView[] {
 const meanings=forks.filter(isMeaning);
 return [...meanings,...forks.filter(f=>!isMeaning(f)&&f.tier!=='fork'&&!(meanings.length>0&&f.field==='view'))];
}

/** The heading a held question is shown under: the meaning heading for a meaning fork, otherwise the server's question. */
export const questionOf=(f:ForkView)=>isMeaning(f)?MEANING_HEADING:f.question;

/**
 * Tentative readings shown beside an applied view ('fork' tier), a meaning first. A fork whose only option is the value
 * already applied offers nothing to choose, so it is not shown ("Or did you mean" followed by nothing).
 */
export function tentativeForks(forks:readonly ForkView[],alternatives:(f:ForkView)=>readonly unknown[]):ForkView[] {
 const list=forks.filter(f=>f.tier==='fork'&&alternatives(f).length>0);
 return [...list.filter(isMeaning),...list.filter(f=>!isMeaning(f))];
}
