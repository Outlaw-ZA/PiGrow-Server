import { FastifyInstance } from "fastify";
import { SensorType, SensorProtocol } from "../../../generated/client/enums.js";

export type SensorProtocolType = (typeof SensorProtocol)[keyof typeof SensorProtocol];
export type SensorTypeValue = (typeof SensorType)[keyof typeof SensorType];

export interface SeedSensorInput {
  name: string;
  type: SensorTypeValue;
  mqttTopic: string;
  pinNumbers: number[];
  protocol: SensorProtocolType;
}

interface CreateControllerInput {
  macAddress: string;
  name: string;
  ipAddress: string;
  sensors?: SeedSensorInput[];
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
        sensors: {
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  // 3. CREATE / REGISTER
  // Preserves the existing upsert-by-macAddress contract so a Pi re-registering
  // its network profile doesn't crash the app. Sensor seeding only happens on a
  // fresh create; re-registrations never silently mutate the sensor inventory.
  async createController(body: CreateControllerInput) {
    const sensors = body.sensors ?? [];

    return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.controller.findUnique({
        where: { macAddress: body.macAddress },
        select: { id: true },
      });

      if (existing) {
        return tx.controller.update({
          where: { macAddress: body.macAddress },
          data: { name: body.name },
        });
      }

      return tx.controller.create({
        data: {
          macAddress: body.macAddress,
          name: body.name,
          ipAddress: body.ipAddress,
          status: "OFFLINE",
          sensors: {
            create: sensors.map((s) => ({
              name: s.name,
              type: s.type,
              mqttTopic: s.mqttTopic,
              pinNumbers: s.pinNumbers,
              protocol: s.protocol,
            })),
          },
        },
        include: { sensors: true },
      });
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
