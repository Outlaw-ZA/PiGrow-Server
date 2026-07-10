import type { FastifyInstance } from 'fastify'
import type { SensorType } from '../../../generated/client/enums.js'

export type SensorTypeValue = (typeof SensorType)[keyof typeof SensorType]

interface CreateTelemetryInput {
  growCycleId: string
  sensorId: string
  sensorType: SensorTypeValue
  value: number
}

export class TelemetryController {
  private prisma

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma
  }

  // 1. READ ALL TELEMETRY FOR A GROW CYCLE
  async getByGrowCycleId(growCycleId: string) {
    return await this.prisma.telemetry.findMany({
      include: {
        sensor: {
          select: {
            id: true,
            name: true,
            protocol: true,
            type: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      where: { growCycleId },
    })
  }

  // 2. READ LATEST READING PER SENSOR (newest reading per physical sensor)
  async getLatestByGrowCycleId(growCycleId: string) {
    const allReadings = await this.prisma.telemetry.findMany({
      include: {
        sensor: {
          select: {
            id: true,
            name: true,
            protocol: true,
            type: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      where: { growCycleId },
    })

    const latestBySensor = new Map<string, (typeof allReadings)[number]>()
    for (const reading of allReadings) {
      if (!latestBySensor.has(reading.sensorId)) {
        latestBySensor.set(reading.sensorId, reading)
      }
    }

    return [...latestBySensor.values()]
  }

  // 3. READ TELEMETRY IN A DATE RANGE
  async getByGrowCycleIdRange(growCycleId: string, from: string, to: string) {
    return await this.prisma.telemetry.findMany({
      include: {
        sensor: {
          select: {
            id: true,
            name: true,
            protocol: true,
            type: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
      where: {
        createdAt: {
          gte: new Date(from),
          lte: new Date(to),
        },
        growCycleId,
      },
    })
  }

  // 4. INGEST TELEMETRY
  async createTelemetry(body: CreateTelemetryInput) {
    return await this.prisma.telemetry.create({
      data: {
        growCycleId: body.growCycleId,
        sensorId: body.sensorId,
        sensorType: body.sensorType,
        value: body.value,
      },
      include: {
        sensor: {
          select: {
            id: true,
            name: true,
            protocol: true,
            type: true,
          },
        },
      },
    })
  }
}
