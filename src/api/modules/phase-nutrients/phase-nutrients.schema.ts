import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'

export const PhaseNutrientSchema = Type.Object({
  createdAt: Type.String(),
  doseMlPerL: Type.Number(),
  growPhaseId: Type.String(),
  id: Type.String(),
  nutrientId: Type.String(),
  sortOrder: Type.Integer(),
  updatedAt: Type.String(),
})

export const CreatePhaseNutrientSchema = Type.Object({
  doseMlPerL: Type.Number({ maximum: 999.99, minimum: 0.01, multipleOf: 0.01 }),
  nutrientId: Type.String(),
  sortOrder: Type.Optional(Type.Integer({ minimum: 0 })),
})

export const UpdatePhaseNutrientSchema = Type.Object({
  doseMlPerL: Type.Optional(Type.Number({ maximum: 999.99, minimum: 0.01, multipleOf: 0.01 })),
  sortOrder: Type.Optional(Type.Integer({ minimum: 0 })),
})

export const PhaseNutrientConflictResponseSchema = Type.Object({
  error: Type.Literal('PHASE_NUTRIENT_CONFLICT'),
  existingId: Type.Optional(Type.String()),
})

export const ErrorResponseSchema = Type.Object({ error: Type.String() })

export type CreatePhaseNutrientPayload = Static<typeof CreatePhaseNutrientSchema>
export type UpdatePhaseNutrientPayload = Static<typeof UpdatePhaseNutrientSchema>
