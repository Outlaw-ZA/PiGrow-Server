import type { PrismaClient } from '../../../generated/client/client.js'
import { computeDosingMl } from './calc.js'
import type { PhaseNutrientLike } from './calc.js'
import type { WarningCode } from './dosing.schema.js'

export class DosingController {
  constructor(private readonly prisma: PrismaClient) {}

  async preview(growPhaseId: string, period: 'DAY' | 'NIGHT', reservoirLiters: number) {
    const nutrientRows = await this.prisma.phaseNutrient.findMany({ where: { growPhaseId } })
    const [dayEnv, nightEnv] = await Promise.all([
      this.prisma.phaseEnvironment.findUnique({
        where: { growPhaseId_period: { growPhaseId, period: 'DAY' } },
      }),
      this.prisma.phaseEnvironment.findUnique({
        where: { growPhaseId_period: { growPhaseId, period: 'NIGHT' } },
      }),
    ])

    const phaseRowsLike: PhaseNutrientLike[] = nutrientRows.map((row) => ({
      appliesToPeriod: row.appliesToPeriod,
      doseMlPerL: row.doseMlPerL,
      nutrientId: row.nutrientId,
    }))
    const calcResult = computeDosingMl(phaseRowsLike, period, reservoirLiters)
    const warnings: WarningCode[] = [...calcResult.warnings]
    const periodEnv = period === 'DAY' ? dayEnv : nightEnv

    if (
      !periodEnv ||
      (periodEnv.phMin == null && periodEnv.phTarget == null && periodEnv.phMax == null)
    ) {
      warnings.push('NO_PH_BANDS')
    }
    if (
      dayEnv &&
      nightEnv &&
      (dayEnv.phMin !== nightEnv.phMin ||
        dayEnv.phTarget !== nightEnv.phTarget ||
        dayEnv.phMax !== nightEnv.phMax)
    ) {
      warnings.push('PH_DAY_NIGHT_MISMATCH')
    }

    return {
      mlByNutrientId: calcResult.mlByNutrientId,
      totalMl: calcResult.totalMl,
      warnings,
    }
  }
}
