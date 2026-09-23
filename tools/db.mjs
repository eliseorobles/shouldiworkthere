#!/usr/bin/env node
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
function isMain() { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }

// Usage: node tools/db.mjs local|remote [--only=public,intake,verifier] [--seed-if-empty] [--accept-legacy-quota-reset] [--accept-row-changes]
//        node tools/db.mjs check local|remote [--for=main|inference|verifier|all]
// Applies each database's base schema (CREATE ... IF NOT EXISTS) and then its pending numbered migrations,
// tracked by Wrangler in d1_migrations, using the Wrangler config that owns the binding. Before applying, it prints each
// pending migration's own header comment. Remotely, a pending migration that may change or remove rows (any DELETE, DROP,
// UPDATE or upsert, REPLACE, RENAME) is applied only with --accept-row-changes, after its header has been read, and a
// remote database whose state cannot be read is refused rather than treated as empty.
// `check` is the read-only deploy gate: it changes nothing and exits 1 unless every migration in this checkout is applied
// to each database the named worker binds (main: public and intake; inference: public; verifier: verifier). The code
// reads and writes the columns and tables those migrations add, so deploying a worker ahead of them breaks it (for the
// main worker: withdrawal, expiry, publication, submit and status). Run it before each `wrangler deploy`.
const args = process.argv.slice(2);
const checking = args[0] === 'check', where = checking ? args[1] : args[0];
if (isMain() && !['local', 'remote'].includes(where ?? '')) { console.error('Usage: node tools/db.mjs local|remote [--only=public,intake,verifier] [--seed-if-empty] [--accept-legacy-quota-reset] [--accept-row-changes]\n       node tools/db.mjs check local|remote [--for=main|inference|verifier|all]'); process.exit(2); }
const mode = where === 'remote' ? '--remote' : '--local';
/** The databases each worker binds (wrangler.jsonc, inference.wrangler.jsonc, issuer.wrangler.jsonc). */
export const WORKER_DATABASES = {main:['public','intake'], inference:['public'], verifier:['verifier']};
/** Migration files in a directory that the applied set does not include, in the order Wrangler applies them. */
export const unapplied = (files, applied) => [...files].filter(f => /^\d{4}_.*\.sql$/.test(f)).sort().filter(f => !applied.has(f));
const only = new Set((args.find(a => a.startsWith('--only='))?.slice(7) ?? 'public,intake,verifier').split(','));
const seedIfEmpty = args.includes('--seed-if-empty');
// db/seed.sql starts by deleting every public table's rows, so it is never run against a remote database.
if (isMain() && mode === '--remote' && seedIfEmpty) { console.error('Refusing: --seed-if-empty is local only (db/seed.sql replaces rows).'); process.exit(2); }
const wrangler = (...rest) => { const r = spawnSync('bunx', ['wrangler', ...rest], {stdio:'inherit'}); if (r.status) process.exit(r.status); };
const stripComments = file => readFileSync(file, 'utf8').split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n');
const pending = (dir) => readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
const databases = [
  {name:'public', db:'shouldiworkthere-public', config:'wrangler.jsonc', base:'db/schema.sql', migrations:'db/migrations'},
  {name:'intake', db:'shouldiworkthere-intake', config:'wrangler.jsonc', base:'db/intake.sql', migrations:'db/intake-migrations'},
  {name:'verifier', db:'shouldiworkthere-verifier', config:'issuer.wrangler.jsonc', base:null, migrations:'db/verifier-migrations'},
];
const report = [];
export const header = file => { const lines = readFileSync(file, 'utf8').split('\n'); const out = []; for (const line of lines) { if (!line.trimStart().startsWith('--')) break; out.push(line.replace(/^\s*--\s?/, '')); } return out.join(' ').trim(); };
/**
 * Statements that may change or remove existing rows, columns or objects, found outside comments and string literals.
 * Deliberately broad (fails closed): any DELETE, DROP, UPDATE (including upserts), REPLACE, RENAME or TRUNCATE is
 * flagged, except trigger events and foreign-key actions, which only name an event. A false positive costs one flag.
 */
export const rowChanges = sql => [...stripSql(sql)
  .replace(/\b(BEFORE|AFTER|INSTEAD\s+OF)\s+(DELETE|INSERT|UPDATE(\s+OF\s+[\w\s,"`[\]]+?)?)\s+ON\b/gi, '$1 EVENT ON')
  .replace(/\bON\s+(DELETE|UPDATE)\s+(CASCADE|RESTRICT|NO\s+ACTION|SET\s+NULL|SET\s+DEFAULT)\b/gi, 'ON EVENT $2')
  .matchAll(/\b(?:DELETE|DROP|UPDATE|REPLACE|RENAME|TRUNCATE)\b[^;]{0,40}/gi)].map(m => m[0].replace(/\s+/g, ' ').trim());
function stripSql(sql) { return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map(l => l.replace(/--.*$/, '')).join('\n').replace(/'(?:[^']|'')*'/g, "''"); }
const query = (target, sql) => { const r = spawnSync('bunx', ['wrangler', 'd1', 'execute', target.db, mode, '--config', target.config, '--command', sql, '--json'], {encoding:'utf8'}); if (r.status) return null; try { return JSON.parse(r.stdout)?.[0]?.results ?? null; } catch { return null; } };
/** A remote database whose state cannot be read is never treated as empty: that would silently skip the safety gates. */
function known(target, rows, what) {
  if (rows) return rows;
  if (mode === '--remote') { console.error(`Refusing: could not read ${what} from the remote ${target.name} database, so the migration safety checks cannot run. Check wrangler access and re-run.`); process.exit(1); }
  report.push(`${target.name}: could not read ${what} locally; treating it as empty`);
  return [];
}
function tableNames(target) { return new Set(known(target, query(target, "SELECT name FROM sqlite_master WHERE type='table'"), 'its table list').map(r => r.name)); }
// Verifier 0001 deletes legacy per-key quota rows; a mailbox credentialed earlier this quarter could then get a second
// credential this quarter. Count them first, and never delete them remotely without an explicit flag.
/** Verifier 0004 drops these legacy tables with every row in them; their row counts are recorded before it runs (D9). */
export const LEGACY_VERIFIER_TABLES = ['attestation_jobs', 'issued_credentials', 'revocation_list', 'issuance_quota', 'challenges', 'issuance_quota_v2'];
function verifierPreflight(target) {
  const tables = tableNames(target);
  const applied = tables.has('d1_migrations') ? new Set(known(target, query(target, 'SELECT name FROM d1_migrations'), 'its applied migrations').map(r => r.name)) : new Set();
  const count = table => tables.has(table) ? known(target, query(target, `SELECT COUNT(*) AS n FROM ${table}`), `the ${table} row count`)[0]?.n ?? 'unknown' : 0;
  if (!applied.has('0004_drop_legacy_tables.sql')) {
    const counts = LEGACY_VERIFIER_TABLES.map(table => `${table}=${tables.has(table) ? count(table) : 'absent'}`).join(', ');
    console.log(`verifier: before 0004, rows in the legacy tables it drops: ${counts}`);
    report.push(`verifier: before 0004, rows in the legacy tables it drops: ${counts}`);
  }
  if (applied.has('0001_sealed_keys_and_quota.sql')) return;
  const quota = count('issuance_quota_v2'), challenges = count('challenges');
  report.push(`verifier: before 0001, legacy rows it deletes: issuance_quota_v2=${quota}, challenges=${challenges}`);
  if (mode === '--remote' && quota !== 0 && !args.includes('--accept-legacy-quota-reset')) {
    console.error(`Refusing: verifier 0001 would delete ${quota} legacy quota rows, so those mailboxes could obtain a second credential this quarter. Re-run with --accept-legacy-quota-reset to proceed.`);
    process.exit(1);
  }
}
function appliedMigrations(target) {
  const tables = tableNames(target);
  return tables.has('d1_migrations') ? new Set(known(target, query(target, 'SELECT name FROM d1_migrations'), 'its applied migrations').map(r => r.name)) : new Set();
}
/** Read-only: exits 1 (listing each missing migration with its header) unless the worker's databases are fully migrated. */
function gate() {
  const worker = args.find(a => a.startsWith('--for='))?.slice(6) ?? 'all';
  const names = worker === 'all' ? ['public', 'intake', 'verifier'] : WORKER_DATABASES[worker];
  if (!names) { console.error(`Unknown --for=${worker}; use main, inference, verifier or all.`); process.exit(2); }
  const missing = [];
  for (const target of databases.filter(d => names.includes(d.name)))
    for (const file of unapplied(readdirSync(target.migrations), appliedMigrations(target))) missing.push(`${target.name} ${file}: ${header(`${target.migrations}/${file}`) || '(no header comment)'}`);
  const where = mode === '--remote' ? 'remote' : 'local';
  if (missing.length) { console.error(`Refusing to deploy ${worker === 'all' ? 'any worker' : `the ${worker} worker`}: ${missing.length} migration(s) in this checkout are not applied to the ${where} database(s) it binds:\n- ${missing.join('\n- ')}\nApply them first with node tools/db.mjs ${where} (it prints every header and gates row changes), then deploy.`); process.exit(1); }
  console.log(`OK: every migration in this checkout is applied to the ${where} ${names.join(', ')} database${names.length > 1 ? 's' : ''}${worker === 'all' ? '' : ` (${worker} worker)`}.`);
}
if (isMain() && checking) { gate(); process.exit(0); }
const followUps = new Set();
if (isMain()) for (const target of databases.filter(d => only.has(d.name))) {
  const config = readFileSync(target.config, 'utf8');
  if (!config.includes(`"${target.migrations}"`)) { console.error(`${target.config} does not set "migrations_dir":"${target.migrations}" for ${target.db}.`); process.exit(1); }
  if (target.name === 'verifier') verifierPreflight(target);
  const applied = appliedMigrations(target), waiting = pending(target.migrations).filter(f => !applied.has(f));
  for (const file of waiting) console.log(`${target.name} ${file}: ${header(`${target.migrations}/${file}`) || '(no header comment)'}`);
  // Every pending migration passes this gate, including verifier 0001, which also has its own, more specific gate above.
  const changing = waiting.map(f => [f, rowChanges(readFileSync(`${target.migrations}/${f}`, 'utf8'))]).filter(([, changes]) => changes.length);
  if (mode === '--remote' && changing.length && !args.includes('--accept-row-changes')) {
    console.error(`Refusing: pending ${target.name} migrations change existing rows: ${changing.map(([f, c]) => `${f} (${[...new Set(c)].join('; ')})`).join(', ')}. Read their headers above, then re-run with --accept-row-changes.`);
    process.exit(1);
  }
  if (target.name === 'verifier' && waiting.includes('0002_juror_tokens_and_issuance_controls.sql')) followUps.add('verifier 0002 was applied: run node tools/provision-issuer.mjs next (with --remote for production) so juror keys exist and every key row carries its headcount-band limits; until then existing mailbox keys fall back to the smallest cap (50 credentials a quarter, 10 a day).');
  if (target.name === 'public' && waiting.includes('0006_juror_keys.sql')) followUps.add('public 0006 was applied: issuer keys now state their purpose; load db/issuer-public-keys.sql (provision-issuer does this with --remote) so juror keys are published.');
  // Owner decisions of 2026-09-23: community listings need 0010 before the main worker that serves /api/employers, and
  // production holds no fictional data (wrangler.jsonc SAMPLE_EMPLOYERS 'off' hides it; tools/purge-samples.mjs removes it).
  if (target.name === 'public' && waiting.includes('0010_community_employers.sql')) followUps.add(`public 0010 was applied: employer_domains holds the curated verification domains and community listings can be stored.${mode === '--remote' ? ' To remove the fictional sample employers from production (public, intake and verifier databases), deploy the workers first, then run node tools/purge-samples.mjs --remote (a dry run), then again with --apply --bookmark=<id> (wrangler d1 time-travel info shouldiworkthere-public), adding --all-intake to clear the pre-launch intake test records (real, work-mailbox verified contributions are kept unless --include-real-contributions is also given).' : ''}`);
  if (target.name === 'public' && waiting.includes('0011_listing_corrections.sql')) followUps.add('public 0011 was applied: listing corrections (POST /api/directory/correct with ADMIN_TOKEN) are logged in listing_corrections and listed at /api/transparency.');
  if (target.base) wrangler('d1', 'execute', target.db, mode, '--config', target.config, '--command', stripComments(target.base), '--yes');
  if (target.name === 'public' && seedIfEmpty) {
    const probe = spawnSync('bunx', ['wrangler', 'd1', 'execute', target.db, '--local', '--config', target.config, '--command', "SELECT (SELECT COUNT(*) FROM companies) AS n, (SELECT COUNT(*) FROM sqlite_master WHERE name='d1_migrations') AS tracked", '--json'], {encoding:'utf8'});
    const row = probe.status ? null : JSON.parse(probe.stdout)?.[0]?.results?.[0];
    const companies = row ? row.n : null;
    if (companies === 0) {
      wrangler('d1', 'execute', target.db, '--local', '--config', target.config, '--file', 'db/seed.sql', '--yes');
      report.push('public: local database was empty, so db/seed.sql (fictional sample employers) was loaded');
      if (row.tracked) report.push('public: WARNING migrations had already been applied before this seed, so 0001 fixture corrections did not run on it; delete the local state to rebuild cleanly');
    }
    else report.push(`public: seed skipped (${companies === null ? 'could not count companies' : `${companies} companies already present`})`);
  }
  wrangler('d1', 'migrations', 'apply', target.db, mode, '--config', target.config);
  report.push(`${target.name}: ${target.base ? `${target.base} run (CREATE ... IF NOT EXISTS only), then ` : ''}every migration in ${target.migrations} is now applied (${pending(target.migrations).join(', ')}); ones applied earlier were not re-run`);
}
if (isMain()) {
  console.log(`\n${mode === '--remote' ? 'Remote' : 'Local'} databases updated:\n- ${report.join('\n- ')}`);
  for (const note of followUps) console.log(`Next: ${note}`);
  // A running local worker can fail its hot reload on the busy SQLite file while a migration is applied (SQLITE_BUSY).
  if (mode === '--local') console.log('If node tools/dev.mjs is running and a worker stops answering after this, restart only that worker: node tools/dev.mjs --restart --only=<main|inference|verifier>.');
  console.log('Migrations are not all additive. Each file header states exactly which rows it changes; the pending ones were printed above before they were applied.');
}
