#!/usr/bin/env node
// Usage: node tools/purge-samples.mjs --remote|--local [--apply] [--bookmark=<public database Time Travel bookmark>]
//                                     [--all-intake [--include-real-contributions]] [--no-export]
//
// Owner decision 1 (2026-09-23): production holds no fictional data. This removes the fictional sample employers
// (companies.kind 'sample') and everything recorded about them, from the public, intake and verifier databases:
//  - public: their cohorts, events, metric releases and answer bands, accounts (with topics, analyses and pair
//    judgments), clusters, question trails, FAQ interest counts, aliases, verification domains, legacy pending rows, and
//    their sandbox ('demo') issuer keys, then the companies rows themselves. Their vector ledger rows (vector_index) are
//    deleted too while the inference worker binds no Vectorize index (inference.wrangler.jsonc); with one bound they are
//    left for the inference worker's scheduled sweep, which deletes each vector and then its row, so no vector is orphaned;
//  - intake: contributions to them (with their decision log rows), jury cases about them and their seats, aggregate
//    groups, and challenges, queued challenges, re-checks and exceptions naming their accounts;
//  - verifier: their sandbox ('demo') signing keys (with the sealed private halves), the verification challenges made
//    with those keys, and any issuance count or pause of an employer that has only sandbox keys.
// With --all-intake it also clears the pre-launch test records from the intake database (decision log, juries,
// challenges, counters, daily budgets, snapshots) and the public moderation_stats counts, which are derived from intake
// and recomputed by the scheduled job. Real contributions are kept: a submission verified with a work mailbox
// (verification_class 'mailbox'), with its decision log, its exceptions, the jury cases and seats of real-employer juries,
// real-employer aggregate groups, and every spent-credential record (they cannot be told apart, and each stops a
// credential being used twice). The dry run lists them by status. --include-real-contributions clears them too; the
// legal release notes say counsel decides how contributions accepted before the launch are handled, so pass it only on
// that decision.
//
// It never touches a real employer's row, the migration tables (d1_migrations, sqlite_*, _cf_*), the append-only public
// ledgers (financial entries, legal requests, moderation actions, release manifests, the exception log, the listing
// correction log) or the transparency archives in R2.
//
// Dry run by default: it reads and prints how many rows each statement would remove, and the SQL. --apply executes it.
// A remote --apply also requires --bookmark=<id> (take one with `wrangler d1 time-travel info shouldiworkthere-public`
// just before), records the intake and verifier databases' current bookmarks itself, and exports all three databases to
// .private-backups/ first (unless --no-export). Tables with append-only triggers (the intake decision log) have their triggers dropped and
// re-created, from their stored SQL, around the delete in the same file; the triggers are checked afterwards and
// re-created if missing. --local runs against the local development databases (the ones `node tools/dev.mjs` serves):
// it removes the local samples too, so re-seed afterwards (delete the local state and run node tools/prepare-local.mjs).
import {existsSync,mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const PUBLIC={name:'public',db:'shouldiworkthere-public',config:'wrangler.jsonc'};
export const INTAKE={name:'intake',db:'shouldiworkthere-intake',config:'wrangler.jsonc'};
export const VERIFIER={name:'verifier',db:'shouldiworkthere-verifier',config:'issuer.wrangler.jsonc'};
/** Tables no purge ever reads or changes: migration bookkeeping and the platform's own. */
export const isProtectedTable=name=>/^(d1_migrations|sqlite_.*|_cf_.*)$/i.test(name);
/** Public tables that are append-only ledgers; never touched. */
export const PUBLIC_LEDGERS=['financial_entries','legal_requests','moderation_actions','release_manifests','exception_log','covenant_versions','listing_corrections'];
/** Whether the inference worker binds a Vectorize index (its config's "vectorize" key), from the config's text. */
export const semanticIndexBound=text=>{try {return !!JSON.parse(String(text).replace(/^\s*\/\/.*$/gm,'')).vectorize;} catch {return /"vectorize"\s*:/.test(String(text));}};
export const quote=value=>`'${String(value).replaceAll("'","''")}'`;
const list=values=>values.length?values.map(quote).join(','):'NULL';
const SAMPLES="(SELECT id FROM companies WHERE kind='sample')";
const SAMPLE_SLUGS="(SELECT slug FROM companies WHERE kind='sample')";
const SAMPLE_ACCOUNTS=`(SELECT id FROM testimony WHERE company_id IN ${SAMPLES})`;
/**
 * The public statements, children before parents, for the tables that exist. Each entry is {table, where}: the rows
 * `DELETE FROM table WHERE where` removes. Every condition names the sample employers, so a real employer's row can
 * never match; with allIntake, moderation_stats (counts derived from intake) is cleared too. With keepVectorLedger (a
 * Vectorize index is bound), vector_index rows stay for the inference worker's sweep, which deletes vectors first.
 */
export function publicPlan(tables,{allIntake=false,keepVectorLedger=false}={}) {
 const has=t=>tables.includes(t);
 const steps=[
  ['distribution_bands',`release_id IN (SELECT id FROM metric_releases WHERE company_id IN ${SAMPLES})`],
  ['metric_releases',`company_id IN ${SAMPLES}`],
  ['evidence_pairs',`left_id IN ${SAMPLE_ACCOUNTS} OR right_id IN ${SAMPLE_ACCOUNTS}`],
  ['evidence_analysis',`testimony_id IN ${SAMPLE_ACCOUNTS}`],
  ['testimony_topics',`testimony_id IN ${SAMPLE_ACCOUNTS}`],
  ...(keepVectorLedger?[]:[['vector_index',`testimony_id IN ${SAMPLE_ACCOUNTS}`]]),
  ['testimony',`company_id IN ${SAMPLES}`],
  ['corroborations',`company_id IN ${SAMPLES}`],
  ['question_trails',`company_id IN ${SAMPLES}`],
  ['faq_interest',`company_id IN ${SAMPLES}`],
  ['pending_submissions',`company_id IN ${SAMPLES}`],
  ['structured_responses',`company_id IN ${SAMPLES}`],
  ['events',`company_id IN ${SAMPLES}`],
  ['cohorts',`company_id IN ${SAMPLES}`],
  ['company_aliases',`company_id IN ${SAMPLES}`],
  ['employer_domains',`company_id IN ${SAMPLES}`],
  ['trusted_issuers',`verification_class='demo' AND company_slug IN ${SAMPLE_SLUGS}`],
  ...(allIntake?[['moderation_stats','1=1']]:[]),
  ['companies',"kind='sample'"],
 ];
 return steps.filter(([table])=>has(table)&&!isProtectedTable(table)&&!PUBLIC_LEDGERS.includes(table)).map(([table,where])=>({table,where}));
}
/** A contribution verified with a work mailbox: a real contribution, never a test record the purge may assume away. */
export const REAL_SUBMISSIONS="(SELECT id FROM submissions WHERE verification_class='mailbox')";
/**
 * With allIntake and without includeReal, what each intake table keeps: the real contributions and everything that
 * belongs to them (see the header). A table not named here is emptied.
 */
export const REAL_KEPT={
 submissions:"verification_class='mailbox'",
 actions:`submission_id IN ${REAL_SUBMISSIONS}`,
 exceptions:`submission_id IN ${REAL_SUBMISSIONS}`,
 jury_cases:"jury_class='mailbox'",
 jury_assignments:"case_id IN (SELECT id FROM jury_cases WHERE jury_class='mailbox')",
 aggregate_groups:"verification_class='mailbox'",
 spent_proofs:'1=1',
};
/** How many real contributions there are, by status (the dry run lists them). */
export const realContributionsSql="SELECT status,COUNT(*) AS n FROM submissions WHERE verification_class='mailbox' GROUP BY status ORDER BY status";
/**
 * The intake statements. companyIds and accountIds are the sample employers' ids and their accounts' public ids, read
 * from the public database first (the databases are separate). With allIntake the pre-launch test records go too: every
 * row, except (unless includeReal) the real contributions and what belongs to them (REAL_KEPT).
 */
export function intakePlan(tables,{companyIds=[],accountIds=[],allIntake=false,includeReal=false}={}) {
 const usable=tables.filter(t=>!isProtectedTable(t));
 if(allIntake) {
  // Seats before cases, so nothing refers to a removed case at any point.
  const order=['jury_assignments','jury_cases'];
  const where=table=>includeReal||!REAL_KEPT[table]?'1=1':`NOT (${REAL_KEPT[table]})`;
  return [...order.filter(t=>usable.includes(t)),...usable.filter(t=>!order.includes(t)).sort()].filter(table=>includeReal||REAL_KEPT[table]!=='1=1').map(table=>({table,where:where(table)}));
 }
 const companies=list(companyIds),accounts=list(accountIds),own=`(SELECT id FROM submissions WHERE company_id IN (${companies}))`;
 const steps=[
  ['actions',`submission_id IN ${own}`],
  ['jury_assignments',`case_id IN (SELECT id FROM jury_cases WHERE company_id IN (${companies}))`],
  ['jury_cases',`company_id IN (${companies})`],
  ['challenges',`public_id IN (${accounts})`],
  ['challenge_queue',`public_id IN (${accounts})`],
  ['rescreens',`public_id IN (${accounts})`],
  ['exceptions',`public_id IN (${accounts})`],
  ['aggregate_groups',`company_id IN (${companies})`],
  ['submissions',`company_id IN (${companies})`],
 ];
 return steps.filter(([table])=>usable.includes(table)).map(([table,where])=>({table,where}));
}
/**
 * The verifier statements: the fictional employers' sandbox ('demo') keys, the verification challenges made with them,
 * and issuance counts, hours and pauses of employers that have only sandbox keys (there should be none: sandbox keys are
 * never counted). The key rows go last. A real employer's key or anything made with one never matches.
 */
export function verifierPlan(tables) {
 const SANDBOX_ONLY="(SELECT company_slug FROM issuer_keys WHERE verification_class='demo' AND company_slug NOT IN (SELECT company_slug FROM issuer_keys WHERE verification_class<>'demo'))";
 const steps=[
  ['mailbox_challenges',"key_id IN (SELECT id FROM issuer_keys WHERE verification_class='demo')"],
  ['issuance_counts',`company_slug IN ${SANDBOX_ONLY}`],
  ['issuance_hours',`company_slug IN ${SANDBOX_ONLY}`],
  ['issuance_pauses',`company_slug IN ${SANDBOX_ONLY}`],
  ['issuer_keys',"verification_class='demo'"],
 ];
 return steps.filter(([table])=>tables.includes(table)&&!isProtectedTable(table)).map(([table,where])=>({table,where}));
}
export const countSql=({table,where})=>`SELECT COUNT(*) AS n FROM "${table}" WHERE ${where}`;
/**
 * The SQL file for a plan. A table with triggers that forbid deletes (append-only) has them dropped just before its
 * delete and re-created, from their stored SQL, just after, in the same file. triggers: [{name, table, sql}].
 */
export function planSql(plan,triggers=[]) {
 const lines=['PRAGMA defer_foreign_keys = on;'];
 for(const step of plan) {
  const own=triggers.filter(t=>t.table===step.table&&/\bDELETE\b/i.test(t.sql)&&/RAISE\s*\(/i.test(t.sql));
  for(const t of own)lines.push(`DROP TRIGGER IF EXISTS "${t.name}";`);
  lines.push(`DELETE FROM "${step.table}" WHERE ${step.where};`);
  for(const t of own)lines.push(`${t.sql.trim().replace(/;?\s*$/,'')};`);
 }
 return `${lines.join('\n')}\n`;
}
/** Triggers missing after the purge, from the list read before it. */
export const missingTriggers=(before,after)=>before.filter(t=>!after.some(a=>a.name===t.name));
/** A D1 Time Travel bookmark as `wrangler d1 time-travel info` prints it. */
export const validBookmark=text=>typeof text==='string'&&/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}$/i.test(text.trim());

function main() {
 const args=process.argv.slice(2),flag=name=>args.includes(name),option=name=>args.find(a=>a.startsWith(`${name}=`))?.slice(name.length+1);
 const remote=flag('--remote'),local=flag('--local'),apply=flag('--apply'),allIntake=flag('--all-intake'),includeReal=flag('--include-real-contributions'),bookmark=option('--bookmark');
 if(remote===local){console.error('Usage: node tools/purge-samples.mjs --remote|--local [--apply] [--bookmark=<id>] [--all-intake [--include-real-contributions]] [--no-export]');process.exit(2);}
 if(includeReal&&!allIntake){console.error('Refusing: --include-real-contributions only applies with --all-intake.');process.exit(2);}
 if(apply&&remote&&!validBookmark(bookmark)){console.error('Refusing: a remote --apply needs --bookmark=<id>, a restore point of the public database taken just before (wrangler d1 time-travel info shouldiworkthere-public).');process.exit(2);}
 const mode=remote?'--remote':'--local',where=remote?'remote':'local';
 const run=(target,sqlArgs)=>spawnSync('bunx',['wrangler','d1','execute',target.db,mode,'--config',target.config,...sqlArgs],{encoding:'utf8',maxBuffer:64*1024*1024});
 const query=(target,sql)=>{
  const r=run(target,['--command',sql,'--json']);
  if(r.status){console.error(`Refusing: could not read the ${where} ${target.name} database (${(r.stderr||r.stdout||'').trim().split('\n').slice(-1)[0]}). Nothing was changed.`);process.exit(1);}
  try {return JSON.parse(r.stdout)?.[0]?.results??[];} catch {console.error(`Refusing: unreadable answer from the ${where} ${target.name} database. Nothing was changed.`);process.exit(1);}
 };
 const tablesOf=target=>query(target,"SELECT name FROM sqlite_master WHERE type='table'").map(r=>r.name).filter(n=>!isProtectedTable(n));
 const triggersOf=target=>query(target,"SELECT name,tbl_name AS \"table\",sql FROM sqlite_master WHERE type='trigger'");
 const publicTables=tablesOf(PUBLIC),intakeTables=tablesOf(INTAKE),verifierTables=tablesOf(VERIFIER);
 const companyIds=query(PUBLIC,"SELECT id FROM companies WHERE kind='sample'").map(r=>r.id);
 const accountIds=companyIds.length?query(PUBLIC,`SELECT id FROM testimony WHERE company_id IN (${list(companyIds)})`).map(r=>r.id):[];
 const keepVectorLedger=existsSync('inference.wrangler.jsonc')&&semanticIndexBound(readFileSync('inference.wrangler.jsonc','utf8'));
 const plans=[[PUBLIC,publicPlan(publicTables,{allIntake,keepVectorLedger})],[INTAKE,intakePlan(intakeTables,{companyIds,accountIds,allIntake,includeReal})],[VERIFIER,verifierPlan(verifierTables)]];
 const counts=()=>plans.map(([target,plan])=>[target,plan.map(step=>({...step,n:Number(query(target,countSql(step))[0]?.n??0)}))]);
 const before=counts();
 console.log(`${apply?'Purging':'Dry run (nothing is changed; pass --apply to purge)'}: ${where} databases, ${companyIds.length} fictional employer(s) (${companyIds.join(', ')||'none'}), ${accountIds.length} of their accounts${allIntake?`, and the intake test records (--all-intake${includeReal?', including real contributions':''})`:''}.`);
 for(const [target,rows] of before) for(const r of rows) console.log(`  ${target.name}.${r.table}: ${r.n} row(s)`);
 const real=intakeTables.includes('submissions')?query(INTAKE,realContributionsSql):[];
 if(real.length)console.log(`Real contributions (work-mailbox verified) in the intake database: ${real.map(r=>`${r.n} ${r.status}`).join(', ')}. ${allIntake&&includeReal?'--include-real-contributions: they are removed with everything that belongs to them.':'They are kept, with their decision log, exceptions, real-employer juries, aggregate groups and every spent-credential record.'}`);
 if(keepVectorLedger&&publicTables.includes('vector_index'))console.log('A Vectorize index is bound (inference.wrangler.jsonc), so the fictional accounts\' vector ledger rows are left for the inference worker\'s scheduled sweep, which deletes each vector and then its row.');
 const total=before.flatMap(([,rows])=>rows).reduce((sum,r)=>sum+r.n,0);
 if(!apply){for(const [target,plan] of plans)console.log(`\n-- ${target.name}\n${planSql(plan,triggersOf(target))}`);console.log(`${total} row(s) would be removed. No real employer's row and no migration table is touched.`);return;}
 if(!total){console.log('Nothing to remove.');return;}
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 if(remote) {
  const bookmarkOf=target=>{const info=spawnSync('bunx',['wrangler','d1','time-travel','info',target.db,'--json','--config',target.config],{encoding:'utf8'});try {return JSON.parse(info.stdout)?.bookmark??null;} catch {return null;}};
  const intakeBookmark=bookmarkOf(INTAKE),verifierBookmark=bookmarkOf(VERIFIER);
  if(!validBookmark(intakeBookmark??'')){console.error('Refusing: could not record the intake database\'s current Time Travel bookmark. Nothing was changed.');process.exit(1);}
  if(!validBookmark(verifierBookmark??'')){console.error('Refusing: could not record the verifier database\'s current Time Travel bookmark. Nothing was changed.');process.exit(1);}
  console.log(`Restore points: public ${bookmark.trim()} (given), intake ${intakeBookmark} and verifier ${verifierBookmark} (read just now).\n  wrangler d1 time-travel restore ${PUBLIC.db} --bookmark=${bookmark.trim()}\n  wrangler d1 time-travel restore ${INTAKE.db} --bookmark=${intakeBookmark}\n  wrangler d1 time-travel restore ${VERIFIER.db} --config ${VERIFIER.config} --bookmark=${verifierBookmark}`);
  if(!flag('--no-export')) {
   mkdirSync('.private-backups',{recursive:true});
   for(const target of [PUBLIC,INTAKE,VERIFIER]) {
    const out=`.private-backups/purge-${target.name}-${stamp}.sql`;
    const r=spawnSync('bunx',['wrangler','d1','export',target.db,'--remote','--config',target.config,'--output',out,'-y'],{stdio:'inherit'});
    if(r.status||!existsSync(out)){console.error(`Refusing: the ${target.name} export failed. Nothing was changed.`);process.exit(1);}
    console.log(`Backup: ${out}`);
   }
  }
 }
 mkdirSync('.wrangler/purge',{recursive:true});
 for(const [target,plan] of plans) {
  if(!plan.length)continue;
  const triggers=triggersOf(target),file=`.wrangler/purge/${target.name}-${stamp}.sql`;
  writeFileSync(file,planSql(plan,triggers));
  const r=run(target,['--file',file,'--yes']);
  const missing=missingTriggers(triggers,triggersOf(target));
  for(const t of missing){const again=run(target,['--command',t.sql]);console.error(again.status?`ERROR: trigger ${t.name} on ${t.table} is missing and could not be re-created; re-create it from: ${t.sql}`:`Trigger ${t.name} on ${t.table} was missing after the purge and has been re-created.`);}
  if(r.status){console.error(`The ${target.name} purge failed: ${(r.stderr||r.stdout||'').trim().split('\n').slice(-3).join(' ')}`);process.exit(1);}
 }
 const after=counts(),left=after.flatMap(([target,rows])=>rows.filter(r=>r.n).map(r=>`${target.name}.${r.table}=${r.n}`));
 console.log(left.length?`WARNING: rows remain after the purge: ${left.join(', ')}`:`Done: ${total} row(s) removed; none of the purged rows remain.${local?' The local samples are gone too: re-seed by deleting .wrangler/state and running node tools/prepare-local.mjs.':''}`);
 if(left.length)process.exitCode=1;
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) main();
