-- Intake 0002: per-question aggregate release state and hold reasons. Additive: new columns, filled for existing rows.
-- Survey questions are optional, so a group-level count of 5 changes can still change one question by a single answer.
--  * question_changes: answer-level publications/withdrawals per question since that question was last released.
--  * question_released: questions released at least once. A released question is replaced only after at least 5
--    answer-level changes (or none), so two consecutive releases of one question never differ by 1–4 answers.
ALTER TABLE aggregate_groups ADD COLUMN question_changes TEXT NOT NULL DEFAULT '{}';
ALTER TABLE aggregate_groups ADD COLUMN question_released TEXT NOT NULL DEFAULT '{}';
-- Every group that exists now was released from legacy data (0001 queued them), so every question counts as released:
-- none may come back after fewer than 5 answer-level changes even if its legacy cell has already been removed.
UPDATE aggregate_groups SET question_released='{"compensation":1,"workload":1,"manager_trust":1,"perf_review_fairness":1,"bad_news_upward":1,"layoffs_handled":1,"promotions_clarity":1,"manager_return":1,"return_intent":1,"exec_trust":1}';
-- Why a case is held, so its receipt states the real reason: 'jury' (a jury outcome) or 'privacy_rescan' (an identifying
-- detail found just before publication). Rows held before this migration were held for a jury outcome.
ALTER TABLE submissions ADD COLUMN hold_reason TEXT;
UPDATE submissions SET hold_reason='jury' WHERE status='held';
