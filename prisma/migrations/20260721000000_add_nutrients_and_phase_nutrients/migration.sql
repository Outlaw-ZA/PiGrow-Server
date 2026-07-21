-- Nutrient dosing configuration tables
CREATE TABLE "Nutrient" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "brand" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Nutrient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "nutrient_name_brand_unique" ON "Nutrient"("name", "brand");

CREATE TABLE "PhaseNutrient" (
  "id" TEXT NOT NULL,
  "growPhaseId" TEXT NOT NULL,
  "nutrientId" TEXT NOT NULL,
  "doseMlPerL" DOUBLE PRECISION NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "appliesToPeriod" "DayNightPeriod" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PhaseNutrient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "phase_nutrient_unique" ON "PhaseNutrient"("growPhaseId", "nutrientId", "appliesToPeriod");

CREATE INDEX "PhaseNutrient_growPhaseId_idx" ON "PhaseNutrient"("growPhaseId");
CREATE INDEX "PhaseNutrient_nutrientId_idx" ON "PhaseNutrient"("nutrientId");

ALTER TABLE "PhaseNutrient" ADD CONSTRAINT "PhaseNutrient_growPhaseId_fkey" FOREIGN KEY ("growPhaseId") REFERENCES "GrowPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PhaseNutrient" ADD CONSTRAINT "PhaseNutrient_nutrientId_fkey" FOREIGN KEY ("nutrientId") REFERENCES "Nutrient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Extend PhaseEnvironment with pH bands
ALTER TABLE "PhaseEnvironment" ADD COLUMN "phMin"    DOUBLE PRECISION;
ALTER TABLE "PhaseEnvironment" ADD COLUMN "phTarget" DOUBLE PRECISION;
ALTER TABLE "PhaseEnvironment" ADD COLUMN "phMax"    DOUBLE PRECISION;
