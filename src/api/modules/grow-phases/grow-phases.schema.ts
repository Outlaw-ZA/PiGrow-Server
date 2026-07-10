import { Type } from '@sinclair/typebox'
import { ErrorSchema } from '../../shared/schemas.js'

const PeriodSchema = Type.Union([Type.Literal('DAY'), Type.Literal('NIGHT')])

const NullableNumber = Type.Optional(Type.Union([Type.Number(), Type.Null()]))

const PhaseEnvironmentSchema = Type.Object({
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
  tempMax: NullableNumber,
  tempMin: NullableNumber,
  tempTarget: NullableNumber,
  updatedAt: Type.String({ format: 'date-time' }),
})

export const GrowPhaseResponseSchema = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
  dayDurationMinutes: Type.Integer(),
  dayStartMinutes: Type.Integer(),
  durationDays: Type.Integer(),
  endAt: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  environments: Type.Optional(Type.Array(PhaseEnvironmentSchema)),
  growCycleId: Type.String({ format: 'uuid' }),
  id: Type.String({ format: 'uuid' }),
  isActive: Type.Boolean(),
  name: Type.String(),
  order: Type.Integer(),
  startAt: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
})

export const GrowPhaseArrayResponseSchema = Type.Array(GrowPhaseResponseSchema)

export const CreateGrowPhaseSchema = Type.Object({
  dayDurationMinutes: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 1440,
      default: 1080,
      description:
        'Duration in minutes (0..1440) of the photoperiod DAY. NIGHT = 1440 - this. Default 1080 = 18h.',
    }),
  ),
  dayStartMinutes: Type.Optional(
    Type.Integer({
      minimum: 0,
      maximum: 1440,
      default: 360,
      description:
        'Minutes from midnight (0..1440) when the photoperiod DAY begins. Default 360 = 06:00.',
    }),
  ),
  durationDays: Type.Integer({
    minimum: 1,
    description: 'Target runtime duration in days for this phase',
  }),
  endAt: Type.Optional(
    Type.String({
      format: 'date',
      description: 'Date (YYYY-MM-DD) when this phase concluded',
    }),
  ),
  growCycleId: Type.String({
    format: 'uuid',
    description: 'The unique ID of the grow cycle this phase belongs to',
  }),
  isActive: Type.Optional(
    Type.Boolean({
      default: false,
      description: 'Flags whether this phase is currently running',
    }),
  ),
  name: Type.String({
    maxLength: 100,
    description: 'e.g., Early Veg, Late Bloom, Flush',
  }),
  order: Type.Integer({
    minimum: 1,
    description: 'The sequential execution order index (e.g., 1, 2, 3)',
  }),
  startAt: Type.Optional(
    Type.String({
      format: 'date',
      description: 'Date (YYYY-MM-DD) when this phase actively started execution',
    }),
  ),
})

export const UpdateGrowPhaseSchema = Type.Object({
  dayDurationMinutes: Type.Optional(Type.Integer({ minimum: 0, maximum: 1440 })),
  dayStartMinutes: Type.Optional(Type.Integer({ minimum: 0, maximum: 1440 })),
  durationDays: Type.Optional(Type.Integer({ minimum: 1 })),
  endAt: Type.Optional(Type.String({ format: 'date' })),
  isActive: Type.Optional(Type.Boolean()),
  name: Type.Optional(Type.String({ maxLength: 100 })),
  order: Type.Optional(Type.Integer({ minimum: 1 })),
  startAt: Type.Optional(Type.String({ format: 'date' })),
})

export const GrowPhaseParamsIdSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

export const GrowPhaseParamsCycleIdSchema = Type.Object({
  growCycleId: Type.String({ format: 'uuid' }),
})

export { ErrorSchema }
