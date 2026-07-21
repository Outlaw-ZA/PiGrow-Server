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
    const cycle = await prismaClient.growCycle.create({
      data: { controllerId, name: 'Dosing Test' },
    })
    growCycleId = cycle.id
    nutrientAId = (await prismaClient.nutrient.create({ data: { name: 'DosingTest-A' } })).id
    nutrientBId = (await prismaClient.nutrient.create({ data: { name: 'DosingTest-B' } })).id
  })

  after(async () => {
    await prismaClient.growCycle.delete({ where: { id: growCycleId } })
    await prismaClient.controller.delete({ where: { id: controllerId } })
    await prismaClient.nutrient.deleteMany({ where: { name: { startsWith: 'DosingTest-' } } })
    await teardownTestApp(app)
  })

  async function createPhase(name: string) {
    return await prismaClient.growPhase.create({
      data: { durationDays: 30, growCycleId, name, order: Date.now() % 100_000 },
    })
  }

  async function addEnvironment(growPhaseId: string, period: 'DAY' | 'NIGHT', values = {}) {
    return await prismaClient.phaseEnvironment.create({
      data: { growPhaseId, period, ...values },
    })
  }

  async function preview(growPhaseId: string, payload: Record<string, unknown>) {
    return await app.inject({
      method: 'POST',
      payload,
      url: `/api/grow-phases/${growPhaseId}/dosing/preview`,
    })
  }

  test('previews one nutrient for one period', async () => {
    const phase = await createPhase('Happy')
    await prismaClient.phaseNutrient.create({
      data: {
        appliesToPeriod: 'DAY',
        doseMlPerL: 2,
        growPhaseId: phase.id,
        nutrientId: nutrientAId,
      },
    })
    await addEnvironment(phase.id, 'DAY', { phMax: 6.5, phMin: 5.5, phTarget: 6 })
    const response = await preview(phase.id, { period: 'DAY', reservoirLiters: 5 })
    assert.equal(response.statusCode, 200)
    assert.deepEqual(JSON.parse(response.body), {
      mlByNutrientId: { [nutrientAId]: 10 },
      totalMl: 10,
      warnings: [],
    })
  })

  test('rejects a negative reservoir volume', async () => {
    const phase = await createPhase('Negative')
    const response = await preview(phase.id, { period: 'DAY', reservoirLiters: -1 })
    assert.equal(response.statusCode, 400)
  })

  test('returns zero for a zero-volume reservoir when rows exist', async () => {
    const phase = await createPhase('Zero')
    await prismaClient.phaseNutrient.create({
      data: {
        appliesToPeriod: 'DAY',
        doseMlPerL: 2,
        growPhaseId: phase.id,
        nutrientId: nutrientAId,
      },
    })
    const response = await preview(phase.id, { period: 'DAY', reservoirLiters: 0 })
    assert.equal(response.statusCode, 200)
    assert.equal(JSON.parse(response.body).totalMl, 0)
  })

  test('warns when no nutrients are configured', async () => {
    const response = await preview((await createPhase('Empty')).id, {
      period: 'DAY',
      reservoirLiters: 5,
    })
    assert.ok(JSON.parse(response.body).warnings.includes('NO_NUTRIENTS_CONFIGURED'))
  })

  test('warns when the requested period has no nutrients', async () => {
    const phase = await createPhase('Period')
    await prismaClient.phaseNutrient.create({
      data: {
        appliesToPeriod: 'DAY',
        doseMlPerL: 2,
        growPhaseId: phase.id,
        nutrientId: nutrientAId,
      },
    })
    const response = await preview(phase.id, { period: 'NIGHT', reservoirLiters: 5 })
    assert.ok(JSON.parse(response.body).warnings.includes('NO_NIGHT_NUTRIENTS'))
  })

  test('returns rounded totals for multiple nutrients', async () => {
    const phase = await createPhase('Multiple')
    await prismaClient.phaseNutrient.createMany({
      data: [
        {
          appliesToPeriod: 'DAY',
          doseMlPerL: 1.111,
          growPhaseId: phase.id,
          nutrientId: nutrientAId,
        },
        {
          appliesToPeriod: 'DAY',
          doseMlPerL: 2.222,
          growPhaseId: phase.id,
          nutrientId: nutrientBId,
        },
      ],
    })
    const body = JSON.parse((await preview(phase.id, { period: 'DAY', reservoirLiters: 3 })).body)
    assert.deepEqual(body.mlByNutrientId, { [nutrientAId]: 3.33, [nutrientBId]: 6.67 })
    assert.equal(body.totalMl, 10)
  })

  test('warns when pH bands are absent', async () => {
    const phase = await createPhase('No pH')
    await prismaClient.phaseNutrient.create({
      data: {
        appliesToPeriod: 'DAY',
        doseMlPerL: 2,
        growPhaseId: phase.id,
        nutrientId: nutrientAId,
      },
    })
    const res = await preview(phase.id, { period: 'DAY', reservoirLiters: 5 })
    const body = JSON.parse(res.body)
    assert.ok(body.warnings.includes('NO_PH_BANDS'))
  })

  test('warns when DAY and NIGHT pH bands differ', async () => {
    const phase = await createPhase('Mismatch')
    await addEnvironment(phase.id, 'DAY', { phMax: 6.5, phMin: 5.5, phTarget: 6 })
    await addEnvironment(phase.id, 'NIGHT', { phMax: 6.8, phMin: 5.8, phTarget: 6.3 })
    const res = await preview(phase.id, { period: 'DAY', reservoirLiters: 5 })
    const body = JSON.parse(res.body)
    assert.ok(body.warnings.includes('PH_DAY_NIGHT_MISMATCH'))
  })
})
