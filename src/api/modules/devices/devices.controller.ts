import { FastifyInstance } from "fastify";
import { mqttClient } from "../../../mqtt/client.js";

type DeviceTypeLiteral =
  | "LIGHT"
  | "EXHAUST_FAN"
  | "INTAKE_FAN"
  | "CIRCULATION_FAN"
  | "WATER_PUMP"
  | "AIR_CONDITIONER"
  | "HEATER"
  | "HUMIDIFIER"
  | "DEHUMIDIFIER"
  | "CO2_INJECTOR";

interface CreateDeviceInput {
  controllerId: string;
  name: string;
  type: DeviceTypeLiteral;
  pinNumber: number;
  mqttTopic: string;
  isActive?: boolean;
}

interface UpdateDeviceInput {
  name?: string;
  type?: DeviceTypeLiteral;
  pinNumber?: number;
  mqttTopic?: string;
  isActive?: boolean;
}

interface BatchDeviceInput {
  name: string;
  type: DeviceTypeLiteral;
  pinNumber: number;
  mqttTopic: string;
  isActive?: boolean;
}

interface BatchCreateInput {
  controllerId: string;
  devices: BatchDeviceInput[];
}

export class DevicesController {
  private prisma;

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma;
  }

  // 1. READ ALL (Fetch inventory assigned to a specific Raspberry Pi)
  async getDevicesByControllerId(controllerId: string) {
    return await this.prisma.device.findMany({
      where: { controllerId },
      orderBy: { pinNumber: "asc" },
    });
  }

  // 2. READ ONE
  async getDeviceById(id: string) {
    return await this.prisma.device.findUniqueOrThrow({
      where: { id },
      include: {
        controller: true,
        deviceConfigs: true,
      },
    });
  }

  // 3. CREATE
  async createDevice(body: CreateDeviceInput) {
    return await this.prisma.device.create({
      data: {
        controllerId: body.controllerId,
        name: body.name,
        type: body.type,
        pinNumber: body.pinNumber,
        mqttTopic: body.mqttTopic,
        isActive: body.isActive ?? true,
      },
    });
  }

  // 4. UPDATE
  async updateDevice(id: string, body: UpdateDeviceInput) {
    return await this.prisma.device.update({
      where: { id },
      data: body,
    });
  }

  // 5. DELETE
  async deleteDevice(id: string) {
    await this.prisma.device.delete({
      where: { id },
    });
  }

  // 6. BATCH CREATE
  async createDevicesBatch(body: BatchCreateInput) {
    return await this.prisma.$transaction(
      body.devices.map((device) =>
        this.prisma.device.create({
          data: {
            controllerId: body.controllerId,
            name: device.name,
            type: device.type,
            pinNumber: device.pinNumber,
            mqttTopic: device.mqttTopic,
            isActive: device.isActive ?? true,
          },
        }),
      ),
    );
  }

  // 7. DEVICE COMMAND (toggle ON/OFF)
  async sendCommand(id: string, action: "ON" | "OFF") {
    const device = await this.prisma.device.findUniqueOrThrow({
      where: { id },
    });

    // Persist the state change
    await this.prisma.device.update({
      where: { id },
      data: { isActive: action === "ON" },
    });

    // Publish command to the Pi over MQTT
    mqttClient.publish(
      `devices/${id}/commands`,
      JSON.stringify({
        action,
        pin: device.pinNumber,
        timestamp: Date.now(),
      }),
    );

    return {
      deviceId: id,
      action,
      timestamp: new Date().toISOString(),
    };
  }
}
