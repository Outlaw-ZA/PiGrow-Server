import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { cast } from '../../shared/cast.js'
import { PhaseNutrientsController, PhaseNutrientsError } from './phase-nutrients.controller.js'
import {
  CreatePhaseNutrientSchema,
  ErrorResponseSchema,
  PhaseNutrientConflictResponseSchema,
  PhaseNutrientSchema,
  UpdatePhaseNutrientSchema,
} from './phase-nutrients.schema.js'

export default async function phaseNutrientsRoutes(app: FastifyInstance) {
  const router = app.withTypeProvider<TypeBoxTypeProvider>()
  const controller = new PhaseNutrientsController(app.prisma)

  router.get(
    '/api/grow-phases/:growPhaseId/phase-nutrients',
    {
      schema: {
        params: Type.Object({ growPhaseId: Type.String() }),
        response: {
          200: Type.Array(PhaseNutrientSchema),
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(
          cast<(typeof PhaseNutrientSchema.static)[]>(
            await controller.list(request.params.growPhaseId),
          ),
        )
      } catch (error) {
        app.log.error(error)
        return reply.code(500).send({ error: 'Failed to list phase nutrients' })
      }
    },
  )

  router.post(
    '/api/grow-phases/:growPhaseId/phase-nutrients',
    {
      schema: {
        body: CreatePhaseNutrientSchema,
        params: Type.Object({ growPhaseId: Type.String() }),
        response: {
          201: PhaseNutrientSchema,
          404: ErrorResponseSchema,
          409: PhaseNutrientConflictResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply
          .code(201)
          .send(
            cast<typeof PhaseNutrientSchema.static>(
              await controller.create(request.params.growPhaseId, request.body),
            ),
          )
      } catch (error) {
        if (error instanceof PhaseNutrientsError) {
          return reply
            .code(error.statusCode)
            .send(
              error.statusCode === 409
                ? { error: 'PHASE_NUTRIENT_CONFLICT', existingId: error.existingId }
                : { error: error.message },
            )
        }
        app.log.error(error)
        return reply.code(500).send({ error: 'Failed to create phase nutrient' })
      }
    },
  )

  router.patch(
    '/api/grow-phases/:growPhaseId/phase-nutrients/:id',
    {
      schema: {
        body: UpdatePhaseNutrientSchema,
        params: Type.Object({ growPhaseId: Type.String(), id: Type.String() }),
        response: {
          200: PhaseNutrientSchema,
          404: ErrorResponseSchema,
          409: PhaseNutrientConflictResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(
          cast<typeof PhaseNutrientSchema.static>(
            await controller.update(request.params.growPhaseId, request.params.id, request.body),
          ),
        )
      } catch (error) {
        if (error instanceof PhaseNutrientsError) {
          return reply
            .code(error.statusCode)
            .send(
              error.statusCode === 409
                ? { error: 'PHASE_NUTRIENT_CONFLICT', existingId: error.existingId }
                : { error: error.message },
            )
        }
        throw error
      }
    },
  )

  router.delete(
    '/api/grow-phases/:growPhaseId/phase-nutrients/:id',
    {
      schema: {
        params: Type.Object({ growPhaseId: Type.String(), id: Type.String() }),
        response: {
          204: { type: 'null' },
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await controller.remove(request.params.growPhaseId, request.params.id)
        return reply.code(204).send(null)
      } catch (error) {
        if (error instanceof PhaseNutrientsError && error.statusCode === 404) {
          return reply.code(404).send({ error: error.message })
        }
        app.log.error(error)
        return reply.code(500).send({ error: 'Failed to delete phase nutrient' })
      }
    },
  )
}
