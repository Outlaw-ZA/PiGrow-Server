import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, teardownTestApp } from '../test-helper.js'

describe('Grow Phases API Feature Module', () => {
  let app: any
  let prismaClient: any
  let testGrowCycleId: string
  let targetedPhaseId: string

  before(async () => {
    const { server, prisma } = await createTestApp()
    app = server
    prismaClient = prisma

    const controller = await prismaClient.controller.create({
      data: {
        growCycles: {
          create: {
            isActive: true,
            name: 'Phase Testing Isolated Crop Run',
            phases: {
              create: {
                dayDurationMinutes: 1080,
                dayStartMinutes: 360,
                durationDays: 14,
                name: 'Temporary Test Phase',
                order: 1,
              },
            },
          },
        },
        ipAddress: '192.168.1.100',
        macAddress: '11:22:33:44:55:66',
        name: 'Stage Validation Hub',
      },
      include: {
        growCycles: {
          include: { phases: true },
        },
      },
    })

    testGrowCycleId = controller.growCycles[0].id
    targetedPhaseId = controller.growCycles[0].phases[0].id
  })

  after(async () => {
    await prismaClient.growCycle.deleteMany({
      where: { controller: { macAddress: '11:22:33:44:55:66' } },
    })
    await prismaClient.controller.delete({
      where: { macAddress: '11:22:33:44:55:66' },
    })
    await teardownTestApp(app)
  })

  test('GET /grow-phases/cycle/:growCycleId - Should load chronological phases with day/night schedule and environments', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/grow-phases/cycle/${testGrowCycleId}`,
    })

    const body = JSON.parse(response.body)

    assert.equal(response.statusCode, 200)
    assert.ok(Array.isArray(body))
    assert.equal(body[0].id, targetedPhaseId)
    assert.equal(body[0].dayStartMinutes, 360)
    assert.equal(body[0].dayDurationMinutes, 1080)
    assert.ok(
      Array.isArray(body[0].environments),
      'Environments array must be included in phase response',
    )
  })

  test('PUT /grow-phases/:id - Should modify timing profiles cleanly', async () => {
    const response = await app.inject({
      method: 'PUT',
      payload: {
        durationDays: 45,
        isActive: true,
        name: 'Upgraded Veg Horizon',
      },
      url: `/api/grow-phases/${targetedPhaseId}`,
    })

    const body = JSON.parse(response.body)

    assert.equal(response.statusCode, 200)
    assert.equal(body.name, 'Upgraded Veg Horizon')
    assert.equal(body.durationDays, 45)
    assert.equal(body.isActive, true)
  })

  test('PUT /grow-phases/:id - Should accept a date-only endAt and return it without a timestamp', async () => {
    const updateResponse = await app.inject({
      method: 'PUT',
      payload: {
        endAt: '2026-07-30',
        startAt: '2026-06-16',
      },
      url: `/api/grow-phases/${targetedPhaseId}`,
    })

    const updated = JSON.parse(updateResponse.body)

    assert.equal(updateResponse.statusCode, 200)
    assert.equal(updated.startAt, '2026-06-16')
    assert.equal(updated.endAt, '2026-07-30')

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/grow-phases/${targetedPhaseId}`,
    })
    const fetched = JSON.parse(getResponse.body)
    assert.equal(getResponse.statusCode, 200)
    assert.equal(fetched.startAt, '2026-06-16')
    assert.equal(fetched.endAt, '2026-07-30')
  })

  test('PUT /grow-phases/:id - Should reject a full date-time string for startAt or endAt', async () => {
    const startAtResponse = await app.inject({
      method: 'PUT',
      payload: { startAt: '2026-06-16T00:00:00.000Z' },
      url: `/api/grow-phases/${targetedPhaseId}`,
    })
    assert.equal(startAtResponse.statusCode, 400)

    const endAtResponse = await app.inject({
      method: 'PUT',
      payload: { endAt: '2026-07-30T00:00:00.000Z' },
      url: `/api/grow-phases/${targetedPhaseId}`,
    })
    assert.equal(endAtResponse.statusCode, 400)
  })

  test('POST and PUT /grow-phases round-trip nullable phase-wide pH bands', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      payload: {
        durationDays: 21,
        growCycleId: testGrowCycleId,
        name: 'Phase-wide pH',
        order: 2,
        phMax: 6.3,
        phMin: 5.7,
        phTarget: 6,
      },
      url: '/api/grow-phases',
    })
    const created = JSON.parse(createResponse.body)
    assert.equal(createResponse.statusCode, 201)
    assert.equal(created.phMin, 5.7)
    assert.equal(created.phTarget, 6)
    assert.equal(created.phMax, 6.3)

    const updateResponse = await app.inject({
      method: 'PUT',
      payload: { phMax: null, phMin: null, phTarget: 6.1 },
      url: `/api/grow-phases/${created.id}`,
    })
    const updated = JSON.parse(updateResponse.body)
    assert.equal(updateResponse.statusCode, 200)
    assert.equal(updated.phMin, null)
    assert.equal(updated.phTarget, 6.1)
    assert.equal(updated.phMax, null)

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/grow-phases/${created.id}`,
    })
    assert.deepEqual(
      (({ phMin, phTarget, phMax }) => ({ phMax, phMin, phTarget }))(JSON.parse(getResponse.body)),
      { phMax: null, phMin: null, phTarget: 6.1 },
    )
  })

  test('PUT /grow-phases/:id - Should accept a custom dayStartMinutes / dayDurationMinutes (12/12 photoperiod)', async () => {
    const response = await app.inject({
      method: 'PUT',
      payload: {
        dayDurationMinutes: 720,
        dayStartMinutes: 360,
      },
      url: `/api/grow-phases/${targetedPhaseId}`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.dayStartMinutes, 360)
    assert.equal(body.dayDurationMinutes, 720)
  })
})
