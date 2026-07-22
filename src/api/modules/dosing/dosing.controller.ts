import type { PrismaClient } from '../../../generated/client/client.js'
import { computeDosingMl } from './calc.js'
import type { PhaseNutrientLike } from './calc.js'
import type { WarningCode } from './dosing.schema.js'

export class DosingController {
  constructor(private readonly prisma: PrismaClient) {}

  async preview(growPhaseId: string, reservoirLiters: number) {
    const [nutrientRows, phase] = await Promise.all([
      this.prisma.phaseNutrient.findMany({ where: { growPhaseId } }),
      this.prisma.growPhase.findUniqueOrThrow({ where: { id: growPhaseId } }),
    ])

    const phaseRowsLike: PhaseNutrientLike[] = nutrientRows.map((row) => ({
      doseMlPerL: row.doseMlPerL,
      nutrientId: row.nutrientId,
    }))
    const calcResult = computeDosingMl(phaseRowsLike, reservoirLiters)
    const warnings: WarningCode[] = [...calcResult.warnings]

    if (phase.phMin == null && phase.phTarget == null && phase.phMax == null) {
      warnings.push('NO_PH_BANDS')
    }

    return {
      mlByNutrientId: calcResult.mlByNutrientId,
      totalMl: calcResult.totalMl,
      warnings,
    }
  }
}
