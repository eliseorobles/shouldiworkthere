-- Intake 0005 (policy 0.6.0): final jury decisions follow the words they decided, relevant challenges wait in a queue
-- instead of being refused, and public counts are served from a daily snapshot. Additive only: two nullable columns and
-- two new tables; no existing row is changed or deleted. Nothing here holds an address, a mailbox, a name or any text.

-- SHA-256 (base64url) of the unmasked words a case decided, so identical words resubmitted by revision keep a final
-- result (an appeal decision, or a first-jury upheld result) instead of drawing a new jury. Cleared, with the link to the
-- contribution, when those words are withdrawn or expire. Cases opened before this migration have none.
ALTER TABLE jury_cases ADD COLUMN content_hash TEXT;

-- SHA-256 (base64url) of the published words a challenge re-check decided, so the same words revised back in after a
-- re-check withheld them stay withheld under that policy version. Deleted with the re-check when the policy changes.
ALTER TABLE rescreens ADD COLUMN content_hash TEXT;

-- Relevant challenges whose re-check could not run when they arrived (the day's re-checks were used up, or the hosted
-- check failed). id is the receipt id already given to the challenger; the scheduled job re-checks queued challenges,
-- urgent privacy and safety rules first, and moves each one to challenges with its outcome.
CREATE TABLE IF NOT EXISTS challenge_queue (
  id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  urgent INTEGER NOT NULL DEFAULT 0,
  policy_version TEXT NOT NULL,
  policy_digest TEXT NOT NULL,
  relevance TEXT,
  period TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS challenge_queue_one ON challenge_queue (public_id, rule_id, policy_digest);
CREATE INDEX IF NOT EXISTS challenge_queue_order ON challenge_queue (urgent, period);

-- Public counts computed at most once per UTC day (the contribution counts behind /api/transparency, and the day each
-- quarter's moderation statistics were last refreshed), so polling cannot time when a rounded count changes. payload
-- holds only values that are already public (rounded or suppressed).
CREATE TABLE IF NOT EXISTS stats_snapshots (
  name TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  payload TEXT NOT NULL
);
