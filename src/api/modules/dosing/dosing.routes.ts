import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import { cast } from '../../shared/cast.js'
import { DosingController } from './dosing.controller.js'
import { DosingPreviewRequestSchema, DosingPreviewResponseSchema } from './dosing.schema.js'

const ErrorResponseSchema = Type.Object({ error: Type.String() })

export default async function dosingRoutes(app: FastifyInstance) {
  const router = app.withTypeProvider<TypeBoxTypeProvider>()
  const controller = new DosingController(app.prisma)

  router.post(
    '/api/grow-phases/:growPhaseId/dosing/preview',
    {
      schema: {
        body: DosingPreviewRequestSchema,
        params: Type.Object({ growPhaseId: Type.String() }),
        response: { 200: DosingPreviewResponseSchema, 500: ErrorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        return reply.send(
          cast<typeof DosingPreviewResponseSchema.static>(
            await controller.preview(
              request.params.growPhaseId,
              request.body.period,
              request.body.reservoirLiters,
            ),
          ),
        )
      } catch (error) {
        app.log.error(error)
        return reply.code(500).send({ error: 'Failed to preview dosing' })
      }
    },
  )
}
