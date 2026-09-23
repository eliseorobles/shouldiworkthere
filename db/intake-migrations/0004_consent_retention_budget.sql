-- Intake 0004: the author's sensitive-data consent, the 12-month scrub of erased records, and the daily challenge
-- budget (policy 0.5.0). Additive only: two defaulted or nullable columns and one new table; no existing row is changed
-- or deleted. Nothing here holds an address, a mailbox or a name.

-- 1 only if the author ticked the explicit statement that the account may reveal sensitive information about them
-- (GDPR Article 9(2)(a)) and chose to publish it. Stored as a boolean on this row only, and erased with the row's text
-- on withdrawal or expiry. Every row accepted before this migration counts as not having given it.
ALTER TABLE submissions ADD COLUMN sensitive_consent INTEGER NOT NULL DEFAULT 0;

-- The UTC month ('YYYY-MM') in which a row was withdrawn or expired. In the 12th month after it, the scheduled job
-- replaces capability_hash with a random value and blanks company_id, company_slug, period and publication_period, then
-- clears this column. Rows erased before this migration are stamped by the first scheduled run after it.
ALTER TABLE submissions ADD COLUMN erased_month TEXT;

-- Challenges per client and UTC day. digest is an HMAC, keyed with the main worker's RATE_LIMIT_SECRET, of the day, the
-- purpose and a SHA-256 digest of the connecting address; no address is stored. Rows are deleted by the scheduled job
-- once their day has ended.
CREATE TABLE IF NOT EXISTS daily_budgets (
  day TEXT NOT NULL,
  digest TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, digest)
);
