-- Intake base schema (private). Kept as originally deployed; every later change is a numbered file in
-- db/intake-migrations, applied by `node tools/db.mjs local|remote` after this file.
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  company_slug TEXT NOT NULL,
  body TEXT NOT NULL,
  layer TEXT NOT NULL CHECK(layer IN ('experience','claim','opinion')),
  period TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  author_key_json TEXT NOT NULL,
  capability_hash TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  verification_class TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('held','approved','published','withdrawn','rejected')),
  eligible_at TEXT NOT NULL,
  publication_period TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  privacy_json TEXT NOT NULL,
  created_day TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS intake_release ON submissions(status, eligible_at);
CREATE TABLE IF NOT EXISTS spent_proofs (
  nullifier TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  action TEXT NOT NULL,
  rule TEXT NOT NULL,
  period TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS actions_no_update BEFORE UPDATE ON actions BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS actions_no_delete BEFORE DELETE ON actions BEGIN SELECT RAISE(ABORT, 'append_only'); END;
