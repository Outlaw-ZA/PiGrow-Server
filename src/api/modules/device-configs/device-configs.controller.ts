import { FastifyInstance } from "fastify";

type TriggerType = "SCHEDULE" | "THRESHOLD" | "ALWAYS_ON" | "ALWAYS_OFF";

type ScheduleConfigData =
  | { onTime: string; durationHours: number }
  | { onTime: string; offTime: string };

type ThresholdConfigData =
  | { metric: string; high: number }
  | {
      sensor: string;
      condition:
        | "GREATER_THAN"
        | "LESS_THAN"
        | "GREATER_THAN_OR_EQUAL"
        | "LESS_THAN_OR_EQUAL"
        | "EQUAL";
      value: number;
      action: "ON" | "OFF" | "TOGGLE";
    };

type CreateDeviceConfigInput =
  | {
      growPhaseId: string;
      deviceId: string;
      triggerType: "SCHEDULE";
      configData: ScheduleConfigData;
    }
  | {
      growPhaseId: string;
      deviceId: string;
      triggerType: "THRESHOLD";
      configData: ThresholdConfigData;
    }
  | {
      growPhaseId: string;
      deviceId: string;
      triggerType: "ALWAYS_ON";
      configData: Record<string, unknown>;
    }
  | {
      growPhaseId: string;
      deviceId: string;
      triggerType: "ALWAYS_OFF";
      configData: Record<string, unknown>;
    };

type UpdateDeviceConfigInput =
  | { triggerType: "SCHEDULE"; configData: ScheduleConfigData }
  | { triggerType: "THRESHOLD"; configData: ThresholdConfigData }
  | { triggerType: "ALWAYS_ON"; configData: Record<string, unknown> }
  | { triggerType: "ALWAYS_OFF"; configData: Record<string, unknown> };

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
        configData: body.configData as object,
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
        configData: body.configData as object,
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
