import { Type } from '@sinclair/typebox'
import { ErrorSchema } from '../../shared/schemas.js'

const ManifestSensorSchema = Type.Object({
  i2cAddr: Type.Optional(Type.Integer()),
  i2cBus: Type.Optional(Type.Integer()),
  interval: Type.Integer({ minimum: 1 }),
  pin: Type.Optional(Type.Integer()),
  protocol: Type.String(),
  type: Type.String(),
})

const ManifestRelaySchema = Type.Object({
  name: Type.Optional(Type.String()),
  pin: Type.Integer(),
  type: Type.String(),
})

const ClaimedSensorSchema = Type.Object({
  ...ManifestSensorSchema.properties,
  id: Type.String({ format: 'uuid' }),
})

const ClaimedDeviceSchema = Type.Object({
  ...ManifestRelaySchema.properties,
  id: Type.String({ format: 'uuid' }),
})

const HardwareManifestSchema = Type.Object({
  relays: Type.Array(ManifestRelaySchema),
  sensors: Type.Array(ManifestSensorSchema),
})

const DiscoveredControllerSchema = Type.Object({
  fwVersion: Type.String(),
  hwManifest: HardwareManifestSchema,
  ip: Type.String(),
  mac: Type.String(),
  pinActive: Type.Boolean(),
  serial: Type.String(),
})

const NullableString = Type.Union([Type.String(), Type.Null()])
const NullableDateTime = Type.Union([Type.String({ format: 'date-time' }), Type.Null()])

const ProvisionedControllerSchema = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
  deviceSerial: NullableString,
  id: Type.String({ format: 'uuid' }),
  ipAddress: Type.String(),
  lastBeaconAt: NullableDateTime,
  macAddress: Type.String(),
  mqttUsername: NullableString,
  name: Type.String(),
  pinExpiresAt: NullableDateTime,
  provisionState: Type.Union([
    Type.Literal('UNCLAIMED'),
    Type.Literal('ACTIVE'),
    Type.Literal('INACTIVE'),
  ]),
  status: Type.String(),
  updatedAt: Type.String({ format: 'date-time' }),
})

export const ScanResponseSchema = Type.Object({
  controllers: Type.Array(DiscoveredControllerSchema),
})

export const ClaimBodySchema = Type.Object({
  claimPin: Type.String(),
  ip: Type.Optional(Type.String()),
  mac: Type.String(),
  name: Type.String({ maxLength: 100, minLength: 1 }),
})

export const ClaimResponseSchema = Type.Object({
  controller: ProvisionedControllerSchema,
  devices: Type.Array(ClaimedDeviceSchema),
  sensors: Type.Array(ClaimedSensorSchema),
})

export { ErrorSchema }
