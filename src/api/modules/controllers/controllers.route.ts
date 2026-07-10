import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import { ControllersController } from '../controllers/controllers.controller.js'
import {
  ControllerCreateResponseSchema,
  ControllerDetailResponseSchema,
  ControllerParamsIdSchema,
  ControllerResponseSchema,
  ControllersArrayResponseSchema,
  CreateControllerSchema,
  ErrorSchema,
  HeartbeatSchema,
  UpdateControllerSchema,
} from './controllers.schema.js'
import { cast } from '../../shared/cast.js'

export default async function controllerRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>()
  const controller = new ControllersController(server)

  // 1. GET ALL REGISTERED RASPBERRY PIS
  router.get(
    '/api/controllers',
    {
      schema: {
        description:
          'Returns every Raspberry Pi hub known to the server, ordered newest-first by `createdAt`.',
        response: {
          200: ControllersArrayResponseSchema,
        },
        summary: 'List all registered controllers',
        tags: ['Controllers'],
      },
    },
    async () =>
      cast<typeof ControllersArrayResponseSchema.static>(await controller.getAllControllers()),
  )

  // 2. GET SINGLE HUBS SYSTEM TOPOLOGY
  router.get(
    '/api/controllers/:id',
    {
      schema: {
        description:
          'Returns the controller plus its active grow cycle (with the active phase and its DAY/NIGHT environments), its persistent device inventory, and its sensor inventory.',
        params: ControllerParamsIdSchema,
        response: {
          200: ControllerDetailResponseSchema,
          404: ErrorSchema,
        },
        summary: 'Get one controller with its topology',
        tags: ['Controllers'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof ControllerDetailResponseSchema.static>(
          await controller.getControllerById(request.params.id),
        )
      } catch {
        return reply.code(404).send({ error: 'Raspberry Pi configuration profile not found' })
      }
    },
  )

  // 3. REGISTER / HEARTBEAT PROVISION APPARATUS
  router.post(
    '/api/controllers',
    {
      schema: {
        body: CreateControllerSchema,
        description:
          'Creates a new controller record, or — if a controller with the same `macAddress` already exists — returns the existing record (sensors are only seeded on the first create).',
        response: {
          201: ControllerCreateResponseSchema,
          400: ErrorSchema,
        },
        summary: 'Register or upsert a controller',
        tags: ['Controllers'],
      },
    },
    async (request, reply) => {
      try {
        const hardwareHub = await controller.createController(request.body)
        return reply.code(201).send(cast<typeof ControllerCreateResponseSchema.static>(hardwareHub))
      } catch (error) {
        server.log.error(error)
        return reply.code(400).send({ error: 'Failed to map controller network identity' })
      }
    },
  )

  // 4. ALTER METADATA OR STATUS SIGNAL
  router.put(
    '/api/controllers/:id',
    {
      schema: {
        body: UpdateControllerSchema,
        params: ControllerParamsIdSchema,
        response: {
          200: ControllerResponseSchema,
          400: ErrorSchema,
        },
        summary: 'Update controller metadata or status',
        tags: ['Controllers'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof ControllerResponseSchema.static>(
          await controller.updateController(request.params.id, request.body),
        )
      } catch (error) {
        server.log.error(error)
        return reply.code(400).send({ error: 'Unable to reconcile device parameters' })
      }
    },
  )

  // 5. UNREGISTER HUB APPARATUS
  router.delete(
    '/api/controllers/:id',
    {
      schema: {
        params: ControllerParamsIdSchema,
        response: {
          204: Type.Null({ description: 'Controller deleted (no content)' }),
          404: ErrorSchema,
        },
        summary: 'Unregister a controller',
        tags: ['Controllers'],
      },
    },
    async (request, reply) => {
      try {
        await controller.deleteController(request.params.id)
        return reply.code(204).send(null)
      } catch {
        return reply.code(404).send({ error: 'Profile unlinking rejected' })
      }
    },
  )

  // 6. PI HEARTBEAT STATUS REPORTING
  router.patch(
    '/api/controllers/:id/heartbeat',
    {
      schema: {
        body: HeartbeatSchema,
        description:
          'Lightweight endpoint the Pi client calls periodically to announce ONLINE / OFFLINE status.',
        params: ControllerParamsIdSchema,
        response: {
          200: ControllerResponseSchema,
          404: ErrorSchema,
        },
        summary: 'Receive a Pi heartbeat status update',
        tags: ['Controllers'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof ControllerResponseSchema.static>(
          await controller.heartbeat(request.params.id, request.body.status),
        )
      } catch {
        return reply.code(404).send({ error: 'Controller not found for heartbeat update' })
      }
    },
  )
}
