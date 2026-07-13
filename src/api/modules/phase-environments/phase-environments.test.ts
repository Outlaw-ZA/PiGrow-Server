import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, teardownTestApp } from '../test-helper.js'

describe('Phase Environments API Feature Module', () => {
  let app: any
  let prismaClient: any
  let phaseId: string

  const mac = `44:55:66:77:88:${Date.now().toString(16).slice(-2)}`

  before(async () => {
    const { server, prisma } = await createTestApp()
    app = server
    prismaClient = prisma

    const controller = await prismaClient.controller.create({
      data: {
        growCycles: {
          create: {
            isActive: true,
            name: 'Env Test Cycle',
            phases: {
              create: {
                durationDays: 30,
                isActive: true,
                name: 'Veg',
                order: 1,
              },
            },
          },
        },
        ipAddress: '192.168.1.110',
        macAddress: mac,
        name: 'Env Test Pi',
      },
      include: { growCycles: { include: { phases: true } } },
    })
    phaseId = controller.growCycles[0].phases[0].id
  })

  after(async () => {
    await prismaClient.growCycle.deleteMany({
      where: { controller: { macAddress: mac } },
    })
    await prismaClient.controller.deleteMany({
      where: { macAddress: mac },
    })
    await teardownTestApp(app)
  })

  test('GET /grow-phases/:id/environment - Should return both DAY and NIGHT as null on a fresh phase', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/grow-phases/${phaseId}/environment`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.growPhaseId, phaseId)
    assert.equal(body.day, null)
    assert.equal(body.night, null)
  })

  test('PUT /grow-phases/:id/environment/DAY - Should upsert a DAY threshold set', async () => {
    const response = await app.inject({
      method: 'PUT',
      payload: {
        co2Max: 1500,
        co2Min: 800,
        co2Target: 1200,
        humidityMax: 75,
        humidityMin: 55,
        tempMax: 28,
        tempMin: 22,
        tempTarget: 25,
      },
      url: `/api/grow-phases/${phaseId}/environment/DAY`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.period, 'DAY')
    assert.equal(body.tempMin, 22)
    assert.equal(body.tempMax, 28)
    assert.equal(body.co2Target, 1200)
  })

  test('GET /grow-phases/:id/environment - Should return the upserted DAY row and a null NIGHT', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/grow-phases/${phaseId}/environment`,
    })

    const body = JSON.parse(response.body)
    assert.equal(body.day.period, 'DAY')
    assert.equal(body.day.tempMax, 28)
    assert.equal(body.night, null)
  })

  test('PUT /grow-phases/:id/environment/NIGHT - Should upsert a NIGHT threshold set with lower temp', async () => {
    const response = await app.inject({
      method: 'PUT',
      payload: {
        co2Max: null,
        co2Min: null,
        co2Target: null,
        humidityMax: 75,
        humidityMin: 55,
        tempMax: 24,
        tempMin: 18,
        tempTarget: 21,
      },
      url: `/api/grow-phases/${phaseId}/environment/NIGHT`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.period, 'NIGHT')
    assert.equal(body.tempMax, 24)
    assert.equal(body.co2Max, null)
  })

  test('PUT /grow-phases/:id/environment/DAY - Should overwrite the existing DAY row (omitted fields cleared)', async () => {
    const response = await app.inject({
      method: 'PUT',
      payload: {
        tempMax: 30,
        // All other fields omitted => cleared
      },
      url: `/api/grow-phases/${phaseId}/environment/DAY`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.tempMax, 30)
    assert.equal(body.tempMin, null)
    assert.equal(body.co2Min, null)
  })

  test('PUT /grow-phases/:id/environment/DAY - Should return 404 for a non-existent phase', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const response = await app.inject({
      method: 'PUT',
      payload: { tempMax: 30 },
      url: `/api/grow-phases/${fakeId}/environment/DAY`,
    })
    assert.equal(response.statusCode, 404)
  })

  test('DELETE /grow-phases/:id/environment/DAY - Should remove the DAY row', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/grow-phases/${phaseId}/environment/DAY`,
    })
    assert.equal(response.statusCode, 204)
  })

  test('DELETE /grow-phases/:id/environment/DAY - Should return 404 when the row is already gone', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/grow-phases/${phaseId}/environment/DAY`,
    })
    assert.equal(response.statusCode, 404)
  })
})
