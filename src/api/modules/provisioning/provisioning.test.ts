import { after, before, describe, test } from 'node:test'
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { createTestApp, teardownTestApp } from '../test-helper.js'
import { discoveryService } from '../../../services/DiscoveryService.js'
import type { ProvisionBeacon } from '../../../services/DiscoveryService.js'
import { mqttClient } from '../../../mqtt/client.js'

const MAC = 'AA:BB:CC:DD:EE:FF'
const POISON_MAC = 'AA:BB:CC:DD:EE:10'
const CAP_MAC = 'AA:BB:CC:DD:EE:11'
const STRICT_MAC = 'AA:BB:CC:DD:EE:12'
const EXPIRY_MAC = 'AA:BB:CC:DD:EE:13'
const FAIRNESS_MAC = 'AA:BB:CC:DD:EE:14'

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

async function sendBeacon(beacon: unknown, sourceIp = '127.0.0.1'): Promise<void> {
  const socket = dgram.createSocket('udp4')
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, sourceIp, () => {
      socket.send(JSON.stringify(beacon), 9999, '127.0.0.1', (error) => {
        socket.close()
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
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

async function waitForPin(pin: string, mac = MAC): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (discoveryService.getByMac(mac)?.beacon.claimPin === pin) {
      return
    }
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

  test('discovery ignores a different-PIN beacon from another source IP but accepts same-IP rotation', async () => {
    await sendBeacon(createBeacon({ claimPin: '111111', mac: POISON_MAC }), '127.0.0.2')
    await waitForPin('111111', POISON_MAC)

    await sendBeacon(createBeacon({ claimPin: '222222', mac: POISON_MAC }), '127.0.0.3')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const protectedSighting = discoveryService.getByMac(POISON_MAC)
    assert.equal(protectedSighting?.beacon.claimPin, '111111')
    assert.equal(protectedSighting?.ip, '127.0.0.2')

    await sendBeacon(createBeacon({ claimPin: '222222', mac: POISON_MAC }), '127.0.0.2')
    await waitForPin('222222', POISON_MAC)
    const rotatedSighting = discoveryService.getByMac(POISON_MAC)
    assert.equal(rotatedSighting?.beacon.claimPin, '222222')
    assert.equal(rotatedSighting?.ip, '127.0.0.2')
  })

  test('post-expiry takeover by a different IP is rejected until the source is quiet for a full TTL', async () => {
    const realNow = Date.now
    let now = realNow()
    Date.now = () => now
    try {
      await sendBeacon(
        createBeacon({ claimPin: '313131', mac: EXPIRY_MAC, pinExpiresAt: now + 100 }),
        '127.0.0.6',
      )
      await waitForPin('313131', EXPIRY_MAC)

      now += 101
      const takeover = createBeacon({
        claimPin: '424242',
        mac: EXPIRY_MAC,
        pinExpiresAt: now + 300_000,
      })
      await sendBeacon(takeover, '127.0.0.7')
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(discoveryService.getByMac(EXPIRY_MAC)?.beacon.claimPin, '313131')
      assert.equal(discoveryService.getByMac(EXPIRY_MAC)?.ip, '127.0.0.6')

      now += 120_001
      await sendBeacon(takeover, '127.0.0.7')
      await waitForPin('424242', EXPIRY_MAC)
      assert.equal(discoveryService.getByMac(EXPIRY_MAC)?.ip, '127.0.0.7')
    } finally {
      Date.now = realNow
    }
  })

  test('256 beacons from one source IP do not evict another source IP sighting', async () => {
    await sendBeacon(createBeacon({ mac: FAIRNESS_MAC }), '127.0.0.9')
    await waitForPin('123456', FAIRNESS_MAC)

    for (let index = 0; index < 256; index += 1) {
      const suffix = index.toString(16).toUpperCase().padStart(6, '0')
      const mac = `02:00:00:${suffix.slice(0, 2)}:${suffix.slice(2, 4)}:${suffix.slice(4, 6)}`
      await sendBeacon(createBeacon({ mac }), '127.0.0.10')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))

    assert.equal(discoveryService.getByMac(FAIRNESS_MAC)?.ip, '127.0.0.9')
    assert.ok(discoveryService.getAll().filter(({ ip }) => ip === '127.0.0.10').length <= 8)
  })

  test('discovery rejects oversized hardware manifests', async () => {
    const sensor = createBeacon().hwManifest.sensors[0]
    await sendBeacon(
      createBeacon({
        hwManifest: { relays: [], sensors: Array.from({ length: 33 }, () => sensor) },
        mac: CAP_MAC,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(discoveryService.getByMac(CAP_MAC), undefined)
  })

  test('discovery rejects non-string PIN and MAC fields', async () => {
    await sendBeacon({ ...createBeacon({ mac: STRICT_MAC }), claimPin: 123_456 })
    await sendBeacon({
      ...createBeacon({ serial: 'PIGROW-TYPECONFUSED' }),
      mac: [STRICT_MAC],
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    assert.equal(discoveryService.getByMac(STRICT_MAC), undefined)
    assert.ok(!(await scan(app)).some((controller) => controller.serial === 'PIGROW-TYPECONFUSED'))
  })

  test('POST /api/controllers/claim provisions the controller manifest and publishes credentials', async () => {
    await sendBeacon(createBeacon())
    await waitForPin('123456')
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
    assert.equal(Object.hasOwn(body.controller, 'claimPinHash'), false)
    assert.equal(Object.hasOwn(body.controller, 'mqttPasswordHash'), false)
    assert.equal(controller.name, 'Research Tent')
    assert.equal(controller.ipAddress, '127.0.0.1')
    assert.equal(controller.status, 'OFFLINE')
    assert.equal(controller.provisionState, 'ACTIVE')
    assert.equal(controller.deviceSerial, 'PIGROW-A1B2C3')
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

  test('POST /api/controllers/claim rejects a replayed PIN without rotating credentials', async () => {
    const before = await prismaClient.controller.findUniqueOrThrow({ where: { macAddress: MAC } })

    const response = await app.inject({
      method: 'POST',
      payload: { claimPin: '123456', mac: MAC, name: 'Replay Attempt' },
      url: '/api/controllers/claim',
    })

    assert.equal(response.statusCode, 409)
    const afterReplay = await prismaClient.controller.findUniqueOrThrow({
      where: { macAddress: MAC },
    })
    assert.equal(afterReplay.name, before.name)
    assert.equal(afterReplay.mqttPasswordHash, before.mqttPasswordHash)
    assert.equal(published.length, 1)
  })

  test('post-consume different-IP chosen-PIN cannot rotate credentials', async () => {
    const before = await prismaClient.controller.findUniqueOrThrow({ where: { macAddress: MAC } })
    await sendBeacon(createBeacon({ claimPin: '565656' }), '127.0.0.8')
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(discoveryService.getByMac(MAC), undefined)

    const takeover = await app.inject({
      method: 'POST',
      payload: { claimPin: '565656', mac: MAC, name: 'Takeover Attempt' },
      url: '/api/controllers/claim',
    })
    assert.equal(takeover.statusCode, 409)
    const afterTakeover = await prismaClient.controller.findUniqueOrThrow({
      where: { macAddress: MAC },
    })
    assert.equal(afterTakeover.mqttPasswordHash, before.mqttPasswordHash)
    assert.equal(published.length, 1)
  })

  test('POST /api/controllers/claim rejects a mismatched PIN', async () => {
    await sendBeacon(createBeacon({ claimPin: '222222' }))
    await waitForPin('222222')
    const response = await app.inject({
      method: 'POST',
      payload: { claimPin: '999999', mac: MAC, name: 'Research Tent' },
      url: '/api/controllers/claim',
    })

    assert.equal(response.statusCode, 401)
    assert.deepEqual(JSON.parse(response.body), { error: 'Claim PIN is invalid or expired' })
    assert.equal(published.length, 1)
  })

  test('POST /api/controllers/claim limits PIN guesses until a fresh PIN beacon arrives', async () => {
    await sendBeacon(createBeacon({ claimPin: '333333' }))
    await waitForPin('333333')

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await app.inject({
        method: 'POST',
        payload: { claimPin: '000000', mac: MAC, name: 'Research Tent' },
        url: '/api/controllers/claim',
      })
      assert.equal(failed.statusCode, 401)
    }

    const limited = await app.inject({
      method: 'POST',
      payload: { claimPin: '333333', mac: MAC, name: 'Research Tent' },
      url: '/api/controllers/claim',
    })
    assert.equal(limited.statusCode, 429)
    assert.ok(Number(limited.headers['retry-after']) > 0)
    assert.equal(published.length, 1)

    await sendBeacon(createBeacon({ claimPin: '444444' }))
    await waitForPin('444444')
    const recovered = await app.inject({
      method: 'POST',
      payload: { claimPin: '444444', mac: MAC, name: 'Research Tent' },
      url: '/api/controllers/claim',
    })
    assert.equal(recovered.statusCode, 200)
    assert.equal(published.length, 2)
  })

  test('POST /api/controllers/claim rejects an expired PIN', async () => {
    await sendBeacon(createBeacon({ claimPin: '555555', pinExpiresAt: Date.now() - 1 }))
    await waitForPin('555555')

    const scanResponse = await scan(app)
    assert.equal(
      scanResponse.find((controller: { mac: string }) => controller.mac === MAC)?.pinActive,
      false,
    )
    const response = await app.inject({
      method: 'POST',
      payload: { claimPin: '555555', mac: MAC, name: 'Research Tent' },
      url: '/api/controllers/claim',
    })

    assert.equal(response.statusCode, 401)
    assert.equal(published.length, 2)
  })

  test('POST /api/controllers/claim rejects an unknown MAC', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: { claimPin: '123456', mac: 'AA:BB:CC:DD:EE:00', name: 'Unknown Tent' },
      url: '/api/controllers/claim',
    })

    assert.equal(response.statusCode, 404)
    assert.equal(published.length, 2)
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
    assert.equal(published.length, 3)
    const reclaim = JSON.parse(published[2].payload)
    assert.notEqual(reclaim.mqttPassword, firstClaim.mqttPassword)
  })

  test('POST /api/controllers/claim reuses a manually renamed sensor', async () => {
    const controller = await prismaClient.controller.findUniqueOrThrow({
      where: { macAddress: MAC },
    })
    const sensor = await prismaClient.sensor.findFirstOrThrow({
      where: { controllerId: controller.id, pinNumbers: { equals: [1, 118] } },
    })
    const rename = await app.inject({
      method: 'PUT',
      payload: { name: 'Canopy Climate' },
      url: `/api/sensors/${sensor.id}`,
    })
    assert.equal(rename.statusCode, 200)
    const beforeCount = await prismaClient.sensor.count({ where: { controllerId: controller.id } })

    await sendBeacon(createBeacon({ claimPin: '765432' }))
    await waitForPin('765432')
    const response = await app.inject({
      method: 'POST',
      payload: { claimPin: '765432', mac: MAC, name: 'Research Tent Reclaimed' },
      url: '/api/controllers/claim',
    })

    assert.equal(response.statusCode, 200)
    assert.equal(
      await prismaClient.sensor.count({ where: { controllerId: controller.id } }),
      beforeCount,
    )
    const afterReclaim = await prismaClient.sensor.findUniqueOrThrow({ where: { id: sensor.id } })
    assert.equal(afterReclaim.name, 'Canopy Climate')
  })

  test('POST /api/controllers/claim provisions GPIO sensors by pin match key', async () => {
    const beacon = createBeacon({
      claimPin: '888888',
      hwManifest: {
        relays: [{ name: 'Main Light', pin: 17, type: 'LIGHT' }],
        sensors: [
          ...createBeacon().hwManifest.sensors,
          { interval: 10, pin: 4, protocol: 'GPIO', type: 'TEMPERATURE' },
        ],
      },
    })
    await sendBeacon(beacon)
    await waitForPin('888888')

    const response = await app.inject({
      method: 'POST',
      payload: { claimPin: '888888', mac: MAC, name: 'Research Tent Reclaimed' },
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

  test('POST /api/controllers/claim allows only one concurrent claim for a PIN generation', async () => {
    await sendBeacon(createBeacon({ claimPin: '999999' }))
    await waitForPin('999999')
    const beforePublishCount = published.length
    const before = await prismaClient.controller.findUniqueOrThrow({ where: { macAddress: MAC } })

    const responses = await Promise.all([
      app.inject({
        method: 'POST',
        payload: { claimPin: '999999', mac: MAC, name: 'Concurrent Winner' },
        url: '/api/controllers/claim',
      }),
      app.inject({
        method: 'POST',
        payload: { claimPin: '999999', mac: MAC, name: 'Concurrent Loser' },
        url: '/api/controllers/claim',
      }),
    ])

    const statusCodes = responses.map((response) => response.statusCode)
    // ES2022 lacks immutable array sorting; statusCodes is local to this assertion.
    // oxlint-disable-next-line unicorn/no-array-sort
    statusCodes.sort((left, right) => left - right)
    assert.deepEqual(statusCodes, [200, 409])
    assert.equal(published.length, beforePublishCount + 1)
    const afterConcurrent = await prismaClient.controller.findUniqueOrThrow({
      where: { macAddress: MAC },
    })
    assert.notEqual(afterConcurrent.mqttPasswordHash, before.mqttPasswordHash)
  })
})
