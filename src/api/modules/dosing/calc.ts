import type { WarningCode } from './dosing.schema.js'

export interface PhaseNutrientLike {
  nutrientId: string
  doseMlPerL: number
}

export interface ComputeDosingMlResult {
  mlByNutrientId: Record<string, number>
  totalMl: number
  warnings: WarningCode[]
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

export class DosingCalcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DosingCalcError'
  }
}

export function computeDosingMl(
  rows: PhaseNutrientLike[],
  reservoirLiters: number,
): ComputeDosingMlResult {
  if (reservoirLiters < 0) {
    throw new DosingCalcError(`reservoirLiters must be >= 0, got ${reservoirLiters}`)
  }

  if (rows.length === 0) {
    return {
      mlByNutrientId: {},
      totalMl: 0,
      warnings: ['NO_NUTRIENTS_CONFIGURED'],
    }
  }

  const mlByNutrientId: Record<string, number> = {}
  for (const row of rows) {
    mlByNutrientId[row.nutrientId] = round2(row.doseMlPerL * reservoirLiters)
  }

  const totalMl = round2(Object.values(mlByNutrientId).reduce((sum, value) => sum + value, 0))

  return {
    mlByNutrientId,
    totalMl,
    warnings: [],
  }
}
