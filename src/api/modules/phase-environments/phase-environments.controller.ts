import type { FastifyInstance } from 'fastify'
import type { DayNightPeriod as DayNightPeriodLiteral } from '../../../generated/client/enums.js'

interface UpsertPhaseEnvironmentInput {
  tempMin?: number | null
  tempMax?: number | null
  tempTarget?: number | null
  humidityMin?: number | null
  humidityMax?: number | null
  humidityTarget?: number | null
  co2Min?: number | null
  co2Max?: number | null
  co2Target?: number | null
}

export class PhaseEnvironmentsController {
  private prisma

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma
  }

  // 1. GET both DAY + NIGHT rows for a phase. Missing periods come back as null
  //    So the FE can tell DAY exists and NIGHT doesn't.
  async getByPhaseId(growPhaseId: string) {
    const phase = await this.prisma.growPhase.findUnique({
      select: { id: true },
      where: { id: growPhaseId },
    })
    if (!phase) {
      const err = new Error('Grow phase record not found')
      ;(err as { statusCode?: number }).statusCode = 404
      throw err
    }

    const rows = await this.prisma.phaseEnvironment.findMany({
      orderBy: { period: 'asc' },
      where: { growPhaseId },
    })

    const day = rows.find((r) => r.period === 'DAY') ?? null
    const night = rows.find((r) => r.period === 'NIGHT') ?? null

    return { day, growPhaseId, night }
  }

  // 2. UPSERT a single period. Omitted fields are cleared (set to null).
  async upsert(
    growPhaseId: string,
    period: DayNightPeriodLiteral,
    body: UpsertPhaseEnvironmentInput,
  ) {
    const phase = await this.prisma.growPhase.findUnique({
      select: { id: true },
      where: { id: growPhaseId },
    })
    if (!phase) {
      const err = new Error('Grow phase record not found')
      ;(err as { statusCode?: number }).statusCode = 404
      throw err
    }

    return await this.prisma.phaseEnvironment.upsert({
      create: {
        co2Max: body.co2Max ?? null,
        co2Min: body.co2Min ?? null,
        co2Target: body.co2Target ?? null,
        growPhaseId,
        humidityMax: body.humidityMax ?? null,
        humidityMin: body.humidityMin ?? null,
        humidityTarget: body.humidityTarget ?? null,
        period,
        tempMax: body.tempMax ?? null,
        tempMin: body.tempMin ?? null,
        tempTarget: body.tempTarget ?? null,
      },
      update: {
        co2Max: body.co2Max ?? null,
        co2Min: body.co2Min ?? null,
        co2Target: body.co2Target ?? null,
        humidityMax: body.humidityMax ?? null,
        humidityMin: body.humidityMin ?? null,
        humidityTarget: body.humidityTarget ?? null,
        tempMax: body.tempMax ?? null,
        tempMin: body.tempMin ?? null,
        tempTarget: body.tempTarget ?? null,
      },
      where: { growPhaseId_period: { growPhaseId, period } },
    })
  }

  // 3. DELETE a period row.
  async remove(growPhaseId: string, period: DayNightPeriodLiteral) {
    const existing = await this.prisma.phaseEnvironment.findUnique({
      where: { growPhaseId_period: { growPhaseId, period } },
    })
    if (!existing) {
      const err = new Error('Phase environment row not found')
      ;(err as { statusCode?: number }).statusCode = 404
      throw err
    }
    await this.prisma.phaseEnvironment.delete({
      where: { growPhaseId_period: { growPhaseId, period } },
    })
  }
}
