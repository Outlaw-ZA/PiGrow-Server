import dgram from 'node:dgram'
import type { RemoteInfo, Socket } from 'node:dgram'

const DISCOVERY_PORT = 9999
const MAX_BEACON_BYTES = 8192
const MAX_MANIFEST_ITEMS = 32
const MAX_SIGHTINGS = 256
const MAX_SIGHTINGS_PER_SOURCE = 8
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
  failedAttempts: number
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
    typeof beacon.mac === 'string' &&
    /^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(beacon.mac) &&
    typeof beacon.ip === 'string' &&
    typeof beacon.fwVersion === 'string' &&
    typeof beacon.claimPin === 'string' &&
    /^\d{6}$/.test(beacon.claimPin) &&
    typeof beacon.pinExpiresAt === 'number' &&
    Number.isFinite(beacon.pinExpiresAt) &&
    manifest !== undefined &&
    manifest !== null &&
    Array.isArray(manifest.sensors) &&
    manifest.sensors.length <= MAX_MANIFEST_ITEMS &&
    manifest.sensors.every(isManifestSensor) &&
    Array.isArray(manifest.relays) &&
    manifest.relays.length <= MAX_MANIFEST_ITEMS &&
    manifest.relays.every(isManifestRelay)
  )
}

export class DiscoveryService {
  private readonly sightings = new Map<string, ControllerSighting>()
  private readonly claiming = new Set<string>()
  private readonly consumed = new Map<
    string,
    { claimPin: string; pinExpiresAt: number; sourceIp: string }
  >()
  private readonly sourceBindings = new Map<string, { ip: string; lastSeenAt: number }>()
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
    this.claiming.clear()
    this.consumed.clear()
    this.sightings.clear()
    this.sourceBindings.clear()
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

  beginClaim(
    mac: string,
  ):
    | { status: 'ready'; sighting: ControllerSighting }
    | { retryAfterSeconds: number; status: 'limited' }
    | { status: 'conflict' }
    | { status: 'missing' } {
    this.sweep()
    const key = mac.toUpperCase()
    if (this.claiming.has(key) || this.consumed.has(key)) {
      return { status: 'conflict' }
    }
    const sighting = this.sightings.get(key)
    if (!sighting) {
      return { status: 'missing' }
    }
    if (sighting.failedAttempts >= 5 && sighting.beacon.pinExpiresAt > Date.now()) {
      return {
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((sighting.beacon.pinExpiresAt - Date.now()) / 1000),
        ),
        status: 'limited',
      }
    }
    this.claiming.add(key)
    return { sighting, status: 'ready' }
  }

  recordFailedAttempt(mac: string): void {
    const sighting = this.sightings.get(mac.toUpperCase())
    if (sighting) {
      sighting.failedAttempts += 1
    }
  }

  releaseClaim(mac: string): void {
    this.claiming.delete(mac.toUpperCase())
  }

  consume(mac: string): ControllerSighting | undefined {
    this.sweep()
    const key = mac.toUpperCase()
    const sighting = this.sightings.get(key)
    if (!sighting) {
      this.claiming.delete(key)
      return undefined
    }
    this.sightings.delete(key)
    this.claiming.delete(key)
    if (!this.consumed.has(key) && this.consumed.size >= MAX_SIGHTINGS) {
      const oldestKey = this.consumed.keys().next().value
      if (oldestKey) {
        this.consumed.delete(oldestKey)
      }
    }
    this.consumed.set(key, {
      claimPin: sighting.beacon.claimPin,
      pinExpiresAt: sighting.beacon.pinExpiresAt,
      sourceIp: this.sourceBindings.get(key)?.ip ?? sighting.ip,
    })
    return sighting
  }

  private receive(message: Buffer, remote: RemoteInfo): void {
    if (message.length > MAX_BEACON_BYTES) {
      return
    }
    try {
      const beacon: unknown = JSON.parse(message.toString('utf8'))
      if (!isProvisionBeacon(beacon)) {
        return
      }
      this.sweep()
      const now = Date.now()
      const binding = this.sourceBindings.get(beacon.mac)
      if (binding && binding.ip !== remote.address && now - binding.lastSeenAt < SIGHTING_TTL_MS) {
        return
      }
      if (binding?.ip === remote.address) {
        binding.lastSeenAt = now
      }

      const consumed = this.consumed.get(beacon.mac)
      if (consumed?.claimPin === beacon.claimPin && consumed.pinExpiresAt > now) {
        return
      }
      if (this.claiming.has(beacon.mac)) {
        return
      }

      const existing = this.sightings.get(beacon.mac)
      if (!this.makeRoomFor(beacon.mac, remote.address)) {
        return
      }

      this.consumed.delete(beacon.mac)
      this.sourceBindings.set(beacon.mac, { ip: remote.address, lastSeenAt: now })
      this.sightings.set(beacon.mac, {
        beacon,
        failedAttempts: existing?.beacon.claimPin === beacon.claimPin ? existing.failedAttempts : 0,
        ip: remote.address,
        seenAt: now,
      })
    } catch {
      return
    }
  }

  private makeRoomFor(mac: string, sourceIp: string): boolean {
    if (this.sightings.has(mac)) {
      return true
    }

    const sourceEntries = [...this.sightings.entries()].filter(
      ([, sighting]) => sighting.ip === sourceIp,
    )
    if (sourceEntries.length >= MAX_SIGHTINGS_PER_SOURCE) {
      const knownSource = this.sourceBindings.get(mac)?.ip === sourceIp
      if (!knownSource) {
        return false
      }
      const oldestFromSource = sourceEntries
        .filter(([entryMac]) => !this.claiming.has(entryMac))
        // ES2022 lacks immutable array sorting; sourceEntries is already a disposable copy.
        // oxlint-disable-next-line unicorn/no-array-sort
        .sort((left, right) => left[1].seenAt - right[1].seenAt)[0]
      if (!oldestFromSource) {
        return false
      }
      this.sightings.delete(oldestFromSource[0])
      this.sourceBindings.delete(oldestFromSource[0])
    }

    if (this.sightings.size < MAX_SIGHTINGS) {
      return true
    }

    const candidates = [...this.sightings.entries()].filter(
      ([entryMac]) => !this.claiming.has(entryMac),
    )
    if (candidates.length === 0) {
      return false
    }
    const countsBySource = new Map<string, number>()
    for (const [, sighting] of candidates) {
      countsBySource.set(sighting.ip, (countsBySource.get(sighting.ip) ?? 0) + 1)
    }
    const largestSourceCount = Math.max(...countsBySource.values())
    const oldestFromLargestSource = candidates
      .filter(([, sighting]) => countsBySource.get(sighting.ip) === largestSourceCount)
      // ES2022 lacks immutable array sorting; candidates is already a disposable copy.
      // oxlint-disable-next-line unicorn/no-array-sort
      .sort((left, right) => left[1].seenAt - right[1].seenAt)[0]
    this.sightings.delete(oldestFromLargestSource[0])
    this.sourceBindings.delete(oldestFromLargestSource[0])
    return true
  }

  private sweep(): void {
    const cutoff = Date.now() - SIGHTING_TTL_MS
    for (const [mac, sighting] of this.sightings) {
      if (sighting.seenAt <= cutoff && !this.claiming.has(mac)) {
        this.sightings.delete(mac)
      }
    }
    for (const [mac, consumed] of this.consumed) {
      if (consumed.pinExpiresAt <= Date.now()) {
        this.consumed.delete(mac)
      }
    }
    for (const [mac, binding] of this.sourceBindings) {
      if (Date.now() - binding.lastSeenAt >= SIGHTING_TTL_MS && !this.claiming.has(mac)) {
        this.sourceBindings.delete(mac)
      }
    }
  }
}

export const discoveryService = new DiscoveryService()
