import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { DevicesController } from './devices.controller.js'
import {
  BatchCreateDeviceSchema,
  CreateDeviceSchema,
  DeviceArrayResponseSchema,
  DeviceCommandResponseSchema,
  DeviceCommandSchema,
  DeviceDetailResponseSchema,
  DeviceParamsControllerIdSchema,
  DeviceParamsIdSchema,
  DeviceResponseSchema,
  DeviceStateLogQuerySchema,
  DeviceStateLogsResponseSchema,
  ErrorSchema,
  UpdateDeviceSchema,
} from './devices.schema.js'
import { cast } from '../../shared/cast.js'

export default async function deviceRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>()
  const controller = new DevicesController(server)

  // 1. LIST persistent hardware for a controller
  router.get(
    '/api/devices/controller/:controllerId',
    {
      schema: {
        description:
          'Returns every device (relay / actuator) attached to the given controller, ordered by `pinNumber` ascending.',
        params: DeviceParamsControllerIdSchema,
        response: { 200: DeviceArrayResponseSchema, 400: ErrorSchema },
        summary: 'List devices on a controller',
        tags: ['Devices'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof DeviceArrayResponseSchema.static>(
          await controller.getDevicesByControllerId(request.params.controllerId),
        )
      } catch {
        return reply.code(400).send({ error: 'Failed to load hardware profiles' })
      }
    },
  )

  // 2. GET a single device
  router.get(
    '/api/devices/:id',
    {
      schema: {
        params: DeviceParamsIdSchema,
        response: {
          200: DeviceDetailResponseSchema,
          404: ErrorSchema,
        },
        summary: 'Get one device with its controller summary',
        tags: ['Devices'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof DeviceDetailResponseSchema.static>(
          await controller.getDeviceById(request.params.id),
        )
      } catch {
        return reply.code(404).send({ error: 'Physical hardware device not found' })
      }
    },
  )

  // 3. PROVISION a device on a controller
  router.post(
    '/api/devices',
    {
      schema: {
        body: CreateDeviceSchema,
        response: {
          201: DeviceResponseSchema,
          400: ErrorSchema,
        },
        summary: 'Provision a new device',
        tags: ['Devices'],
      },
    },
    async (request, reply) => {
      try {
        const newDevice = await controller.createDevice(request.body)
        return reply.code(201).send(cast<typeof DeviceResponseSchema.static>(newDevice))
      } catch (error) {
        server.log.error(error)
        return reply.code(400).send({ error: 'Failed to map new hardware device' })
      }
    },
  )

  // 4. BULK PROVISION
  router.post(
    '/api/devices/batch',
    {
      schema: {
        body: BatchCreateDeviceSchema,
        response: {
          201: DeviceArrayResponseSchema,
          400: ErrorSchema,
        },
        summary: 'Bulk-provision several devices on a controller',
        tags: ['Devices'],
      },
    },
    async (request, reply) => {
      try {
        const newDevices = await controller.createDevicesBatch(request.body)
        return reply.code(201).send(cast<typeof DeviceArrayResponseSchema.static>(newDevices))
      } catch (error) {
        server.log.error(error)
        return reply.code(400).send({ error: 'Failed to map batch hardware devices' })
      }
    },
  )

  // 5. UPDATE device configuration
  router.put(
    '/api/devices/:id',
    {
      schema: {
        body: UpdateDeviceSchema,
        params: DeviceParamsIdSchema,
        response: {
          200: DeviceResponseSchema,
          400: ErrorSchema,
        },
        summary: 'Update device configuration',
        tags: ['Devices'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof DeviceResponseSchema.static>(
          await controller.updateDevice(request.params.id, request.body),
        )
      } catch (error) {
        server.log.error(error)
        return reply.code(400).send({ error: 'Hardware parameter update rejected' })
      }
    },
  )

  // 6. DELETE
  router.delete(
    '/api/devices/:id',
    {
      schema: {
        params: DeviceParamsIdSchema,
        response: {
          204: Type.Null({ description: 'Device deleted (no content)' }),
          404: ErrorSchema,
        },
        summary: 'Delete a device',
        tags: ['Devices'],
      },
    },
    async (request, reply) => {
      try {
        await controller.deleteDevice(request.params.id)
        return reply.code(204).send(null)
      } catch {
        return reply.code(404).send({ error: 'Hardware profile deletion failed' })
      }
    },
  )

  // 7. SEND ON/OFF COMMAND (source = MANUAL)
  router.post(
    '/api/devices/:id/command',
    {
      schema: {
        body: DeviceCommandSchema,
        description:
          "Persists a MANUAL DeviceStateLog row, updates the device's `isActive`, and publishes the MQTT command to the Pi.",
        params: DeviceParamsIdSchema,
        response: {
          200: DeviceCommandResponseSchema,
          404: ErrorSchema,
        },
        summary: 'Send an immediate ON/OFF command',
        tags: ['Devices'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof DeviceCommandResponseSchema.static>(
          await controller.sendCommand(request.params.id, request.body.action),
        )
      } catch {
        return reply.code(404).send({ error: 'Device command dispatch failed' })
      }
    },
  )

  // 8. DEVICE STATE LOGS (ON/OFF history within a time range)
  router.get(
    '/api/devices/:id/state-logs',
    {
      schema: {
        description:
          'Returns device ON/OFF state-transition logs within the given time range, plus the state at the start boundary.',
        params: DeviceParamsIdSchema,
        querystring: DeviceStateLogQuerySchema,
        response: {
          200: DeviceStateLogsResponseSchema,
          404: ErrorSchema,
        },
        summary: 'Device ON/OFF state history',
        tags: ['Devices'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof DeviceStateLogsResponseSchema.static>(
          await controller.getDeviceStateLogs(request.params.id, request.query),
        )
      } catch (error) {
        server.log.error(
          { deviceId: request.params.id, err: error },
          'Device state log query failed',
        )
        return reply.code(404).send({ error: 'Device state log query failed' })
      }
    },
  )
}
