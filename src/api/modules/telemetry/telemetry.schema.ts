import { Type } from '@sinclair/typebox'
import { ErrorSchema } from '../../shared/schemas.js'

export const TelemetrySensorTypeSchema = Type.Union([
  Type.Literal('HUMIDITY'),
  Type.Literal('TEMPERATURE'),
  Type.Literal('TEMP_HUMIDITY'),
  Type.Literal('CO2'),
  Type.Literal('PH'),
  Type.Literal('EC'),
])

export const TelemetryResponseSchema = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
  growCycleId: Type.String({ format: 'uuid' }),
  id: Type.String({ format: 'uuid' }),
  sensor: Type.Object({
    id: Type.String({ format: 'uuid' }),
    name: Type.String(),
    protocol: Type.Union([
      Type.Literal('I2C'),
      Type.Literal('SPI'),
      Type.Literal('UART'),
      Type.Literal('RS485'),
    ]),
    type: TelemetrySensorTypeSchema,
  }),
  sensorId: Type.String({ format: 'uuid' }),
  sensorType: TelemetrySensorTypeSchema,
  value: Type.Number(),
})

export const TelemetryArrayResponseSchema = Type.Array(TelemetryResponseSchema)

export const CreateTelemetrySchema = Type.Object({
  growCycleId: Type.String({
    description: 'The grow cycle this telemetry reading belongs to',
    format: 'uuid',
  }),
  sensorId: Type.String({
    description: 'The physical sensor that produced this reading',
    format: 'uuid',
  }),
  sensorType: TelemetrySensorTypeSchema,
  value: Type.Number({
    description: 'The sensor reading value',
  }),
})

export const TelemetryParamsGrowCycleIdSchema = Type.Object({
  growCycleId: Type.String({ format: 'uuid' }),
})

export const TelemetryRangeQuerySchema = Type.Object({
  from: Type.String({
    description: 'ISO 8601 start timestamp (inclusive)',
    format: 'date-time',
  }),
  to: Type.String({
    description: 'ISO 8601 end timestamp (inclusive)',
    format: 'date-time',
  }),
})

export { ErrorSchema }
