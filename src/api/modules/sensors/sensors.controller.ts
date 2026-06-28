import { FastifyInstance } from "fastify";
import { SensorType, SensorProtocol } from "../../../generated/client/enums.js";

export type SensorTypeValue = (typeof SensorType)[keyof typeof SensorType];
export type SensorProtocolValue =
  (typeof SensorProtocol)[keyof typeof SensorProtocol];

interface CreateSensorInput {
  controllerId: string;
  name: string;
  type: SensorTypeValue;
  mqttTopic: string;
  pinNumbers: number[];
  protocol: SensorProtocolValue;
}

interface UpdateSensorInput {
  name?: string;
  type?: SensorTypeValue;
  mqttTopic?: string;
  pinNumbers?: number[];
  protocol?: SensorProtocolValue;
  lastActive?: string;
}

export class SensorsController {
  private prisma;

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma;
  }

  // 1. LIST SENSORS ATTACHED TO A CONTROLLER
  async getSensorsByControllerId(controllerId: string) {
    return await this.prisma.sensor.findMany({
      where: { controllerId },
      orderBy: { createdAt: "asc" },
    });
  }

  // 2. READ SINGLE SENSOR WITH PARENT CONTROLLER
  async getSensorById(id: string) {
    return await this.prisma.sensor.findUniqueOrThrow({
      where: { id },
      include: {
        controller: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
    });
  }

  // 3. PROVISION A NEW SENSOR ON A CONTROLLER
  async createSensor(body: CreateSensorInput) {
    return await this.prisma.sensor.create({
      data: {
        controllerId: body.controllerId,
        name: body.name,
        type: body.type,
        mqttTopic: body.mqttTopic,
        pinNumbers: body.pinNumbers,
        protocol: body.protocol,
      },
    });
  }

  // 4. UPDATE SENSOR CONFIGURATION
  async updateSensor(id: string, body: UpdateSensorInput) {
    const { lastActive, ...rest } = body;
    return await this.prisma.sensor.update({
      where: { id },
      data: {
        ...rest,
        ...(lastActive !== undefined ? { lastActive: new Date(lastActive) } : {}),
      },
    });
  }

  // 5. REMOVE A SENSOR (cascades to its telemetry rows)
  async deleteSensor(id: string) {
    await this.prisma.sensor.delete({
      where: { id },
    });
  }
}
