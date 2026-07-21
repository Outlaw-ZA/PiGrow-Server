import { Type } from '@sinclair/typebox'

const PeriodSchema = Type.Union([Type.Literal('DAY'), Type.Literal('NIGHT')])

const NullableNumber = Type.Optional(Type.Union([Type.Number(), Type.Null()]))

export const PhaseEnvironmentSchema = Type.Object({
  co2Max: NullableNumber,
  co2Min: NullableNumber,
  co2Target: NullableNumber,
  createdAt: Type.String({ format: 'date-time' }),
  growPhaseId: Type.String({ format: 'uuid' }),
  humidityMax: NullableNumber,
  humidityMin: NullableNumber,
  humidityTarget: NullableNumber,
  id: Type.String({ format: 'uuid' }),
  period: PeriodSchema,
  phMax: NullableNumber,
  phMin: NullableNumber,
  phTarget: NullableNumber,
  tempMax: NullableNumber,
  tempMin: NullableNumber,
  tempTarget: NullableNumber,
  updatedAt: Type.String({ format: 'date-time' }),
})
