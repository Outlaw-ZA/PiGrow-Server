import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, teardownTestApp } from '../test-helper.js'

describe('Nutrients API Feature Module', () => {
  let app: any
  let prismaClient: any

  before(async () => {
    const testApp = await createTestApp()
    app = testApp.server
    prismaClient = testApp.prisma
    await prismaClient.phaseNutrient.deleteMany()
    await prismaClient.nutrient.deleteMany()
  })

  after(async () => {
    await prismaClient.phaseNutrient.deleteMany()
    await prismaClient.nutrient.deleteMany()
    await teardownTestApp(app)
  })

  test('POST /api/nutrients creates a row', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: { brand: 'General Hydroponics', name: 'FloraGro', notes: 'Base nutrient' },
      url: '/api/nutrients',
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.name, 'FloraGro')
    assert.equal(body.brand, 'General Hydroponics')
    assert.equal(body.notes, 'Base nutrient')
    assert.ok(body.id)
    assert.ok(body.createdAt)
    assert.ok(body.updatedAt)
  })

  test('POST /api/nutrients with duplicate name and brand returns 409', async () => {
    const existing = await prismaClient.nutrient.create({
      data: { brand: 'Athena', name: 'Core' },
    })
    const response = await app.inject({
      method: 'POST',
      payload: { brand: 'Athena', name: 'Core' },
      url: '/api/nutrients',
    })
    assert.equal(response.statusCode, 409)
    assert.deepEqual(JSON.parse(response.body), {
      error: 'NUTRIENT_CONFLICT',
      existingId: existing.id,
    })
  })

  test('POST /api/nutrients with null brand returns 409 on duplicate', async () => {
    // First POST — no brand field, controller normalizes to null
    const first = await prismaClient.nutrient.create({ data: { name: 'NullBrandTest', brand: null } })
    const response = await app.inject({
      method: 'POST',
      payload: { name: 'NullBrandTest' },
      url: '/api/nutrients',
    })
    assert.equal(response.statusCode, 409)
    const body = JSON.parse(response.body)
    assert.equal(body.error, 'NUTRIENT_CONFLICT')
    assert.equal(body.existingId, first.id)
    await prismaClient.nutrient.delete({ where: { id: first.id } })
  })

  test('GET /api/nutrients lists rows', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nutrients' })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.ok(Array.isArray(body))
    assert.ok(body.length >= 2)
  })

  test('PATCH /api/nutrients/:id updates the row', async () => {
    const nutrient = await prismaClient.nutrient.create({ data: { name: 'Bloom' } })
    const response = await app.inject({
      method: 'PATCH',
      payload: { brand: 'Advanced Nutrients', notes: 'Updated' },
      url: `/api/nutrients/${nutrient.id}`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.id, nutrient.id)
    assert.equal(body.name, 'Bloom')
    assert.equal(body.brand, 'Advanced Nutrients')
    assert.equal(body.notes, 'Updated')
  })

  test('DELETE /api/nutrients/:id succeeds when unused', async () => {
    const nutrient = await prismaClient.nutrient.create({ data: { name: 'Unused' } })
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/nutrients/${nutrient.id}`,
    })
    assert.equal(response.statusCode, 204)
    assert.equal(await prismaClient.nutrient.findUnique({ where: { id: nutrient.id } }), null)
  })

  test('DELETE /api/nutrients/:id returns 409 when referenced by a phase', async () => {
    const controller = await prismaClient.controller.create({
      data: {
        ipAddress: '192.168.1.200',
        macAddress: `AA:BB:CC:DD:${Date.now().toString(16).slice(-5)}`,
        name: 'Nutrient Test',
      },
    })
    const cycle = await prismaClient.growCycle.create({
      data: { controllerId: controller.id, name: 'Nutrient Cycle' },
    })
    const phase = await prismaClient.growPhase.create({
      data: { durationDays: 30, growCycleId: cycle.id, name: 'Vegetative', order: 1 },
    })
    const nutrient = await prismaClient.nutrient.create({ data: { name: 'Referenced' } })
    await prismaClient.phaseNutrient.create({
      data: {
        appliesToPeriod: 'DAY',
        doseMlPerL: 1,
        growPhaseId: phase.id,
        nutrientId: nutrient.id,
      },
    })
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/nutrients/${nutrient.id}`,
    })
    assert.equal(response.statusCode, 409)
    assert.deepEqual(JSON.parse(response.body), { error: 'NUTRIENT_IN_USE', referencing: 1 })
    await prismaClient.growCycle.delete({ where: { id: cycle.id } })
    await prismaClient.controller.delete({ where: { id: controller.id } })
  })

  test('DELETE /api/nutrients/:id returns 404 when the nutrient does not exist', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/nutrients/00000000-0000-0000-0000-000000000000',
    })
    assert.equal(response.statusCode, 404)
  })
})
