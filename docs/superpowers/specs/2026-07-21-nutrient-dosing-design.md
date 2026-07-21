# Nutrient Dosing & pH Bands

**Date:** 2026-07-21
**Status:** Approved
**Scope:** Add nutrient-dosing configuration plus an in-UI per-batch calculator to PiGrow, and extend `PhaseEnvironment` with pH min/target/max bands. No hardware actuation in this iteration.

## Motivation

PiGrow already manages grow cycles, grow phases, per-period environmental thresholds (`PhaseEnvironment`), sensor telemetry, and an automation engine that drives devices (`AutomationRule`, interval scheduler, threshold evaluator). There is no representation of nutrient dosing or pH bands.

Growers want to:

1. Maintain a library of nutrients they use.
2. Attach a dosing chart to each grow phase (which nutrients, at what `ml/L`).
3. Compute the per-nutrient ml totals they need to add to a reservoir for a given water volume.
4. Track min/target/max pH bands per phase so future automation can correct drift.

The future end-state is fully automated dosing via peristaltic pumps. This iteration ships the configuration and calculator halves; pump calibration, persisted mix events, and per-pump runtime are explicitly deferred to a follow-up spec.

## Decisions

1. **Volume-based recipes are the source of truth.** Every dose is stored as `ml / L of working solution`. No ppm, no EC-tolerance windows.
2. **Two-table shape for the chart.** A global `Nutrient` library and a per-phase join table `PhaseNutrient` carrying `doseMlPerL`. Multi-part recipes (A / B / Cal / Mg / pH-up / pH-down) are supported as multiple join rows.
3. **pH bands extend `PhaseEnvironment`.** The existing per-period DAY/NIGHT rows already carry min/target/max for `temp`, `humidity`, `co2`. pH rides on the same shape and reuses the same edit dialog.
4. **Per-period dosing is explicit.** `PhaseNutrient.appliesToPeriod` is non-nullable (`DAY | NIGHT`); the UI surfaces "Both periods" as a toggle that creates two rows. This eliminates the Postgres NULL-distinctness ambiguity a nullable period would create.
5. **Calculator is a stateless preview, not a persisted event.** No `MixEvent` table this iteration. The calculator is a pure function; the UI calls it through a POST endpoint.
6. **`PhaseEnvironmentSchema` is extracted into a shared module.** The TypeBox schema is currently duplicated inline in three modules (`grow-cycles`, `grow-phases`, `controllers`); extraction lands in this PR to prevent the same silent-strip trap on future additions.
7. **Pump calibration, persisted mix events, and per-pump auto-dosing are deferred** to a follow-up spec. The follow-up's exact file touch points are enumerated at the end of this document.

## Data model

### `Nutrient` (new table)

| Column     | Type      | Notes                                                            |
| ---------- | --------- | ---------------------------------------------------------------- |
| id         | UUID      | Primary key.                                                     |
| name       | String    | Required, free text.                                             |
| brand      | String?   | Optional. Forward-compatibility; nullable.                       |
| notes      | String?   | Optional.                                                        |
| createdAt  | DateTime  | default now().                                                   |
| updatedAt  | DateTime  | @updatedAt.                                                      |

Constraint: `@@unique([name, brand])`. Documented behavior: two rows with the same `name` and same `brand` are rejected. Two rows with the same `name` and `NULL` brand are both allowed by Postgres NULL-distinctness; the API rejects the second create explicitly with a 409 referencing the existing record's id. Different brands with the same name are allowed (real horticulture case: many brands sell "CalMag").

### `PhaseNutrient` (new table)

| Column           | Type           | Notes                                                                       |
| ---------------- | -------------- | --------------------------------------------------------------------------- |
| id               | UUID           | Primary key.                                                                |
| growPhaseId      | String         | FK → `GrowPhase.id` ON DELETE CASCADE.                                       |
| nutrientId       | String         | FK → `Nutrient.id` ON DELETE RESTRICT. (Deleting a referenced nutrient → 409.) |
| doseMlPerL       | Float          | > 0. API layer further constrains `multipleOf: 0.01` and `maximum: 999.99`. |
| sortOrder        | Int            | default 0.                                                                  |
| appliesToPeriod  | DayNightPeriod | Non-nullable. DAY or NIGHT only.                                            |
| createdAt        | DateTime       | default now().                                                              |
| updatedAt        | DateTime       | @updatedAt.                                                                 |

Constraint: `@@unique([growPhaseId, nutrientId, appliesToPeriod])`.

The "Both periods" intent is expressed as two rows in the table, one for DAY and one for NIGHT.

### `PhaseEnvironment` (extend)

Add three nullable `Float?` columns: `phMin`, `phTarget`, `phMax`. The columns participate in the existing per-period DAY/NIGHT rows; no behavioral change to the threshold evaluator this iteration.

## API surface

### `nutrients` module

| Method | Path                            | Behavior                                                                                  |
| ------ | ------------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/api/nutrients`                | List all nutrients.                                                                       |
| POST   | `/api/nutrients`                | Create. Body `{ name, brand?, notes? }`.                                                  |
| PATCH  | `/api/nutrients/:id`            | Update mutable fields.                                                                    |
| DELETE | `/api/nutrients/:id`            | 409 if any `PhaseNutrient` references this nutrient; otherwise 204.                        |

### `phase-nutrients` module (re-nested under the phase)

| Method | Path                                                        | Behavior                                                                                  |
| ------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| GET    | `/api/grow-phases/:growPhaseId/phase-nutrients`             | List rows for the phase. Optional `?period=DAY|NIGHT` filter; omitting the param returns rows for both periods, ordered by `appliesToPeriod` then `sortOrder`. |
| POST   | `/api/grow-phases/:growPhaseId/phase-nutrients`             | Create. Body `{ nutrientId, doseMlPerL, appliesToPeriod, sortOrder? }`.                   |
| PATCH  | `/api/grow-phases/:growPhaseId/phase-nutrients/:id`         | Update mutable fields (dose, sort order, period).                                          |
| DELETE | `/api/grow-phases/:growPhaseId/phase-nutrients/:id`         | 204 on success.                                                                           |

Re-nested under `/api/grow-phases/:growPhaseId/...` to match the existing `phase-environments` route pattern. The cycle id is not part of the URL; authorization uses the phase's `growCycleId` FK when needed.

### `phase-environments` module (extend existing endpoint)

Extend the existing `PUT /api/grow-phases/:growPhaseId/environment/:period` upsert schema to accept `Nullable(Float({ multipleOf: 0.01 }))` for `phMin`, `phTarget`, `phMax`. **No new endpoint.** The existing replace-semantics controller (full upsert, omitted fields → null) handles the new fields unchanged.

### `dosing-preview` module (new stateless endpoint)

```
POST /api/grow-phases/:growPhaseId/dosing/preview
Body:    { reservoirLiters: number, period: DAY | NIGHT }
Response: {
  mlByNutrientId: Record<string, number>,   // nutrientId -> ml (rounded to 2 decimals)
  totalMl: number,                          // sum of mlByNutrientId values (rounded to 2 decimals)
  warnings: WarningCode[]
}
```

`WarningCode` union:
- `NO_NUTRIENTS_CONFIGURED` — no `PhaseNutrient` rows on the phase.
- `NO_DAY_NUTRIENTS` — period=DAY and no DAY row exists.
- `NO_NIGHT_NUTRIENTS` — period=NIGHT and no NIGHT row exists.
- `NO_PH_BANDS` — no `phMin / phTarget / phMax` on the requested period's `PhaseEnvironment` row.
- `PH_DAY_NIGHT_MISMATCH` — DAY and NIGHT bands exist and differ; the UI shows both to the user.
- `RESERVOIR_TOO_SMALL` — `reservoirLiters < 0` (the API rejects 0 with `min` validation, < 0 with 400).

The endpoint does not persist anything. It reads `PhaseNutrient` rows for the phase filtered by period, reads `PhaseEnvironment` for the phase filtered by period, and runs `computeDosingMl`.

## Calculation

Pure function in `src/api/modules/dosing/calc.ts`:

```ts
function computeDosingMl(
  rows: PhaseNutrientLike[],
  period: DayNightPeriod,
  reservoirLiters: number,
): { mlByNutrientId: Record<string, number>; totalMl: number; warnings: WarningCode[] }
```

Ownership: the pure function owns **all** dosing-domain warnings (`NO_NUTRIENTS_CONFIGURED`, `NO_DAY_NUTRIENTS`, `NO_NIGHT_NUTRIENTS`). The controller owns the pH-band warnings (`NO_PH_BANDS`, `PH_DAY_NIGHT_MISMATCH`) because they require reading `PhaseEnvironment`, which is outside the function's pure signature.

- Returns rounded ml per nutrient (2 decimals).
- Empty input → empty `mlByNutrientId`, `totalMl: 0`, `warning: NO_NUTRIENTS_CONFIGURED`.
- Rows with `appliesToPeriod !== period` are filtered out before calculation. If filtering yields an empty set, emit `NO_DAY_NUTRIENTS` for `period=DAY` or `NO_NIGHT_NUTRIENTS` for `period=NIGHT`.
- Negative or zero `reservoirLiters` → throws a typed error the controller maps to 400 (validation belongs at the schema layer; the function assumes valid input).
- No DB calls. Exhaustive unit tests cover: rounding, per-nutrient totals, sum, warning generation, period filtering.

## Refactor (concurrent)

Extract `PhaseEnvironmentSchema` from its three inline duplicates:

- `src/api/modules/grow-cycles/grow-cycles.schema.ts`
- `src/api/modules/grow-phases/grow-phases.schema.ts`
- `src/api/modules/controllers/controllers.schema.ts`

Move into `src/api/shared/phase-environment-schema.ts`. Each module imports the canonical schema. This is the fix for the silent-strip-on-add-fields trap that the duplicated copies would otherwise cause for the new pH fields.

This refactor lands in the same PR as the dosing feature.

## UI (PiGrow-UI)

1. New `/admin/nutrients` route. List page with a CRUD dialog.
2. New "Nutrient Dosing" tab inside the existing phase admin view. Sortable list of phase nutrients per period (DAY / NIGHT). "Both periods" toggle creates two rows.
3. pH bands added to the existing "Day/Night Environment" dialog (three numeric inputs per period, defaulting NIGHT values from DAY when a new period row is created).
4. New calculator dialog accessible from the phase admin. Inputs: reservoir liters, period (auto-resolved from the same day/night clock logic as the rest of PiGrow; when present, the active phase's `dayStartMinutes` / `dayDurationMinutes` determine the period — fallback to DAY if the active phase cannot be resolved). Output: ml-per-nutrient table, total ml, warnings list. Purely client-side state; nothing persisted.

State management follows the existing pattern: a Pinia store per new resource (`nutrientStore`, `phaseNutrientStore`), `apiStore`-wrapping methods for the new endpoints, registration in `router.ts` and `App.vue`.

## Migration

A single additive migration. Steps:

1. `CREATE TABLE "Nutrient"` with the columns above and `@@unique([name, brand])` constraint.
2. `CREATE TABLE "PhaseNutrient"` with the columns above, FK to `GrowPhase` ON DELETE CASCADE, FK to `Nutrient` ON DELETE RESTRICT, and `@@unique([growPhaseId, nutrientId, appliesToPeriod])`.
3. `ALTER TABLE "PhaseEnvironment" ADD COLUMN "phMin" DOUBLE PRECISION, ADD COLUMN "phTarget" DOUBLE PRECISION, ADD COLUMN "phMax" DOUBLE PRECISION;` (all nullable).

The migration is fully reversible: `DROP TABLE "PhaseNutrient"`, `DROP TABLE "Nutrient"`, `ALTER TABLE "PhaseEnvironment" DROP COLUMN ...;`. The schema extraction is code-only, no migration needed.

## Testing

### Server-side (must pass)

- Existing 157 server tests continue to pass.
- `nutrients` module CRUD: create / list / patch / delete; duplicate `(name, brand)` rejected with 409.
- `DELETE /api/nutrients/:id` returns 409 when referenced by any `PhaseNutrient`.
- `phase-nutrients` module CRUD; conflicting `(growPhaseId, nutrientId, appliesToPeriod)` rejected at DB layer (unique constraint).
- PUT `phase-environments` round-trip: pH fields → GET → values survive; omitted pH fields → null.
- `POST /api/grow-phases/:growPhaseId/dosing/preview`:
  - `reservoirLiters: -1` → 400.
  - `reservoirLiters: 0` → 200 with empty results.
  - Phase with no phase nutrients → 200 with `NO_NUTRIENTS_CONFIGURED` warning.
  - Multi-nutrient phase returns rounded ml per nutrient + sum.
- Migration rollforward + `DROP TABLE / DROP COLUMN` rollback verified against the test DB.

### `computeDosingMl` unit tests

- Rounding (0.33 × 15.5 → 5.12, not 5.114999999999999).
- Per-nutrient totals.
- Sum consistency.
- Warning generation for empty input.

### UI smoke tests (vitest)

- `NutrientList` renders + dialogs commit.
- `DosingCalculatorDialog` shows the expected ml totals given a fixture.
- pH inputs round-trip in `PhaseEnvironmentDialog`.

## Out of scope (deferred)

Each item below is an explicit deferral with future-seam documentation.

1. **Pump calibration (`ml/s` per nutrient pump).** No pump device can have ml/s yet.
2. **`MixEvent` persistence.** The calculator returns no event row; future iteration adds an optional "save mix event" toggle that creates a `MixEvent` table keyed off `growCycleId`, `growPhaseId`, `nutrientId`.
3. **Per-pump auto-dosing runtime.** No device actuation this iteration.
4. **`DeviceType.DOSING_PUMP`** extension. The follow-up adds it to `prisma/schema.prisma:75-86`.
5. **`RuleCondition` PH threshold values.** Today, `SENSOR_TO_ENV_KEY` maps `PH: null` and `getBoundaryFields` returns `null` for `PH`. The follow-up adds `phMin/phMax/phTarget` to `EnvFields`, a `'PH'` case in `getBoundaryFields`, updates `SENSOR_TO_ENV_KEY` to `'phMax'`, and adds `PH_ABOVE_TARGET / PH_BELOW_TARGET` to `RuleCondition`.
6. **EC bands.** Deferral rationale: EC auto-dosing requires a different pump strategy (typical reservoirs need A and B dosed in sequence with EC feedback) than pH (single pH-up / pH-down pump). Will land in a separate spec after pump calibration exists.

## Future-seam touch points (exact files)

The follow-up spec must edit:

- `prisma/schema.prisma` — extend `DeviceType` with `DOSING_PUMP`; extend `RuleCondition` with `PH_ABOVE_TARGET` / `PH_BELOW_TARGET`.
- `src/automation/evaluator.ts` — `EnvFields` interface (add `phMin / phMax / phTarget`), `SENSOR_TO_ENV_KEY` (change `PH: null` → `PH: 'phMax'`), `getBoundaryFields` switch (add `case 'PH'`), `evaluateThresholds` select clause (include the three pH columns).
- `src/api/modules/automation-rules/automation-rules.schema.ts` — extend `AcceptedRuleConditionEnum` and the rule create/update payloads with PH conditions.
- New file `src/automation/dosing-scheduler.ts` — implements per-pump duty cycles using existing `intervalScheduler` patterns.
- `src/api/modules/dosing/calc.ts` (this iteration's file) — runtime extension to compute "next ml to dispense given current sensor drift" once sensor feedback is wired.

## Open questions resolved

1. Nutrient scoping: **global** library; no `controllerId` column.
2. Phase cloning: **not present today**; design records that future phase/cycle cloning must copy `PhaseNutrient` rows with the duplicated phase.
3. Calculator persistence: **in-UI only**; no `MixEvent` in this iteration.
4. Schema extraction: **included in this PR**, not a separate refactor PR.

## Risks

1. **Migration drift.** The Postgres NULL-distinctness quirk on `@@unique([name, brand])` is mitigated by the API-layer conflict check. Documented in the migration SQL header comment.
2. **Per-period overlap safety.** The "both periods" toggle creates two explicit rows; the unique constraint rejects duplicates. The UI must disable the toggle when one of the two intended rows already exists.
3. **`PhaseEnvironmentSchema` extraction scope.** Three modules need to switch their inline schemas. The diff is mechanical, but reviewers should confirm the imports stay tree-shakeable and the `Nullable(Float)` wrapper type is preserved exactly.
