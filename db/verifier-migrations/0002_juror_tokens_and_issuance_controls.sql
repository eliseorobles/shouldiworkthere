-- Verifier 0002: juror keys, the juror token quota, and anti-astroturf issuance controls for real employers. Additive
-- only: no existing row is changed or deleted. Existing mailbox keys become contribution keys with no embedded limits;
-- the verifier then applies the smallest cap until tools/provision-issuer.mjs rewrites their rows with limits for the
-- employer's headcount band. Sandbox (demo) keys are never capped, counted or paused.
ALTER TABLE issuer_keys ADD COLUMN purpose TEXT NOT NULL DEFAULT 'contribution' CHECK (purpose IN ('contribution','juror'));
-- Copied from the public database's companies.headcount_band at provisioning time; the verifier never reads that database.
ALTER TABLE issuer_keys ADD COLUMN headcount_band TEXT;
-- Credentials (contribution) or tokens (juror) per employer, purpose and issuance quarter.
ALTER TABLE issuer_keys ADD COLUMN issuance_cap INTEGER;
-- Most issued for one employer and purpose within a rolling 24 hours before issuance pauses for 24 hours.
ALTER TABLE issuer_keys ADD COLUMN velocity_limit INTEGER;

-- Juror tokens per (mailbox, employer, issuance quarter), separate from the one contribution credential. mailbox_hash is
-- a keyed hash with its own prefix. Rows expire at the end of the quarter.
CREATE TABLE IF NOT EXISTS juror_quota (
 mailbox_hash TEXT PRIMARY KEY,
 tokens INTEGER NOT NULL,
 expires_at TEXT NOT NULL,
 CONSTRAINT juror_quota_limit CHECK (tokens BETWEEN 0 AND 5)
);

-- Issued per employer, purpose and issuance quarter. Nothing identifies a mailbox. Rows older than the current
-- quarter are deleted by the scheduled job.
CREATE TABLE IF NOT EXISTS issuance_counts (
 company_slug TEXT NOT NULL,
 purpose TEXT NOT NULL,
 epoch TEXT NOT NULL,
 issued INTEGER NOT NULL,
 cap INTEGER NOT NULL,
 PRIMARY KEY (company_slug, purpose, epoch),
 CONSTRAINT issuance_cap CHECK (issued <= cap)
);

-- Issued per employer, purpose and UTC hour, kept 48 hours for the rolling 24-hour velocity breaker.
CREATE TABLE IF NOT EXISTS issuance_hours (
 company_slug TEXT NOT NULL,
 purpose TEXT NOT NULL,
 hour INTEGER NOT NULL,
 n INTEGER NOT NULL,
 velocity_limit INTEGER NOT NULL,
 PRIMARY KEY (company_slug, purpose, hour)
);
CREATE TRIGGER IF NOT EXISTS issuance_velocity_insert AFTER INSERT ON issuance_hours
 WHEN (SELECT SUM(n) FROM issuance_hours WHERE company_slug=NEW.company_slug AND purpose=NEW.purpose AND hour>NEW.hour-24) > NEW.velocity_limit
 BEGIN SELECT RAISE(ABORT, 'issuance_velocity'); END;
CREATE TRIGGER IF NOT EXISTS issuance_velocity_update AFTER UPDATE OF n ON issuance_hours
 WHEN NEW.n > OLD.n AND (SELECT SUM(n) FROM issuance_hours WHERE company_slug=NEW.company_slug AND purpose=NEW.purpose AND hour>NEW.hour-24) > NEW.velocity_limit
 BEGIN SELECT RAISE(ABORT, 'issuance_velocity'); END;

-- An employer and purpose whose issuance is paused until paused_until. A contribution trip pauses both purposes for that
-- employer; a juror trip pauses juror tokens only. Deleted by the scheduled job once ended.
CREATE TABLE IF NOT EXISTS issuance_pauses (
 company_slug TEXT NOT NULL,
 purpose TEXT NOT NULL,
 paused_until TEXT NOT NULL,
 PRIMARY KEY (company_slug, purpose)
);

-- The code-email throttle counts per mailbox across purposes and quarters (at most 3 emails in any 15 minutes). A keyed
-- hash of the canonical mailbox alone, kept only as long as its challenge row.
ALTER TABLE mailbox_challenges ADD COLUMN throttle_hash TEXT;
CREATE INDEX IF NOT EXISTS mailbox_challenges_throttle ON mailbox_challenges(throttle_hash, expires_at);

-- A mailbox challenge authorizes one issuance. The juror flow marks it used without a used=0 filter, so a concurrent
-- second use aborts its whole batch instead of silently counting twice. Releasing (used=0) stays allowed.
CREATE TRIGGER IF NOT EXISTS mailbox_challenge_single_use BEFORE UPDATE OF used ON mailbox_challenges
 WHEN OLD.used = 1 AND NEW.used = 1
 BEGIN SELECT RAISE(ABORT, 'challenge_used'); END;
