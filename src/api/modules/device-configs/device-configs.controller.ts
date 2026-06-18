import { FastifyInstance } from "fastify";

interface CreateDeviceConfigInput {
  growPhaseId: string;
  deviceId: string;
  triggerType: "SCHEDULE" | "THRESHOLD" | "ALWAYS_ON" | "ALWAYS_OFF";
  configData: any;
}

interface UpdateDeviceConfigInput {
  triggerType?: "SCHEDULE" | "THRESHOLD" | "ALWAYS_ON" | "ALWAYS_OFF";
  configData?: any;
}

export class DeviceConfigsController {
  private prisma;

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma;
  }

  // 1. READ ALL CONFIGS FOR A PHASE
  async getConfigsByPhaseId(phaseId: string) {
    return await this.prisma.deviceConfig.findMany({
      where: { growPhaseId: phaseId },
      include: {
        device: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  // 2. READ ONE CONFIG
  async getDeviceConfigById(id: string) {
    return await this.prisma.deviceConfig.findUniqueOrThrow({
      where: { id },
      include: {
        device: true,
      },
    });
  }

  // 3. CREATE
  async createDeviceConfig(body: CreateDeviceConfigInput) {
    return await this.prisma.deviceConfig.create({
      data: {
        growPhaseId: body.growPhaseId,
        deviceId: body.deviceId,
        triggerType: body.triggerType,
        configData: body.configData,
      },
      include: {
        device: true,
      },
    });
  }

  // 4. UPDATE
  async updateDeviceConfig(id: string, body: UpdateDeviceConfigInput) {
    return await this.prisma.deviceConfig.update({
      where: { id },
      data: {
        triggerType: body.triggerType,
        configData: body.configData,
      },
      include: {
        device: true,
      },
    });
  }

  // 5. DELETE
  async deleteDeviceConfig(id: string) {
    await this.prisma.deviceConfig.delete({
      where: { id },
    });
  }
}
