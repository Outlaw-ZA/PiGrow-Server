import type { FastifyInstance } from 'fastify'

interface CreatePhaseInput {
  growCycleId: string
  name: string
  order: number
  durationDays: number
  isActive?: boolean
  startAt?: string
  endAt?: string
  dayStartMinutes?: number
  dayDurationMinutes?: number
}

interface UpdatePhaseInput {
  name?: string
  order?: number
  durationDays?: number
  isActive?: boolean
  startAt?: string
  endAt?: string
  dayStartMinutes?: number
  dayDurationMinutes?: number
}

export class GrowPhasesController {
  private prisma

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma
  }

  private formatDateOnly(date: Date | null): string | null {
    return date ? date.toISOString().slice(0, 10) : null
  }

  private serializePhaseDates<
    T extends
      | { startAt: Date | null; endAt: Date | null }
      | { startAt: Date | null; endAt: Date | null }[],
  >(phase: T): T {
    if (Array.isArray(phase)) {
      return phase.map((p) => ({
        ...p,
        endAt: this.formatDateOnly(p.endAt),
        startAt: this.formatDateOnly(p.startAt),
      })) as T
    }
    return {
      ...phase,
      endAt: this.formatDateOnly(phase.endAt),
      startAt: this.formatDateOnly(phase.startAt),
    } as T
  }

  // 1. READ ALL PHASES FOR A SPECIFIC CYCLE (with environments)
  async getPhasesByCycleId(growCycleId: string) {
    const phases = await this.prisma.growPhase.findMany({
      include: {
        environments: { orderBy: { period: 'asc' } },
      },
      orderBy: { order: 'asc' },
      where: { growCycleId },
    })
    return this.serializePhaseDates(phases)
  }

  // 2. READ ONE INDIVIDUAL PHASE (with environments)
  async getGrowPhaseById(id: string) {
    const phase = await this.prisma.growPhase.findUniqueOrThrow({
      include: {
        environments: { orderBy: { period: 'asc' } },
      },
      where: { id },
    })
    return this.serializePhaseDates(phase)
  }

  // 3. CREATE A CUSTOM PHASE
  async createGrowPhase(body: CreatePhaseInput) {
    const { startAt, endAt, isActive, dayStartMinutes, dayDurationMinutes, ...rest } = body

    const created = await this.prisma.growPhase.create({
      data: {
        ...rest,
        dayDurationMinutes: dayDurationMinutes ?? 1080,
        dayStartMinutes: dayStartMinutes ?? 360,
        endAt: endAt ? new Date(endAt) : null,
        isActive: isActive ?? false,
        startAt: startAt ? new Date(startAt) : null,
      },
    })
    return this.serializePhaseDates(created)
  }

  // 4. UPDATE A PHASE'S PARAMETERS
  async updateGrowPhase(id: string, body: UpdatePhaseInput) {
    const { startAt, endAt, ...rest } = body

    const updated = await this.prisma.growPhase.update({
      data: {
        ...rest,
        endAt: endAt ? new Date(endAt) : undefined,
        startAt: startAt ? new Date(startAt) : undefined,
      },
      where: { id },
    })
    return this.serializePhaseDates(updated)
  }

  // 5. DELETE A PHASE
  async deleteGrowPhase(id: string) {
    await this.prisma.growPhase.delete({
      where: { id },
    })
  }

  // 6. ACTIVATE A PHASE (clears all other phases in the same grow cycle)
  async activatePhase(id: string) {
    const phase = await this.prisma.growPhase.findUniqueOrThrow({
      where: { id },
    })

    await this.prisma.$transaction([
      this.prisma.growPhase.updateMany({
        data: { isActive: false },
        where: { growCycleId: phase.growCycleId },
      }),
      this.prisma.growPhase.update({
        data: { isActive: true },
        where: { id },
      }),
    ])

    const result = await this.prisma.growPhase.findUnique({
      include: { environments: { orderBy: { period: 'asc' } } },
      where: { id },
    })
    return result ? this.serializePhaseDates(result) : result
  }
}
