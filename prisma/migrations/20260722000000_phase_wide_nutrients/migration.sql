ALTER TABLE "GrowPhase"
ADD COLUMN "phMin" DOUBLE PRECISION,
ADD COLUMN "phTarget" DOUBLE PRECISION,
ADD COLUMN "phMax" DOUBLE PRECISION;

UPDATE "GrowPhase" AS phase
SET
  "phMin" = COALESCE(
    (SELECT env."phMin" FROM "PhaseEnvironment" AS env WHERE env."growPhaseId" = phase."id" AND env."period" = 'DAY'),
    (SELECT env."phMin" FROM "PhaseEnvironment" AS env WHERE env."growPhaseId" = phase."id" AND env."period" = 'NIGHT')
  ),
  "phTarget" = COALESCE(
    (SELECT env."phTarget" FROM "PhaseEnvironment" AS env WHERE env."growPhaseId" = phase."id" AND env."period" = 'DAY'),
    (SELECT env."phTarget" FROM "PhaseEnvironment" AS env WHERE env."growPhaseId" = phase."id" AND env."period" = 'NIGHT')
  ),
  "phMax" = COALESCE(
    (SELECT env."phMax" FROM "PhaseEnvironment" AS env WHERE env."growPhaseId" = phase."id" AND env."period" = 'DAY'),
    (SELECT env."phMax" FROM "PhaseEnvironment" AS env WHERE env."growPhaseId" = phase."id" AND env."period" = 'NIGHT')
  );

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
