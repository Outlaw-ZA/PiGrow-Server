import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, teardownTestApp } from '../test-helper.js'

describe('Devices API Feature Module', () => {
  let app: any
  let prismaClient: any
  let testControllerId: string

  const mac = `00:1a:2b:3c:4d:${Date.now().toString(16).slice(-2)}`

  before(async () => {
    const { server, prisma } = await createTestApp()
    app = server
    prismaClient = prisma

    const controller = await prismaClient.controller.create({
      data: {
        ipAddress: '192.168.1.100',
        macAddress: mac,
        name: 'Hardware Module Test Pi',
      },
    })
    testControllerId = controller.id
  })

  after(async () => {
    await prismaClient.device.deleteMany({
      where: { controllerId: testControllerId },
    })
    await prismaClient.controller.delete({
      where: { id: testControllerId },
    })
    await teardownTestApp(app)
  })

  test('POST /devices - Should provision a relay channel assignment onto a controller', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        controllerId: testControllerId,
        mqttTopic: 'tent1/device/light/cmd',
        name: 'SpiderFarmer LED Panel',
        pinNumber: 4,
        type: 'LIGHT',
      },
      url: '/api/devices',
    })

    const body = JSON.parse(response.body)

    assert.equal(response.statusCode, 201)
    assert.equal(body.controllerId, testControllerId)
    assert.equal(body.pinNumber, 4)
    assert.equal(body.automationMode, 'MANUAL')
    assert.equal(body.isActive, true)
  })

  test('GET /devices/controller/:id - Should list persistent hardware for a controller', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/devices/controller/${testControllerId}`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.ok(Array.isArray(body))
    assert.ok(body.some((d: { name: string }) => d.name === 'SpiderFarmer LED Panel'))
  })

  test('GET /devices/:id - Should return a single device with parent controller', async () => {
    const list = await prismaClient.device.findFirst({
      where: { controllerId: testControllerId },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/api/devices/${list.id}`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.id, list.id)
    assert.ok(body.controller, 'Expected nested controller')
    assert.equal(body.controller.id, testControllerId)
  })

  test('PUT /devices/:id - Should update device automation mode', async () => {
    const list = await prismaClient.device.findFirst({
      where: { controllerId: testControllerId },
    })

    const response = await app.inject({
      method: 'PUT',
      payload: { automationMode: 'SCHEDULED' },
      url: `/api/devices/${list.id}`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.automationMode, 'SCHEDULED')
  })

  test('POST /devices/batch - Should bulk provision multiple devices', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        controllerId: testControllerId,
        devices: [
          {
            name: 'Exhaust Fan',
            type: 'EXHAUST_FAN',
            pinNumber: 17,
            mqttTopic: 'tent1/fan',
          },
          {
            name: 'Heater',
            type: 'HEATER',
            pinNumber: 27,
            mqttTopic: 'tent1/heater',
            automationMode: 'THRESHOLD',
          },
        ],
      },
      url: '/api/devices/batch',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.length, 2)
    assert.equal(body[0].automationMode, 'MANUAL')
    assert.equal(body[1].automationMode, 'THRESHOLD')
  })
})
