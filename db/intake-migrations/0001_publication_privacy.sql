-- Intake 0001: publication and erasure rules (applied after db/intake.sql).
-- Lossless rebuild of `submissions` because SQLite cannot alter a CHECK constraint:
--  * status gains 'publishing' (claimed by a batch) and 'expired' (erased by the retention job, distinct from 'withdrawn');
--  * public_id is a separate random id used for the public record; `id` stays a private receipt id;
--  * batch_id marks rows claimed by an in-flight publication batch; held_on starts the 30-day hold clock;
--  * op_token is a random value written by each state change so dependent inserts (action log, aggregate
--    counters) in the same transaction apply only if that exact change happened;
--  * content_hash, eligible_at and created_day become nullable so erasure can clear these fingerprints.
-- Legacy rows: published rows used their intake id as the public id. The public id moves to public_id and the
-- private id is replaced with a fresh random value. Bodies of already published rows are erased (the public
-- record holds the text; answers stay for aggregation). Withdrawn rows lose their remaining fingerprints.
CREATE TABLE submissions_next (
  id TEXT PRIMARY KEY,
  public_id TEXT UNIQUE,
  company_id TEXT NOT NULL,
  company_slug TEXT NOT NULL,
  body TEXT NOT NULL,
  layer TEXT NOT NULL CHECK(layer IN ('experience','claim','opinion')),
  period TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  author_key_json TEXT NOT NULL,
  capability_hash TEXT NOT NULL UNIQUE,
  content_hash TEXT,
  verification_class TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('held','approved','publishing','published','withdrawn','rejected','expired')),
  eligible_at TEXT,
  publication_period TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  privacy_json TEXT NOT NULL,
  created_day TEXT,
  held_on TEXT,
  batch_id TEXT,
  op_token TEXT
);
INSERT INTO submissions_next(id,public_id,company_id,company_slug,body,layer,period,answers_json,author_key_json,capability_hash,content_hash,verification_class,status,eligible_at,publication_period,revision,privacy_json,created_day,held_on,batch_id,op_token)
SELECT
  CASE WHEN status='published' THEN 'sub_'||lower(hex(randomblob(18))) ELSE id END,
  CASE WHEN status='published' THEN id END,
  company_id, company_slug,
  CASE WHEN status IN ('published','withdrawn') THEN '' ELSE body END,
  layer, period,
  CASE WHEN status='withdrawn' THEN '{}' ELSE answers_json END,
  CASE WHEN status='withdrawn' THEN '{}' ELSE author_key_json END,
  capability_hash,
  CASE WHEN status IN ('published','withdrawn') THEN NULL ELSE content_hash END,
  verification_class, status,
  CASE WHEN status IN ('published','withdrawn') THEN NULL ELSE eligible_at END,
  publication_period, revision,
  CASE WHEN status IN ('published','withdrawn') THEN '[]' ELSE privacy_json END,
  CASE WHEN status IN ('published','withdrawn') THEN NULL ELSE created_day END,
  CASE WHEN status='held' THEN created_day END,
  NULL,
  NULL
FROM submissions;
DROP TABLE submissions;
ALTER TABLE submissions_next RENAME TO submissions;
CREATE INDEX IF NOT EXISTS intake_release ON submissions(status, eligible_at);
CREATE INDEX IF NOT EXISTS intake_group ON submissions(company_id, period, verification_class, status);
CREATE INDEX IF NOT EXISTS intake_batch ON submissions(batch_id);

-- Decisions pin the exact policy (version + canonical digest + matched rule ids) and the screening provider/model/prompt.
-- Rows carry a coarse quarter only; `submission_id` is the private receipt id, never the public id.
ALTER TABLE actions ADD COLUMN policy_version TEXT;
ALTER TABLE actions ADD COLUMN policy_digest TEXT;
ALTER TABLE actions ADD COLUMN rules_json TEXT;
ALTER TABLE actions ADD COLUMN provider TEXT;
ALTER TABLE actions ADD COLUMN model TEXT;
ALTER TABLE actions ADD COLUMN prompt_version TEXT;

-- Per-group aggregate release state. `changes` counts publications and withdrawals since the last released
-- aggregate; a group is re-released only when changes >= 5 and at least 25 published contributions remain.
-- `suppressed` = 1 while a withdrawal has removed the group's cells and no new release has been made.
CREATE TABLE IF NOT EXISTS aggregate_groups (
  company_id TEXT NOT NULL,
  period TEXT NOT NULL,
  verification_class TEXT NOT NULL,
  changes INTEGER NOT NULL DEFAULT 0,
  suppressed INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  released_period TEXT,
  PRIMARY KEY(company_id, period, verification_class)
);
-- Legacy aggregates were computed from a public copy of individual answers (now purged by public migration 0002);
-- queue every legacy published group for one recomputation from intake.
INSERT OR IGNORE INTO aggregate_groups(company_id,period,verification_class,changes,suppressed,version)
SELECT company_id, period, verification_class, COUNT(*), 0, 1 FROM submissions WHERE status='published' GROUP BY company_id, period, verification_class;
