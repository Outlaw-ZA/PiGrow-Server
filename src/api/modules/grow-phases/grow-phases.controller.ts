import { FastifyInstance } from "fastify";

interface CreatePhaseInput {
  growCycleId: string;
  name: string;
  order: number;
  durationDays: number;
  isActive?: boolean;
  startAt?: string;
  endAt?: string;
}

interface UpdatePhaseInput {
  name?: string;
  order?: number;
  durationDays?: number;
  isActive?: boolean;
  startAt?: string;
  endAt?: string;
}

export class GrowPhasesController {
  private prisma;

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma;
  }

  private formatDateOnly(date: Date | null): string | null {
    return date ? date.toISOString().slice(0, 10) : null;
  }

  private serializePhaseDates<T extends { startAt: Date | null; endAt: Date | null } | { startAt: Date | null; endAt: Date | null }[]>(phase: T): T {
    if (Array.isArray(phase)) {
      return phase.map((p) => ({
        ...p,
        startAt: this.formatDateOnly(p.startAt),
        endAt: this.formatDateOnly(p.endAt),
      })) as T;
    }
    return {
      ...phase,
      startAt: this.formatDateOnly(phase.startAt),
      endAt: this.formatDateOnly(phase.endAt),
    } as T;
  }

  // 1. READ ALL PHASES FOR A SPECIFIC CYCLE
  async getPhasesByCycleId(growCycleId: string) {
    const phases = await this.prisma.growPhase.findMany({
      where: { growCycleId },
      orderBy: {
        order: "asc", // Ensures phases return in sequential order
      },
      include: {
        deviceConfigs: {
          include: {
            device: true,
          },
        },
      },
    });
    return this.serializePhaseDates(phases);
  }

  // 2. READ ONE INDIVIDUAL PHASE
  async getGrowPhaseById(id: string) {
    const phase = await this.prisma.growPhase.findUniqueOrThrow({
      where: { id },
      include: {
        deviceConfigs: {
          include: {
            device: true,
          },
        },
      },
    });
    return this.serializePhaseDates(phase);
  }

  // 3. CREATE A CUSTOM PHASE
  async createGrowPhase(body: CreatePhaseInput) {
    const { startAt, endAt, isActive, ...rest } = body;

    const created = await this.prisma.growPhase.create({
      data: {
        ...rest,
        isActive: isActive ?? false,
        startAt: startAt ? new Date(startAt) : null,
        endAt: endAt ? new Date(endAt) : null,
      },
    });
    return this.serializePhaseDates(created);
  }

  // 4. UPDATE A PHASE'S PARAMETERS
  async updateGrowPhase(id: string, body: UpdatePhaseInput) {
    const { startAt, endAt, ...rest } = body;

    const updated = await this.prisma.growPhase.update({
      where: { id },
      data: {
        ...rest,
        startAt: startAt ? new Date(startAt) : undefined,
        endAt: endAt ? new Date(endAt) : undefined,
      },
    });
    return this.serializePhaseDates(updated);
  }

  // 5. DELETE A PHASE
  async deleteGrowPhase(id: string) {
    await this.prisma.growPhase.delete({
      where: { id },
    });
  }

  // 6. ACTIVATE A PHASE (clears all other phases in the same grow cycle)
  async activatePhase(id: string) {
    const phase = await this.prisma.growPhase.findUniqueOrThrow({
      where: { id },
    });

    await this.prisma.$transaction([
      this.prisma.growPhase.updateMany({
        where: { growCycleId: phase.growCycleId },
        data: { isActive: false },
      }),
      this.prisma.growPhase.update({
        where: { id },
        data: { isActive: true },
      }),
    ]);

    const result = await this.prisma.growPhase.findUnique({
      where: { id },
      include: {
        deviceConfigs: {
          include: {
            device: true,
          },
        },
      },
    });
    return result ? this.serializePhaseDates(result) : result;
  }
}
