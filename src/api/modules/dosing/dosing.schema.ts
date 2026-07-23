import { Type } from '@sinclair/typebox'

export const WarningCodeSchema = Type.Union([
  Type.Literal('NO_NUTRIENTS_CONFIGURED'),
  Type.Literal('NO_PH_BANDS'),
  Type.Literal('RESERVOIR_TOO_SMALL'),
])

export const WARNING_CODES = [
  'NO_NUTRIENTS_CONFIGURED',
  'NO_PH_BANDS',
  'RESERVOIR_TOO_SMALL',
] as const

export type WarningCode = (typeof WARNING_CODES)[number]

export function getWarningCodes(): readonly WarningCode[] {
  return WARNING_CODES
}

export const DosingPreviewRequestSchema = Type.Object({
  reservoirLiters: Type.Number({ maximum: 100_000, minimum: 0 }),
})

export const DosingPreviewResponseSchema = Type.Object({
  mlByNutrientId: Type.Record(Type.String(), Type.Number()),
  totalMl: Type.Number(),
  warnings: Type.Array(WarningCodeSchema),
})
