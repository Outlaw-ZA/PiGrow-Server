import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type {
  AutomationMode,
  DeviceType,
  SensorProtocol,
  SensorType,
} from '../../../generated/client/enums.js'
import { MQTT_BROKER_URL, mqttClient } from '../../../mqtt/client.js'
import { discoveryService } from '../../../services/DiscoveryService.js'
import type { ManifestRelay, ManifestSensor } from '../../../services/DiscoveryService.js'

const DEFAULT_MAX_ON_SECONDS = 7200
const SERVER_HTTP_URL = process.env.SERVER_HTTP_URL || 'http://localhost:4000'
const DEVICE_TYPES = new Set([
  'LIGHT',
  'EXHAUST_FAN',
  'INTAKE_FAN',
  'CIRCULATION_FAN',
  'WATER_PUMP',
  'AIR_CONDITIONER',
  'HEATER',
  'HUMIDIFIER',
  'DEHUMIDIFIER',
  'CO2_INJECTOR',
])
const SENSOR_TYPES = new Set(['HUMIDITY', 'TEMPERATURE', 'TEMP_HUMIDITY', 'CO2', 'PH', 'EC'])
const SENSOR_PROTOCOLS = new Set(['I2C', 'SPI', 'UART', 'RS485', 'GPIO', 'ONE_WIRE'])
const SENSOR_PROTOCOL_ALIASES: Record<string, string> = {
  '1WIRE': 'ONE_WIRE',
  ONEWIRE: 'ONE_WIRE',
}
const SENSOR_TYPE_ALIASES: Record<string, string> = {
  BME280: 'TEMP_HUMIDITY',
}

type DeviceTypeValue = (typeof DeviceType)[keyof typeof DeviceType]
type AutomationModeValue = (typeof AutomationMode)[keyof typeof AutomationMode]
type SensorTypeValue = (typeof SensorType)[keyof typeof SensorType]
type SensorProtocolValue = (typeof SensorProtocol)[keyof typeof SensorProtocol]

interface ClaimInput {
  mac: string
  claimPin: string
  name: string
}

export class ProvisioningError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 401 | 404 | 409 | 429,
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
  }
}

function matchesClaimPin(supplied: string, expected: string): boolean {
  const suppliedBuffer = Buffer.from(supplied, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  )
}

function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32)
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

function normalizeSensorType(type: string): SensorTypeValue {
  const normalized = SENSOR_TYPE_ALIASES[type] ?? type
  if (!SENSOR_TYPES.has(normalized)) {
    throw new ProvisioningError(`Unsupported sensor type: ${type}`, 400)
  }
  return normalized as SensorTypeValue
}

function normalizeSensorProtocol(protocol: string): SensorProtocolValue {
  const normalized = SENSOR_PROTOCOL_ALIASES[protocol] ?? protocol
  if (!SENSOR_PROTOCOLS.has(normalized)) {
    throw new ProvisioningError(`Unsupported sensor protocol: ${protocol}`, 400)
  }
  return normalized as SensorProtocolValue
}

function sensorPins(sensor: ManifestSensor): number[] {
  if (sensor.protocol === 'I2C') {
    if (sensor.i2cBus === undefined || sensor.i2cAddr === undefined) {
      throw new ProvisioningError('I2C sensors require i2cBus and i2cAddr', 400)
    }
    return [sensor.i2cBus, sensor.i2cAddr]
  }
  if (sensor.pin === undefined) {
    throw new ProvisioningError(`${sensor.protocol} sensors require pin`, 400)
  }
  return [sensor.pin]
}

function normalizeDeviceType(type: string): DeviceTypeValue {
  if (!DEVICE_TYPES.has(type)) {
    throw new ProvisioningError(`Unsupported relay type: ${type}`, 400)
  }
  return type as DeviceTypeValue
}

function defaultAutomationMode(type: DeviceTypeValue): AutomationModeValue {
  return (type === 'LIGHT' ? 'SCHEDULED' : 'MANUAL') as AutomationModeValue
}

function defaultRelayName(relay: ManifestRelay): string {
  const typeName = relay.type
    .toLowerCase()
    .split('_')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
  return `${typeName} ${relay.pin}`
}

export class ProvisioningController {
  private readonly prisma

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma
  }

  async claim(body: ClaimInput) {
    const lease = discoveryService.beginClaim(body.mac)
    if (lease.status === 'missing') {
      throw new ProvisioningError('Controller not found in discovery cache', 404)
    }
    if (lease.status === 'conflict') {
      throw new ProvisioningError('Controller claim already consumed or in progress', 409)
    }
    if (lease.status === 'limited') {
      throw new ProvisioningError('Too many failed claim attempts', 429, lease.retryAfterSeconds)
    }
    const { sighting } = lease

    const pinMatches = matchesClaimPin(body.claimPin, sighting.beacon.claimPin)
    if (!pinMatches || sighting.beacon.pinExpiresAt <= Date.now()) {
      if (!pinMatches) {
        discoveryService.recordFailedAttempt(body.mac)
      }
      discoveryService.releaseClaim(body.mac)
      throw new ProvisioningError('Claim PIN is invalid or expired', 401)
    }

    const mqttPassword = randomBytes(18).toString('base64url')
    const mqttPasswordHash = hashPassword(mqttPassword)
    const pairedAt = Date.now()
    const lastBeaconAt = new Date(pairedAt)
    const normalizedMac = sighting.beacon.mac

    let result
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.controller.findUnique({
          select: { id: true },
          where: { macAddress: normalizedMac },
        })

        const controller = existing
          ? await tx.controller.update({
              data: {
                deviceSerial: sighting.beacon.serial,
                lastBeaconAt,
                name: body.name,
                pinExpiresAt: null,
                provisionState: 'ACTIVE',
              },
              where: { macAddress: normalizedMac },
            })
          : await tx.controller.create({
              data: {
                deviceSerial: sighting.beacon.serial,
                ipAddress: sighting.ip,
                lastBeaconAt,
                macAddress: normalizedMac,
                name: body.name,
                pinExpiresAt: null,
                provisionState: 'ACTIVE',
                status: 'OFFLINE',
              },
            })

        for (const sensor of sighting.beacon.hwManifest.sensors) {
          const type = normalizeSensorType(sensor.type)
          const protocol = normalizeSensorProtocol(sensor.protocol)
          const pinNumbers = sensorPins(sensor)
          const existingSensor = await tx.sensor.findFirst({
            select: { id: true },
            where: {
              controllerId: controller.id,
              pinNumbers: { equals: pinNumbers },
              protocol,
              type,
            },
          })

          if (existingSensor) {
            await tx.sensor.update({
              data: { pinNumbers, protocol, type },
              where: { id: existingSensor.id },
            })
          } else {
            await tx.sensor.create({
              data: {
                controllerId: controller.id,
                id: randomUUID(),
                name: sensor.type,
                pinNumbers,
                protocol,
                type,
              },
            })
          }
        }

        for (const relay of sighting.beacon.hwManifest.relays) {
          const type = normalizeDeviceType(relay.type)
          const data = {
            automationMode: defaultAutomationMode(type),
            isActive: false,
            maxOnSeconds: DEFAULT_MAX_ON_SECONDS,
            name: relay.name ?? defaultRelayName(relay),
            pinNumber: relay.pin,
            type,
          }
          const existingDevice = await tx.device.findFirst({
            select: { id: true },
            where: { controllerId: controller.id, pinNumber: relay.pin },
          })

          if (existingDevice) {
            await tx.device.update({ data, where: { id: existingDevice.id } })
          } else {
            await tx.device.create({
              data: { ...data, controllerId: controller.id, id: randomUUID() },
            })
          }
        }

        const mqttUsername = `pigrow-${controller.id}`
        const claimedController = await tx.controller.update({
          data: { mqttPasswordHash, mqttUsername },
          where: { id: controller.id },
        })

        return { controller: claimedController, created: !existing }
      })
    } catch (error) {
      discoveryService.releaseClaim(normalizedMac)
      throw error
    }

    if (!discoveryService.consume(normalizedMac)) {
      throw new ProvisioningError('Controller claim already consumed or in progress', 409)
    }

    mqttClient.publish(
      `provision/${normalizedMac}/claim`,
      JSON.stringify({
        controllerId: result.controller.id,
        controllerMac: normalizedMac,
        mqttBrokerUrl: MQTT_BROKER_URL,
        mqttPassword,
        mqttUsername: result.controller.mqttUsername,
        pairedAt,
        schema: 1,
        serverHttpUrl: SERVER_HTTP_URL,
      }),
      { qos: 1, retain: false },
    )

    return result
  }
}
