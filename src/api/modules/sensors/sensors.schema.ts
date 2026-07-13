import { Type } from '@sinclair/typebox'
import { ErrorSchema } from '../../shared/schemas.js'

export const SensorTypeSchema = Type.Union([
  Type.Literal('HUMIDITY'),
  Type.Literal('TEMPERATURE'),
  Type.Literal('TEMP_HUMIDITY'),
  Type.Literal('CO2'),
  Type.Literal('PH'),
  Type.Literal('EC'),
])

export const SensorProtocolSchema = Type.Union([
  Type.Literal('I2C'),
  Type.Literal('SPI'),
  Type.Literal('UART'),
  Type.Literal('RS485'),
])

export const SensorResponseSchema = Type.Object({
  controllerId: Type.String({ format: 'uuid' }),
  createdAt: Type.String({ format: 'date-time' }),
  id: Type.String({ format: 'uuid' }),
  lastActive: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
  name: Type.String(),
  pinNumbers: Type.Array(Type.Integer()),
  protocol: SensorProtocolSchema,
  type: SensorTypeSchema,
  updatedAt: Type.String({ format: 'date-time' }),
})

export const SensorDetailResponseSchema = Type.Object({
  ...SensorResponseSchema.properties,
  controller: Type.Object({
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    status: Type.String(),
  }),
})

export const SensorArrayResponseSchema = Type.Array(SensorResponseSchema)

export const SensorParamsIdSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

export const SensorParamsControllerIdSchema = Type.Object({
  controllerId: Type.String({ format: 'uuid' }),
})

export const CreateSensorSchema = Type.Object({
  controllerId: Type.String({ format: 'uuid' }),
  name: Type.String({ maxLength: 100 }),
  pinNumbers: Type.Array(Type.Integer({ maximum: 40, minimum: 0 })),
  protocol: SensorProtocolSchema,
  type: SensorTypeSchema,
})

export const UpdateSensorSchema = Type.Object({
  lastActive: Type.Optional(
    Type.String({
      description: 'ISO 8601 timestamp. Server-managed in normal flow.',
      format: 'date-time',
    }),
  ),
  name: Type.Optional(Type.String({ maxLength: 100 })),
  pinNumbers: Type.Optional(Type.Array(Type.Integer({ maximum: 40, minimum: 0 }))),
  protocol: Type.Optional(SensorProtocolSchema),
  type: Type.Optional(SensorTypeSchema),
})

export { ErrorSchema }
