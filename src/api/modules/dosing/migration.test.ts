import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

const migrationSql = readFileSync(
  new URL(
    '../../../../prisma/migrations/20260722000000_phase_wide_nutrients/migration.sql',
    import.meta.url,
  ),
  'utf8',
).replaceAll(/\s+/g, ' ')

const phBackfillSql = migrationSql.slice(0, migrationSql.indexOf('DELETE FROM'))

describe('phase-wide nutrient migration', () => {
  it('copies all pH fields from one preferred environment row', async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
    await client.connect()

    try {
      await client.query(`
        CREATE TEMP TABLE "GrowPhase" ("id" TEXT PRIMARY KEY);
        CREATE TEMP TABLE "PhaseEnvironment" (
          "growPhaseId" TEXT NOT NULL,
          "period" TEXT NOT NULL,
          "phMin" DOUBLE PRECISION,
          "phTarget" DOUBLE PRECISION,
          "phMax" DOUBLE PRECISION
        );
        INSERT INTO "GrowPhase" ("id") VALUES ('day-partial'), ('empty'), ('night');
        INSERT INTO "PhaseEnvironment" ("growPhaseId", "period", "phMin", "phTarget", "phMax") VALUES
          ('day-partial', 'DAY', 5.5, NULL, NULL),
          ('day-partial', 'NIGHT', 5.8, 6.0, 6.2),
          ('empty', 'DAY', NULL, NULL, NULL),
          ('empty', 'NIGHT', NULL, NULL, NULL),
          ('night', 'DAY', NULL, NULL, NULL),
          ('night', 'NIGHT', 5.8, 6.0, 6.2);
      `)
      await client.query(phBackfillSql)

      const result = await client.query(
        `SELECT "id", "phMin", "phTarget", "phMax" FROM "GrowPhase" ORDER BY "id"`,
      )
      assert.deepEqual(result.rows, [
        { id: 'day-partial', phMax: null, phMin: 5.5, phTarget: null },
        { id: 'empty', phMax: null, phMin: null, phTarget: null },
        { id: 'night', phMax: 6.2, phMin: 5.8, phTarget: 6 },
      ])
    } finally {
      await client.end()
    }

    assert.doesNotMatch(migrationSql, /COALESCE/i)
    assert.doesNotMatch(migrationSql, /COALESCE/i)
    assert.match(migrationSql, /WITH "phase_ph_source" AS/)
    assert.match(
      migrationSql,
      /WHERE env\."phMin" IS NOT NULL OR env\."phTarget" IS NOT NULL OR env\."phMax" IS NOT NULL/,
    )
    assert.match(
      migrationSql,
      /"phMin" = source\."phMin", "phTarget" = source\."phTarget", "phMax" = source\."phMax"/,
    )
    assert.match(migrationSql, /CASE env\."period" WHEN 'DAY' THEN 0 ELSE 1 END/)
  })
})
