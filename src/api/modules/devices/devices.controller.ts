import type { FastifyInstance } from 'fastify'
import { mqttClient } from '../../../mqtt/client.js'
import { DEVICE_STATE_CHANGED, deviceEvents } from '../../../events.js'
import type { AutomationMode, DeviceType } from '../../../generated/client/enums.js'

type DeviceTypeLiteral = (typeof DeviceType)[keyof typeof DeviceType]
type AutomationModeLiteral = (typeof AutomationMode)[keyof typeof AutomationMode]

interface CreateDeviceInput {
  controllerId: string
  name: string
  type: DeviceTypeLiteral
  pinNumber: number
  automationMode?: AutomationModeLiteral
  isActive?: boolean
  maxOnSeconds?: number | null
}

interface UpdateDeviceInput {
  name?: string
  type?: DeviceTypeLiteral
  pinNumber?: number
  automationMode?: AutomationModeLiteral
  isActive?: boolean
  maxOnSeconds?: number | null
}

interface BatchDeviceInput {
  name: string
  type: DeviceTypeLiteral
  pinNumber: number
  automationMode?: AutomationModeLiteral
  isActive?: boolean
  maxOnSeconds?: number | null
}

interface BatchCreateInput {
  controllerId: string
  devices: BatchDeviceInput[]
}

export class DevicesController {
  private prisma

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma
  }

  // 1. READ ALL — persistent hardware inventory for a controller.
  async getDevicesByControllerId(controllerId: string) {
    return await this.prisma.device.findMany({
      orderBy: { pinNumber: 'asc' },
      where: { controllerId },
    })
  }

  // 2. READ ONE
  async getDeviceById(id: string) {
    return await this.prisma.device.findUniqueOrThrow({
      include: {
        controller: {
          select: { id: true, name: true, status: true },
        },
      },
      where: { id },
    })
  }

  // 3. CREATE
  async createDevice(body: CreateDeviceInput) {
    return await this.prisma.device.create({
      data: {
        automationMode: body.automationMode ?? (body.type === 'LIGHT' ? 'SCHEDULED' : 'MANUAL'),
        controllerId: body.controllerId,
        isActive: body.isActive ?? true,
        maxOnSeconds: body.maxOnSeconds ?? null,
        name: body.name,
        pinNumber: body.pinNumber,
        type: body.type,
      },
    })
  }

  // 4. UPDATE — controllerId is immutable
  async updateDevice(id: string, body: UpdateDeviceInput) {
    return await this.prisma.device.update({
      data: body,
      where: { id },
    })
  }

  // 5. DELETE
  async deleteDevice(id: string) {
    await this.prisma.device.delete({
      where: { id },
    })
  }

  // 6. BATCH CREATE
  async createDevicesBatch(body: BatchCreateInput) {
    return await this.prisma.$transaction(
      body.devices.map((device) =>
        this.prisma.device.create({
          data: {
            automationMode:
              device.automationMode ?? (device.type === 'LIGHT' ? 'SCHEDULED' : 'MANUAL'),
            controllerId: body.controllerId,
            isActive: device.isActive ?? true,
            maxOnSeconds: device.maxOnSeconds ?? null,
            name: device.name,
            pinNumber: device.pinNumber,
            type: device.type,
          },
        }),
      ),
    )
  }

  // 7. DEVICE COMMAND (immediate ON/OFF, source = MANUAL)
  async sendCommand(id: string, action: 'ON' | 'OFF') {
    const device = await this.prisma.device.findUniqueOrThrow({
      where: { id },
    })

    // Persist the state change and write an audit log row in a single transaction.
    await this.prisma.$transaction([
      this.prisma.device.update({
        data: { isActive: action === 'ON' },
        where: { id },
      }),
      this.prisma.deviceStateLog.create({
        data: {
          action,
          deviceId: id,
          source: 'MANUAL',
        },
      }),
    ])

    deviceEvents.emit(DEVICE_STATE_CHANGED, { deviceId: id, isActive: action === 'ON' })

    mqttClient.publish(
      `devices/${id}/commands`,
      JSON.stringify({
        action,
        pin: device.pinNumber,
        timestamp: Date.now(),
      }),
    )

    return {
      action,
      deviceId: id,
      timestamp: new Date().toISOString(),
    }
  }

  // 8. DEVICE STATE LOGS (ON/OFF history within a time range)
  async getDeviceStateLogs(
    deviceId: string,
    query: { from?: string; to?: string; limit?: number },
  ) {
    const { from, to, limit = 2000 } = query
    const where: { deviceId: string; createdAt?: { gte?: Date; lte?: Date } } = { deviceId }
    if (from || to) {
      where.createdAt = {}
      if (from) {
        where.createdAt.gte = new Date(from)
      }
      if (to) {
        where.createdAt.lte = new Date(to)
      }
    }

    const logs = await this.prisma.deviceStateLog.findMany({
      orderBy: { createdAt: 'asc' },
      take: limit,
      where,
    })

    let priorAction: 'ON' | 'OFF' | null = null
    if (from) {
      const prior = await this.prisma.deviceStateLog.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { action: true },
        where: { createdAt: { lt: new Date(from) }, deviceId },
      })
      priorAction = (prior?.action as 'ON' | 'OFF') ?? null
    }

    return { logs, priorAction }
  }
}
