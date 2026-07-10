import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { GrowPhasesController } from './grow-phases.controller.js'
import {
  CreateGrowPhaseSchema,
  ErrorSchema,
  GrowPhaseArrayResponseSchema,
  GrowPhaseParamsCycleIdSchema,
  GrowPhaseParamsIdSchema,
  GrowPhaseResponseSchema,
  UpdateGrowPhaseSchema,
} from './grow-phases.schema.js'
import { cast } from '../../shared/cast.js'

export default async function growPhaseRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>()

  // Instantiate the controller exactly once for this group of routes
  const controller = new GrowPhasesController(server)

  // 1. READ ALL PHASES FOR A SPECIFIC GROW CYCLE
  router.get(
    '/api/grow-phases/cycle/:growCycleId',
    {
      schema: {
        description: 'Returns every phase attached to the cycle, ordered by `order` ascending.',
        params: GrowPhaseParamsCycleIdSchema,
        response: { 200: GrowPhaseArrayResponseSchema, 400: ErrorSchema },
        summary: 'List phases for a grow cycle',
        tags: ['GrowPhases'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof GrowPhaseArrayResponseSchema.static>(
          await controller.getPhasesByCycleId(request.params.growCycleId),
        )
      } catch (error) {
        router.log.error(error)
        return reply.code(400).send({ error: 'Failed to retrieve phases for this cycle' })
      }
    },
  )

  // 2. READ ONE INDIVIDUAL PHASE
  router.get(
    '/api/grow-phases/:id',
    {
      schema: {
        params: GrowPhaseParamsIdSchema,
        response: {
          200: GrowPhaseResponseSchema,
          404: ErrorSchema,
        },
        summary: 'Get one grow phase',
        tags: ['GrowPhases'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof GrowPhaseResponseSchema.static>(
          await controller.getGrowPhaseById(request.params.id),
        )
      } catch {
        return reply.code(404).send({ error: 'Grow phase record not found' })
      }
    },
  )

  // 3. CREATE A CUSTOM PHASE MANUALLY
  router.post(
    '/api/grow-phases',
    {
      schema: {
        body: CreateGrowPhaseSchema,
        response: {
          201: GrowPhaseResponseSchema,
          400: ErrorSchema,
        },
        summary: 'Create a new grow phase',
        tags: ['GrowPhases'],
      },
    },
    async (request, reply) => {
      try {
        const newPhase = await controller.createGrowPhase(request.body)
        return reply.code(201).send(cast<typeof GrowPhaseResponseSchema.static>(newPhase))
      } catch (error) {
        router.log.error(error)
        return reply.code(400).send({ error: 'Failed to create grow phase record' })
      }
    },
  )

  // 4. UPDATE A PHASE'S TARGET PARAMETERS
  router.put(
    '/api/grow-phases/:id',
    {
      schema: {
        body: UpdateGrowPhaseSchema,
        params: GrowPhaseParamsIdSchema,
        response: {
          200: GrowPhaseResponseSchema,
          400: ErrorSchema,
        },
        summary: 'Update a grow phase',
        tags: ['GrowPhases'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof GrowPhaseResponseSchema.static>(
          await controller.updateGrowPhase(request.params.id, request.body),
        )
      } catch (error) {
        router.log.error(error)
        return reply.code(400).send({ error: 'Failed to update grow phase record' })
      }
    },
  )

  // 5. DELETE A PHASE
  router.delete(
    '/api/grow-phases/:id',
    {
      schema: {
        params: GrowPhaseParamsIdSchema,
        response: {
          204: Type.Null({ description: 'Grow phase deleted (no content)' }),
          404: ErrorSchema,
        },
        summary: 'Delete a grow phase',
        tags: ['GrowPhases'],
      },
    },
    async (request, reply) => {
      try {
        await controller.deleteGrowPhase(request.params.id)
        return reply.code(204).send(null)
      } catch {
        return reply.code(404).send({ error: 'Record could not be deleted' })
      }
    },
  )

  // 6. ACTIVATE A PHASE (sets isActive, clears all others in the same cycle)
  router.patch(
    '/api/grow-phases/:id/activate',
    {
      schema: {
        description:
          'Atomically deactivates every other phase in the same grow cycle and marks this one as `isActive: true`.',
        params: GrowPhaseParamsIdSchema,
        response: {
          200: GrowPhaseResponseSchema,
          404: ErrorSchema,
        },
        summary: 'Activate a phase (deactivates siblings)',
        tags: ['GrowPhases'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof GrowPhaseResponseSchema.static>(
          await controller.activatePhase(request.params.id),
        )
      } catch {
        return reply.code(404).send({ error: 'Grow phase could not be activated' })
      }
    },
  )
}
