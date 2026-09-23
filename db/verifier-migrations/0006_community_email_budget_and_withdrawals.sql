-- Verifier 0006: daily email budgets for community employers, withdrawn community registrations, and an index for
-- per-employer key reads. Additive only: two new tables and two new indexes; no existing row is changed or deleted.
--
-- email_budget: verification emails sent today (UTC) for employers anyone listed (community keys), per employer and for
-- all of them together (scope '*'), so a listed domain cannot be used to send large volumes of codes to addresses at it
-- (shared/proof.ts COMMUNITY_EMAIL_LIMITS). Counts only: no address, mailbox digest or time finer than the day. /start
-- answers the same whether or not the budget allowed an email, like the per-mailbox throttle. Rows older than yesterday are
-- deleted by the scheduled job.
CREATE TABLE IF NOT EXISTS email_budget (
 day TEXT NOT NULL,
 scope TEXT NOT NULL,
 sent INTEGER NOT NULL DEFAULT 0 CHECK (sent >= 0),
 PRIMARY KEY (day, scope)
);
-- withdrawn_employers: a community registration taken down (DELETE /internal/employers, authenticated by INTERNAL_TOKEN).
-- The registry row and the employer's community keys are deleted; this row keeps the slug and domain from being registered
-- again, so a key id is never reused for other key material. An operator re-admits an employer by deleting its row here.
CREATE TABLE IF NOT EXISTS withdrawn_employers (
 company_slug TEXT PRIMARY KEY,
 domain TEXT,
 withdrawn_quarter TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS withdrawn_employers_domain ON withdrawn_employers(domain);
-- /keys?company=<slug>, /stats?company=<slug>, the signing checks and the scheduled job read one employer's keys at a time.
CREATE INDEX IF NOT EXISTS issuer_keys_company ON issuer_keys(company_slug, expires_at);
