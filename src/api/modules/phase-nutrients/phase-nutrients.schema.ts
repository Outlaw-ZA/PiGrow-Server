import { Type } from '@sinclair/typebox'
import { DayNightPeriodSchema } from '../dosing/dosing.schema.js'

export const PhaseNutrientSchema = Type.Object({
  appliesToPeriod: DayNightPeriodSchema,
  createdAt: Type.String(),
  doseMlPerL: Type.Number(),
  growPhaseId: Type.String(),
  id: Type.String(),
  nutrientId: Type.String(),
  sortOrder: Type.Integer(),
  updatedAt: Type.String(),
})

export const CreatePhaseNutrientSchema = Type.Object({
  appliesToPeriod: DayNightPeriodSchema,
  doseMlPerL: Type.Number({ maximum: 999.99, minimum: 0.01, multipleOf: 0.01 }),
  nutrientId: Type.String(),
  sortOrder: Type.Optional(Type.Integer({ minimum: 0 })),
})

export const UpdatePhaseNutrientSchema = Type.Object({
  appliesToPeriod: Type.Optional(DayNightPeriodSchema),
  doseMlPerL: Type.Optional(Type.Number({ maximum: 999.99, minimum: 0.01, multipleOf: 0.01 })),
  sortOrder: Type.Optional(Type.Integer({ minimum: 0 })),
})

export const PhaseNutrientConflictResponseSchema = Type.Object({
  error: Type.Literal('PHASE_NUTRIENT_CONFLICT'),
  existingId: Type.Optional(Type.String()),
})

export const ErrorResponseSchema = Type.Object({ error: Type.String() })

export type CreatePhaseNutrientPayload = typeof CreatePhaseNutrientSchema.static
export type UpdatePhaseNutrientPayload = typeof UpdatePhaseNutrientSchema.static
