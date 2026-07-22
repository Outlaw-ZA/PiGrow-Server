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

    growPhaseId = (
      await prismaClient.growPhase.create({
        data: { durationDays: 30, growCycleId, name: 'Veg', order: 1 },
      })
    ).id
    growPhase2Id = (
      await prismaClient.growPhase.create({
        data: { durationDays: 14, growCycleId, name: 'Flower', order: 2 },
      })
    ).id

    nutrientAId = (await prismaClient.nutrient.create({ data: { name: 'PNTest-A' } })).id
    nutrientBId = (await prismaClient.nutrient.create({ data: { name: 'PNTest-B' } })).id
  })

  after(async () => {
    await prismaClient.phaseNutrient.deleteMany()
    await prismaClient.growCycle.delete({ where: { id: growCycleId } })
    await prismaClient.controller.delete({ where: { id: controllerId } })
    await prismaClient.nutrient.deleteMany({ where: { name: { startsWith: 'PNTest-' } } })
    await teardownTestApp(app)
  })

  test('POST creates one phase-wide nutrient row without a period', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
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
    assert.equal(body.sortOrder, 1)
    assert.ok(!('appliesToPeriod' in body))
  })

  test('POST returns 409 for a duplicate phase and nutrient', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: { doseMlPerL: 3, nutrientId: nutrientAId },
      url: `/api/grow-phases/${growPhaseId}/phase-nutrients`,
    })
    assert.equal(response.statusCode, 409)
    const body = JSON.parse(response.body)
    assert.equal(body.error, 'PHASE_NUTRIENT_CONFLICT')
    assert.ok(body.existingId)
  })

  test('POST returns 404 when growPhaseId does not exist', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: { doseMlPerL: 1.5, nutrientId: nutrientBId },
      url: '/api/grow-phases/00000000-0000-0000-0000-000000000000/phase-nutrients',
    })
    assert.equal(response.statusCode, 404)
    assert.equal(JSON.parse(response.body).error, 'PHASE_NOT_FOUND')
  })

  test('GET lists shared rows by sort order without period filtering', async () => {
    await prismaClient.phaseNutrient.createMany({
      data: [
        { doseMlPerL: 1, growPhaseId: growPhase2Id, nutrientId: nutrientAId, sortOrder: 2 },
        { doseMlPerL: 3, growPhaseId: growPhase2Id, nutrientId: nutrientBId, sortOrder: 1 },
      ],
    })
    const response = await app.inject({
      method: 'GET',
      url: `/api/grow-phases/${growPhase2Id}/phase-nutrients?period=NIGHT`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.length, 2)
    assert.deepEqual(
      body.map((item: { nutrientId: string }) => item.nutrientId),
      [nutrientBId, nutrientAId],
    )
    assert.ok(body.every((item: Record<string, unknown>) => !('appliesToPeriod' in item)))
  })

  test('PATCH updates dose and sort order without a period', async () => {
    const row = await prismaClient.phaseNutrient.create({
      data: { doseMlPerL: 1.5, growPhaseId, nutrientId: nutrientBId },
    })
    const response = await app.inject({
      method: 'PATCH',
      payload: { doseMlPerL: 4, sortOrder: 3 },
      url: `/api/grow-phases/${growPhaseId}/phase-nutrients/${row.id}`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.doseMlPerL, 4)
    assert.equal(body.sortOrder, 3)
    assert.ok(!('appliesToPeriod' in body))
  })

  test('DELETE removes the row', async () => {
    const row = await prismaClient.phaseNutrient.findFirstOrThrow({
      where: { growPhaseId, nutrientId: nutrientBId },
    })
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/grow-phases/${growPhaseId}/phase-nutrients/${row.id}`,
    })
    assert.equal(response.statusCode, 204)
    assert.equal(await prismaClient.phaseNutrient.findUnique({ where: { id: row.id } }), null)
  })

  test('PATCH returns 404 when the row belongs to another phase', async () => {
    const row = await prismaClient.phaseNutrient.findFirstOrThrow({
      where: { growPhaseId: growPhase2Id, nutrientId: nutrientAId },
    })
    const response = await app.inject({
      method: 'PATCH',
      payload: { doseMlPerL: 99 },
      url: `/api/grow-phases/${growPhaseId}/phase-nutrients/${row.id}`,
    })
    assert.equal(response.statusCode, 404)
    assert.equal(JSON.parse(response.body).error, 'PHASE_NUTRIENT_NOT_FOUND')
  })

  test('DELETE returns 404 when the row belongs to another phase', async () => {
    const row = await prismaClient.phaseNutrient.findFirstOrThrow({
      where: { growPhaseId: growPhase2Id, nutrientId: nutrientAId },
    })
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/grow-phases/${growPhaseId}/phase-nutrients/${row.id}`,
    })
    assert.equal(response.statusCode, 404)
    assert.equal(JSON.parse(response.body).error, 'PHASE_NUTRIENT_NOT_FOUND')
  })
})
