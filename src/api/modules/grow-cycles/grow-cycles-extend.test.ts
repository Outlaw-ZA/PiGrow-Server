import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, teardownTestApp } from '../test-helper.js'

describe('Grow cycle active phase extension', () => {
  let app: any
  let prismaClient: any
  const macBase = `${Date.now().toString(16)}`.padStart(8, '0')
  const macPrefix = `de:ad:be:${macBase.slice(-6, -4)}:${macBase.slice(-4, -2)}`
  const macCounter = { n: 0 }

  before(async () => {
    const result = await createTestApp()
    app = result.server
    prismaClient = result.prisma
  })

  after(async () => {
    await prismaClient.growCycle.deleteMany({
      where: { controller: { macAddress: { startsWith: macPrefix } } },
    })
    await prismaClient.controller.deleteMany({
      where: { macAddress: { startsWith: macPrefix } },
    })
    await teardownTestApp(app)
  })

  async function seedCycle(options: { name: string; isActive?: boolean; startAt?: string }) {
    const mac = `de:ad:be:${macBase.slice(-6, -4)}:${macBase.slice(-4, -2)}:${((parseInt(macBase.slice(-2), 16) + macCounter.n++) % 256).toString(16).padStart(2, '0')}`
    const controller = await prismaClient.controller.create({
      data: {
        ipAddress: '192.168.1.100',
        macAddress: mac,
        name: options.name,
      },
    })
    const response = await app.inject({
      method: 'POST',
      payload: {
        controllerId: controller.id,
        isActive: options.isActive ?? true,
        name: options.name,
      },
      url: '/api/grow-cycles',
    })
    assert.equal(response.statusCode, 201)
    const body = JSON.parse(response.body)
    if (options.startAt) {
      const startResponse = await app.inject({
        method: 'PUT',
        payload: { startAt: options.startAt },
        url: `/api/grow-cycles/${body.id}`,
      })
      assert.equal(startResponse.statusCode, 200)
    }
    return { controllerId: controller.id, growCycleId: body.id }
  }

  async function seedPhases(growCycleId: string, durations: number[], activeIndex = 0) {
    return await prismaClient.$transaction(
      durations.map((durationDays, index) =>
        prismaClient.growPhase.create({
          data: {
            durationDays,
            growCycleId,
            isActive: index === activeIndex,
            name: `Phase ${index + 1}`,
            order: index + 1,
          },
        }),
      ),
    )
  }

  async function extend(growCycleId: string, days: unknown) {
    return await app.inject({
      method: 'POST',
      payload: { days },
      url: `/api/grow-cycles/${growCycleId}/extend-active-phase`,
    })
  }

  test('extends the active phase and shifts every subsequent phase', async () => {
    const { growCycleId } = await seedCycle({
      name: 'Extend Happy Path',
      startAt: '2026-01-01',
    })
    await seedPhases(growCycleId, [10, 20, 15])

    const response = await extend(growCycleId, 5)
    const body = JSON.parse(response.body)

    assert.equal(response.statusCode, 200)
    assert.equal(body.phases[0].durationDays, 15)
    assert.equal(body.phases[0].startAt, '2026-01-01')
    assert.equal(body.phases[0].endAt, '2026-01-16')
    assert.equal(body.phases[1].startAt, '2026-01-16')
    assert.equal(body.phases[1].endAt, '2026-02-05')
    assert.equal(body.phases[2].startAt, '2026-02-05')
    assert.equal(body.phases[2].endAt, '2026-02-20')
    assert.equal(body.phases[2].isActive, false)
  })

  test('extends the final phase without ending the cycle', async () => {
    const { growCycleId } = await seedCycle({
      name: 'Extend Final Phase',
      startAt: '2026-01-01',
    })
    await seedPhases(growCycleId, [10])

    const response = await extend(growCycleId, 7)
    const body = JSON.parse(response.body)

    assert.equal(response.statusCode, 200)
    assert.equal(body.isActive, true)
    assert.equal(body.phases[0].durationDays, 17)
    assert.equal(body.phases[0].endAt, '2026-01-18')
  })

  test('rejects an inactive cycle with CYCLE_NOT_ACTIVE', async () => {
    const { growCycleId } = await seedCycle({ isActive: false, name: 'Inactive Cycle' })
    await seedPhases(growCycleId, [10])

    const response = await extend(growCycleId, 5)
    const body = JSON.parse(response.body)

    assert.equal(response.statusCode, 409)
    assert.equal(body.code, 'CYCLE_NOT_ACTIVE')
  })

  test('rejects a cycle without a start date with CYCLE_NOT_STARTED', async () => {
    const { growCycleId } = await seedCycle({ name: 'Not Started Cycle' })
    await seedPhases(growCycleId, [10])

    const response = await extend(growCycleId, 5)
    const body = JSON.parse(response.body)

    assert.equal(response.statusCode, 409)
    assert.equal(body.code, 'CYCLE_NOT_STARTED')
  })

  test('rejects a cycle without an active phase with NO_ACTIVE_PHASE', async () => {
    const { growCycleId } = await seedCycle({
      name: 'No Active Phase',
      startAt: '2026-01-01',
    })
    await seedPhases(growCycleId, [10], -1)

    const response = await extend(growCycleId, 5)
    const body = JSON.parse(response.body)

    assert.equal(response.statusCode, 409)
    assert.equal(body.code, 'NO_ACTIVE_PHASE')
  })

  test('rejects days outside integer range 1..90', async () => {
    const { growCycleId } = await seedCycle({
      name: 'Invalid Extension Days',
      startAt: '2026-01-01',
    })
    await seedPhases(growCycleId, [10])

    for (const days of [0, 91, -3, 2.5]) {
      const response = await extend(growCycleId, days)
      assert.equal(response.statusCode, 400, `days=${days}`)
    }
  })

  test('returns PHASE_LOST_RACE when the active phase is deactivated before the gate update', async () => {
    const { growCycleId } = await seedCycle({
      name: 'Phase Race',
      startAt: '2026-01-01',
    })
    const [phase] = await seedPhases(growCycleId, [10])
    const originalTransaction = prismaClient.$transaction.bind(prismaClient)
    const originalPhaseDelegate = prismaClient.growPhase
    let flipped = false
    prismaClient.$transaction = (callback: any) =>
      originalTransaction(async (tx: any) => {
        const phaseDelegate = new Proxy(tx.growPhase, {
          get(target, property, receiver) {
            if (property !== 'updateMany') {
              return Reflect.get(target, property, receiver)
            }
            return async (args: any) => {
              if (!flipped && args.where?.id === phase.id && args.where?.isActive === true) {
                flipped = true
                await originalPhaseDelegate.update({
                  data: { isActive: false },
                  where: { id: phase.id },
                })
              }
              return target.updateMany(args)
            }
          },
        })
        const transactionProxy = new Proxy(tx, {
          get(target, property, receiver) {
            if (property === 'growPhase') {
              return phaseDelegate
            }
            return Reflect.get(target, property, receiver)
          },
        })
        return callback(transactionProxy)
      })

    try {
      const response = await extend(growCycleId, 5)
      const body = JSON.parse(response.body)
      assert.equal(response.statusCode, 409)
      assert.equal(body.code, 'PHASE_LOST_RACE')
    } finally {
      prismaClient.$transaction = originalTransaction
    }
  })
})
