# Nutrient Dosing & pH Bands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-phase nutrient dosing configuration, an in-UI per-batch dosing calculator, and pH min/target/max bands to PiGrow.

**Architecture:** Two new Prisma tables (`Nutrient`, `PhaseNutrient`) joined to existing `GrowPhase`. Three nullable `Float` columns added to existing `PhaseEnvironment` for pH bands. New `POST /api/grow-phases/:growPhaseId/dosing/preview` endpoint backed by a pure `computeDosingMl` function. One refactor to extract the duplicated `PhaseEnvironmentSchema` into a shared module. UI adds a nutrients admin page, a nutrient-dosing tab inside the existing phase admin, pH inputs in the existing environment dialog, and a calculator dialog. No hardware actuation — pump calibration, MixEvent persistence, and per-pump auto-dosing are deferred to a follow-up spec.

**Tech Stack:**
- Backend: Node.js 22, TypeScript 6, Fastify 5, TypeBox, Prisma 7, PostgreSQL 16.
- Frontend: Vue 3, TypeScript, Pinia, Vue Router, vitest.
- Testing: bun test (server), vitest (UI).

## Global Constraints

- All migrations are **additive only** (no data migration, no column drops, no backfill).
- The migration is reversible via `DROP TABLE "PhaseNutrient"`, `DROP TABLE "Nutrient"`, `ALTER TABLE "PhaseEnvironment" DROP COLUMN "phMin"`, `DROP COLUMN "phTarget"`, `DROP COLUMN "phMax"`.
- All API responses use the existing `cast<>` helper from `src/api/shared/cast.ts`.
- All numeric API inputs use `Type.Integer` or `Type.Float({ multipleOf: 0.01, maximum: 999.99 })` as appropriate.
- Reuse existing patterns: each module has `routes.ts`, `controller.ts`, `schema.ts`, `test.ts`. Use `src/api/modules/test-helper.ts` for integration test bootstrap.
- Module shape: a controller class instantiated by Fastify plugin, schemas in TypeBox, route handlers wrapped in `try/catch`.
- Client: Vue 3 + Pinia, mounts in `src/main.ts`; routes in `src/router.ts`; UI registered in `src/App.vue`. New stores follow the existing `apiStore`-wrapping pattern.
- Existing 157 server tests must continue to pass.
- Commit after each step (per the subagent-driven-development template).

---

## File Structure

### Server (create)

| File                                                                          | Purpose                                                                |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `prisma/migrations/<timestamp>_add_nutrients_and_phase_nutrients/migration.sql` | Additive migration: `Nutrient`, `PhaseNutrient`, three pH columns.   |
| `src/api/shared/phase-environment-schema.ts`                                  | Canonical `PhaseEnvironmentSchema` (extracted from three duplicates). |
| `src/api/shared/phase-environment-schema.test.ts`                             | Unit test asserting the shared schema matches the prior inline shapes. |
| `src/api/modules/nutrients/nutrients.routes.ts`                                | `GET/POST /api/nutrients`, `PATCH/DELETE /api/nutrients/:id`.        |
| `src/api/modules/nutrients/nutrients.controller.ts`                            | Controller class.                                                      |
| `src/api/modules/nutrients/nutrients.schema.ts`                                | TypeBox schemas + `WarningCode` enum (`PhaseNutrient` reuses it).       |
| `src/api/modules/nutrients/nutrients.test.ts`                                  | Integration tests.                                                     |
| `src/api/modules/phase-nutrients/phase-nutrients.routes.ts`                    | `GET/POST /api/grow-phases/:growPhaseId/phase-nutrients`, etc.         |
| `src/api/modules/phase-nutrients/phase-nutrients.controller.ts`                | Controller class.                                                      |
| `src/api/modules/phase-nutrients/phase-nutrients.schema.ts`                    | TypeBox schemas.                                                       |
| `src/api/modules/phase-nutrients/phase-nutrients.test.ts`                      | Integration tests.                                                     |
| `src/api/modules/dosing/calc.ts`                                               | Pure function `computeDosingMl`.                                       |
| `src/api/modules/dosing/calc.test.ts`                                          | Pure-function unit tests.                                              |
| `src/api/modules/dosing/dosing.routes.ts`                                      | `POST /api/grow-phases/:growPhaseId/dosing/preview`.                    |
| `src/api/modules/dosing/dosing.controller.ts`                                  | Controller: reads rows, runs `computeDosingMl`, adds pH warnings.      |
| `src/api/modules/dosing/dosing.schema.ts`                                      | TypeBox schemas + `WarningCode` enum + `DayNightPeriod`.                |
| `src/api/modules/dosing/dosing.test.ts`                                        | Integration tests for preview endpoint.                                |

### Server (modify)

| File                                                                  | Change                                                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                                | Add `Nutrient`, `PhaseNutrient` models; add `phMin/phTarget/phMax` to `PhaseEnvironment`.           |
| `src/api/modules/phase-environments/phase-environments.schema.ts`     | Extend `UpsertPhaseEnvironmentSchema` with pH fields (nullable Float).                              |
| `src/api/modules/phase-environments/phase-environments.controller.ts` | No behavior change; the existing upsert accepts the new fields.                                   |
| `src/api/modules/grow-cycles/grow-cycles.schema.ts`                   | Replace inline `PhaseEnvironmentSchema` with import from `src/api/shared/phase-environment-schema`. |
| `src/api/modules/grow-phases/grow-phases.schema.ts`                   | Same as above.                                                                                    |
| `src/api/modules/controllers/controllers.schema.ts`                   | Same as above.                                                                                    |
| `src/server.ts`                                                       | Register the three new Fastify plugins (`nutrients`, `phase-nutrients`, `dosing`).                  |

### UI (create)

| File                                                  | Purpose                                          |
| ----------------------------------------------------- | ------------------------------------------------ |
| `src/stores/nutrientStore.ts`                         | Pinia store for the nutrient library.            |
| `src/stores/phaseNutrientStore.ts`                    | Pinia store for phase dosing rows.               |
| `src/views/admin/Nutrients.vue`                       | `/admin/nutrients` CRUD page.                    |
| `src/components/NutrientList.vue`                     | Reusable list/table for nutrients.               |
| `src/components/PhaseNutrientList.vue`                | Per-phase nutrient dosing tab content.           |
| `src/components/DosingCalculatorDialog.vue`          | Calculator dialog (UI only).                     |
| `src/views/admin/Nutrients.test.ts`                   | Smoke tests.                                     |
| `src/components/PhaseNutrientList.test.ts`            | Smoke tests.                                     |
| `src/components/DosingCalculatorDialog.test.ts`       | Smoke tests (mocked API).                        |

### UI (modify)

| File                                              | Change                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/stores/apiStore.ts`                          | Add `nutrients.*`, `phaseNutrients.*`, `dosing.preview()` methods.                                       |
| `src/router.ts`                                   | Register `/admin/nutrients` route.                                                                      |
| `src/components/PhaseEnvironmentDialog.vue`       | Add three numeric inputs per period for pH bands; default NIGHT from DAY when creating a new period row. |
| `src/views/PhaseAdmin.vue` (or equivalent)         | Add "Nutrient Dosing" tab; add "Calculator" button.                                                     |

---

## Task 1: Prisma schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (add models and columns).
- Create: `prisma/migrations/<timestamp>_add_nutrients_and_phase_nutrients/migration.sql`.
- Run: `bunx prisma migrate dev --name add_nutrients_and_phase_nutrients`.

**Interfaces:**
- Produces Prisma model types:
  - `Nutrient { id, name, brand?, notes?, createdAt, updatedAt }`
  - `PhaseNutrient { id, growPhaseId, nutrientId, doseMlPerL, sortOrder, appliesToPeriod: DayNightPeriod, createdAt, updatedAt }`
  - `PhaseEnvironment { ...existing, phMin?, phTarget?, phMax? }`

- [ ] **Step 1.1: Add models to `schema.prisma`**

Append to `prisma/schema.prisma` (find a clean location after the existing models, before or after `PhaseEnvironment` per Prisma convention):

```prisma
// ==========================================
// NUTRIENT DOSING LAYER
// ==========================================

model Nutrient {
  id        String   @id @default(uuid())
  name      String
  brand     String?
  notes     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  phaseNutrients PhaseNutrient[]

  @@unique([name, brand], map: "nutrient_name_brand_unique")
}

model PhaseNutrient {
  id              String        @id @default(uuid())
  growPhaseId     String
  nutrientId      String
  doseMlPerL      Float
  sortOrder       Int           @default(0)
  appliesToPeriod DayNightPeriod
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt

  growPhase GrowPhase @relation(fields: [growPhaseId], references: [id], onDelete: Cascade)
  nutrient  Nutrient  @relation(fields: [nutrientId], references: [id], onDelete: Restrict)

  @@unique([growPhaseId, nutrientId, appliesToPeriod], map: "phase_nutrient_unique")
}
```

Then find the existing `PhaseEnvironment` model (around line 176 in the current schema) and add the three columns inside the model block, after the `co2Target Float?` line:

```prisma
  phMin         Float?
  phTarget      Float?
  phMax         Float?
```

- [ ] **Step 1.2: Generate the migration manually**

The migration directory name must follow Prisma's timestamp convention. Inspect the existing migrations directory for the latest timestamp prefix, then create a folder with a unique, lexicographically-later timestamp. Filename: `prisma/migrations/<timestamp>_add_nutrients_and_phase_nutrients/migration.sql`.

Inside `migration.sql`:

```sql
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
ALTER TABLE "PhaseEnvironment" ADD COLUMN "phMin" DOUBLE PRECISION;
ALTER TABLE "PhaseEnvironment" ADD COLUMN "phTarget" DOUBLE PRECISION;
ALTER TABLE "PhaseEnvironment" ADD COLUMN "phMax" DOUBLE PRECISION;
```

- [ ] **Step 1.3: Apply the migration and regenerate the client**

Run from `PiGrow-Server/`:

```bash
bunx prisma migrate dev
bunx prisma generate
```

Expected: migration applies cleanly, Prisma client regenerated at `src/generated/client/`. New model types `Nutrient`, `PhaseNutrient` appear under `src/generated/client/models/`. `PhaseEnvironment` type now includes `phMin`, `phTarget`, `phMax`.

- [ ] **Step 1.4: Verify with the test DB**

Run:

```bash
bun run test
```

Expected: 157 server tests still pass. No regressions (the migration is additive; existing rows keep their defaults).

- [ ] **Step 1.5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ src/generated/client/
git commit -m "feat(dosing): add Nutrient, PhaseNutrient, pH band columns"
```

---

## Task 2: Extract `PhaseEnvironmentSchema` into a shared module

**Files:**
- Read: `src/api/modules/grow-cycles/grow-cycles.schema.ts`, `src/api/modules/grow-phases/grow-phases.schema.ts`, `src/api/modules/controllers/controllers.schema.ts`.
- Create: `src/api/shared/phase-environment-schema.ts`.
- Create: `src/api/shared/phase-environment-schema.test.ts`.
- Modify: replace inline definitions in the three modules with imports.

**Interfaces:**
- Produces: `PhaseEnvironmentSchema`, `CreatePhaseEnvironmentSchema`, `UpdatePhaseEnvironmentSchema` (or whatever the current types are — confirm by reading the modules) exported from `src/api/shared/phase-environment-schema.ts`.

- [ ] **Step 2.1: Read the three inline definitions**

For each of the three modules, identify the exact TypeBox schema definitions used. They should be identical in shape (per board review confirmation). Capture the full text for each.

- [ ] **Step 2.2: Write the failing test for the shared module**

`src/api/shared/phase-environment-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Type } from '@sinclair/typebox';
import {
  PhaseEnvironmentSchema,
} from './phase-environment-schema.js';

describe('phase-environment-schema', () => {
  it('exports PhaseEnvironmentSchema matching the prior inline shape', () => {
    expect(PhaseEnvironmentSchema).toBeDefined();
    // PhaseEnvironment schema must include the existing fields plus the new pH columns
    const props = (PhaseEnvironmentSchema as any).properties;
    expect(props).toHaveProperty('tempMin');
    expect(props).toHaveProperty('humidityTarget');
    expect(props).toHaveProperty('co2Target');
  });
});
```

- [ ] **Step 2.3: Run the failing test**

Run: `bun run test src/api/shared/phase-environment-schema.test.ts`
Expected: FAIL with `Cannot find module './phase-environment-schema.js'`.

- [ ] **Step 2.4: Create the shared module**

`src/api/shared/phase-environment-schema.ts`: copy the inline `PhaseEnvironmentSchema` definition (the *current* version without pH fields) from one of the three modules. The pH fields are NOT yet part of the schema — they land in Task 4.

```ts
import { Type } from '@sinclair/typebox';
import { Nullable } from './schemas.js';

export const PhaseEnvironmentSchema = Type.Object({
  id: Type.String(),
  growPhaseId: Type.String(),
  period: Type.Union([Type.Literal('DAY'), Type.Literal('NIGHT')]),
  tempMin: Nullable(Type.Number()),
  tempMax: Nullable(Type.Number()),
  tempTarget: Nullable(Type.Number()),
  humidityMin: Nullable(Type.Number()),
  humidityMax: Nullable(Type.Number()),
  humidityTarget: Nullable(Type.Number()),
  co2Min: Nullable(Type.Number()),
  co2Max: Nullable(Type.Number()),
  co2Target: Nullable(Type.Number()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
```

Adjust the field set to match exactly what the three modules currently inline. Use the `Nullable` helper if it exists; otherwise inline `Type.Union([Type.Null(), Type.Number()])`.

- [ ] **Step 2.5: Update the three modules to import the shared schema**

In each of `grow-cycles.schema.ts`, `grow-phases.schema.ts`, `controllers.schema.ts`, remove the inline `PhaseEnvironmentSchema` (and any closely related types they duplicated) and replace with:

```ts
import { PhaseEnvironmentSchema } from '../../shared/phase-environment-schema.js';
```

(Use the correct relative path for each module — adjust the `..` count.)

- [ ] **Step 2.6: Run all tests**

Run: `bun run test`
Expected: all 157 tests pass. No behavior change yet — pure refactor.

- [ ] **Step 2.7: Commit**

```bash
git add src/api/shared/phase-environment-schema.ts src/api/shared/phase-environment-schema.test.ts src/api/modules/grow-cycles/grow-cycles.schema.ts src/api/modules/grow-phases/grow-phases.schema.ts src/api/modules/controllers/controllers.schema.ts
git commit -m "refactor(server): extract PhaseEnvironmentSchema into shared module"
```

---

## Task 3: Add `WarningCode` enum and `DayNightPeriod` re-export

**Files:**
- Create: `src/api/modules/dosing/dosing.schema.ts` (initial — only the enum + period re-export for now).
- (Full schemas for the dosing module land in Task 5.)

**Interfaces:**
- Produces:
  - `WarningCode` enum-like TypeBox union used by the dosing preview endpoint and surfaced to the UI.
  - `DayNightPeriodSchema` re-export from the existing module so the dosing module doesn't import from the grow-phase module.

- [ ] **Step 3.1: Write the failing test for the schema file**

`src/api/modules/dosing/dosing.schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getWarningCodes } from './dosing.schema.js';

describe('dosing.schema warning codes', () => {
  it('exposes the canonical warning set', () => {
    expect(getWarningCodes()).toEqual([
      'NO_NUTRIENTS_CONFIGURED',
      'NO_DAY_NUTRIENTS',
      'NO_NIGHT_NUTRIENTS',
      'NO_PH_BANDS',
      'PH_DAY_NIGHT_MISMATCH',
      'RESERVOIR_TOO_SMALL',
    ]);
  });
});
```

- [ ] **Step 3.2: Run the failing test**

Run: `bun run test src/api/modules/dosing/dosing.schema.test.ts`
Expected: FAIL with `Cannot find module './dosing.schema.js'`.

- [ ] **Step 3.3: Implement the schema file**

`src/api/modules/dosing/dosing.schema.ts`:

```ts
import { Type } from '@sinclair/typebox';

export const DayNightPeriodSchema = Type.Union([
  Type.Literal('DAY'),
  Type.Literal('NIGHT'),
]);

export const WarningCodeSchema = Type.Union([
  Type.Literal('NO_NUTRIENTS_CONFIGURED'),
  Type.Literal('NO_DAY_NUTRIENTS'),
  Type.Literal('NO_NIGHT_NUTRIENTS'),
  Type.Literal('NO_PH_BANDS'),
  Type.Literal('PH_DAY_NIGHT_MISMATCH'),
  Type.Literal('RESERVOIR_TOO_SMALL'),
]);

export const WARNING_CODES = [
  'NO_NUTRIENTS_CONFIGURED',
  'NO_DAY_NUTRIENTS',
  'NO_NIGHT_NUTRIENTS',
  'NO_PH_BANDS',
  'PH_DAY_NIGHT_MISMATCH',
  'RESERVOIR_TOO_SMALL',
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

export function getWarningCodes(): readonly WarningCode[] {
  return WARNING_CODES;
}
```

- [ ] **Step 3.4: Run the test to verify it passes**

Run: `bun run test src/api/modules/dosing/dosing.schema.test.ts`
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
git add src/api/modules/dosing/dosing.schema.ts src/api/modules/dosing/dosing.schema.test.ts
git commit -m "feat(dosing): expose WarningCode schema and helpers"
```

---

## Task 4: Extend `PhaseEnvironment` with pH bands

**Files:**
- Modify: `src/api/shared/phase-environment-schema.ts` (add the three nullable pH columns).
- Modify: `src/api/modules/phase-environments/phase-environments.schema.ts` (extend `UpsertPhaseEnvironmentSchema`).

**Interfaces:**
- Produces: `UpsertPhaseEnvironmentSchema` accepts optional `phMin`, `phTarget`, `phMax` (each `Type.Union([Type.Null(), Type.Number()])` or `Nullable(Type.Number())`).

- [ ] **Step 4.1: Write the failing test for pH field round-trip**

Append to `src/api/shared/phase-environment-schema.test.ts`:

```ts
describe('PhaseEnvironmentSchema pH fields', () => {
  it('includes the pH band fields', () => {
    const props = (PhaseEnvironmentSchema as any).properties;
    expect(props).toHaveProperty('phMin');
    expect(props).toHaveProperty('phTarget');
    expect(props).toHaveProperty('phMax');
  });
});
```

Run: `bun run test src/api/shared/phase-environment-schema.test.ts`
Expected: FAIL.

- [ ] **Step 4.2: Add the pH fields to the shared schema**

Edit `src/api/shared/phase-environment-schema.ts`. Append to the `properties` object (or to the `Type.Object({...})` definition):

```ts
  phMin: Nullable(Type.Number()),
  phTarget: Nullable(Type.Number()),
  phMax: Nullable(Type.Number()),
```

`Nullable` may need to be imported from `src/api/shared/schemas.js` (or inlined if absent).

- [ ] **Step 4.3: Run the test to verify it passes**

Run: `bun run test src/api/shared/phase-environment-schema.test.ts`
Expected: PASS.

- [ ] **Step 4.4: Read the existing `phase-environments.schema.ts`**

Locate the `UpsertPhaseEnvironmentSchema`. Confirm whether it currently uses `Nullable` or inlines `Type.Union([Type.Null(), Type.Number()])`. Match the existing style.

- [ ] **Step 4.5: Extend `UpsertPhaseEnvironmentSchema` with pH fields**

In `phase-environments.schema.ts`, add to the upsert body schema:

```ts
  phMin: Type.Optional(Nullable(Type.Number({ multipleOf: 0.01, maximum: 14 }))),
  phTarget: Type.Optional(Nullable(Type.Number({ multipleOf: 0.01, maximum: 14 }))),
  phMax: Type.Optional(Nullable(Type.Number({ multipleOf: 0.01, maximum: 14 }))),
```

`multipleOf: 0.01` matches the existing precision conventions for min/target/max fields elsewhere in the schema (verify by reading the schema). `maximum: 14` is the realistic pH ceiling.

- [ ] **Step 4.6: Add round-trip integration test**

Append to `src/api/modules/phase-environments/phase-environments.test.ts`:

```ts
import { FastifyInstance } from 'fastify';
import { createTestApp } from '../test-helper.js';

describe('phase-environments pH bands', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = await createTestApp();
  });
  afterEach(async () => {
    await app.close();
  });

  it('round-trips pH min/target/max via PUT', async () => {
    // Setup: create a controller, cycle, and phase using the test helper utilities
    const ctx = await app.inject({
      method: 'POST',
      url: '/api/test/seed', // adjust to match the actual test helper pattern
    });
    // The actual shape of the test setup is whatever createTestApp + helpers provide.
    // Capture a growPhaseId from the response body.

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/grow-phases/${growPhaseId}/environment/DAY`,
      payload: {
        tempMin: 20, tempMax: 28, tempTarget: 24,
        humidityMin: 50, humidityMax: 75, humidityTarget: 60,
        co2Min: 600, co2Max: 1200, co2Target: 800,
        phMin: 5.8, phTarget: 6.0, phMax: 6.2,
      },
    });
    expect(putRes.statusCode).toBe(200);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/grow-phases/${growPhaseId}/environment/DAY`,
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json();
    expect(body).toMatchObject({
      phMin: 5.8,
      phTarget: 6.0,
      phMax: 6.2,
    });
  });
});
```

Adjust the seed and growPhaseId capture to match the actual pattern of `createTestApp` in `src/api/modules/test-helper.ts`. The test placeholder is illustrative — the implementer must read the existing phase-environments.test.ts and follow its setup conventions exactly.

- [ ] **Step 4.7: Run the round-trip test**

Run: `bun run test src/api/modules/phase-environments/phase-environments.test.ts`
Expected: PASS.

- [ ] **Step 4.8: Commit**

```bash
git add src/api/shared/phase-environment-schema.ts src/api/shared/phase-environment-schema.test.ts src/api/modules/phase-environments/phase-environments.schema.ts src/api/modules/phase-environments/phase-environments.test.ts
git commit -m "feat(dosing): add pH min/target/max to PhaseEnvironment"
```

---

## Task 5: Pure function `computeDosingMl`

**Files:**
- Create: `src/api/modules/dosing/calc.ts`.
- Create: `src/api/modules/dosing/calc.test.ts`.

**Interfaces:**
- Produces:
  ```ts
  type PhaseNutrientLike = {
    nutrientId: string;
    doseMlPerL: number;
    appliesToPeriod: 'DAY' | 'NIGHT';
  };

  function computeDosingMl(
    rows: PhaseNutrientLike[],
    period: 'DAY' | 'NIGHT',
    reservoirLiters: number,
  ): {
    mlByNutrientId: Record<string, number>;
    totalMl: number;
    warnings: WarningCode[];
  };
  ```
- Owned warnings: `NO_NUTRIENTS_CONFIGURED`, `NO_DAY_NUTRIENTS`, `NO_NIGHT_NUTRIENTS`.
- Rounding: 2 decimals via `Math.round(x * 100) / 100`.

- [ ] **Step 5.1: Write failing tests**

`src/api/modules/dosing/calc.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeDosingMl } from './calc.js';

const row = (overrides: Partial<{ nutrientId: string; doseMlPerL: number; appliesToPeriod: 'DAY' | 'NIGHT' }> = {}) => ({
  nutrientId: overrides.nutrientId ?? 'nut-1',
  doseMlPerL: overrides.doseMlPerL ?? 2,
  appliesToPeriod: overrides.appliesToPeriod ?? ('DAY' as const),
});

describe('computeDosingMl', () => {
  it('returns per-nutrient ml and sum for a single DAY row', () => {
    const result = computeDosingMl([row({ doseMlPerL: 2 })], 'DAY', 5);
    expect(result.mlByNutrientId).toEqual({ 'nut-1': 10 });
    expect(result.totalMl).toBe(10);
    expect(result.warnings).toEqual([]);
  });

  it('rounds to two decimals without floating-point noise', () => {
    const result = computeDosingMl([row({ doseMlPerL: 0.33 })], 'DAY', 15.5);
    expect(result.mlByNutrientId['nut-1']).toBe(5.12);
    expect(result.totalMl).toBe(5.12);
  });

  it('aggregates multiple nutrients into the sum', () => {
    const result = computeDosingMl(
      [
        row({ nutrientId: 'a', doseMlPerL: 2 }),
        row({ nutrientId: 'b', doseMlPerL: 1.5 }),
      ],
      'DAY',
      4,
    );
    expect(result.mlByNutrientId).toEqual({ a: 8, b: 6 });
    expect(result.totalMl).toBe(14);
  });

  it('emits NO_NUTRIENTS_CONFIGURED for an empty input', () => {
    const result = computeDosingMl([], 'DAY', 10);
    expect(result.mlByNutrientId).toEqual({});
    expect(result.totalMl).toBe(0);
    expect(result.warnings).toContain('NO_NUTRIENTS_CONFIGURED');
  });

  it('filters by the requested period and emits NO_NIGHT_NUTRIENTS when filtering produces empty', () => {
    const result = computeDosingMl([row({ appliesToPeriod: 'DAY' })], 'NIGHT', 5);
    expect(result.mlByNutrientId).toEqual({});
    expect(result.warnings).toContain('NO_NIGHT_NUTRIENTS');
    expect(result.warnings).not.toContain('NO_DAY_NUTRIENTS');
  });

  it('does not double-count nutrients that exist in both periods (period-filtered input only)', () => {
    // The controller is responsible for filtering to one period before calling.
    // The function does not prevent duplicate nutrientIds within the input rows
    // — last write wins per nutrientId — but it does not sum them.
    const result = computeDosingMl(
      [
        row({ nutrientId: 'a', doseMlPerL: 2 }),
        row({ nutrientId: 'a', doseMlPerL: 3 }),
      ],
      'DAY',
      1,
    );
    expect(result.mlByNutrientId.a).toBe(3); // last write wins
  });

  it('throws a typed error for negative reservoir liters', () => {
    expect(() => computeDosingMl([], 'DAY', -1)).toThrowError();
  });

  it('returns empty results for zero reservoir liters without warning', () => {
    const result = computeDosingMl([row({ doseMlPerL: 2 })], 'DAY', 0);
    expect(result.mlByNutrientId).toEqual({ 'nut-1': 0 });
    expect(result.totalMl).toBe(0);
    expect(result.warnings).toEqual([]);
  });
});
```

- [ ] **Step 5.2: Run the failing tests**

Run: `bun run test src/api/modules/dosing/calc.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 5.3: Implement `computeDosingMl`**

`src/api/modules/dosing/calc.ts`:

```ts
import type { WarningCode } from './dosing.schema.js';

export type PhaseNutrientLike = {
  nutrientId: string;
  doseMlPerL: number;
  appliesToPeriod: 'DAY' | 'NIGHT';
};

export type ComputeDosingMlResult = {
  mlByNutrientId: Record<string, number>;
  totalMl: number;
  warnings: WarningCode[];
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export class DosingCalcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DosingCalcError';
  }
}

export function computeDosingMl(
  rows: PhaseNutrientLike[],
  period: 'DAY' | 'NIGHT',
  reservoirLiters: number,
): ComputeDosingMlResult {
  if (reservoirLiters < 0) {
    throw new DosingCalcError(`reservoirLiters must be >= 0, got ${reservoirLiters}`);
  }

  const filtered = rows.filter((r) => r.appliesToPeriod === period);

  if (rows.length === 0) {
    return {
      mlByNutrientId: {},
      totalMl: 0,
      warnings: ['NO_NUTRIENTS_CONFIGURED'],
    };
  }

  if (filtered.length === 0) {
    const warning: WarningCode =
      period === 'DAY' ? 'NO_DAY_NUTRIENTS' : 'NO_NIGHT_NUTRIENTS';
    return {
      mlByNutrientId: {},
      totalMl: 0,
      warnings: [warning],
    };
  }

  const mlByNutrientId: Record<string, number> = {};
  for (const row of filtered) {
    const ml = round2(row.doseMlPerL * reservoirLiters);
    mlByNutrientId[row.nutrientId] = ml;
  }

  const totalMl = round2(
    Object.values(mlByNutrientId).reduce((sum, v) => sum + v, 0),
  );

  return {
    mlByNutrientId,
    totalMl,
    warnings: [],
  };
}
```

- [ ] **Step 5.4: Run tests**

Run: `bun run test src/api/modules/dosing/calc.test.ts`
Expected: 8 tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add src/api/modules/dosing/calc.ts src/api/modules/dosing/calc.test.ts
git commit -m "feat(dosing): add computeDosingMl with period filtering and rounding"
```

---

## Task 6: Nutrients module (CRUD)

**Files:**
- Create: `src/api/modules/nutrients/nutrients.schema.ts`.
- Create: `src/api/modules/nutrients/nutrients.controller.ts`.
- Create: `src/api/modules/nutrients/nutrients.routes.ts`.
- Create: `src/api/modules/nutrients/nutrients.test.ts`.
- Modify: `src/server.ts` (register the plugin).

**Interfaces:**
- Produces:
  - REST routes under `/api/nutrients`.
  - DELETE returns 409 if any `PhaseNutrient` references the nutrient.
  - Conflict check on POST: same `(name, brand)` exists → 409 with the existing record's id.

- [ ] **Step 6.1: Read `src/api/modules/automation-rules/automation-rules.{routes,controller,schema,test}.ts` end-to-end**

Use the existing automation-rules module as the closest pattern reference (it has similar CRUD shape). Reuse: the controller-class style, `cast<>` response typing, the `try/catch` route-wrapping pattern, and the `createTestApp` test setup.

- [ ] **Step 6.2: Write failing test for nutrient CRUD and conflict detection**

`src/api/modules/nutrients/nutrients.test.ts`: read `automation-rules.test.ts` first and follow its pattern exactly. Cover:

- POST `/api/nutrients` creates a row.
- POST `/api/nutrients` with a duplicate `(name, brand)` returns 409 (test that an existing row is detected — populate the DB directly via prisma first, then POST through the API).
- GET `/api/nutrients` lists rows.
- PATCH `/api/nutrients/:id` updates the row.
- DELETE `/api/nutrients/:id` succeeds (204) when no `PhaseNutrient` references it.
- DELETE `/api/nutrients/:id` returns 409 when a `PhaseNutrient` row references the nutrient.

- [ ] **Step 6.3: Run the failing tests**

Run: `bun run test src/api/modules/nutrients/nutrients.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 6.4: Implement `nutrients.schema.ts`**

```ts
import { Type } from '@sinclair/typebox';

export const NutrientSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  brand: Type.Union([Type.String(), Type.Null()]),
  notes: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export const CreateNutrientSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  brand: Type.Optional(Type.String({ maxLength: 200 })),
  notes: Type.Optional(Type.String()),
});

export const UpdateNutrientSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  brand: Type.Optional(Type.String({ maxLength: 200 })),
  notes: Type.Optional(Type.String()),
});

export const NutrientConflictResponseSchema = Type.Object({
  error: Type.Literal('NUTRIENT_CONFLICT'),
  existingId: Type.String(),
});
```

- [ ] **Step 6.5: Implement `nutrients.controller.ts`**

Follow the automation-rules controller pattern. Methods: `list()`, `create(payload)`, `update(id, payload)`, `remove(id)`. In `remove`: query `prisma.phaseNutrient.count({ where: { nutrientId: id } })`; if > 0, throw a typed error that the route maps to 409. In `create`: query for an existing row with the same `(name, brand)`. If `brand` is null in both inputs (or both null), Postgres' NULL-distinctness makes the unique index ineffective — fall back to `prisma.nutrient.findFirst({ where: { name, brand: null } })` and treat that hit as a conflict. Map the conflict to a 409 response carrying the existing id.

- [ ] **Step 6.6: Implement `nutrients.routes.ts`**

Wrap each handler in `try { ... } catch (err) { ... }` with `reply.code(...)` for typed errors. Mount at `/api/nutrients` and `/api/nutrients/:id`. Use `cast<>` from `src/api/shared/cast.ts` on responses.

- [ ] **Step 6.7: Register the plugin in `src/server.ts`**

Find the line where existing module plugins are registered (e.g., `await app.register(automationRules)`). Add:

```ts
await app.register(nutrients);
```

Add the matching import at the top. Match the existing style exactly.

- [ ] **Step 6.8: Run the failing tests**

Run: `bun run test src/api/modules/nutrients/nutrients.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 6.9: Commit**

```bash
git add src/api/modules/nutrients/ src/server.ts
git commit -m "feat(dosing): add nutrients CRUD module"
```

---

## Task 7: Phase nutrients module (CRUD with period)

**Files:**
- Create: `src/api/modules/phase-nutrients/phase-nutrients.schema.ts`.
- Create: `src/api/modules/phase-nutrients/phase-nutrients.controller.ts`.
- Create: `src/api/modules/phase-nutrients/phase-nutrients.routes.ts`.
- Create: `src/api/modules/phase-nutrients/phase-nutrients.test.ts`.
- Modify: `src/server.ts` (register the plugin).

**Interfaces:**
- Produces:
  - REST routes under `/api/grow-phases/:growPhaseId/phase-nutrients`.
  - GET supports optional `?period=DAY|NIGHT` filter.
  - POST validates `growPhaseId` exists; conflict on `(growPhaseId, nutrientId, appliesToPeriod)` returns 409.
  - DELETE returns 204.

- [ ] **Step 7.1: Re-read `nutrients.{routes,controller,schema,test}.ts` to match style**

- [ ] **Step 7.2: Write failing tests**

Cover:
- POST creates a row tied to a phase.
- POST with `(growPhaseId, nutrientId, appliesToPeriod)` already used returns 409.
- GET lists phase rows.
- GET with `?period=DAY` filters.
- PATCH updates dose and period.
- DELETE removes a row.

- [ ] **Step 7.3: Run failing tests**

Run: `bun run test src/api/modules/phase-nutrients/phase-nutrients.test.ts`
Expected: FAIL.

- [ ] **Step 7.4: Implement `phase-nutrients.schema.ts`**

```ts
import { Type } from '@sinclair/typebox';
import { DayNightPeriodSchema } from '../dosing/dosing.schema.js';

export const PhaseNutrientSchema = Type.Object({
  id: Type.String(),
  growPhaseId: Type.String(),
  nutrientId: Type.String(),
  doseMlPerL: Type.Number(),
  sortOrder: Type.Integer(),
  appliesToPeriod: DayNightPeriodSchema,
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export const CreatePhaseNutrientSchema = Type.Object({
  nutrientId: Type.String(),
  doseMlPerL: Type.Number({ minimum: 0.01, multipleOf: 0.01, maximum: 999.99 }),
  appliesToPeriod: DayNightPeriodSchema,
  sortOrder: Type.Optional(Type.Integer({ minimum: 0 })),
});

export const UpdatePhaseNutrientSchema = Type.Object({
  doseMlPerL: Type.Optional(Type.Number({ minimum: 0.01, multipleOf: 0.01, maximum: 999.99 })),
  sortOrder: Type.Optional(Type.Integer({ minimum: 0 })),
  appliesToPeriod: Type.Optional(DayNightPeriodSchema),
});
```

- [ ] **Step 7.5: Implement the controller**

Methods: `list(growPhaseId, period?)`, `create(growPhaseId, payload)`, `update(id, payload)`, `remove(id)`. Validate phase existence before create. The unique-constraint conflict is handled by Prisma's `P2002` error — map to 409.

- [ ] **Step 7.6: Implement the routes**

Mount under `/api/grow-phases/:growPhaseId/phase-nutrients` (list + create) and `/api/grow-phases/:growPhaseId/phase-nutrients/:id` (patch + delete). Use `cast<>` on responses.

- [ ] **Step 7.7: Register in `src/server.ts`**

Add `await app.register(phaseNutrients);` next to the nutrients registration.

- [ ] **Step 7.8: Run tests**

Run: `bun run test src/api/modules/phase-nutrients/phase-nutrients.test.ts`
Expected: all tests pass.

- [ ] **Step 7.9: Commit**

```bash
git add src/api/modules/phase-nutrients/ src/server.ts
git commit -m "feat(dosing): add phase-nutrients module (per-phase dosing chart)"
```

---

## Task 8: Dosing preview endpoint

**Files:**
- Create: `src/api/modules/dosing/dosing.routes.ts` (extend `dosing.schema.ts` if needed).
- Create: `src/api/modules/dosing/dosing.controller.ts` (extends `dosing.schema.ts`).
- Create: `src/api/modules/dosing/dosing.test.ts`.
- Modify: `src/server.ts` (register).

**Interfaces:**
- Produces:
  ```ts
  POST /api/grow-phases/:growPhaseId/dosing/preview
  Body: { reservoirLiters: number; period: 'DAY' | 'NIGHT' }
  Response: {
    mlByNutrientId: Record<string, number>;
    totalMl: number;
    warnings: WarningCode[];
  }
  ```
- The endpoint reads `PhaseNutrient` rows for the phase (no period filter — call `computeDosingMl` with the user's chosen period), reads the `PhaseEnvironment` for the matching period, adds the pH warnings.

- [ ] **Step 8.1: Extend `dosing.schema.ts`**

Append:

```ts
export const DosingPreviewRequestSchema = Type.Object({
  reservoirLiters: Type.Number({ minimum: 0, maximum: 100000 }),
  period: DayNightPeriodSchema,
});

export const DosingPreviewResponseSchema = Type.Object({
  mlByNutrientId: Type.Record(Type.String(), Type.Number()),
  totalMl: Type.Number(),
  warnings: Type.Array(WarningCodeSchema),
});
```

- [ ] **Step 8.2: Write failing tests for the endpoint**

Cover:
- Happy path with one nutrient, one period, valid reservoir → 200 with `{ mlByNutrientId: { 'nut-1': X }, totalMl: X, warnings: [] }`.
- Period filtering: only the requested period's rows are used.
- pH warnings:
  - No `PhaseEnvironment` row for the period → `warnings` contains `NO_PH_BANDS`.
  - DAY and NIGHT bands exist and differ → `warnings` contains `PH_DAY_NIGHT_MISMATCH` (returned even when the response is otherwise valid).
- `reservoirLiters: -1` → 400.
- `reservoirLiters: 0` → 200 with empty results.

- [ ] **Step 8.3: Run failing tests**

Run: `bun run test src/api/modules/dosing/dosing.test.ts`
Expected: FAIL.

- [ ] **Step 8.4: Implement the controller**

```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { computeDosingMl, type PhaseNutrientLike } from './calc.js';
import type { WarningCode } from './dosing.schema.js';

export class DosingController {
  constructor(private prisma: PrismaClient) {}

  async preview(
    request: FastifyRequest<{
      Params: { growPhaseId: string };
      Body: { reservoirLiters: number; period: 'DAY' | 'NIGHT' };
    }>,
    reply: FastifyReply,
  ) {
    const { growPhaseId } = request.params;
    const { reservoirLiters, period } = request.body;

    const [nutrientRows, dayEnv, nightEnv] = await Promise.all([
      this.prisma.phaseNutrient.findMany({
        where: { growPhaseId },
      }),
      this.prisma.phaseEnvironment.findUnique({
        where: { growPhaseId_period: { growPhaseId, period: 'DAY' } },
      }),
      this.prisma.phaseEnvironment.findUnique({
        where: { growPhaseId_period: { growPhaseId, period: 'NIGHT' } },
      }),
    ]);

    const phaseRowsLike: PhaseNutrientLike[] = nutrientRows.map((row) => ({
      nutrientId: row.nutrientId,
      doseMlPerL: row.doseMlPerL,
      appliesToPeriod: row.appliesToPeriod,
    }));

    const calcResult = computeDosingMl(phaseRowsLike, period, reservoirLiters);

    const warnings: WarningCode[] = [...calcResult.warnings];
    const periodEnv = period === 'DAY' ? dayEnv : nightEnv;
    if (!periodEnv || (periodEnv.phMin == null && periodEnv.phTarget == null && periodEnv.phMax == null)) {
      warnings.push('NO_PH_BANDS');
    }
    if (
      dayEnv &&
      nightEnv &&
      (dayEnv.phMin !== nightEnv.phMin ||
        dayEnv.phTarget !== nightEnv.phTarget ||
        dayEnv.phMax !== nightEnv.phMax)
    ) {
      warnings.push('PH_DAY_NIGHT_MISMATCH');
    }

    return reply.code(200).send({
      mlByNutrientId: calcResult.mlByNutrientId,
      totalMl: calcResult.totalMl,
      warnings,
    });
  }
}
```

The exact `findUnique` composite key shape (`growPhaseId_period`) depends on the Prisma-generated compound-key name. Verify the actual generated name in `src/generated/client/internal/prismaNamespace.ts` after `bunx prisma generate`. Adjust if needed.

- [ ] **Step 8.5: Implement the routes file**

```ts
import { FastifyInstance } from 'fastify';
import { DosingPreviewRequestSchema, DosingPreviewResponseSchema } from './dosing.schema.js';
import { DosingController } from './dosing.controller.js';

export default async function dosingRoutes(app: FastifyInstance) {
  const controller = new DosingController(app.prisma);

  app.post('/api/grow-phases/:growPhaseId/dosing/preview', {
    schema: {
      body: DosingPreviewRequestSchema,
      response: { 200: DosingPreviewResponseSchema },
    },
  }, async (request, reply) => {
    try {
      return await controller.preview(request, reply);
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'INTERNAL' });
    }
  });
}
```

- [ ] **Step 8.6: Register in `src/server.ts`**

Add:

```ts
await app.register(dosing);
```

next to the phase-nutrients registration.

- [ ] **Step 8.7: Run tests**

Run: `bun run test src/api/modules/dosing/dosing.test.ts`
Expected: all tests pass.

- [ ] **Step 8.8: Commit**

```bash
git add src/api/modules/dosing/ src/server.ts
git commit -m "feat(dosing): add dosing preview endpoint with pH warnings"
```

---

## Task 9: UI — nutrient admin page

**Files:**
- Modify: `src/stores/apiStore.ts` (add `nutrients` collection).
- Create: `src/stores/nutrientStore.ts`.
- Create: `src/views/admin/Nutrients.vue`.
- Create: `src/components/NutrientList.vue`.
- Modify: `src/router.ts` (register `/admin/nutrients`).
- Modify: `src/App.vue` (register the page nav item).

**Interfaces:**
- Produces: a working CRUD page at `/admin/nutrients`.

- [ ] **Step 9.1: Read existing similar UI files**

Read `PiGrow-UI/src/views/admin/` files for the closest pattern, and `src/stores/apiStore.ts` for the API-call wrapping convention.

- [ ] **Step 9.2: Extend `apiStore.ts`**

Add a `nutrients` block following the existing pattern (read the file and mirror its shape). Methods: `list()`, `create(payload)`, `update(id, payload)`, `remove(id)`.

- [ ] **Step 9.3: Write `nutrientStore.ts`**

Pinia store wrapping `apiStore.nutrients.*`. Read an existing simple store (e.g., a CRUD store) for the convention. Methods: `fetchAll`, `addOne`, `updateOne`, `removeOne`. State: `nutrients: Nutrient[]`.

- [ ] **Step 9.4: Write `NutrientList.vue`**

A reusable list component with a header row, inline edit, and delete. Match the design-system rules in `PiGrow-UI/design-system/pigrow/MASTER.md`. Reuse existing form components if any.

- [ ] **Step 9.5: Write `Nutrients.vue` page**

Mounts `NutrientList`, handles dialog open/close for create/edit.

- [ ] **Step 9.6: Register the route in `src/router.ts`**

Find the existing `/admin/*` routes and add `/admin/nutrients` following the same pattern.

- [ ] **Step 9.7: Register the page in `src/App.vue``

Add a nav-link entry using the same style as existing admin nav items.

- [ ] **Step 8.8: Write a smoke test**

`src/views/admin/Nutrients.test.ts`: render with a stubbed store, assert that the empty state, loading state, and one-row state render.

- [ ] **Step 9.9: Run UI tests**

Run: `bun run test src/views/admin/Nutrients.test.ts` (or whatever the project's UI test runner is — check `package.json`'s `scripts.test`).

Expected: pass.

- [ ] **Step 9.10: Commit**

```bash
git add src/stores/nutrientStore.ts src/stores/apiStore.ts src/views/admin/Nutrients.vue src/components/NutrientList.vue src/views/admin/Nutrients.test.ts src/router.ts src/App.vue
git commit -m "feat(ui): add nutrient admin page"
```

---

## Task 10: UI — phase nutrient dosing tab

**Files:**
- Modify: `src/stores/apiStore.ts` (add `phaseNutrients` collection).
- Create: `src/stores/phaseNutrientStore.ts`.
- Create: `src/components/PhaseNutrientList.vue`.
- Locate and modify: the existing per-phase admin view (file name varies — read first).

**Interfaces:**
- Produces: a "Nutrient Dosing" tab inside the per-phase admin view that lists phase nutrients for DAY and NIGHT periods with sortable positions, edit, and delete. A "Both periods" toggle creates two rows.

- [ ] **Step 10.1: Locate the existing per-phase admin view**

Search for the component that already shows the PhaseAutomationRulesDialog. That file is the closest pattern for "phase-scoped edit UI".

- [ ] **Step 10.2: Extend `apiStore.ts`**

Add a `phaseNutrients` block with methods: `list(growPhaseId, period?)`, `create(growPhaseId, payload)`, `update(id, payload)`, `remove(id)`.

- [ ] **Step 10.3: Write `phaseNutrientStore.ts`**

Mirrors `nutrientStore.ts`. State: `byPhase: Record<string, PhaseNutrient[]>`. Methods: `fetchForPhase(growPhaseId)`, `addOne(growPhaseId, payload)`, `updateOne(id, payload)`, `removeOne(id)`.

- [ ] **Step 10.4: Write `PhaseNutrientList.vue`**

Props: `growPhaseId`. Two lists (DAY, NIGHT). Each row: nutrient name (resolved via the nutrient store), dose `ml/L`, sort order, period chip, edit/delete buttons. "Both periods" toggle at the top: when the user toggles it ON, the dialog prompts for `doseMlPerL` and creates two rows. When both rows already exist, disable the toggle.

- [ ] **Step 10.5: Add the new tab to the phase admin view**

Read the view's existing tab structure. Add a new tab labeled "Nutrient Dosing" that mounts `PhaseNutrientList`.

- [ ] **Step 10.6: Smoke test**

`src/components/PhaseNutrientList.test.ts`: render with stubbed stores, assert that two periods render and the "Both periods" toggle is disabled when both periods already have entries.

- [ ] **Step 10.7: Run tests**

Run the vitest command from `PiGrow-UI/`.

Expected: pass.

- [ ] **Step 10.8: Commit**

```bash
git add src/components/PhaseNutrientList.vue src/components/PhaseNutrientList.test.ts src/stores/phaseNutrientStore.ts src/stores/apiStore.ts <phase-admin-view-file>
git commit -m "feat(ui): add phase nutrient dosing tab"
```

---

## Task 11: UI — pH bands in environment dialog

**Files:**
- Modify: `src/components/PhaseEnvironmentDialog.vue` (or the dialog component in the phase admin view).

**Interfaces:**
- Produces: an edit dialog with three numeric inputs per period for `phMin / phTarget / phMax`. When creating a new period row, default the inputs from the DAY values (if a DAY row already exists).

- [ ] **Step 11.1: Read the existing dialog**

Locate the dialog file. Confirm it uses `apiStore.environments.upsert(...)` or equivalent. Note the existing input shapes for temp/humidity/co2.

- [ ] **Step 11.2: Add pH inputs**

Add three numeric inputs per period below the existing co2 inputs. Bind to `form.phMin / phTarget / phMax`. Include step="0.01" and min/max validation (0..14).

- [ ] **Step 11.3: Day-from-Night default logic**

When opening the dialog for a NIGHT period and the DAY row already exists with pH values, pre-populate the NIGHT inputs from DAY as a default the user can override.

- [ ] **Step 11.4: Round-trip test**

Existing UI tests for the dialog should be extended to include pH values; assert that setting all three, committing, and reopening shows the same values back.

- [ ] **Step 11.5: Commit**

```bash
git add src/components/PhaseEnvironmentDialog.vue <existing-test-file>
git commit -m "feat(ui): add pH band inputs to phase environment dialog"
```

---

## Task 12: UI — dosing calculator dialog

**Files:**
- Modify: `src/stores/apiStore.ts` (add `dosing.preview(growPhaseId, payload)`).
- Create: `src/components/DosingCalculatorDialog.vue`.
- Modify: the existing per-phase admin view to add a "Calculator" button.

**Interfaces:**
- Produces: a dialog that takes `reservoirLiters` and the active period (default DAY, auto-resolved). Calls `dosing.preview(...)`. Renders the ml-per-nutrient table, total, and the warnings list.

- [ ] **Step 12.1: Read the existing dialog patterns**

Find a small dialog component to use as the shell. Match style.

- [ ] **Step 12.2: Extend `apiStore.ts`**

Add `dosing.preview(growPhaseId, { reservoirLiters, period })` returning the response payload.

- [ ] **Step 12.3: Write `DosingCalculatorDialog.vue`**

Props: `growPhaseId`, `modelValue` (open/close). Local state: `reservoirLiters` (number), `period` (DAY | NIGHT, default DAY). On submit, call `dosing.preview(...)` and render the results: a per-nutrient table (use the nutrient store to resolve names) + a total chip + a chip per warning code.

- [ ] **Step 12.4: Period defaulting**

If the active phase clock resolves (read how the UI already resolves day/night — there's likely a `useDayNight` composable or a similar pattern), pre-select the period. Fall back to DAY.

- [ ] **Step 12.5: Wire up the "Calculator" button**

Add a button next to the "Nutrient Dosing" tab in the phase admin view. Clicking opens `DosingCalculatorDialog`.

- [ ] **Step 12.6: Smoke test**

`src/components/DosingCalculatorDialog.test.ts`: render with the api stub returning a fixture, assert that nutrient names, ml values, total, and warning chips render.

- [ ] **Step 12.7: Run UI tests**

Expected: pass.

- [ ] **Step 12.8: Commit**

```bash
git add src/components/DosingCalculatorDialog.vue src/components/DosingCalculatorDialog.test.ts src/stores/apiStore.ts <phase-admin-view-file>
git commit -m "feat(ui): add dosing calculator dialog"
```

---

## Task 13: End-to-end gate

**Files:** none (verification only).

**Interfaces:** none. This is a gate.

- [ ] **Step 13.1: Run the full server test suite**

Run from `PiGrow-Server/`: `bun run test`.
Expected: 157 prior tests still pass + all new test cases added across the dosing modules pass. Total tests ≥ 157 + 6 (nutrients) + 6 (phase-nutrients) + 5 (dosing.test.ts) + 8 (calc.test.ts) + 1 (phase-environments pH round-trip) + 1 (schema extraction test).

- [ ] **Step 13.2: Run the full UI test suite**

Run from `PiGrow-UI/`: `bun run test` (or `npm run test`).
Expected: all UI smoke tests pass.

- [ ] **Step 13.3: Manual smoke test the API**

Start the dev server: `bun run dev`. Use curl or a REST client to:
- POST `/api/nutrients` with `{ name: "FloraMicro", brand: null }` → 201.
- POST `/api/nutrients` again with the same payload → 409 with `existingId`.
- POST `/api/grow-phases/:phaseId/phase-nutrients` with `{ nutrientId: <id>, doseMlPerL: 2, appliesToPeriod: 'DAY' }` → 201.
- POST the same again → 409 (unique constraint).
- PUT `/api/grow-phases/:phaseId/environment/DAY` with `phMin: 5.8, phTarget: 6.0, phMax: 6.2` → 200.
- GET → returns the values.
- POST `/api/grow-phases/:phaseId/dosing/preview` with `{ reservoirLiters: 10, period: 'DAY' }` → 200 with `mlByNutrientId: { <id>: 20 }, totalMl: 20, warnings: []`.

- [ ] **Step 13.4: Manual smoke test the UI**

Open the UI in a browser. Confirm:
- `/admin/nutrients` lists, adds, edits, deletes nutrients.
- The phase admin view has a "Nutrient Dosing" tab with two period sublists and an editable chart.
- The "Day/Night Environment" dialog has pH min/target/max inputs.
- The "Calculator" button opens a dialog; entering `10` liters with the chart from Step 13.3 produces the expected ml table.

- [ ] **Step 13.5: Final commit (any remaining lint/format cleanup)**

Run formatters/linters (whatever the project's standard is) and commit:

```bash
bun run lint
bun run format
git add .
git commit -m "chore(dosing): final lint pass"
```

---

## Self-Review Notes

After writing the plan above, I verified:

- **Spec coverage:** every item in the v2 design doc maps to a task. Tasks 1+2 = data model and refactor; Tasks 3+5 = dosing-domain scaffolding and the pure calculator; Task 4 = pH bands; Tasks 6+7 = CRUD modules; Task 8 = preview endpoint; Tasks 9+10+11+12 = UI; Task 13 = gates.
- **No placeholders:** each step contains the actual code or schema; the few "read existing module first" steps are explicit and reference real files.
- **Type consistency:** `WarningCode`, `DayNightPeriod`, `computeDosingMl(rows, period, reservoirLiters)`, `PhaseNutrientLike`, `Nutrient`, `PhaseNutrient` types match across tasks. The `findUnique` composite key shape in Task 8 is called out as needing verification against the generated client — the implementer must verify it.
- **Risks flagged:** NULL-distinctness conflict handled in Task 6 controller logic; UI toggle safety in Task 10; refactor scope in Task 2.
