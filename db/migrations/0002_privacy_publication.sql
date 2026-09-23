-- Public 0002: privacy and publication.
-- Structural changes are additive. The only row deletions are in two legacy tables that hold individual,
-- non-public data and are no longer read or written by any code:
--  * structured_responses: one row of private questionnaire answers per published testimony id. Individual answers
--    now stay in the intake database; this database receives only thresholded aggregates.
--  * pending_submissions: legacy unpublished drafts, capability hashes and exact submission timestamps.
-- No other table's rows are changed.
ALTER TABLE metric_releases ADD COLUMN verification_method TEXT;
DELETE FROM structured_responses;
DELETE FROM pending_submissions;
-- The hash-chained transparency manifests are append-only, like the financial and legal ledgers.
CREATE TRIGGER IF NOT EXISTS release_manifests_no_update BEFORE UPDATE ON release_manifests BEGIN SELECT RAISE(ABORT, 'append_only'); END;
CREATE TRIGGER IF NOT EXISTS release_manifests_no_delete BEFORE DELETE ON release_manifests BEGIN SELECT RAISE(ABORT, 'append_only'); END;
