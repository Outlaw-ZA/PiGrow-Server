import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, teardownTestApp } from '../test-helper.js'

describe('Dosing preview API', () => {
  let app: any
  let prismaClient: any
  let controllerId: string
  let growCycleId: string
  let nutrientAId: string
  let nutrientBId: string

  before(async () => {
    const testApp = await createTestApp()
    app = testApp.server
    prismaClient = testApp.prisma
    await prismaClient.phaseNutrient.deleteMany()
    await prismaClient.phaseEnvironment.deleteMany()
    await prismaClient.nutrient.deleteMany({ where: { name: { startsWith: 'DosingTest-' } } })

    const controller = await prismaClient.controller.create({
      data: {
        ipAddress: '192.168.99.110',
        macAddress: `AA:CC:DD:EE:${Date.now().toString(16).slice(-5)}`,
        name: 'Dosing Test Controller',
      },
    })
    controllerId = controller.id
    growCycleId = (
      await prismaClient.growCycle.create({ data: { controllerId, name: 'Dosing Test' } })
    ).id
    nutrientAId = (await prismaClient.nutrient.create({ data: { name: 'DosingTest-A' } })).id
    nutrientBId = (await prismaClient.nutrient.create({ data: { name: 'DosingTest-B' } })).id
  })

  after(async () => {
    await prismaClient.growCycle.delete({ where: { id: growCycleId } })
    await prismaClient.controller.delete({ where: { id: controllerId } })
    await prismaClient.nutrient.deleteMany({ where: { name: { startsWith: 'DosingTest-' } } })
    await teardownTestApp(app)
  })

  async function createPhase(
    name: string,
    ph: { phMin?: number; phTarget?: number; phMax?: number } = {},
  ) {
    return await prismaClient.growPhase.create({
      data: { durationDays: 30, growCycleId, name, order: Date.now() % 100_000, ...ph },
    })
  }

  async function preview(growPhaseId: string, reservoirLiters: number) {
    return await app.inject({
      method: 'POST',
      payload: { reservoirLiters },
      url: `/api/grow-phases/${growPhaseId}/dosing/preview`,
    })
  }

  test('previews shared phase nutrients without a period', async () => {
    const phase = await createPhase('Happy', { phMax: 6.5, phMin: 5.5, phTarget: 6 })
    await prismaClient.phaseNutrient.create({
      data: { doseMlPerL: 2, growPhaseId: phase.id, nutrientId: nutrientAId },
    })
    const response = await preview(phase.id, 5)
    assert.equal(response.statusCode, 200)
    assert.deepEqual(JSON.parse(response.body), {
      mlByNutrientId: { [nutrientAId]: 10 },
      totalMl: 10,
      warnings: [],
    })
  })

  test('rejects a negative reservoir volume', async () => {
    const response = await preview((await createPhase('Negative')).id, -1)
    assert.equal(response.statusCode, 400)
  })

  test('returns zero doses for a zero-volume reservoir', async () => {
    const phase = await createPhase('Zero')
    await prismaClient.phaseNutrient.create({
      data: { doseMlPerL: 2, growPhaseId: phase.id, nutrientId: nutrientAId },
    })
    const response = await preview(phase.id, 0)
    assert.equal(response.statusCode, 200)
    assert.equal(JSON.parse(response.body).totalMl, 0)
  })

  test('warns when no nutrients are configured', async () => {
    const response = await preview((await createPhase('Empty')).id, 5)
    assert.ok(JSON.parse(response.body).warnings.includes('NO_NUTRIENTS_CONFIGURED'))
  })

  test('returns rounded totals for all shared nutrients', async () => {
    const phase = await createPhase('Multiple', { phTarget: 6 })
    await prismaClient.phaseNutrient.createMany({
      data: [
        { doseMlPerL: 1.111, growPhaseId: phase.id, nutrientId: nutrientAId },
        { doseMlPerL: 2.222, growPhaseId: phase.id, nutrientId: nutrientBId },
      ],
    })
    const body = JSON.parse((await preview(phase.id, 3)).body)
    assert.deepEqual(body.mlByNutrientId, { [nutrientAId]: 3.33, [nutrientBId]: 6.67 })
    assert.equal(body.totalMl, 10)
  })

  test('derives NO_PH_BANDS from GrowPhase', async () => {
    const phase = await createPhase('No pH')
    await prismaClient.phaseEnvironment.create({
      data: { growPhaseId: phase.id, period: 'DAY', tempTarget: 24 },
    })
    await prismaClient.phaseNutrient.create({
      data: { doseMlPerL: 2, growPhaseId: phase.id, nutrientId: nutrientAId },
    })
    const body = JSON.parse((await preview(phase.id, 5)).body)
    assert.ok(body.warnings.includes('NO_PH_BANDS'))
  })

  test('does not emit obsolete period-specific warning codes', async () => {
    const phase = await createPhase('Shared warnings', { phTarget: 6 })
    const warnings = JSON.parse((await preview(phase.id, 5)).body).warnings as string[]
    assert.ok(!warnings.includes('NO_DAY_NUTRIENTS'))
    assert.ok(!warnings.includes('NO_NIGHT_NUTRIENTS'))
    assert.ok(!warnings.includes('PH_DAY_NIGHT_MISMATCH'))
  })
})
