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

  // 1. READ ALL PHASES FOR A SPECIFIC CYCLE
  async getPhasesByCycleId(growCycleId: string) {
    return await this.prisma.growPhase.findMany({
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
  }

  // 2. READ ONE INDIVIDUAL PHASE
  async getGrowPhaseById(id: string) {
    return await this.prisma.growPhase.findUniqueOrThrow({
      where: { id },
      include: {
        deviceConfigs: {
          include: {
            device: true,
          },
        },
      },
    });
  }

  // 3. CREATE A CUSTOM PHASE
  async createGrowPhase(body: CreatePhaseInput) {
    const { startAt, endAt, isActive, ...rest } = body;

    return await this.prisma.growPhase.create({
      data: {
        ...rest,
        isActive: isActive ?? false,
        startAt: startAt ? new Date(startAt) : null,
        endAt: endAt ? new Date(endAt) : null,
      },
    });
  }

  // 4. UPDATE A PHASE'S PARAMETERS
  async updateGrowPhase(id: string, body: UpdatePhaseInput) {
    const { startAt, endAt, ...rest } = body;

    return await this.prisma.growPhase.update({
      where: { id },
      data: {
        ...rest,
        startAt: startAt ? new Date(startAt) : undefined,
        endAt: endAt ? new Date(endAt) : undefined,
      },
    });
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

    return await this.prisma.growPhase.findUnique({
      where: { id },
      include: {
        deviceConfigs: {
          include: {
            device: true,
          },
        },
      },
    });
  }
}
