import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { cast } from '../../shared/cast.js'
import { NutrientsController, NutrientsError } from './nutrients.controller.js'
import {
  CreateNutrientSchema,
  ErrorResponseSchema,
  NutrientConflictResponseSchema,
  NutrientInUseResponseSchema,
  NutrientSchema,
  UpdateNutrientSchema,
} from './nutrients.schema.js'

export default async function nutrientsRoutes(app: FastifyInstance) {
  const router = app.withTypeProvider<TypeBoxTypeProvider>()
  const controller = new NutrientsController(app.prisma)

  router.get(
    '/api/nutrients',
    { schema: { response: { 200: Type.Array(NutrientSchema), 500: ErrorResponseSchema } } },
    async (_request, reply) => {
      try {
        return reply.send(cast<(typeof NutrientSchema.static)[]>(await controller.list()))
      } catch (error) {
        app.log.error(error)
        return reply.code(500).send({ error: 'Failed to list nutrients' })
      }
    },
  )

  router.post(
    '/api/nutrients',
    {
      schema: {
        body: CreateNutrientSchema,
        response: {
          201: NutrientSchema,
          409: NutrientConflictResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        const result = await controller.create(request.body)
        if ('error' in result) {
          return reply.code(409).send(result)
        }
        return reply.code(201).send(cast<typeof NutrientSchema.static>(result))
      } catch (error) {
        app.log.error(error)
        return reply.code(500).send({ error: 'Failed to create nutrient' })
      }
    },
  )

  router.patch(
    '/api/nutrients/:id',
    {
      schema: {
        body: UpdateNutrientSchema,
        params: Type.Object({ id: Type.String() }),
        response: { 200: NutrientSchema, 404: ErrorResponseSchema, 409: NutrientConflictResponseSchema, 500: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(
          cast<typeof NutrientSchema.static>(
            await controller.update(request.params.id, request.body),
          ),
        )
      } catch (err) {
        if (err instanceof NutrientsError) {
          return reply.code(err.statusCode).send({ error: err.message })
        }
        throw err
      }
    },
  )

  router.delete(
    '/api/nutrients/:id',
    {
      schema: {
        params: Type.Object({ id: Type.String() }),
        response: {
          204: { type: 'null' },
          404: ErrorResponseSchema,
          409: NutrientInUseResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        await controller.remove(request.params.id)
        return reply.code(204).send(null)
      } catch (error) {
        if (error instanceof NutrientsError) {
          if (error.statusCode === 409) {
            return reply
              .code(409)
              .send({ error: 'NUTRIENT_IN_USE', referencing: error.referencing ?? 0 })
          }
          return reply.code(404).send({ error: error.message })
        }
        app.log.error(error)
        return reply.code(500).send({ error: 'Failed to delete nutrient' })
      }
    },
  )
}
