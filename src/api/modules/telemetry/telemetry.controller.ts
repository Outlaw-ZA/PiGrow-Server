import { FastifyInstance } from "fastify";

interface CreateTelemetryInput {
  growCycleId: string;
  sensorType: string;
  value: number;
}

export class TelemetryController {
  private prisma;

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma;
  }

  // 1. READ ALL TELEMETRY FOR A GROW CYCLE
  async getByGrowCycleId(growCycleId: string) {
    return await this.prisma.telemetry.findMany({
      where: { growCycleId },
      orderBy: { createdAt: "desc" },
    });
  }

  // 2. READ LATEST READING PER SENSOR TYPE
  async getLatestByGrowCycleId(growCycleId: string) {
    const allReadings = await this.prisma.telemetry.findMany({
      where: { growCycleId },
      orderBy: { createdAt: "desc" },
    });

    const latestByType = new Map<string, (typeof allReadings)[number]>();
    for (const reading of allReadings) {
      if (!latestByType.has(reading.sensorType)) {
        latestByType.set(reading.sensorType, reading);
      }
    }

    return Array.from(latestByType.values());
  }

  // 3. READ TELEMETRY IN A DATE RANGE
  async getByGrowCycleIdRange(
    growCycleId: string,
    from: string,
    to: string,
  ) {
    return await this.prisma.telemetry.findMany({
      where: {
        growCycleId,
        createdAt: {
          gte: new Date(from),
          lte: new Date(to),
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  // 4. INGEST TELEMETRY
  async createTelemetry(body: CreateTelemetryInput) {
    return await this.prisma.telemetry.create({
      data: {
        growCycleId: body.growCycleId,
        sensorType: body.sensorType,
        value: body.value,
      },
    });
  }
}
