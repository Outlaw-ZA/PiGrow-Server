-- =============================================================
-- Add ABOVE_MIN / BELOW_MAX / ABOVE_TARGET / BELOW_TARGET to
-- RuleCondition. These are threshold conditions evaluated by the
-- automation evaluator (src/automation/evaluator.ts) against the
-- current PhaseEnvironment row for the watched sensor type.
-- No model/column changes are needed — all four new conditions
-- operate on fields that already exist on PhaseEnvironment.
-- =============================================================

-- 1. Extend the RuleCondition enum with the four new values.
--    Each ADD VALUE is its own statement because Postgres cannot
--    combine ALTER TYPE ... ADD VALUE with any other catalog
--    mutation inside a single transaction.
ALTER TYPE "RuleCondition" ADD VALUE 'ABOVE_MIN';
ALTER TYPE "RuleCondition" ADD VALUE 'BELOW_MAX';
ALTER TYPE "RuleCondition" ADD VALUE 'ABOVE_TARGET';
ALTER TYPE "RuleCondition" ADD VALUE 'BELOW_TARGET';
