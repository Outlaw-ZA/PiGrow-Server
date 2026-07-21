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
    // LIGHT now defaults to SCHEDULED (so the grow-phase clock drives it
    // Without the user picking an automation mode first). Non-LIGHT types
    // Still default to MANUAL — see the second test in this file for the
    // Explicit batch path with EXHAUST_FAN (default MANUAL) + HEATER
    // (default THRESHOLD).
    assert.equal(body.automationMode, 'SCHEDULED')
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

  test('GET /devices/:id/state-logs - Should return state logs for a device within a time range', async () => {
    const list = await prismaClient.device.findFirst({
      where: { controllerId: testControllerId },
    })

    // Create a test state log
    await prismaClient.deviceStateLog.create({
      data: { action: 'ON', deviceId: list.id, source: 'MANUAL' },
    })

    await prismaClient.deviceStateLog.create({
      data: { action: 'OFF', deviceId: list.id, reason: 'test range', source: 'AUTO' },
    })

    const now = new Date()
    const from = new Date(now.getTime() - 3_600_000).toISOString() // 1 hour ago
    const to = now.toISOString()

    const response = await app.inject({
      method: 'GET',
      url: `/api/devices/${list.id}/state-logs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.ok(Array.isArray(body.logs))
    assert.equal(body.logs.length, 2)
    assert.equal(body.logs[0].action, 'ON')
    assert.equal(body.logs[1].action, 'OFF')
    assert.ok('priorAction' in body)
  })

  test('GET /devices/:id/state-logs - Should return priorAction when query has from', async () => {
    const list = await prismaClient.device.findFirst({
      where: { controllerId: testControllerId },
    })

    // Log from before the time range
    await prismaClient.deviceStateLog.create({
      data: {
        action: 'ON',
        createdAt: new Date(Date.now() - 86_400_000),
        deviceId: list.id,
        source: 'MANUAL',
      },
    })

    const from = new Date(Date.now() - 3_600_000).toISOString()
    const to = new Date().toISOString()

    const response = await app.inject({
      method: 'GET',
      url: `/api/devices/${list.id}/state-logs?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.priorAction, 'ON')
  })

  test('POST /devices/batch - Should bulk provision multiple devices', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        controllerId: testControllerId,
        devices: [
          {
            name: 'Exhaust Fan',
            pinNumber: 17,
            type: 'EXHAUST_FAN',
          },
          {
            automationMode: 'THRESHOLD',
            name: 'Heater',
            pinNumber: 27,
            type: 'HEATER',
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
