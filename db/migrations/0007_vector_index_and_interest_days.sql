-- 0007: additive only (two new tables, one index; no existing row is changed or removed).
-- vector_index: the deletion ledger for optional semantic retrieval (G6). Every vector id is recorded here before it is
-- upserted, so the sweep can always delete a withdrawn account's vector. Nothing is indexed until this table AND a
-- VECTORIZE binding on the inference worker both exist. Identical to worker/inference-core.ts VECTOR_LEDGER_DDL.
-- interest_seen: per-day de-duplication of FAQ interest (decision D5). A row is HMAC(RATE_LIMIT_SECRET, UTC day, scope,
-- digest of the connecting address) and that day, nothing else; no address, employer or question is stored in the clear.
-- Rows of earlier days are deleted on the next write and by the 6-hourly scheduled job, so none outlives the next day.
CREATE TABLE IF NOT EXISTS vector_index(testimony_id TEXT PRIMARY KEY, indexed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS interest_seen(digest TEXT PRIMARY KEY, day TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS interest_seen_day ON interest_seen(day);
