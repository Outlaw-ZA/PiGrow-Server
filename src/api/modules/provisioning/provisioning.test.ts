import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { createTestApp, teardownTestApp } from '../test-helper.js'
import { discoveryService } from '../../../services/DiscoveryService.js';
import type { ProvisionBeacon } from '../../../services/DiscoveryService.js';
import { mqttClient } from '../../../mqtt/client.js'

const MAC = 'AA:BB:CC:DD:EE:FF'

function createBeacon(overrides: Partial<ProvisionBeacon> = {}): ProvisionBeacon {
  return {
    claimPin: '123456',
    fwVersion: '0.4.0',
    hwManifest: {
      relays: [{ name: 'Main Light', pin: 17, type: 'LIGHT' }],
      sensors: [
        {
          i2cAddr: 118,
          i2cBus: 1,
          interval: 30,
          protocol: 'I2C',
          type: 'BME280',
        },
      ],
    },
    ip: '192.168.1.42',
    mac: MAC,
    pinExpiresAt: Date.now() + 300_000,
    schema: 1,
    serial: 'PIGROW-A1B2C3',
    ...overrides,
  }
}

async function sendBeacon(beacon: ProvisionBeacon): Promise<void> {
  const socket = dgram.createSocket('udp4')
  await new Promise<void>((resolve, reject) => {
    socket.send(JSON.stringify(beacon), 9999, '127.0.0.1', (error) => {
      socket.close()
      if (error) {reject(error)}
      else {resolve()}
    })
  })
}

async function scan(app: any): Promise<any[]> {
  const response = await app.inject({ method: 'GET', url: '/api/controllers/scan' })
  assert.equal(response.statusCode, 200)
  return JSON.parse(response.body).controllers
}

async function waitForSighting(app: any): Promise<any[]> {
  let controllers: any[] = []
  for (let attempt = 0; attempt < 20 && controllers.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    controllers = await scan(app)
  }
  return controllers
}

async function waitForPin(pin: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (discoveryService.getByMac(MAC)?.beacon.claimPin === pin) {return}
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail(`Beacon PIN ${pin} was not received`)
}

describe('Controller provisioning API', () => {
  let app: any
  let prismaClient: any
  let originalPublish: typeof mqttClient.publish
  const published: { options: any; payload: string; topic: string }[] = []

  before(async () => {
    const testApp = await createTestApp()
    app = testApp.server
    prismaClient = testApp.prisma
    await prismaClient.controller.deleteMany({ where: { macAddress: MAC } })
    originalPublish = mqttClient.publish
    ;(mqttClient as any).publish = (
      topic: string,
      payload: string,
      options: any,
      callback?: () => void,
    ) => {
      published.push({ options, payload: String(payload), topic })
      callback?.()
      return mqttClient
    }
    await discoveryService.start()
  })

  after(async () => {
    discoveryService.stop()
    ;(mqttClient as any).publish = originalPublish
    await prismaClient.controller.deleteMany({ where: { macAddress: MAC } })
    await teardownTestApp(app)
  })

  test('GET /api/controllers/scan returns the discovery cache', async () => {
    assert.deepEqual(await scan(app), [])
  })

  test('UDP beacons appear in scan results with packet source IP and active PIN state', async () => {
    const beacon = createBeacon()
    await sendBeacon(beacon)
    const controllers = await waitForSighting(app)

    assert.equal(controllers.length, 1)
    assert.deepEqual(controllers[0], {
      fwVersion: beacon.fwVersion,
      hwManifest: beacon.hwManifest,
      ip: '127.0.0.1',
      mac: beacon.mac,
      pinActive: true,
      serial: beacon.serial,
    })
  })

  test('POST /api/controllers/claim provisions the controller manifest and publishes credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: { claimPin: '123456', mac: MAC, name: 'Research Tent' },
      url: '/api/controllers/claim',
    })

    assert.equal(response.statusCode, 201)
    const body = JSON.parse(response.body)
    const controller = await prismaClient.controller.findUniqueOrThrow({
      include: { devices: true, sensors: true },
      where: { macAddress: MAC },
    })
    assert.equal(body.controller.id, controller.id)
    assert.equal(controller.name, 'Research Tent')
    assert.equal(controller.ipAddress, '127.0.0.1')
    assert.equal(controller.status, 'OFFLINE')
    assert.equal(controller.provisionState, 'ACTIVE')
    assert.equal(controller.deviceSerial, 'PIGROW-A1B2C3')
    assert.equal(controller.claimPinHash, null)
    assert.equal(controller.pinExpiresAt, null)
    assert.ok(controller.lastBeaconAt instanceof Date)
    assert.equal(controller.mqttUsername, `pigrow-${controller.id}`)
    assert.match(controller.mqttPasswordHash, /^scrypt\$/)
    assert.deepEqual(
      controller.sensors.map((sensor: any) => ({
        name: sensor.name,
        pinNumbers: sensor.pinNumbers,
        protocol: sensor.protocol,
        type: sensor.type,
      })),
      [
        {
          name: 'BME280',
          pinNumbers: [1, 118],
          protocol: 'I2C',
          type: 'TEMP_HUMIDITY',
        },
      ],
    )
    assert.deepEqual(
      controller.devices.map((device: any) => ({
        automationMode: device.automationMode,
        isActive: device.isActive,
        maxOnSeconds: device.maxOnSeconds,
        name: device.name,
        pinNumber: device.pinNumber,
        type: device.type,
      })),
      [
        {
          automationMode: 'SCHEDULED',
          isActive: false,
          maxOnSeconds: 7200,
          name: 'Main Light',
          pinNumber: 17,
          type: 'LIGHT',
        },
      ],
    )

    assert.equal(published.length, 1)
    assert.equal(published[0].topic, `provision/${MAC}/claim`)
    assert.deepEqual(published[0].options, { qos: 1, retain: false })
    const claimResponse = JSON.parse(published[0].payload)
    assert.equal(claimResponse.schema, 1)
    assert.equal(claimResponse.controllerId, controller.id)
    assert.equal(claimResponse.controllerMac, MAC)
    assert.equal(claimResponse.mqttUsername, controller.mqttUsername)
    assert.equal(claimResponse.mqttPassword.length, 24)
    assert.equal(
      claimResponse.mqttBrokerUrl,
      process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883',
    )
    assert.equal(
      claimResponse.serverHttpUrl,
      process.env.SERVER_HTTP_URL || 'http://localhost:4000',
    )
    assert.equal(typeof claimResponse.pairedAt, 'number')
    assert.ok(!JSON.stringify(controller).includes(claimResponse.mqttPassword))
  })

  test('POST /api/controllers/claim rejects a mismatched PIN', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: { claimPin: '999999', mac: MAC, name: 'Research Tent' },
      url: '/api/controllers/claim',
    })

    assert.equal(response.statusCode, 401)
    assert.deepEqual(JSON.parse(response.body), { error: 'Claim PIN is invalid or expired' })
    assert.equal(published.length, 1)
  })

  test('POST /api/controllers/claim rejects an expired PIN', async () => {
    await sendBeacon(createBeacon({ claimPin: '333333', pinExpiresAt: Date.now() - 1 }))
    await waitForPin('333333')

    const scanResponse = await scan(app)
    assert.equal(scanResponse[0].pinActive, false)
    const response = await app.inject({
      method: 'POST',
      payload: { claimPin: '333333', mac: MAC, name: 'Research Tent' },
      url: '/api/controllers/claim',
    })

    assert.equal(response.statusCode, 401)
    assert.equal(published.length, 1)
  })

  test('POST /api/controllers/claim rejects an unknown MAC', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: { claimPin: '123456', mac: 'AA:BB:CC:DD:EE:00', name: 'Unknown Tent' },
      url: '/api/controllers/claim',
    })

    assert.equal(response.statusCode, 404)
    assert.equal(published.length, 1)
  })

  test('POST /api/controllers/claim reclaims by upsert without duplicate hardware rows', async () => {
    await sendBeacon(createBeacon({ claimPin: '654321' }))
    await waitForPin('654321')
    const beforeSensors = await prismaClient.sensor.count({
      where: { controller: { macAddress: MAC } },
    })
    const beforeDevices = await prismaClient.device.count({
      where: { controller: { macAddress: MAC } },
    })
    const firstClaim = JSON.parse(published[0].payload)

    const response = await app.inject({
      method: 'POST',
      payload: { claimPin: '654321', mac: MAC, name: 'Research Tent Reclaimed' },
      url: '/api/controllers/claim',
    })

    assert.equal(response.statusCode, 200)
    assert.equal(
      await prismaClient.sensor.count({ where: { controller: { macAddress: MAC } } }),
      beforeSensors,
    )
    assert.equal(
      await prismaClient.device.count({ where: { controller: { macAddress: MAC } } }),
      beforeDevices,
    )
    assert.equal(
      (await prismaClient.controller.findUniqueOrThrow({ where: { macAddress: MAC } })).name,
      'Research Tent Reclaimed',
    )
    assert.equal(published.length, 2)
    const reclaim = JSON.parse(published[1].payload)
    assert.notEqual(reclaim.mqttPassword, firstClaim.mqttPassword)
  })

  test('POST /api/controllers/claim provisions GPIO sensors by pin match key', async () => {
    const beacon = createBeacon({
      claimPin: '777777',
      hwManifest: {
        relays: [{ name: 'Main Light', pin: 17, type: 'LIGHT' }],
        sensors: [
          ...createBeacon().hwManifest.sensors,
          { interval: 10, pin: 4, protocol: 'GPIO', type: 'TEMPERATURE' },
        ],
      },
    })
    await sendBeacon(beacon)
    await waitForPin('777777')

    const response = await app.inject({
      method: 'POST',
      payload: { claimPin: '777777', mac: MAC, name: 'Research Tent Reclaimed' },
      url: '/api/controllers/claim',
    })

    assert.equal(response.statusCode, 200)
    const controller = await prismaClient.controller.findUniqueOrThrow({
      where: { macAddress: MAC },
    })
    const gpioSensor = await prismaClient.sensor.findFirstOrThrow({
      where: { controllerId: controller.id, pinNumbers: { equals: [4] }, protocol: 'GPIO' },
    })
    assert.equal(gpioSensor.type, 'TEMPERATURE')
    assert.equal(gpioSensor.name, 'TEMPERATURE')
  })
})
