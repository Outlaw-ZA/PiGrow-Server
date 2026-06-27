import { FastifyInstance } from "fastify";

interface CreateControllerInput {
  macAddress: string;
  name: string;
  ipAddress: string;
}

interface UpdateControllerInput {
  name?: string;
  status?: "ONLINE" | "OFFLINE" | "ERROR";
}

export class ControllersController {
  private prisma;

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma;
  }

  // 1. READ ALL (Lists all registered hubs with light status payloads)
  async getAllControllers() {
    return await this.prisma.controller.findMany({
      orderBy: { createdAt: "desc" },
    });
  }

  // 2. READ ONE (Deeply fetches active infrastructure networks for Vue dashboards)
  async getControllerById(id: string) {
    return await this.prisma.controller.findUniqueOrThrow({
      where: { id },
      include: {
        growCycles: {
          where: { isActive: true }, // Instantly displays what's currently cultivation-active
          include: {
            phases: {
              where: { isActive: true }, // Pulls the currently running step
            },
            devices: true, // Per-grow device inventory (devices are now scoped to grow cycles)
          },
        },
      },
    });
  }

  // 3. CREATE / REGISTER
  async createController(body: CreateControllerInput) {
    // Uses upsert so if a Pi re-registers its network profile, it avoids crashing the app
    return await this.prisma.controller.upsert({
      where: { macAddress: body.macAddress },
      update: { name: body.name },
      create: {
        macAddress: body.macAddress,
        name: body.name,
        ipAddress: body.ipAddress,
        status: "OFFLINE",
      },
    });
  }

  // 4. UPDATE STATUS / DETAILS
  async updateController(id: string, body: UpdateControllerInput) {
    return await this.prisma.controller.update({
      where: { id },
      data: body,
    });
  }

  // 5. REMOVE HUB PROVISION
  async deleteController(id: string) {
    await this.prisma.controller.delete({
      where: { id },
    });
  }

  // 6. HEARTBEAT STATUS UPDATE
  async heartbeat(id: string, status: "ONLINE" | "OFFLINE") {
    return await this.prisma.controller.update({
      where: { id },
      data: { status },
    });
  }
}
