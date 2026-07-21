import { Type } from '@sinclair/typebox'

export const DayNightPeriodSchema = Type.Union([Type.Literal('DAY'), Type.Literal('NIGHT')])

export const WarningCodeSchema = Type.Union([
  Type.Literal('NO_NUTRIENTS_CONFIGURED'),
  Type.Literal('NO_DAY_NUTRIENTS'),
  Type.Literal('NO_NIGHT_NUTRIENTS'),
  Type.Literal('NO_PH_BANDS'),
  Type.Literal('PH_DAY_NIGHT_MISMATCH'),
  Type.Literal('RESERVOIR_TOO_SMALL'),
])

export const WARNING_CODES = [
  'NO_NUTRIENTS_CONFIGURED',
  'NO_DAY_NUTRIENTS',
  'NO_NIGHT_NUTRIENTS',
  'NO_PH_BANDS',
  'PH_DAY_NIGHT_MISMATCH',
  'RESERVOIR_TOO_SMALL',
] as const

export type WarningCode = (typeof WARNING_CODES)[number]

export function getWarningCodes(): readonly WarningCode[] {
  return WARNING_CODES
}

export const DosingPreviewRequestSchema = Type.Object({
  period: DayNightPeriodSchema,
  reservoirLiters: Type.Number({ minimum: 0, maximum: 100000 }),
})

export const DosingPreviewResponseSchema = Type.Object({
  mlByNutrientId: Type.Record(Type.String(), Type.Number()),
  totalMl: Type.Number(),
  warnings: Type.Array(WarningCodeSchema),
})
