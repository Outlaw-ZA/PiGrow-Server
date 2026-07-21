import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, teardownTestApp } from '../test-helper.js'

describe('Phase Nutrients API Feature Module', () => {
  let app: any
  let prismaClient: any
  let controllerId: string
  let growCycleId: string
  let growPhaseId: string
  let growPhase2Id: string
  let nutrientAId: string
  let nutrientBId: string

  before(async () => {
    const testApp = await createTestApp()
    app = testApp.server
    prismaClient = testApp.prisma

    // Clean slate — phase-nutrients module is not yet registered, so the
    // Table may have rows from other test files. deleteMany is safe.
    await prismaClient.phaseNutrient.deleteMany()
    await prismaClient.nutrient.deleteMany({ where: { name: { startsWith: 'PNTest-' } } })

    const controller = await prismaClient.controller.create({
      data: {
        ipAddress: '192.168.99.100',
        macAddress: `AA:CC:DD:EE:${Date.now().toString(16).slice(-5)}`,
        name: 'Phase Nutrient Test Controller',
      },
    })
    controllerId = controller.id

    const cycle = await prismaClient.growCycle.create({
      data: { controllerId, name: 'Phase Nutrient Test' },
    })
    growCycleId = cycle.id

    const phase = await prismaClient.growPhase.create({
      data: { durationDays: 30, growCycleId, name: 'Veg', order: 1 },
    })
    growPhaseId = phase.id

    const phase2 = await prismaClient.growPhase.create({
      data: { durationDays: 14, growCycleId, name: 'Flower', order: 2 },
    })
    growPhase2Id = phase2.id

    const nutA = await prismaClient.nutrient.create({ data: { name: 'PNTest-A' } })
    nutrientAId = nutA.id
    const nutB = await prismaClient.nutrient.create({ data: { name: 'PNTest-B' } })
    nutrientBId = nutB.id
  })

  after(async () => {
    await prismaClient.phaseNutrient.deleteMany()
    await prismaClient.growCycle.delete({ where: { id: growCycleId } })
    await prismaClient.controller.delete({ where: { id: controllerId } })
    await prismaClient.nutrient.deleteMany({ where: { name: { startsWith: 'PNTest-' } } })
    await teardownTestApp(app)
  })

  test('POST /api/grow-phases/:growPhaseId/phase-nutrients creates a row', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        appliesToPeriod: 'DAY',
        doseMlPerL: 2.5,
        nutrientId: nutrientAId,
        sortOrder: 1,
      },
      url: `/api/grow-phases/${growPhaseId}/phase-nutrients`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.growPhaseId, growPhaseId)
    assert.equal(body.nutrientId, nutrientAId)
    assert.equal(body.doseMlPerL, 2.5)
    assert.equal(body.appliesToPeriod, 'DAY')
    assert.equal(body.sortOrder, 1)
    assert.ok(body.id)
    assert.ok(body.createdAt)
    assert.ok(body.updatedAt)
  })

  test('POST ... returns 409 on duplicate (growPhaseId, nutrientId, appliesToPeriod)', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        appliesToPeriod: 'DAY',
        doseMlPerL: 2.5,
        nutrientId: nutrientAId,
      },
      url: `/api/grow-phases/${growPhaseId}/phase-nutrients`,
    })
    assert.equal(response.statusCode, 409)
    const body = JSON.parse(response.body)
    assert.equal(body.error, 'PHASE_NUTRIENT_CONFLICT')
    assert.ok(body.existingId)
  })

  test('POST ... returns 404 when growPhaseId does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        appliesToPeriod: 'DAY',
        doseMlPerL: 1.5,
        nutrientId: nutrientBId,
      },
      url: `/api/grow-phases/00000000-0000-0000-0000-000000000000/phase-nutrients`,
    })
    assert.equal(response.statusCode, 404)
    const body = JSON.parse(response.body)
    assert.equal(body.error, 'PHASE_NOT_FOUND')
  })

  test('GET /api/grow-phases/:growPhaseId/phase-nutrients lists rows ordered DAY before NIGHT', async () => {
    // Seed two rows for phase2; NIGHT created first so orderBy appliesToPeriod
    // Must outrank createdAt.
    await prismaClient.phaseNutrient.create({
      data: {
        appliesToPeriod: 'NIGHT',
        doseMlPerL: 1,
        growPhaseId: growPhase2Id,
        nutrientId: nutrientAId,
      },
    })
    await prismaClient.phaseNutrient.create({
      data: {
        appliesToPeriod: 'DAY',
        doseMlPerL: 3,
        growPhaseId: growPhase2Id,
        nutrientId: nutrientBId,
      },
    })
    const response = await app.inject({
      method: 'GET',
      url: `/api/grow-phases/${growPhase2Id}/phase-nutrients`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.ok(Array.isArray(body))
    assert.equal(body.length, 2)
    assert.equal(body[0].appliesToPeriod, 'DAY')
    assert.equal(body[1].appliesToPeriod, 'NIGHT')
  })

  test('GET /api/grow-phases/:growPhaseId/phase-nutrients?period=DAY filters to DAY rows', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/grow-phases/${growPhase2Id}/phase-nutrients?period=DAY`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.length, 1)
    assert.equal(body[0].appliesToPeriod, 'DAY')
  })

  test('PATCH /api/grow-phases/:growPhaseId/phase-nutrients/:id updates dose and period', async () => {
    const row = await prismaClient.phaseNutrient.create({
      data: {
        appliesToPeriod: 'NIGHT',
        doseMlPerL: 1.5,
        growPhaseId,
        nutrientId: nutrientBId,
      },
    })
    const response = await app.inject({
      method: 'PATCH',
      payload: { appliesToPeriod: 'DAY', doseMlPerL: 4 },
      url: `/api/grow-phases/${growPhaseId}/phase-nutrients/${row.id}`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.id, row.id)
    assert.equal(body.doseMlPerL, 4)
    assert.equal(body.appliesToPeriod, 'DAY')
  })

  test('PATCH ... returns 409 when period change collides with another row', async () => {
    // Phase2 already has (phase2, nutrientB, DAY). Create (phase2, nutrientB, NIGHT)
    // Then PATCH it to DAY — that triple is already taken.
    const row = await prismaClient.phaseNutrient.create({
      data: {
        appliesToPeriod: 'NIGHT',
        doseMlPerL: 0.5,
        growPhaseId: growPhase2Id,
        nutrientId: nutrientBId,
      },
    })
    const response = await app.inject({
      method: 'PATCH',
      payload: { appliesToPeriod: 'DAY' },
      url: `/api/grow-phases/${growPhase2Id}/phase-nutrients/${row.id}`,
    })
    assert.equal(response.statusCode, 409)
    const body = JSON.parse(response.body)
    assert.equal(body.error, 'PHASE_NUTRIENT_CONFLICT')
  })

  test('DELETE /api/grow-phases/:growPhaseId/phase-nutrients/:id removes the row', async () => {
    const row = await prismaClient.phaseNutrient.create({
      data: {
        appliesToPeriod: 'NIGHT',
        doseMlPerL: 1,
        growPhaseId,
        nutrientId: nutrientAId,
      },
    })
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/grow-phases/${growPhaseId}/phase-nutrients/${row.id}`,
    })
    assert.equal(response.statusCode, 204)
    assert.equal(await prismaClient.phaseNutrient.findUnique({ where: { id: row.id } }), null)
  })

  test('DELETE ... returns 404 for non-existent id', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/grow-phases/${growPhaseId}/phase-nutrients/00000000-0000-0000-0000-000000000000`,
    })
    assert.equal(response.statusCode, 404)
  })

  test('PATCH ... returns 404 when row belongs to a different growPhaseId', async () => {
    const row = await prismaClient.phaseNutrient.create({
      data: {
        appliesToPeriod: 'NIGHT',
        doseMlPerL: 2.0,
        growPhaseId,
        nutrientId: nutrientBId,
      },
    })
    // Request targets growPhase2Id but the row belongs to growPhaseId
    const response = await app.inject({
      method: 'PATCH',
      payload: { doseMlPerL: 99 },
      url: `/api/grow-phases/${growPhase2Id}/phase-nutrients/${row.id}`,
    })
    assert.equal(response.statusCode, 404)
    const body = JSON.parse(response.body)
    assert.equal(body.error, 'PHASE_NUTRIENT_NOT_FOUND')
  })

  test('DELETE ... returns 404 when row belongs to a different growPhaseId', async () => {
    // growPhaseId has no free (nutrient,period) slots — create in growPhase2Id instead.
    // growPhase2Id has (nutrientA,NIGHT) and (nutrientB,DAY) from GET test — use nutrientA+DAY which is free there.
    const row = await prismaClient.phaseNutrient.create({
      data: {
        appliesToPeriod: 'DAY',
        doseMlPerL: 3.0,
        growPhaseId: growPhase2Id,
        nutrientId: nutrientAId,
      },
    })
    // Request targets growPhaseId but the row belongs to growPhase2Id
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/grow-phases/${growPhaseId}/phase-nutrients/${row.id}`,
    })
    assert.equal(response.statusCode, 404)
    const body = JSON.parse(response.body)
    assert.equal(body.error, 'PHASE_NUTRIENT_NOT_FOUND')
  })
})
