import type { PrismaClient } from '../../../generated/client/client.js'
import type {
  CreatePhaseNutrientPayload,
  UpdatePhaseNutrientPayload,
} from './phase-nutrients.schema.js'

export class PhaseNutrientsError extends Error {
  constructor(
    message: string,
    readonly statusCode: 404 | 409,
    readonly existingId?: string,
  ) {
    super(message)
    this.name = 'PhaseNutrientsError'
  }
}

export class PhaseNutrientsController {
  constructor(private readonly prisma: PrismaClient) {}

  async list(growPhaseId: string, period?: 'DAY' | 'NIGHT') {
    return await this.prisma.phaseNutrient.findMany({
      orderBy: [{ appliesToPeriod: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      where: { ...(period ? { appliesToPeriod: period } : {}), growPhaseId },
    })
  }

  async create(growPhaseId: string, payload: CreatePhaseNutrientPayload) {
    const phase = await this.prisma.growPhase.findUnique({ where: { id: growPhaseId } })
    if (!phase) {
      throw new PhaseNutrientsError('PHASE_NOT_FOUND', 404)
    }

    try {
      return await this.prisma.phaseNutrient.create({
        data: {
          appliesToPeriod: payload.appliesToPeriod,
          doseMlPerL: payload.doseMlPerL,
          growPhaseId,
          nutrientId: payload.nutrientId,
          sortOrder: payload.sortOrder ?? 0,
        },
      })
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error
      }
      const existing = await this.prisma.phaseNutrient.findFirst({
        select: { id: true },
        where: {
          appliesToPeriod: payload.appliesToPeriod,
          growPhaseId,
          nutrientId: payload.nutrientId,
        },
      })
      throw new PhaseNutrientsError('PHASE_NUTRIENT_CONFLICT', 409, existing?.id)
    }
  }

  async update(growPhaseId: string, id: string, payload: UpdatePhaseNutrientPayload) {
    const existing = await this.prisma.phaseNutrient.findUnique({ where: { id, growPhaseId } })
    if (!existing) {
      throw new PhaseNutrientsError('PHASE_NUTRIENT_NOT_FOUND', 404)
    }

    try {
      return await this.prisma.phaseNutrient.update({
        data: {
          ...(payload.appliesToPeriod !== undefined
            ? { appliesToPeriod: payload.appliesToPeriod }
            : {}),
          ...(payload.doseMlPerL !== undefined ? { doseMlPerL: payload.doseMlPerL } : {}),
          ...(payload.sortOrder !== undefined ? { sortOrder: payload.sortOrder } : {}),
        },
        where: { id },
      })
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error
      }
      const conflicting = await this.prisma.phaseNutrient.findFirst({
        select: { id: true },
        where: {
          ...(payload.appliesToPeriod !== undefined
            ? { appliesToPeriod: payload.appliesToPeriod }
            : { appliesToPeriod: existing.appliesToPeriod }),
          growPhaseId: existing.growPhaseId,
          id: { not: id },
          nutrientId: existing.nutrientId,
        },
      })
      throw new PhaseNutrientsError('PHASE_NUTRIENT_CONFLICT', 409, conflicting?.id)
    }
  }

  async remove(growPhaseId: string, id: string) {
    const existing = await this.prisma.phaseNutrient.findUnique({ where: { id, growPhaseId } })
    if (!existing) {
      throw new PhaseNutrientsError('PHASE_NUTRIENT_NOT_FOUND', 404)
    }
    await this.prisma.phaseNutrient.delete({ where: { id } })
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    )
  }
}
