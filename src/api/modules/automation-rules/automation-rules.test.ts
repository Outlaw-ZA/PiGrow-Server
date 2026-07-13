import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { createTestApp, teardownTestApp } from '../test-helper.js'

describe('Automation Rules API Feature Module', () => {
  let app: any
  let prismaClient: any
  let controllerId: string
  let growCycleId: string
  let growPhaseId: string
  let lightId: string
  let fanId: string
  let heaterId: string

  const mac = `66:77:88:99:aa:${Date.now().toString(16).slice(-2)}`

  before(async () => {
    const { server, prisma } = await createTestApp()
    app = server
    prismaClient = prisma

    const controller = await prismaClient.controller.create({
      data: {
        growCycles: {
          create: {
            isActive: true,
            name: 'Auto Cycle',
            phases: {
              create: {
                dayDurationMinutes: 1080,
                dayStartMinutes: 360,
                durationDays: 30,
                isActive: true,
                name: 'Veg',
                order: 1,
              },
            },
          },
        },
        ipAddress: '192.168.1.120',
        macAddress: mac,
        name: 'Automation Test Pi',
      },
      include: { growCycles: { include: { phases: true } } },
    })

    controllerId = controller.id
    growCycleId = controller.growCycles[0].id
    growPhaseId = controller.growCycles[0].phases[0].id

    const light = await prismaClient.device.create({
      data: {
        automationMode: 'SCHEDULED',
        controllerId,
        name: 'Light',
        pinNumber: 4,
        type: 'LIGHT',
      },
    })
    const fan = await prismaClient.device.create({
      data: {
        automationMode: 'THRESHOLD',
        controllerId,
        name: 'Exhaust Fan',
        pinNumber: 17,
        type: 'EXHAUST_FAN',
      },
    })
    const heater = await prismaClient.device.create({
      data: {
        automationMode: 'THRESHOLD',
        controllerId,
        name: 'Heater',
        pinNumber: 27,
        type: 'HEATER',
      },
    })
    lightId = light.id
    fanId = fan.id
    heaterId = heater.id
  })

  after(async () => {
    await prismaClient.automationRule.deleteMany({
      where: { device: { controllerId } },
    })
    await prismaClient.deviceStateLog.deleteMany({
      where: { device: { controllerId } },
    })
    await prismaClient.device.deleteMany({ where: { controllerId } })
    await prismaClient.growCycle.deleteMany({
      where: { controller: { macAddress: mac } },
    })
    await prismaClient.controller.deleteMany({ where: { macAddress: mac } })
    await teardownTestApp(app)
  })

  test('POST /api/automation-rules - Should reject a rule targeting a LIGHT device', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'ABOVE_MAX',
        deviceId: lightId,
        growPhaseId,
        period: 'DAY',
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /LIGHT devices are not eligible/)
  })

  test('POST /api/automation-rules - Should reject SCHEDULE_ON condition on any device', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'SCHEDULE_ON',
        deviceId: fanId,
        growPhaseId,
        period: 'DAY',
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /SCHEDULE_ON\/SCHEDULE_OFF conditions are no longer supported/)
  })

  test('POST /api/automation-rules - Should reject SCHEDULE_OFF condition on any device', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'OFF',
        condition: 'SCHEDULE_OFF',
        deviceId: fanId,
        growPhaseId,
        period: 'NIGHT',
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /SCHEDULE_ON\/SCHEDULE_OFF conditions are no longer supported/)
  })

  test('POST /api/automation-rules - Should reject when both growCycleId and growPhaseId are set', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'ABOVE_MAX',
        deviceId: fanId,
        growCycleId,
        growPhaseId,
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /Exactly one/)
  })

  test('POST /api/automation-rules - Should reject when neither scope is set', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'ABOVE_MAX',
        deviceId: fanId,
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /Exactly one/)
  })

  test('POST /api/automation-rules - Should create a phase-scoped threshold rule (fan ABOVE_MAX on temp)', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'ABOVE_MAX',
        deviceId: fanId,
        growPhaseId,
        period: 'DAY',
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.condition, 'ABOVE_MAX')
  })

  test('POST /api/automation-rules - Should create a phase-scoped threshold rule (heater BELOW_MIN on temp)', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'BELOW_MIN',
        deviceId: heaterId,
        growPhaseId,
        period: 'NIGHT',
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    assert.equal(response.statusCode, 201)
  })

  test('GET /api/automation-rules/grow-phase/:id - Should list rules for a phase', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/automation-rules/grow-phase/${growPhaseId}`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.length, 2)
  })

  test('GET /api/automation-rules/grow-cycle/:id - Should list cycle-scoped rules (none in this suite)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/automation-rules/grow-cycle/${growCycleId}`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.length, 0)
  })

  test('GET /api/automation-rules/device/:id - Should list rules for a device', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/automation-rules/device/${fanId}`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.length, 1)
    assert.equal(body[0].deviceId, fanId)
  })

  test('PATCH /api/automation-rules/:id/toggle - Should flip the enabled flag', async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { deviceId: fanId },
    })

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/automation-rules/${list.id}/toggle`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.id, list.id)
    assert.equal(body.enabled, false)

    // Toggle back
    const response2 = await app.inject({
      method: 'PATCH',
      url: `/api/automation-rules/${list.id}/toggle`,
    })
    const body2 = JSON.parse(response2.body)
    assert.equal(body2.enabled, true)
  })

  test("PUT /api/automation-rules/:id - Should update a rule's cooldown", async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { deviceId: heaterId },
    })

    const response = await app.inject({
      method: 'PUT',
      payload: { cooldownSeconds: 600 },
      url: `/api/automation-rules/${list.id}`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.cooldownSeconds, 600)
  })

  test('PUT /api/automation-rules/:id - Should reject updating deviceId to a LIGHT device', async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { deviceId: heaterId },
    })

    const response = await app.inject({
      method: 'PUT',
      payload: { deviceId: lightId },
      url: `/api/automation-rules/${list.id}`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /LIGHT devices are not eligible/)

    // Confirm the rule was not mutated.
    const after = await prismaClient.automationRule.findUnique({
      where: { id: list.id },
    })
    assert.equal(after.deviceId, heaterId)
  })

  test('PUT /api/automation-rules/:id - Should reject updating condition to SCHEDULE_OFF', async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { deviceId: fanId },
    })

    const response = await app.inject({
      method: 'PUT',
      payload: { condition: 'SCHEDULE_OFF' },
      url: `/api/automation-rules/${list.id}`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /SCHEDULE_ON\/SCHEDULE_OFF conditions are no longer supported/)

    // Confirm the rule's condition was not mutated.
    const after = await prismaClient.automationRule.findUnique({
      where: { id: list.id },
    })
    assert.equal(after.condition, 'ABOVE_MAX')
  })

  // ---------- ALWAYS_ON / ALWAYS_OFF rule conditions ----------

  test('POST /api/automation-rules - Should create an ALWAYS_ON rule (no sensor type, action ON)', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'ALWAYS_ON',
        deviceId: heaterId,
        growPhaseId,
        period: null,
        watchedSensorType: null,
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.condition, 'ALWAYS_ON')
    assert.equal(body.action, 'ON')
    assert.equal(body.watchedSensorType, null)
    assert.equal(body.period, null)
  })

  test('POST /api/automation-rules - Should create an ALWAYS_OFF rule scoped to NIGHT', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'OFF',
        condition: 'ALWAYS_OFF',
        deviceId: fanId,
        growPhaseId,
        period: 'NIGHT',
        watchedSensorType: null,
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.condition, 'ALWAYS_OFF')
    assert.equal(body.action, 'OFF')
    assert.equal(body.period, 'NIGHT')
  })

  test('POST /api/automation-rules - Should reject ALWAYS_ON with a mismatched action', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'OFF',
        condition: 'ALWAYS_ON',
        deviceId: fanId,
        growPhaseId,
        watchedSensorType: null,
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /action must be ON for condition ALWAYS_ON/)
  })

  test('POST /api/automation-rules - Should reject ALWAYS_OFF with a mismatched action', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'ALWAYS_OFF',
        deviceId: fanId,
        growPhaseId,
        watchedSensorType: null,
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /action must be OFF for condition ALWAYS_OFF/)
  })

  test('POST /api/automation-rules - Should reject ALWAYS_ON with a watchedSensorType set', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'ALWAYS_ON',
        deviceId: fanId,
        growPhaseId,
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /watchedSensorType must be null for ALWAYS_ON \/ ALWAYS_OFF rules/)
  })

  test('POST /api/automation-rules - Should reject ABOVE_MAX with a null watchedSensorType', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'ABOVE_MAX',
        deviceId: fanId,
        growPhaseId,
        watchedSensorType: null,
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /watchedSensorType is required for threshold conditions/)
  })

  test('POST /api/automation-rules - Should reject an ALWAYS_ON rule targeting a LIGHT device', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'ALWAYS_ON',
        deviceId: lightId,
        growPhaseId,
        watchedSensorType: null,
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /LIGHT devices are not eligible/)
  })

  test('PUT /api/automation-rules/:id - Should reject changing a threshold rule to ALWAYS_OFF without clearing watchedSensorType', async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { condition: 'BELOW_MIN', deviceId: heaterId },
    })
    assert.ok(list, 'heater BELOW_MIN rule should exist from earlier test')

    const response = await app.inject({
      method: 'PUT',
      payload: { action: 'OFF', condition: 'ALWAYS_OFF' },
      url: `/api/automation-rules/${list.id}`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /watchedSensorType must be null for ALWAYS_ON \/ ALWAYS_OFF rules/)

    // Confirm the rule was not mutated.
    const after = await prismaClient.automationRule.findUnique({
      where: { id: list.id },
    })
    assert.equal(after.condition, 'BELOW_MIN')
  })

  test('PUT /api/automation-rules/:id - Should allow converting a threshold rule to ALWAYS_ON (clearing watchedSensorType)', async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { condition: 'BELOW_MIN', deviceId: heaterId },
    })
    assert.ok(list, 'heater BELOW_MIN rule should still exist from earlier test')

    const response = await app.inject({
      method: 'PUT',
      payload: {
        action: 'ON',
        condition: 'ALWAYS_ON',
        watchedSensorType: null,
      },
      url: `/api/automation-rules/${list.id}`,
    })
    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 200)
    assert.equal(body.condition, 'ALWAYS_ON')
    assert.equal(body.action, 'ON')
    assert.equal(body.watchedSensorType, null)
  })

  test('DELETE /api/automation-rules/:id - Should remove a rule', async () => {
    const list = await prismaClient.automationRule.findFirst({
      where: { deviceId: heaterId },
    })
    assert.ok(list)

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/automation-rules/${list.id}`,
    })
    assert.equal(response.statusCode, 204)
  })

  // ---------- ABOVE_MIN / BELOW_MAX / ABOVE_TARGET / BELOW_TARGET rule conditions ----------

  test('POST /api/automation-rules - Should create a rule with BELOW_MAX condition', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'OFF',
        condition: 'BELOW_MAX',
        deviceId: fanId,
        growPhaseId,
        period: 'DAY',
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.condition, 'BELOW_MAX')
    assert.equal(body.action, 'OFF')
  })

  test('POST /api/automation-rules - Should create a rule with ABOVE_MIN condition', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'OFF',
        condition: 'ABOVE_MIN',
        deviceId: heaterId,
        growPhaseId,
        period: 'NIGHT',
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.condition, 'ABOVE_MIN')
  })

  test('POST /api/automation-rules - Should create a rule with ABOVE_TARGET condition', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'ABOVE_TARGET',
        deviceId: fanId,
        growPhaseId,
        period: 'DAY',
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.condition, 'ABOVE_TARGET')
  })

  test('POST /api/automation-rules - Should create a rule with BELOW_TARGET condition', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'BELOW_TARGET',
        deviceId: heaterId,
        growPhaseId,
        period: 'NIGHT',
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.condition, 'BELOW_TARGET')
  })

  // ---------- INTERVAL rule conditions (duty-cycle schedules) ----------

  test('POST /api/automation-rules - Should create an INTERVAL rule (fan 30s ON every 5 min)', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'INTERVAL',
        deviceId: fanId,
        growPhaseId,
        intervalCycleSeconds: 300,
        intervalOnSeconds: 30,
        period: 'DAY',
        watchedSensorType: null,
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 201)
    assert.equal(body.condition, 'INTERVAL')
    assert.equal(body.action, 'ON')
    assert.equal(body.watchedSensorType, null)
    assert.equal(body.intervalOnSeconds, 30)
    assert.equal(body.intervalCycleSeconds, 300)
  })

  test('POST /api/automation-rules - Should reject INTERVAL with action OFF', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'OFF',
        condition: 'INTERVAL',
        deviceId: heaterId,
        growPhaseId,
        intervalCycleSeconds: 60,
        intervalOnSeconds: 10,
        watchedSensorType: null,
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /action must be ON for condition INTERVAL/)
  })

  test('POST /api/automation-rules - Should reject INTERVAL with watchedSensorType set', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'INTERVAL',
        deviceId: heaterId,
        growPhaseId,
        intervalCycleSeconds: 60,
        intervalOnSeconds: 10,
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /watchedSensorType must be null for INTERVAL rules/)
  })

  test('POST /api/automation-rules - Should reject INTERVAL missing intervalOnSeconds', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'INTERVAL',
        deviceId: heaterId,
        growPhaseId,
        intervalCycleSeconds: 60,
        watchedSensorType: null,
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /intervalOnSeconds is required for INTERVAL rules/)
  })

  test('POST /api/automation-rules - Should reject INTERVAL missing intervalCycleSeconds', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'INTERVAL',
        deviceId: heaterId,
        growPhaseId,
        intervalOnSeconds: 10,
        watchedSensorType: null,
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /intervalCycleSeconds is required for INTERVAL rules/)
  })

  test('POST /api/automation-rules - Should reject INTERVAL when cycleSeconds <= onSeconds', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'INTERVAL',
        deviceId: heaterId,
        growPhaseId,
        intervalCycleSeconds: 60,
        intervalOnSeconds: 60,
        watchedSensorType: null,
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /intervalCycleSeconds must be greater than intervalOnSeconds/)
  })

  test('POST /api/automation-rules - Should reject INTERVAL on a LIGHT device', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'INTERVAL',
        deviceId: lightId,
        growPhaseId,
        intervalCycleSeconds: 60,
        intervalOnSeconds: 10,
        watchedSensorType: null,
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(body.error, /LIGHT devices are not eligible/)
  })

  test('POST /api/automation-rules - Should reject interval fields on a non-INTERVAL rule', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        action: 'ON',
        condition: 'ABOVE_MAX',
        deviceId: heaterId,
        growPhaseId,
        intervalCycleSeconds: 60,
        intervalOnSeconds: 10,
        watchedSensorType: 'TEMPERATURE',
      },
      url: '/api/automation-rules',
    })

    const body = JSON.parse(response.body)
    assert.equal(response.statusCode, 400)
    assert.match(
      body.error,
      /intervalOnSeconds and intervalCycleSeconds must be null for non-INTERVAL rules/,
    )
  })
})
