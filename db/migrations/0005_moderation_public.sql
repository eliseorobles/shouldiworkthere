-- Public 0005: moderation transparency. Additive only; no existing row is changed.
-- The scheduled job writes each quarter's moderation counts into moderation_stats. A count below 5 is stored as
-- suppressed=1 with value 0, so no small count is ever held in this database.
ALTER TABLE moderation_stats ADD COLUMN suppressed INTEGER NOT NULL DEFAULT 0;
-- One append-only row per executed trustee exception: kind, scope, a digest of the target account, the expiry day, the
-- signing trustees and the pinned policy. No text, no requester and no precise time.
CREATE TABLE IF NOT EXISTS exception_log (
  id TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('legal_order','imminent_safety')),
  scope TEXT NOT NULL,
  target_digest TEXT NOT NULL,
  expires_on TEXT NOT NULL,
  signers_json TEXT NOT NULL,
  action_digest TEXT NOT NULL UNIQUE,
  policy_version TEXT NOT NULL,
  policy_digest TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS exception_log_no_update BEFORE UPDATE ON exception_log BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS exception_log_no_delete BEFORE DELETE ON exception_log BEGIN SELECT RAISE(ABORT, 'append_only'); END;
