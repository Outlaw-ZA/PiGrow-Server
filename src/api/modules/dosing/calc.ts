import type { WarningCode } from './dosing.schema.js'

export interface PhaseNutrientLike {
  nutrientId: string
  doseMlPerL: number
  appliesToPeriod: 'DAY' | 'NIGHT'
}

export interface ComputeDosingMlResult {
  mlByNutrientId: Record<string, number>
  totalMl: number
  warnings: WarningCode[]
}

const round2 = (n: number): number => Math.round(n * 100) / 100

export class DosingCalcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DosingCalcError'
  }
}

export function computeDosingMl(
  rows: PhaseNutrientLike[],
  period: 'DAY' | 'NIGHT',
  reservoirLiters: number,
): ComputeDosingMlResult {
  if (reservoirLiters < 0) {
    throw new DosingCalcError(`reservoirLiters must be >= 0, got ${reservoirLiters}`)
  }

  const filtered = rows.filter((r) => r.appliesToPeriod === period)

  if (rows.length === 0) {
    return {
      mlByNutrientId: {},
      totalMl: 0,
      warnings: ['NO_NUTRIENTS_CONFIGURED'],
    }
  }

  if (filtered.length === 0) {
    const warning: WarningCode = period === 'DAY' ? 'NO_DAY_NUTRIENTS' : 'NO_NIGHT_NUTRIENTS'
    return {
      mlByNutrientId: {},
      totalMl: 0,
      warnings: [warning],
    }
  }

  const mlByNutrientId: Record<string, number> = {}
  for (const row of filtered) {
    const ml = round2(row.doseMlPerL * reservoirLiters)
    mlByNutrientId[row.nutrientId] = ml
  }

  const totalMl = round2(Object.values(mlByNutrientId).reduce((sum, v) => sum + v, 0))

  return {
    mlByNutrientId,
    totalMl,
    warnings: [],
  }
}
