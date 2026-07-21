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
    // Use groupBy to get the most recent createdAt per sensorId, avoiding
    // An unbounded full-table scan that the previous in-memory dedup caused.
    const groups = await this.prisma.telemetry.groupBy({
      _max: { createdAt: true },
      by: ['sensorId'],
      where: { growCycleId },
    })

    if (groups.length === 0) {
      return []
    }

    // Fetch the full reading row for each (sensorId, createdAt) pair.
    const readings = await this.prisma.telemetry.findMany({
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
      where: {
        OR: groups.map((g) => ({
          createdAt: g._max.createdAt!,
          sensorId: g.sensorId,
        })),
        growCycleId,
      },
    })

    return readings
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
