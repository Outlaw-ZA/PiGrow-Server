-- =============================================================
-- Add ALWAYS_ON / ALWAYS_OFF to RuleCondition and make
-- AutomationRule.watchedSensorType nullable so ALWAYS_* rules can
-- omit the sensor type. ABOVE_MAX / BELOW_MIN rules keep the existing
-- non-null contract (enforced at the API layer).
-- =============================================================

-- 1. Extend the RuleCondition enum with the two new values.
ALTER TYPE "RuleCondition" ADD VALUE 'ALWAYS_ON';
ALTER TYPE "RuleCondition" ADD VALUE 'ALWAYS_OFF';

-- 2. Make watchedSensorType nullable. Existing rows have non-null values
--    (all current rules are ABOVE_MAX / BELOW_MIN), so no data rewrite is
--    needed — the column is simply widened.
ALTER TABLE "AutomationRule"
    ALTER COLUMN "watchedSensorType" DROP NOT NULL;
