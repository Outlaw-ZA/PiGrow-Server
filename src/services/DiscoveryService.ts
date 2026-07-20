import dgram from 'node:dgram'
import type { RemoteInfo, Socket } from 'node:dgram'

const DISCOVERY_PORT = 9999
const SIGHTING_TTL_MS = 120_000

export interface ManifestSensor {
  type: string
  protocol: string
  i2cBus?: number
  i2cAddr?: number
  pin?: number
  interval: number
}

export interface ManifestRelay {
  type: string
  pin: number
  name?: string
}

export interface ProvisionBeacon {
  schema: 1
  serial: string
  mac: string
  ip: string
  fwVersion: string
  claimPin: string
  pinExpiresAt: number
  hwManifest: {
    sensors: ManifestSensor[]
    relays: ManifestRelay[]
  }
}

export interface DiscoveredController {
  mac: string
  ip: string
  serial: string
  fwVersion: string
  pinActive: boolean
  hwManifest: ProvisionBeacon['hwManifest']
}

export interface ControllerSighting {
  beacon: ProvisionBeacon
  seenAt: number
  ip: string
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function isManifestSensor(value: unknown): value is ManifestSensor {
  if (!value || typeof value !== 'object') {
    return false
  }
  const sensor = value as Record<string, unknown>
  return (
    typeof sensor.type === 'string' &&
    typeof sensor.protocol === 'string' &&
    isInteger(sensor.interval) &&
    sensor.interval > 0 &&
    (sensor.i2cBus === undefined || isInteger(sensor.i2cBus)) &&
    (sensor.i2cAddr === undefined || isInteger(sensor.i2cAddr)) &&
    (sensor.pin === undefined || isInteger(sensor.pin))
  )
}

function isManifestRelay(value: unknown): value is ManifestRelay {
  if (!value || typeof value !== 'object') {
    return false
  }
  const relay = value as Record<string, unknown>
  return (
    typeof relay.type === 'string' &&
    isInteger(relay.pin) &&
    (relay.name === undefined || typeof relay.name === 'string')
  )
}

function isProvisionBeacon(value: unknown): value is ProvisionBeacon {
  if (!value || typeof value !== 'object') {
    return false
  }
  const beacon = value as Record<string, unknown>
  const manifest = beacon.hwManifest as Record<string, unknown> | undefined

  return (
    beacon.schema === 1 &&
    typeof beacon.serial === 'string' &&
    /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(String(beacon.mac)) &&
    typeof beacon.ip === 'string' &&
    typeof beacon.fwVersion === 'string' &&
    /^\d{6}$/.test(String(beacon.claimPin)) &&
    typeof beacon.pinExpiresAt === 'number' &&
    Number.isFinite(beacon.pinExpiresAt) &&
    manifest !== undefined &&
    Array.isArray(manifest.sensors) &&
    manifest.sensors.every(isManifestSensor) &&
    Array.isArray(manifest.relays) &&
    manifest.relays.every(isManifestRelay)
  )
}

export class DiscoveryService {
  private readonly sightings = new Map<string, ControllerSighting>()
  private socket: Socket | undefined
  private sweepTimer: NodeJS.Timeout | undefined

  async start(): Promise<void> {
    if (this.socket) {
      return
    }

    const socket = dgram.createSocket({ reuseAddr: true, type: 'udp4' })
    this.socket = socket
    socket.on('message', (message, remote) => this.receive(message, remote))
    socket.on('error', (error) => console.error('[discovery] UDP listener error:', error))

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        socket.off('listening', onListening)
        this.socket = undefined
        reject(error)
      }
      const onListening = () => {
        socket.off('error', onError)
        resolve()
      }
      socket.once('error', onError)
      socket.once('listening', onListening)
      socket.bind(DISCOVERY_PORT, '0.0.0.0')
    })

    this.sweepTimer = setInterval(() => this.sweep(), SIGHTING_TTL_MS)
    this.sweepTimer.unref()
  }

  stop(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
    }
    this.sweepTimer = undefined
    if (this.socket) {
      this.socket.close()
    }
    this.socket = undefined
    this.sightings.clear()
  }

  getAll(): DiscoveredController[] {
    this.sweep()
    return [...this.sightings.values()].map(({ beacon, ip }) => ({
      fwVersion: beacon.fwVersion,
      hwManifest: beacon.hwManifest,
      ip,
      mac: beacon.mac,
      pinActive: beacon.pinExpiresAt > Date.now(),
      serial: beacon.serial,
    }))
  }

  getByMac(mac: string): ControllerSighting | undefined {
    this.sweep()
    return this.sightings.get(mac.toUpperCase())
  }

  private receive(message: Buffer, remote: RemoteInfo): void {
    try {
      const beacon: unknown = JSON.parse(message.toString('utf8'))
      if (!isProvisionBeacon(beacon)) {
        return
      }
      this.sightings.set(beacon.mac, { beacon, ip: remote.address, seenAt: Date.now() })
    } catch {
      return
    }
  }

  private sweep(): void {
    const cutoff = Date.now() - SIGHTING_TTL_MS
    for (const [mac, sighting] of this.sightings) {
      if (sighting.seenAt <= cutoff) {
        this.sightings.delete(mac)
      }
    }
  }
}

export const discoveryService = new DiscoveryService()
