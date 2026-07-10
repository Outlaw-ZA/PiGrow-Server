import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, teardownTestApp } from '../test-helper.js'

describe('Sensors API Feature Module', () => {
  let app: any
  let prismaClient: any
  let controllerId: string

  const mac = 'b8:27:eb:bf:d3:99'

  before(async () => {
    const { server, prisma } = await createTestApp()
    app = server
    prismaClient = prisma

    // Provision a fresh controller for sensor tests
    const created = await prismaClient.controller.create({
      data: {
        ipAddress: '192.168.1.199',
        macAddress: mac,
        name: 'Sensor Test Pi',
        status: 'OFFLINE',
      },
    })
    controllerId = created.id
  })

  after(async () => {
    await prismaClient.sensor.deleteMany({ where: { controllerId } })
    await prismaClient.controller.deleteMany({ where: { macAddress: mac } })
    await teardownTestApp(app)
  })

  test('POST /api/sensors - Should register a new sensor on a controller', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        controllerId,
        mqttTopic: 'tent1/sensor/ambient',
        name: 'DHT22 Ambient',
        pinNumbers: [4],
        protocol: 'I2C',
        type: 'TEMP_HUMIDITY',
      },
      url: '/api/sensors',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.controllerId, controllerId)
    assert.equal(body.type, 'TEMP_HUMIDITY')
    assert.equal(body.protocol, 'I2C')
    assert.deepEqual(body.pinNumbers, [4])
    assert.equal(body.lastActive, null)
    assert.ok(body.id, 'Expected a generated UUID')
  })

  test('GET /api/sensors/controller/:id - Should list sensors for a controller', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/sensors/controller/${controllerId}`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.ok(Array.isArray(body))
    assert.ok(body.length > 0, 'Expected at least one sensor from prior test')
    assert.equal(body[0].controllerId, controllerId)
  })

  test('GET /api/sensors/:id - Should return the sensor with its controller', async () => {
    const list = await prismaClient.sensor.findFirst({
      where: { controllerId },
    })
    const response = await app.inject({
      method: 'GET',
      url: `/api/sensors/${list.id}`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.id, list.id)
    assert.ok(body.controller, 'Expected nested controller')
    assert.equal(body.controller.id, controllerId)
  })

  test('PUT /api/sensors/:id - Should update sensor configuration', async () => {
    const list = await prismaClient.sensor.findFirst({
      where: { controllerId },
    })

    const response = await app.inject({
      method: 'PUT',
      payload: {
        name: 'DHT22 (renamed)',
        pinNumbers: [4, 17],
      },
      url: `/api/sensors/${list.id}`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.name, 'DHT22 (renamed)')
    assert.deepEqual(body.pinNumbers, [4, 17])
  })

  test('DELETE /api/sensors/:id - Should remove a sensor and return 204', async () => {
    const sensor = await prismaClient.sensor.create({
      data: {
        controllerId,
        mqttTopic: 'tent1/sensor/ph',
        name: 'Throwaway',
        pinNumbers: [],
        protocol: 'UART',
        type: 'PH',
      },
    })

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/sensors/${sensor.id}`,
    })

    assert.equal(response.statusCode, 204)

    const after = await prismaClient.sensor.findUnique({
      where: { id: sensor.id },
    })
    assert.equal(after, null)
  })
})
