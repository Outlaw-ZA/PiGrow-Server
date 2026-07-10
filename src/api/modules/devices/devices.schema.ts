import { Type } from '@sinclair/typebox'
import { ErrorSchema } from '../../shared/schemas.js'

const DeviceTypeEnum = Type.Union([
  Type.Literal('LIGHT'),
  Type.Literal('EXHAUST_FAN'),
  Type.Literal('INTAKE_FAN'),
  Type.Literal('CIRCULATION_FAN'),
  Type.Literal('WATER_PUMP'),
  Type.Literal('AIR_CONDITIONER'),
  Type.Literal('HEATER'),
  Type.Literal('HUMIDIFIER'),
  Type.Literal('DEHUMIDIFIER'),
  Type.Literal('CO2_INJECTOR'),
])

const AutomationModeEnum = Type.Union([
  Type.Literal('MANUAL'),
  Type.Literal('SCHEDULED'),
  Type.Literal('THRESHOLD'),
  Type.Literal('ALWAYS_ON'),
  Type.Literal('ALWAYS_OFF'),
])

const DeviceBody = Type.Object({
  automationMode: Type.Optional(Type.Union([AutomationModeEnum], { default: 'MANUAL' })),
  isActive: Type.Optional(Type.Boolean({ default: true })),
  mqttTopic: Type.String({ maxLength: 150 }),
  name: Type.String({ maxLength: 100 }),
  pinNumber: Type.Integer({ minimum: 0, maximum: 40 }),
  type: DeviceTypeEnum,
})

export const DeviceResponseSchema = Type.Object({
  automationMode: AutomationModeEnum,
  controllerId: Type.String({ format: 'uuid' }),
  createdAt: Type.String({ format: 'date-time' }),
  id: Type.String({ format: 'uuid' }),
  isActive: Type.Boolean(),
  mqttTopic: Type.String(),
  name: Type.String(),
  pinNumber: Type.Integer(),
  type: DeviceTypeEnum,
  updatedAt: Type.String({ format: 'date-time' }),
})

export const DeviceDetailResponseSchema = Type.Object({
  ...DeviceResponseSchema.properties,
  controller: Type.Object({
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    status: Type.String(),
  }),
})

export const DeviceArrayResponseSchema = Type.Array(DeviceResponseSchema)

export const DeviceCommandResponseSchema = Type.Object({
  action: Type.Union([Type.Literal('ON'), Type.Literal('OFF')]),
  deviceId: Type.String({ format: 'uuid' }),
  timestamp: Type.String({ format: 'date-time' }),
})

export const CreateDeviceSchema = Type.Object({
  automationMode: Type.Optional(AutomationModeEnum),
  controllerId: Type.String({
    format: 'uuid',
    description: 'UUID of the parent Controller that owns this device',
  }),
  isActive: Type.Optional(Type.Boolean({ default: true })),
  mqttTopic: Type.String({ maxLength: 150 }),
  name: Type.String({ maxLength: 100 }),
  pinNumber: Type.Integer({ minimum: 0, maximum: 40 }),
  type: DeviceTypeEnum,
})

export const BatchCreateDeviceSchema = Type.Object({
  controllerId: Type.String({ format: 'uuid' }),
  devices: Type.Array(DeviceBody, { minItems: 1 }),
})

export const UpdateDeviceSchema = Type.Object({
  automationMode: Type.Optional(AutomationModeEnum),
  isActive: Type.Optional(Type.Boolean()),
  mqttTopic: Type.Optional(Type.String({ maxLength: 150 })),
  name: Type.Optional(Type.String({ maxLength: 100 })),
  pinNumber: Type.Optional(Type.Integer({ minimum: 0, maximum: 40 })),
  type: Type.Optional(DeviceTypeEnum),
})

export const DeviceCommandSchema = Type.Object({
  action: Type.Union([Type.Literal('ON'), Type.Literal('OFF')]),
})

export const DeviceParamsIdSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

export const DeviceParamsControllerIdSchema = Type.Object({
  controllerId: Type.String({ format: 'uuid' }),
})

export { ErrorSchema }
