import {policy} from '../../shared/policy.ts';
import type {Env} from './types.ts';

/**
 * Launch switches read from Worker vars (owner decisions of 2026-09-23). A leaf module, so pages.ts, legal.ts and every
 * other module can read them without importing the app.
 */

/** Fictional sample employers are shown only when SAMPLE_EMPLOYERS is exactly 'on' (locally and in tests); unset hides them. */
export const samplesEnabled=(env:Pick<Env,'SAMPLE_EMPLOYERS'>)=>env.SAMPLE_EMPLOYERS==='on';
/** SQL condition on a companies table alias: true for every employer a visitor may see. Bind nothing. */
export const visibleCompanySql=(env:Pick<Env,'SAMPLE_EMPLOYERS'>,alias='companies')=>samplesEnabled(env)?'1=1':`${alias}.kind<>'sample'`;
/**
 * Written accounts publish in batches of at least this many approved accounts per employer and verification type:
 * TESTIMONY_BATCH_MIN (production 5), never below the published policy's retention.minimumBatch.
 */
export function testimonyBatchMin(env:Pick<Env,'TESTIMONY_BATCH_MIN'>):number {
 const floor=policy.retention.minimumBatch,configured=Number(env.TESTIMONY_BATCH_MIN);
 return Number.isInteger(configured)&&configured>floor?configured:floor;
}
/** Questionnaire aggregates: groups and answers of at least MIN_COHORT_N (production 25), never below the policy's aggregateMinimum. */
export function aggregateMinimum(env:Pick<Env,'MIN_COHORT_N'>):number {
 const floor=policy.retention.aggregateMinimum,configured=Number(env.MIN_COHORT_N);
 return Number.isFinite(configured)&&configured>floor?configured:floor;
}
