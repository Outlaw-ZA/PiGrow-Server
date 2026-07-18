import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import {
  ControllerBusyError,
  ExtendPhaseError,
  GrowCyclesController,
  SkipPhaseError,
} from './grow-cycles.controller.js'
import {
  CreateGrowCycleSchema,
  ErrorSchema,
  ExtendActivePhaseErrorSchema,
  ExtendActivePhaseSchema,
  GrowCycleArrayResponseSchema,
  GrowCycleDetailResponseSchema,
  GrowCycleParamsIdSchema,
  GrowCycleUpdateResponseSchema,
  SkipPhaseQuerySchema,
  UpdateGrowCycleSchema,
} from './grow-cycles.schema.js'
import { cast } from '../../shared/cast.js'

export default async function growCycleRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>()

  // Instantiate the controller exactly once for this group of routes
  const controller = new GrowCyclesController(server)

  // 1. READ ALL
  router.get(
    '/api/grow-cycles',
    {
      schema: {
        response: { 200: GrowCycleArrayResponseSchema },
        summary: 'List all grow cycles',
        tags: ['GrowCycles'],
      },
    },
    async () =>
      cast<typeof GrowCycleArrayResponseSchema.static>(await controller.getAllGrowCycles()),
  )

  // 2. READ ONE
  router.get(
    '/api/grow-cycles/:id',
    {
      schema: {
        params: GrowCycleParamsIdSchema,
        response: {
          200: GrowCycleDetailResponseSchema,
          404: ErrorSchema,
        },
        summary: 'Get one grow cycle with its phases + environments',
        tags: ['GrowCycles'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof GrowCycleDetailResponseSchema.static>(
          await controller.getGrowCycleById(request.params.id),
        )
      } catch {
        return reply.code(404).send({ error: 'Grow cycle record not found' })
      }
    },
  )

  // 3. CREATE
  router.post(
    '/api/grow-cycles',
    {
      schema: {
        body: CreateGrowCycleSchema,
        response: {
          201: GrowCycleDetailResponseSchema,
          400: ErrorSchema,
          409: ErrorSchema,
        },
        summary: 'Create a new grow cycle',
        tags: ['GrowCycles'],
      },
    },
    async (request, reply) => {
      try {
        const newGrowCycle = await controller.createGrowCycle(request.body)
        return reply.code(201).send(cast<typeof GrowCycleDetailResponseSchema.static>(newGrowCycle))
      } catch (error) {
        if (error instanceof ControllerBusyError) {
          return reply.code(409).send({ error: error.message })
        }
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'P2002'
        ) {
          return reply.code(409).send({ error: 'Controller already has an active grow cycle' })
        }
        router.log.error(error)
        return reply.code(400).send({ error: 'Failed to create grow cycle record' })
      }
    },
  )

  // 4. UPDATE
  router.put(
    '/api/grow-cycles/:id',
    {
      schema: {
        body: UpdateGrowCycleSchema,
        params: GrowCycleParamsIdSchema,
        response: {
          200: GrowCycleUpdateResponseSchema,
          400: ErrorSchema,
          409: ErrorSchema,
        },
        summary: 'Update a grow cycle',
        tags: ['GrowCycles'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof GrowCycleUpdateResponseSchema.static>(
          await controller.updateGrowCycle(request.params.id, request.body),
        )
      } catch (error) {
        if (error instanceof ControllerBusyError) {
          return reply.code(409).send({ error: error.message })
        }
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'P2002'
        ) {
          return reply.code(409).send({ error: 'Controller already has an active grow cycle' })
        }
        router.log.error(error)
        return reply.code(400).send({ error: 'Failed to update grow cycle record' })
      }
    },
  )

  // 5. DELETE
  router.delete(
    '/api/grow-cycles/:id',
    {
      schema: {
        params: GrowCycleParamsIdSchema,
        response: {
          204: Type.Null({ description: 'Grow cycle deleted (no content)' }),
          404: ErrorSchema,
        },
        summary: 'Delete a grow cycle',
        tags: ['GrowCycles'],
      },
    },
    async (request, reply) => {
      try {
        await controller.deleteGrowCycle(request.params.id)
        return reply.code(204).send(null)
      } catch {
        return reply.code(404).send({ error: 'Record could not be deleted' })
      }
    },
  )

  // 6. SKIP ACTIVE PHASE (atomic)
  router.post(
    '/api/grow-cycles/:id/skip-phase',
    {
      schema: {
        description:
          "Atomically ends the active phase, re-computes each phase's `startAt`/`endAt`, and activates the next phase.",
        params: GrowCycleParamsIdSchema,
        querystring: SkipPhaseQuerySchema,
        response: {
          200: GrowCycleDetailResponseSchema,
          400: ErrorSchema,
          404: ErrorSchema,
        },
        summary: 'Skip the currently active grow phase',
        tags: ['GrowCycles'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof GrowCycleDetailResponseSchema.static>(
          await controller.skipPhase(request.params.id, request.query.today),
        )
      } catch (error) {
        if (error instanceof SkipPhaseError) {
          return reply.code(400).send({ error: error.message })
        }
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'P2025'
        ) {
          return reply.code(404).send({ error: 'Grow cycle record not found' })
        }
        router.log.error(error)
        return reply.code(400).send({ error: 'Failed to skip active grow phase' })
      }
    },
  )

  // 7. EXTEND ACTIVE PHASE (atomic)
  router.post(
    '/api/grow-cycles/:id/extend-active-phase',
    {
      schema: {
        body: ExtendActivePhaseSchema,
        description:
          "Atomically extends the active phase and shifts every subsequent phase's dates.",
        params: GrowCycleParamsIdSchema,
        response: {
          200: GrowCycleDetailResponseSchema,
          400: ErrorSchema,
          404: ErrorSchema,
          409: ExtendActivePhaseErrorSchema,
        },
        summary: 'Extend the currently active grow phase',
        tags: ['GrowCycles'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof GrowCycleDetailResponseSchema.static>(
          await controller.extendActivePhase(request.params.id, request.body.days),
        )
      } catch (error) {
        if (error instanceof ExtendPhaseError) {
          return reply.code(409).send({ code: error.code, error: error.message })
        }
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'P2025'
        ) {
          return reply.code(404).send({ error: 'Grow cycle record not found' })
        }
        router.log.error(error)
        return reply.code(400).send({ error: 'Failed to extend active grow phase' })
      }
    },
  )

  // 8. END GROW (atomic)
  router.post(
    '/api/grow-cycles/:id/end-grow',
    {
      schema: {
        description:
          'Atomically ends the active phase, marks the cycle inactive, and persists the final phase dates.',
        params: GrowCycleParamsIdSchema,
        querystring: SkipPhaseQuerySchema,
        response: {
          200: GrowCycleDetailResponseSchema,
          400: ErrorSchema,
          404: ErrorSchema,
        },
        summary: 'End the entire grow cycle',
        tags: ['GrowCycles'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof GrowCycleDetailResponseSchema.static>(
          await controller.endGrow(request.params.id, request.query.today),
        )
      } catch (error) {
        if (error instanceof SkipPhaseError) {
          return reply.code(400).send({ error: error.message })
        }
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as { code: string }).code === 'P2025'
        ) {
          return reply.code(404).send({ error: 'Grow cycle record not found' })
        }
        router.log.error(error)
        return reply.code(400).send({ error: 'Failed to end grow cycle' })
      }
    },
  )
}
