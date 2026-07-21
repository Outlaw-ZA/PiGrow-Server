import { Type } from '@sinclair/typebox'

export const NutrientSchema = Type.Object({
  brand: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  id: Type.String(),
  name: Type.String(),
  notes: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String(),
})

export const CreateNutrientSchema = Type.Object({
  brand: Type.Optional(Type.String({ maxLength: 200 })),
  name: Type.String({ minLength: 1, maxLength: 200 }),
  notes: Type.Optional(Type.String()),
})

export const UpdateNutrientSchema = Type.Object({
  brand: Type.Optional(Type.String({ maxLength: 200 })),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  notes: Type.Optional(Type.String()),
})

export const NutrientConflictResponseSchema = Type.Object({
  error: Type.Literal('NUTRIENT_CONFLICT'),
  existingId: Type.String(),
})

export const NutrientInUseResponseSchema = Type.Object({
  error: Type.Literal('NUTRIENT_IN_USE'),
  referencing: Type.Integer(),
})

export const ErrorResponseSchema = Type.Object({ error: Type.String() })

export type CreateNutrientPayload = typeof CreateNutrientSchema.static
export type UpdateNutrientPayload = typeof UpdateNutrientSchema.static
