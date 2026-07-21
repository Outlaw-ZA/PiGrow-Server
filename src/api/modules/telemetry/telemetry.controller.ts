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

  // 2. READ LATEST READING PER (sensor, sensorType) PAIR
  async getLatestByGrowCycleId(growCycleId: string) {
    // Group by (sensorId, sensorType) to find the latest createdAt per pair.
    // The MQTT handler persists an entire payload inside one
    // prisma.$transaction(), and Postgres TIMESTAMP(3) truncates
    // sub-millisecond precision — rows from one delivery frequently share
    // a createdAt. The follow-up must therefore pick exactly one row per
    // group with a deterministic tiebreaker (id desc) rather than match
    // on (sensorId, sensorType, createdAt) in an OR, which would return
    // every tied row.
    const groups = await this.prisma.telemetry.groupBy({
      _max: { createdAt: true },
      by: ['sensorId', 'sensorType'],
      where: { growCycleId },
    })

    if (groups.length === 0) {
      return []
    }

    const sensorSelect = {
      select: {
        id: true,
        name: true,
        protocol: true,
        type: true,
      },
    }

    const rows = await Promise.all(
      groups.map((g) =>
        this.prisma.telemetry.findFirst({
          include: { sensor: sensorSelect },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          where: {
            growCycleId,
            sensorId: g.sensorId,
            sensorType: g.sensorType,
          },
        }),
      ),
    )

    const readings = rows.filter((r): r is NonNullable<typeof r> => r !== null)
    readings.sort((a, b) => {
      if (a.sensorId !== b.sensorId) {
        return a.sensorId < b.sensorId ? -1 : 1
      }
      return a.sensorType < b.sensorType ? -1 : a.sensorType > b.sensorType ? 1 : 0
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
