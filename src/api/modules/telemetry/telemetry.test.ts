import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, teardownTestApp } from '../test-helper.js'

describe('Telemetry API Feature Module', () => {
  let app: any
  let prismaClient: any
  let testGrowCycleId: string
  let testControllerId: string
  let testTempSensorId: string
  let testHumiditySensorId: string
  const testControllerMac = 'ee:ee:ee:ee:ee:ee'

  before(async () => {
    const { server, prisma } = await createTestApp()
    app = server
    prismaClient = prisma

    const controller = await prismaClient.controller.create({
      data: {
        growCycles: {
          create: {
            isActive: false,
            name: 'Telemetry Test Cycle',
          },
        },
        ipAddress: '192.168.1.100',
        macAddress: testControllerMac,
        name: 'Telemetry Test Pi',
        sensors: {
          create: [
            {
              name: 'DHT22 Temp',
              pinNumbers: [4],
              protocol: 'I2C',
              type: 'TEMPERATURE',
            },
            {
              name: 'DHT22 Humidity',
              pinNumbers: [4],
              protocol: 'I2C',
              type: 'HUMIDITY',
            },
          ],
        },
      },
      include: { growCycles: true, sensors: true },
    })

    testControllerId = controller.id
    testGrowCycleId = controller.growCycles[0].id
    testTempSensorId = controller.sensors.find((s: { type: string }) => s.type === 'TEMPERATURE').id
    testHumiditySensorId = controller.sensors.find(
      (s: { type: string }) => s.type === 'HUMIDITY',
    ).id
  })

  after(async () => {
    // Delete in FK-safe order: grow cycles first, then the controller
    // (sensors + telemetry cascade automatically).
    await prismaClient.growCycle.deleteMany({
      where: { controller: { macAddress: testControllerMac } },
    })
    await prismaClient.controller.deleteMany({
      where: { macAddress: testControllerMac },
    })
    await teardownTestApp(app)
  })

  test('POST /telemetry - Should ingest a new sensor reading', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        growCycleId: testGrowCycleId,
        sensorId: testTempSensorId,
        sensorType: 'TEMPERATURE',
        value: 24.7,
      },
      url: '/api/telemetry',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.sensorType, 'TEMPERATURE')
    assert.equal(body.value, 24.7)
    assert.equal(body.sensorId, testTempSensorId)
    assert.ok(body.sensor, 'Expected nested sensor summary on create')
  })

  test('GET /telemetry/grow-cycle/:id/latest - Should return latest reading per physical sensor', async () => {
    await app.inject({
      method: 'POST',
      payload: {
        growCycleId: testGrowCycleId,
        sensorId: testHumiditySensorId,
        sensorType: 'HUMIDITY',
        value: 60,
      },
      url: '/api/telemetry',
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/telemetry/grow-cycle/${testGrowCycleId}/latest`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.ok(Array.isArray(body))
    const sensorIds = new Set(body.map((r: { sensorId: string }) => r.sensorId))
    assert.ok(sensorIds.has(testTempSensorId))
    assert.ok(sensorIds.has(testHumiditySensorId))
  })

  test('POST /telemetry - Should accept TEMP_HUMIDITY sensor type', async () => {
    const combined = await prismaClient.sensor.create({
      data: {
        controllerId: testControllerId,
        name: 'DHT22 Combo',
        pinNumbers: [4],
        protocol: 'I2C',
        type: 'TEMP_HUMIDITY',
      },
    })

    const response = await app.inject({
      method: 'POST',
      payload: {
        growCycleId: testGrowCycleId,
        sensorId: combined.id,
        sensorType: 'TEMP_HUMIDITY',
        value: 22.4,
      },
      url: '/api/telemetry',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.sensorType, 'TEMP_HUMIDITY')
  })

  test('GET /telemetry/grow-cycle/:id/latest - Should return latest reading per (sensor, sensorType) pair', async () => {
    const combo = await prismaClient.sensor.create({
      data: {
        controllerId: testControllerId,
        name: 'DHT22 Combo Latest',
        pinNumbers: [5],
        protocol: 'I2C',
        type: 'TEMP_HUMIDITY',
      },
    })

    await app.inject({
      method: 'POST',
      payload: {
        growCycleId: testGrowCycleId,
        sensorId: combo.id,
        sensorType: 'TEMPERATURE',
        value: 23.1,
      },
      url: '/api/telemetry',
    })

    await app.inject({
      method: 'POST',
      payload: {
        growCycleId: testGrowCycleId,
        sensorId: combo.id,
        sensorType: 'HUMIDITY',
        value: 55,
      },
      url: '/api/telemetry',
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/telemetry/grow-cycle/${testGrowCycleId}/latest`,
    })

    const body: Array<{
      sensorId: string
      sensorType: string
      value: number
    }> = JSON.parse(response.body)

    assert.equal(response.statusCode, 200)
    const comboRows = body.filter((r) => r.sensorId === combo.id)
    const types = comboRows.map((r) => r.sensorType).sort()
    assert.deepEqual(types, ['HUMIDITY', 'TEMPERATURE'])
    assert.equal(comboRows.find((r) => r.sensorType === 'TEMPERATURE')?.value, 23.1)
    assert.equal(comboRows.find((r) => r.sensorType === 'HUMIDITY')?.value, 55)
  })

  test('GET /telemetry/grow-cycle/:id/latest - Should return one row per (sensor, sensorType) when rows share createdAt', async () => {
    // Postgres TIMESTAMP(3) truncates sub-millisecond precision, and the
    // MQTT handler persists a full payload inside one prisma.$transaction()
    // — so when two rows from the same delivery land in the same millisecond
    // the (sensorId, sensorType, createdAt) OR-match returns both. The
    // /latest endpoint must collapse ties to one row per (sensor, sensorType).
    const sensor = await prismaClient.sensor.create({
      data: {
        controllerId: testControllerId,
        name: 'DHT22 Tied Timestamps',
        pinNumbers: [6],
        protocol: 'I2C',
        type: 'TEMP_HUMIDITY',
      },
    })

    const tiedTimestamp = new Date('2026-07-21T18:32:17.204Z')
    await prismaClient.$transaction([
      prismaClient.telemetry.create({
        data: {
          growCycleId: testGrowCycleId,
          sensorId: sensor.id,
          sensorType: 'TEMPERATURE',
          value: 20.5,
          createdAt: tiedTimestamp,
        },
      }),
      prismaClient.telemetry.create({
        data: {
          growCycleId: testGrowCycleId,
          sensorId: sensor.id,
          sensorType: 'TEMPERATURE',
          value: 20.5,
          createdAt: tiedTimestamp,
        },
      }),
      prismaClient.telemetry.create({
        data: {
          growCycleId: testGrowCycleId,
          sensorId: sensor.id,
          sensorType: 'HUMIDITY',
          value: 42.4,
        },
      }),
    ])

    const response = await app.inject({
      method: 'GET',
      url: `/api/telemetry/grow-cycle/${testGrowCycleId}/latest`,
    })

    const body: Array<{ sensorId: string; sensorType: string; value: number }> = JSON.parse(
      response.body,
    )

    assert.equal(response.statusCode, 200)
    const sensorRows = body.filter((r) => r.sensorId === sensor.id)
    assert.equal(sensorRows.length, 2, 'expected exactly one row per sensorType')
    const types = sensorRows.map((r) => r.sensorType).sort()
    assert.deepEqual(types, ['HUMIDITY', 'TEMPERATURE'])
  })
})
