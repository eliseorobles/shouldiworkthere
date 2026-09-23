-- Verifier 0004: REMOVES ROWS. Drops the tables of the verifier that predates blind-signed credentials, which no code
-- reads or writes: attestation_jobs (employer domain and label, relationship, challenge hash, exact creation time),
-- issued_credentials (attestation reference, claim scope, relationship, exact issuance and redemption times),
-- revocation_list, the per-bucket issuance_quota, and the legacy challenges and issuance_quota_v2 that 0001 already
-- emptied. Every row in them is deleted with the table; they were kept with no time limit and were never listed in the
-- privacy policy. tools/db.mjs prints each table's row count before applying this, and applies it to a remote database
-- only with --accept-row-changes (take a D1 bookmark first: docs/operations.md). The current tables (issuer_keys,
-- mailbox_challenges, issuance_quota_v3, juror_quota, issuance_counts, issuance_hours, issuance_pauses) are untouched.
DROP TABLE IF EXISTS attestation_jobs;
DROP TABLE IF EXISTS issued_credentials;
DROP TABLE IF EXISTS revocation_list;
DROP TABLE IF EXISTS issuance_quota;
DROP TABLE IF EXISTS challenges;
DROP TABLE IF EXISTS issuance_quota_v2;
