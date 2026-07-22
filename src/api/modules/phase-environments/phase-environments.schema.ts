import { Type } from '@sinclair/typebox'
import { ErrorSchema } from '../../shared/schemas.js'

const PeriodParam = Type.Union([Type.Literal('DAY'), Type.Literal('NIGHT')])

const NullableNumber = Type.Optional(Type.Union([Type.Number(), Type.Null()]))

export const PhaseEnvironmentResponseSchema = Type.Object({
  co2Max: NullableNumber,
  co2Min: NullableNumber,
  co2Target: NullableNumber,
  createdAt: Type.String({ format: 'date-time' }),
  growPhaseId: Type.String({ format: 'uuid' }),
  humidityMax: NullableNumber,
  humidityMin: NullableNumber,
  humidityTarget: NullableNumber,
  id: Type.String({ format: 'uuid' }),
  period: PeriodParam,
  tempMax: NullableNumber,
  tempMin: NullableNumber,
  tempTarget: NullableNumber,
  updatedAt: Type.String({ format: 'date-time' }),
})

export const PhaseEnvironmentPairResponseSchema = Type.Object({
  day: Type.Union([PhaseEnvironmentResponseSchema, Type.Null()]),
  growPhaseId: Type.String({ format: 'uuid' }),
  night: Type.Union([PhaseEnvironmentResponseSchema, Type.Null()]),
})

export const PhaseEnvironmentPeriodParamsSchema = Type.Object({
  growPhaseId: Type.String({ format: 'uuid' }),
  period: PeriodParam,
})

export const PhaseEnvironmentPhaseParamsSchema = Type.Object({
  growPhaseId: Type.String({ format: 'uuid' }),
})

export const UpsertPhaseEnvironmentSchema = Type.Object({
  co2Max: NullableNumber,
  co2Min: NullableNumber,
  co2Target: NullableNumber,
  humidityMax: NullableNumber,
  humidityMin: NullableNumber,
  humidityTarget: NullableNumber,
  tempMax: NullableNumber,
  tempMin: NullableNumber,
  tempTarget: NullableNumber,
})

export { ErrorSchema }
