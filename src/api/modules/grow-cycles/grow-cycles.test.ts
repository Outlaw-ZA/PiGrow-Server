import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, teardownTestApp } from '../test-helper.js'

describe('Grow Cycles API Feature Module', () => {
  let app: any
  let prismaClient: any

  // Per-run unique MAC base so this suite can run repeatedly without colliding
  // With rows from previous runs.
  const macBase = `${Date.now().toString(16)}`.padStart(8, '0')
  const macPrefix = `aa:bb:cc:${macBase.slice(0, 2)}:${macBase.slice(2, 4)}`

  before(async () => {
    const { server, prisma } = await createTestApp()
    app = server
    prismaClient = prisma
  })

  after(async () => {
    // Clean up all controllers this run created (any MAC matching our prefix).
    // Delete grow cycles first so the controller FK is no longer referenced.
    await prismaClient.growCycle.deleteMany({
      where: { controller: { macAddress: { startsWith: macPrefix } } },
    })
    await prismaClient.controller.deleteMany({
      where: { macAddress: { startsWith: macPrefix } },
    })
    await teardownTestApp(app)
  })

  // Helper: provision a fresh controller + grow cycle pair, each with its own
  // Unique mac address. This is required because the schema enforces at most
  // ONE active grow per controller, so every test that needs an active grow
  // Must get a dedicated controller.
  const macCounter = { n: 0 }
  async function seedControllerAndCycle(options: {
    name: string
    isActive?: boolean
    startAt?: string
  }) {
    const mac = `aa:bb:cc:${macBase.slice(0, 2)}:${macBase.slice(2, 4)}:${(macCounter.n++).toString(16).padStart(2, '0')}`
    const controller = await prismaClient.controller.create({
      data: {
        ipAddress: '192.168.1.100',
        macAddress: mac,
        name: options.name,
      },
    })

    const createResponse = await app.inject({
      method: 'POST',
      payload: {
        controllerId: controller.id,
        isActive: options.isActive ?? true,
        name: options.name,
      },
      url: '/api/grow-cycles',
    })
    const created = JSON.parse(createResponse.body)
    assert.equal(createResponse.statusCode, 201)

    if (options.startAt) {
      await app.inject({
        method: 'PUT',
        payload: { startAt: options.startAt },
        url: `/api/grow-cycles/${created.id}`,
      })
    }

    return { body: created, controllerId: controller.id, growCycleId: created.id }
  }

  test('POST /grow-cycles - Should initialize a cycle without devices or phases', async () => {
    const { body } = await seedControllerAndCycle({
      isActive: true,
      name: 'Blue Dream Automated Crop Run',
    })

    assert.equal(body.name, 'Blue Dream Automated Crop Run')
    assert.equal(body.isActive, true)

    assert.ok(Array.isArray(body.phases), 'Response payload data should expose a sub-phase array')
    assert.equal(body.phases.length, 0, 'Phases are not auto-generated')
  })

  test('PUT /grow-cycles/:id - Should accept a date-only startAt (YYYY-MM-DD) and return it without a timestamp', async () => {
    const { growCycleId } = await seedControllerAndCycle({
      isActive: true,
      name: 'Date Only Start Run',
    })

    const updateResponse = await app.inject({
      method: 'PUT',
      payload: { startAt: '2026-06-16' },
      url: `/api/grow-cycles/${growCycleId}`,
    })
    const updated = JSON.parse(updateResponse.body)
    assert.equal(updateResponse.statusCode, 200)
    assert.equal(updated.startAt, '2026-06-16')

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/grow-cycles/${growCycleId}`,
    })
    const fetched = JSON.parse(getResponse.body)
    assert.equal(getResponse.statusCode, 200)
    assert.equal(fetched.startAt, '2026-06-16')

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/grow-cycles',
    })
    const list = JSON.parse(listResponse.body)
    const listed = list.find((c: { id: string }) => c.id === growCycleId)
    assert.equal(listed.startAt, '2026-06-16')
  })

  test('PUT /grow-cycles/:id - Should reject a full date-time string', async () => {
    const { growCycleId } = await seedControllerAndCycle({
      isActive: false,
      name: 'Reject DateTime Run',
    })

    const updateResponse = await app.inject({
      method: 'PUT',
      payload: { startAt: '2026-06-16T00:00:00.000Z' },
      url: `/api/grow-cycles/${growCycleId}`,
    })

    assert.equal(updateResponse.statusCode, 400)
  })

  test('POST /grow-cycles - Should reject 409 when the controller already has an active grow cycle', async () => {
    const { controllerId } = await seedControllerAndCycle({
      isActive: true,
      name: 'First Active Cycle',
    })

    const response = await app.inject({
      method: 'POST',
      payload: {
        controllerId,
        isActive: true,
        name: 'Second Active Cycle Attempt',
      },
      url: '/api/grow-cycles',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 409)
    assert.match(body.error, /active grow cycle/i)
  })

  test('POST /grow-cycles - Should allow a second (inactive) grow cycle on a controller that already has an active one', async () => {
    const { controllerId } = await seedControllerAndCycle({
      isActive: true,
      name: 'Primary Active Cycle',
    })

    const response = await app.inject({
      method: 'POST',
      payload: {
        controllerId,
        isActive: false,
        name: 'Secondary Inactive Cycle',
      },
      url: '/api/grow-cycles',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.isActive, false)
  })

  test('POST /grow-cycles/:id/skip-phase - Happy path: trims active phase and cascades shift to subsequent phases', async () => {
    const { growCycleId } = await seedControllerAndCycle({
      isActive: true,
      name: 'Skip Happy Path',
      startAt: '2026-01-01',
    })

    await seedPhases(growCycleId, [10, 20, 15, 5])

    const skipResponse = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-01-16`,
    })
    const body = JSON.parse(skipResponse.body)

    assert.equal(skipResponse.statusCode, 200)
    assert.equal(body.id, growCycleId)
    assert.ok(Array.isArray(body.phases))

    const { phases } = body
    const p1 = phases[0]
    const p2 = phases[1]
    const p3 = phases[2]
    const p4 = phases[3]

    assert.equal(p2.durationDays, 5, 'Active phase trimmed to elapsed days (16 - 11 = 5)')
    assert.equal(p2.endAt, '2026-01-16')
    assert.equal(p2.isActive, false)

    assert.equal(p3.startAt, '2026-01-16')
    assert.equal(p3.durationDays, 15)
    assert.equal(p3.endAt, '2026-01-31')
    assert.equal(p3.isActive, true)

    assert.equal(p4.startAt, '2026-01-31')
    assert.equal(p4.endAt, '2026-02-05')
    assert.equal(p4.durationDays, 5)

    assert.equal(p1.startAt, '2026-01-01')
    assert.equal(p1.endAt, '2026-01-11')
    assert.equal(p1.isActive, false)
  })

  test('POST /grow-cycles/:id/skip-phase - Should reject when cycle has not started (startAt null)', async () => {
    const { growCycleId } = await seedControllerAndCycle({
      isActive: false,
      name: 'Skip Not Started',
    })

    const skipResponse = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-06-01`,
    })
    const body = JSON.parse(skipResponse.body)

    assert.equal(skipResponse.statusCode, 400)
    assert.equal(body.error, 'Grow cycle has not started yet')
  })

  test('POST /grow-cycles/:id/skip-phase - Should reject when no phase is active (before startAt)', async () => {
    const { growCycleId } = await seedControllerAndCycle({
      isActive: true,
      name: 'Skip Before Start',
      startAt: '2030-01-01',
    })
    await seedPhases(growCycleId, [10, 20, 15, 5])

    const skipResponse = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2025-12-31`,
    })
    const body = JSON.parse(skipResponse.body)

    assert.equal(skipResponse.statusCode, 400)
    assert.equal(body.error, 'No active phase to skip')
  })

  test('POST /grow-cycles/:id/skip-phase - Should reject when the last phase is active', async () => {
    const { growCycleId } = await seedControllerAndCycle({
      isActive: true,
      name: 'Skip Last Phase',
      startAt: '2026-01-01',
    })
    await seedPhases(growCycleId, [10, 20, 15, 5])

    const skipResponse = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-02-17`,
    })
    const body = JSON.parse(skipResponse.body)

    assert.equal(skipResponse.statusCode, 400)
    assert.equal(body.error, 'Cannot skip the final grow phase')
  })

  test('POST /grow-cycles/:id/skip-phase - Should allow 0-day skipped phase when active started today', async () => {
    const { growCycleId } = await seedControllerAndCycle({
      isActive: true,
      name: 'Skip Day 1',
      startAt: '2026-01-01',
    })
    await seedPhases(growCycleId, [10, 20, 15, 5])

    const skipResponse = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-01-01`,
    })
    const body = JSON.parse(skipResponse.body)
    assert.equal(skipResponse.statusCode, 200)

    const { phases } = body
    assert.equal(phases[0].durationDays, 0)
    assert.equal(phases[0].endAt, '2026-01-01')
    assert.equal(phases[1].startAt, '2026-01-01')
    assert.equal(phases[1].isActive, true)
  })

  test('POST /grow-cycles/:id/skip-phase - Should accept the today query parameter', async () => {
    const { growCycleId } = await seedControllerAndCycle({
      isActive: true,
      name: 'Skip Today Override',
      startAt: '2026-01-01',
    })
    await seedPhases(growCycleId, [10, 20, 15, 5])

    const skipResponse = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-01-21`,
    })
    assert.equal(skipResponse.statusCode, 200)

    const body = JSON.parse(skipResponse.body)
    const p2 = body.phases[1]
    assert.equal(p2.durationDays, 10)
    assert.equal(p2.endAt, '2026-01-21')
    assert.equal(body.phases[3].endAt, '2026-02-10')
  })

  test('POST /grow-cycles/:id/skip-phase - Calling twice should advance the active phase by one each time', async () => {
    const { growCycleId } = await seedControllerAndCycle({
      isActive: true,
      name: 'Skip Double Advance',
      startAt: '2026-01-01',
    })
    await seedPhases(growCycleId, [10, 20, 15, 5])

    const first = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-01-16`,
    })
    assert.equal(first.statusCode, 200)
    const firstBody = JSON.parse(first.body)
    assert.equal(firstBody.phases[2].isActive, true)
    assert.equal(firstBody.phases[1].endAt, '2026-01-16')

    const second = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${growCycleId}/skip-phase?today=2026-01-26`,
    })
    assert.equal(second.statusCode, 200)
    const secondBody = JSON.parse(second.body)
    assert.equal(secondBody.phases[3].isActive, true)
    assert.equal(secondBody.phases[2].endAt, '2026-01-26')
    assert.equal(secondBody.phases[2].durationDays, 10)
    assert.equal(secondBody.phases[3].startAt, '2026-01-26')
  })

  test('POST /grow-cycles/:id/skip-phase - Should return 404 when the cycle does not exist', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const skipResponse = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${fakeId}/skip-phase?today=2026-01-01`,
    })
    assert.equal(skipResponse.statusCode, 404)
  })

  test('POST /grow-cycles/:id/end-grow - Happy path: trims active phase, marks cycle inactive, deactivates all phases', async () => {
    const { growCycleId } = await seedControllerAndCycle({
      isActive: true,
      name: 'End Grow Happy Path',
      startAt: '2026-01-01',
    })
    await seedPhases(growCycleId, [10, 20, 15, 5])

    const endResponse = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${growCycleId}/end-grow?today=2026-02-17`,
    })
    const body = JSON.parse(endResponse.body)

    assert.equal(endResponse.statusCode, 200)
    assert.equal(body.isActive, false)
    assert.ok(Array.isArray(body.phases))

    const { phases } = body
    const lastPhase = phases[3]

    assert.equal(lastPhase.durationDays, 2)
    assert.equal(lastPhase.endAt, '2026-02-17')
    assert.equal(lastPhase.isActive, false)
    assert.equal(phases[0].isActive, false)
    assert.equal(phases[1].isActive, false)
    assert.equal(phases[2].isActive, false)
    assert.equal(phases[2].endAt, '2026-02-15')
  })

  test('POST /grow-cycles/:id/end-grow - Should reject when cycle has not started (startAt null)', async () => {
    const { growCycleId } = await seedControllerAndCycle({
      isActive: false,
      name: 'End Grow Not Started',
    })

    const endResponse = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${growCycleId}/end-grow?today=2026-06-01`,
    })
    const body = JSON.parse(endResponse.body)

    assert.equal(endResponse.statusCode, 400)
    assert.equal(body.error, 'Grow cycle has not started yet')
  })

  test('POST /grow-cycles/:id/end-grow - Should reject when no phase is active (today past last endAt)', async () => {
    const { growCycleId } = await seedControllerAndCycle({
      isActive: true,
      name: 'End Grow No Active',
      startAt: '2026-01-01',
    })
    await seedPhases(growCycleId, [10, 20, 15, 5])

    const endResponse = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${growCycleId}/end-grow?today=2026-03-01`,
    })
    const body = JSON.parse(endResponse.body)

    assert.equal(endResponse.statusCode, 400)
    assert.equal(body.error, 'No active phase to end')
  })

  test('POST /grow-cycles/:id/end-grow - Should accept the today query parameter', async () => {
    const { growCycleId } = await seedControllerAndCycle({
      isActive: true,
      name: 'End Grow Today Override',
      startAt: '2026-01-01',
    })
    await seedPhases(growCycleId, [10, 20, 15, 5])

    const endResponse = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${growCycleId}/end-grow?today=2026-02-18`,
    })
    assert.equal(endResponse.statusCode, 200)

    const body = JSON.parse(endResponse.body)
    const lastPhase = body.phases[3]
    assert.equal(lastPhase.durationDays, 3)
    assert.equal(lastPhase.endAt, '2026-02-18')
    assert.equal(body.isActive, false)
  })

  test('POST /grow-cycles/:id/end-grow - Should return 404 when the cycle does not exist', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000'
    const endResponse = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${fakeId}/end-grow?today=2026-01-01`,
    })
    assert.equal(endResponse.statusCode, 404)
  })

  test('POST /grow-cycles/:id/end-grow - After end, the controller can start a new active grow', async () => {
    const { controllerId, growCycleId } = await seedControllerAndCycle({
      isActive: true,
      name: 'Cycle Then End Then Restart',
      startAt: '2026-01-01',
    })
    await seedPhases(growCycleId, [10, 20, 15, 5])

    const endResponse = await app.inject({
      method: 'POST',
      url: `/api/grow-cycles/${growCycleId}/end-grow?today=2026-02-17`,
    })
    assert.equal(endResponse.statusCode, 200)

    const restartResponse = await app.inject({
      method: 'POST',
      payload: {
        controllerId,
        isActive: true,
        name: 'Sequential Next Grow',
      },
      url: '/api/grow-cycles',
    })
    const restartBody = JSON.parse(restartResponse.body)
    assert.equal(restartResponse.statusCode, 201)
    assert.equal(restartBody.isActive, true)
    assert.equal(restartBody.controllerId, controllerId)
  })

  async function seedPhases(growCycleId: string, durations: [number, number, number, number]) {
    await prismaClient.$transaction(
      durations.map((durationDays, i) =>
        prismaClient.growPhase.create({
          data: {
            durationDays,
            growCycleId,
            isActive: i === 0,
            name: `Phase ${i + 1}`,
            order: i + 1,
          },
        }),
      ),
    )
  }
})
