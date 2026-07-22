ALTER TABLE "GrowPhase"
ADD COLUMN "phMin" DOUBLE PRECISION,
ADD COLUMN "phTarget" DOUBLE PRECISION,
ADD COLUMN "phMax" DOUBLE PRECISION;

WITH "phase_ph_source" AS (
  SELECT DISTINCT ON (env."growPhaseId")
    env."growPhaseId",
    env."phMin",
    env."phTarget",
    env."phMax"
  FROM "PhaseEnvironment" AS env
  WHERE env."phMin" IS NOT NULL
    OR env."phTarget" IS NOT NULL
    OR env."phMax" IS NOT NULL
  ORDER BY
    env."growPhaseId",
    CASE env."period" WHEN 'DAY' THEN 0 ELSE 1 END
)
UPDATE "GrowPhase" AS phase
SET
  "phMin" = source."phMin",
  "phTarget" = source."phTarget",
  "phMax" = source."phMax"
FROM "phase_ph_source" AS source
WHERE source."growPhaseId" = phase."id";

DELETE FROM "PhaseNutrient" AS night
USING "PhaseNutrient" AS day
WHERE night."growPhaseId" = day."growPhaseId"
  AND night."nutrientId" = day."nutrientId"
  AND night."appliesToPeriod" = 'NIGHT'
  AND day."appliesToPeriod" = 'DAY';

DROP INDEX "phase_nutrient_unique";

ALTER TABLE "PhaseNutrient" DROP COLUMN "appliesToPeriod";

CREATE UNIQUE INDEX "phase_nutrient_unique" ON "PhaseNutrient"("growPhaseId", "nutrientId");

ALTER TABLE "PhaseEnvironment"
DROP COLUMN "phMin",
DROP COLUMN "phTarget",
DROP COLUMN "phMax";
