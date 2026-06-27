-- Scope devices to a grow cycle (per-grow isolation).
ALTER TABLE "Device" DROP CONSTRAINT IF EXISTS "Device_controllerId_fkey";
ALTER TABLE "Device" DROP COLUMN IF EXISTS "controllerId";
ALTER TABLE "Device" ADD COLUMN "growCycleId" TEXT NOT NULL;
ALTER TABLE "Device" ADD CONSTRAINT "Device_growCycleId_fkey" FOREIGN KEY ("growCycleId") REFERENCES "GrowCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce at most one active grow per controller at the DB level.
CREATE UNIQUE INDEX "one_active_grow_per_controller" ON "GrowCycle"("controllerId") WHERE "isActive" = true;
