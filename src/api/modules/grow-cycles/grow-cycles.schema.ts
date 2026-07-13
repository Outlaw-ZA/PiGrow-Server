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

const GrowPhaseSchema = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
  dayDurationMinutes: Type.Integer(),
  dayStartMinutes: Type.Integer(),
  durationDays: Type.Integer(),
  endAt: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  environments: Type.Array(PhaseEnvironmentSchema),
  growCycleId: Type.String({ format: 'uuid' }),
  id: Type.String({ format: 'uuid' }),
  isActive: Type.Boolean(),
  name: Type.String(),
  order: Type.Integer(),
  startAt: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
})

const ControllerSummarySchema = Type.Object({
  createdAt: Type.String({ format: 'date-time' }),
  id: Type.String({ format: 'uuid' }),
  ipAddress: Type.String(),
  macAddress: Type.String(),
  name: Type.String(),
  status: Type.String(),
  updatedAt: Type.String({ format: 'date-time' }),
})

export const GrowCycleResponseSchema = Type.Object({
  controller: Type.Object({
    name: Type.String(),
    status: Type.String(),
  }),
  controllerId: Type.String({ format: 'uuid' }),
  createdAt: Type.String({ format: 'date-time' }),
  id: Type.String({ format: 'uuid' }),
  isActive: Type.Boolean(),
  name: Type.String(),
  startAt: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
})

export const GrowCycleDetailResponseSchema = Type.Object({
  ...GrowCycleResponseSchema.properties,
  phases: Type.Array(GrowPhaseSchema),
})

export const GrowCycleArrayResponseSchema = Type.Array(GrowCycleResponseSchema)

export const CreateGrowCycleSchema = Type.Object({
  controllerId: Type.String({
    description: 'The UUID of the physical Raspberry Pi running this cycle',
    format: 'uuid',
  }),
  isActive: Type.Optional(
    Type.Boolean({
      default: false,
      description: 'Whether this grow cycle is actively running right now',
    }),
  ),
  name: Type.String({
    description: 'The name of the specific grow run or harvest batch',
    maxLength: 100,
  }),
})

export const UpdateGrowCycleSchema = Type.Object({
  isActive: Type.Optional(Type.Boolean()),
  name: Type.Optional(Type.String({ maxLength: 100 })),
  startAt: Type.Optional(
    Type.String({
      description: 'Date (YYYY-MM-DD) marking when this grow cycle started',
      format: 'date',
    }),
  ),
})

export const GrowCycleParamsIdSchema = Type.Object({
  id: Type.String({
    description: 'The unique UUID identifier of the grow cycle',
    format: 'uuid',
  }),
})

export const SkipPhaseQuerySchema = Type.Object({
  today: Type.Optional(
    Type.String({
      description:
        "Optional override for today's date (YYYY-MM-DD). Useful for timezone-correct skip operations; defaults to server UTC today.",
      format: 'date',
    }),
  ),
})

export const GrowCycleUpdateResponseSchema = Type.Object({
  controllerId: Type.String({ format: 'uuid' }),
  createdAt: Type.String({ format: 'date-time' }),
  id: Type.String({ format: 'uuid' }),
  isActive: Type.Boolean(),
  name: Type.String(),
  startAt: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
})

export { ErrorSchema }

export { ControllerSummarySchema }
