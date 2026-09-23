-- Verifier 0003: the juror token quota falls from 5 to 3 per mailbox, employer and issuance quarter (policy 0.5.0).
-- Additive only: two triggers; no existing row is changed or deleted. SQLite cannot alter the 0..5 CHECK from 0002, so
-- these triggers refuse any insert, or any increase, that would take a mailbox above 3 tokens. They raise the same
-- 'juror_quota_limit' error the CHECK does, so /issue-juror answers juror_quota_exceeded with the tokens that remain.
-- A mailbox that already holds 4 or 5 tokens this quarter keeps them and cannot get more; decreases (a release after a
-- signing failure) stay allowed.
CREATE TRIGGER IF NOT EXISTS juror_quota_three_insert AFTER INSERT ON juror_quota
 WHEN NEW.tokens > 3
 BEGIN SELECT RAISE(ABORT, 'juror_quota_limit'); END;
CREATE TRIGGER IF NOT EXISTS juror_quota_three_update AFTER UPDATE OF tokens ON juror_quota
 WHEN NEW.tokens > 3 AND NEW.tokens > OLD.tokens
 BEGIN SELECT RAISE(ABORT, 'juror_quota_limit'); END;
