import type { FastifyInstance } from 'fastify'

export class SkipPhaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SkipPhaseError'
  }
}

export class ControllerBusyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ControllerBusyError'
  }
}

export class GrowCyclesController {
  private prisma

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma
  }

  private formatDateOnly(date: Date | null): string | null {
    return date ? date.toISOString().slice(0, 10) : null
  }

  private serializeStartAt<T extends { startAt: Date | null } | { startAt: Date | null }[]>(
    cycle: T,
  ): T {
    if (Array.isArray(cycle)) {
      return cycle.map((c) => ({ ...c, startAt: this.formatDateOnly(c.startAt) })) as T
    }
    return { ...cycle, startAt: this.formatDateOnly(cycle.startAt) } as T
  }

  private serializePhaseDates<
    T extends
      | { startAt: Date | null; endAt: Date | null }
      | { startAt: Date | null; endAt: Date | null }[],
  >(phases: T): T {
    if (Array.isArray(phases)) {
      return phases.map((p) => ({
        ...p,
        endAt: this.formatDateOnly(p.endAt),
        startAt: this.formatDateOnly(p.startAt),
      })) as T
    }
    return {
      ...phases,
      endAt: this.formatDateOnly(phases.endAt),
      startAt: this.formatDateOnly(phases.startAt),
    } as T
  }

  // Reject if the controller already has an active grow cycle.
  private async assertControllerAvailable(controllerId: string, exceptGrowCycleId?: string) {
    const active = await this.prisma.growCycle.findFirst({
      select: { id: true },
      where: {
        controllerId,
        isActive: true,
        ...(exceptGrowCycleId ? { NOT: { id: exceptGrowCycleId } } : {}),
      },
    })
    if (active) {
      throw new ControllerBusyError(
        'Controller already has an active grow cycle. End the current grow before starting a new one.',
      )
    }
  }

  // 1. READ ALL (Includes assigned Raspberry Pi details)
  async getAllGrowCycles() {
    const cycles = await this.prisma.growCycle.findMany({
      include: {
        controller: {
          select: {
            name: true,
            status: true,
          },
        },
      },
    })
    return this.serializeStartAt(cycles)
  }

  // 2. READ ONE (Deeply fetches related phases with environments).
  // Note: devices are NOT included — they are owned by the controller.
  async getGrowCycleById(id: string) {
    const cycle = await this.prisma.growCycle.findUniqueOrThrow({
      include: {
        controller: true,
        phases: {
          include: {
            environments: { orderBy: { period: 'asc' } },
          },
          orderBy: { order: 'asc' },
        },
      },
      where: { id },
    })
    cycle.phases = this.serializePhaseDates(cycle.phases)
    return this.serializeStartAt(cycle)
  }

  // 3. CREATE
  // Devices are no longer seeded here — they belong to the controller.
  // Phases are created separately via POST /api/grow-phases.
  async createGrowCycle(body: { name: string; controllerId: string; isActive?: boolean }) {
    const isActive = body.isActive ?? false

    if (isActive) {
      await this.assertControllerAvailable(body.controllerId)
    }

    const createdCycle = await this.prisma.growCycle.create({
      data: {
        controllerId: body.controllerId,
        isActive,
        name: body.name,
      },
    })

    return this.getGrowCycleById(createdCycle.id)
  }

  // 4. UPDATE
  async updateGrowCycle(
    id: string,
    body: {
      name?: string
      isActive?: boolean
      startAt?: string
    },
  ) {
    const { startAt, isActive, ...rest } = body

    if (isActive === true) {
      const cycle = await this.prisma.growCycle.findUniqueOrThrow({
        select: { controllerId: true },
        where: { id },
      })
      await this.assertControllerAvailable(cycle.controllerId, id)
    }

    const updated = await this.prisma.growCycle.update({
      data: {
        ...rest,
        isActive: isActive,
        startAt: startAt ? new Date(startAt) : undefined,
      },
      where: { id },
    })
    return this.serializeStartAt(updated)
  }

  // 5. DELETE
  async deleteGrowCycle(id: string) {
    await this.prisma.growCycle.delete({
      where: { id },
    })
  }

  // 6. SKIP ACTIVE PHASE
  async skipPhase(id: string, todayOverride?: string) {
    const cycle = await this.prisma.growCycle.findUniqueOrThrow({
      include: {
        phases: {
          orderBy: { order: 'asc' },
        },
      },
      where: { id },
    })

    if (!cycle.startAt) {
      throw new SkipPhaseError('Grow cycle has not started yet')
    }

    const today = todayOverride ?? this.formatDateOnly(new Date())
    if (!today) {
      throw new SkipPhaseError("Server could not determine today's date")
    }

    this.recalculatePhaseDates(cycle.phases, cycle.startAt)

    const activeIdx = cycle.phases.findIndex(
      (p) =>
        p.startAt &&
        p.endAt &&
        today >= this.formatDateOnly(p.startAt)! &&
        today < this.formatDateOnly(p.endAt)!,
    )

    if (activeIdx === -1) {
      throw new SkipPhaseError('No active phase to skip')
    }

    if (activeIdx === cycle.phases.length - 1) {
      throw new SkipPhaseError('Cannot skip the final grow phase')
    }

    const active = cycle.phases[activeIdx]
    const elapsed = this.daysBetween(active.startAt!, today)
    active.durationDays = elapsed

    this.recalculatePhaseDates(cycle.phases, cycle.startAt)

    const next = cycle.phases[activeIdx + 1]

    await this.prisma.$transaction([
      this.prisma.growPhase.updateMany({
        data: { isActive: false },
        where: { growCycleId: id },
      }),
      this.prisma.growPhase.update({
        data: { isActive: true },
        where: { id: next.id },
      }),
      ...cycle.phases.map((p) =>
        this.prisma.growPhase.update({
          data: {
            durationDays: p.id === active.id ? elapsed : p.durationDays,
            endAt: p.endAt,
            startAt: p.startAt,
          },
          where: { id: p.id },
        }),
      ),
    ])

    return this.getGrowCycleById(id)
  }

  // 7. END GROW
  async endGrow(id: string, todayOverride?: string) {
    const cycle = await this.prisma.growCycle.findUniqueOrThrow({
      include: {
        phases: {
          orderBy: { order: 'asc' },
        },
      },
      where: { id },
    })

    if (!cycle.startAt) {
      throw new SkipPhaseError('Grow cycle has not started yet')
    }

    const today = todayOverride ?? this.formatDateOnly(new Date())
    if (!today) {
      throw new SkipPhaseError("Server could not determine today's date")
    }

    this.recalculatePhaseDates(cycle.phases, cycle.startAt)

    const activeIdx = cycle.phases.findIndex(
      (p) =>
        p.startAt &&
        p.endAt &&
        today >= this.formatDateOnly(p.startAt)! &&
        today < this.formatDateOnly(p.endAt)!,
    )

    if (activeIdx === -1) {
      throw new SkipPhaseError('No active phase to end')
    }

    const active = cycle.phases[activeIdx]
    const elapsed = this.daysBetween(active.startAt!, today)
    active.durationDays = elapsed

    this.recalculatePhaseDates(cycle.phases, cycle.startAt)

    await this.prisma.$transaction([
      this.prisma.growPhase.updateMany({
        data: { isActive: false },
        where: { growCycleId: id },
      }),
      this.prisma.growCycle.update({
        data: { isActive: false },
        where: { id },
      }),
      ...cycle.phases.map((p) =>
        this.prisma.growPhase.update({
          data: {
            durationDays: p.id === active.id ? elapsed : p.durationDays,
            endAt: p.endAt,
            startAt: p.startAt,
          },
          where: { id: p.id },
        }),
      ),
    ])

    return this.getGrowCycleById(id)
  }

  // Recompute every phase's startAt/endAt from cycle.startAt + cumulative durations.
  private recalculatePhaseDates(
    phases: { startAt: Date | null; endAt: Date | null; durationDays: number }[],
    growStart: Date,
  ): void {
    const cursor = new Date(growStart)
    cursor.setUTCHours(0, 0, 0, 0)
    for (const phase of phases) {
      phase.startAt = new Date(cursor)
      cursor.setUTCDate(cursor.getUTCDate() + phase.durationDays)
      phase.endAt = new Date(cursor)
    }
  }

  // Whole-day difference between two dates (date-only, UTC).
  private daysBetween(from: Date, todayStr: string): number {
    const fromDate = new Date(from)
    fromDate.setUTCHours(0, 0, 0, 0)
    const toDate = new Date(`${todayStr}T00:00:00Z`)
    toDate.setUTCHours(0, 0, 0, 0)
    const diffMs = toDate.getTime() - fromDate.getTime()
    return Math.max(0, Math.floor(diffMs / 86_400_000))
  }
}
