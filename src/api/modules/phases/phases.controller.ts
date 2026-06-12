import { FastifyInstance } from "fastify";
import { CycleType, PhaseType } from "../../../generated/client/enums.js";

export class PhasesController {
  private prisma;

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma;
  }

  // 1. READ ALL
  async getAllPhases(cycle_id: string) {
    return await this.prisma.phases.findMany({ where: { cycle_id } });
  }

  // 2. READ ONE
  async getPhaseById(id: string) {
    return await this.prisma.phases.findUniqueOrThrow({
      where: { id },
    });
  }

  // 3. CREATE (Handles mutations and date formatting)
  async createPhase(body: any) {
    const { start_date, end_date, type, ...rest } = body;

    return await this.prisma.phases.create({
      data: {
        ...rest,
        type: type as PhaseType,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
      },
    });
  }

  // 4. UPDATE (Handles clean transformations)
  async updatePhase(id: string, body: any) {
    const { start_date, end_date, type, ...rest } = body;

    return await this.prisma.phases.update({
      where: { id },
      data: {
        ...rest,
        type: type ? (type as CycleType) : undefined,
        start_date: start_date ? new Date(start_date) : undefined,
        end_date: end_date ? new Date(end_date) : undefined,
      },
    });
  }

  // 5. DELETE
  async deletePhase(id: string) {
    await this.prisma.phases.delete({
      where: { id },
    });
  }
}
