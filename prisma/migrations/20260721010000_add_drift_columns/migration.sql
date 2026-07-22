-- Align live DB with prisma/schema.prisma after pre-existing drift was discovered.
-- This column is nullable in the schema; no data backfill required.
--
-- Drift history:
--   * Device.maxOnSeconds (Int?, max continuous ON time before the engine
--     force-OFFs) was added to the schema but never persisted via a migration.
--
-- The column is referenced at runtime by the automation scheduler's overrun
-- backstop at src/automation/scheduler.ts:80-100 and was the cause of the
-- npm-run-dev startup crash plus the pre-existing 18 integration-test
-- failures.

ALTER TABLE "Device" ADD COLUMN "maxOnSeconds" INTEGER;
