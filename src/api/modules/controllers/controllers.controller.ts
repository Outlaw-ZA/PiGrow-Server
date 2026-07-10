import type { FastifyInstance } from 'fastify'
import type { SensorProtocol, SensorType } from '../../../generated/client/enums.js'

export type SensorProtocolType = (typeof SensorProtocol)[keyof typeof SensorProtocol]
export type SensorTypeValue = (typeof SensorType)[keyof typeof SensorType]

export interface SeedSensorInput {
  name: string
  type: SensorTypeValue
  mqttTopic: string
  pinNumbers: number[]
  protocol: SensorProtocolType
}

interface CreateControllerInput {
  macAddress: string
  name: string
  ipAddress: string
  sensors?: SeedSensorInput[]
}

interface UpdateControllerInput {
  name?: string
  status?: 'ONLINE' | 'OFFLINE' | 'ERROR'
}

export class ControllersController {
  private prisma

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma
  }

  // 1. READ ALL (Lists all registered hubs with light status payloads)
  async getAllControllers() {
    return await this.prisma.controller.findMany({
      orderBy: { createdAt: 'desc' },
    })
  }

  // 2. READ ONE
  //    - active grow cycles (with active phase and its DAY/NIGHT environments)
  //    - persistent device inventory
  //    - sensor inventory
  async getControllerById(id: string) {
    return await this.prisma.controller.findUniqueOrThrow({
      include: {
        devices: {
          orderBy: { pinNumber: 'asc' },
        },
        growCycles: {
          include: {
            phases: {
              include: {
                environments: { orderBy: { period: 'asc' } },
              },
              where: { isActive: true },
            },
          },
          where: { isActive: true },
        },
        sensors: {
          orderBy: { createdAt: 'asc' },
        },
      },
      where: { id },
    })
  }

  // 3. CREATE / REGISTER
  //    Preserves the existing upsert-by-macAddress contract. Sensor seeding only
  //    Happens on a fresh create; re-registrations never silently mutate the
  //    Sensor inventory.
  async createController(body: CreateControllerInput) {
    const sensors = body.sensors ?? []

    return await this.prisma.$transaction(async (tx) => {
      const existing = await tx.controller.findUnique({
        select: { id: true },
        where: { macAddress: body.macAddress },
      })

      if (existing) {
        return tx.controller.update({
          data: { name: body.name },
          where: { macAddress: body.macAddress },
        })
      }

      return tx.controller.create({
        data: {
          ipAddress: body.ipAddress,
          macAddress: body.macAddress,
          name: body.name,
          sensors: {
            create: sensors.map((s) => ({
              name: s.name,
              type: s.type,
              mqttTopic: s.mqttTopic,
              pinNumbers: s.pinNumbers,
              protocol: s.protocol,
            })),
          },
          status: 'OFFLINE',
        },
        include: { sensors: true },
      })
    })
  }

  // 4. UPDATE STATUS / DETAILS
  async updateController(id: string, body: UpdateControllerInput) {
    return await this.prisma.controller.update({
      data: body,
      where: { id },
    })
  }

  // 5. REMOVE HUB PROVISION
  async deleteController(id: string) {
    await this.prisma.controller.delete({
      where: { id },
    })
  }

  // 6. HEARTBEAT STATUS UPDATE
  async heartbeat(id: string, status: 'ONLINE' | 'OFFLINE') {
    return await this.prisma.controller.update({
      data: { status },
      where: { id },
    })
  }
}
