import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { PhaseEnvironmentsController } from './phase-environments.controller.js'
import {
  ErrorSchema,
  PhaseEnvironmentPairResponseSchema,
  PhaseEnvironmentPeriodParamsSchema,
  PhaseEnvironmentPhaseParamsSchema,
  PhaseEnvironmentResponseSchema,
  UpsertPhaseEnvironmentSchema,
} from './phase-environments.schema.js'
import { cast } from '../../shared/cast.js'

export default async function phaseEnvironmentRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>()
  const controller = new PhaseEnvironmentsController(server)

  // 1. GET both DAY + NIGHT environment rows for a phase
  router.get(
    '/api/grow-phases/:growPhaseId/environment',
    {
      schema: {
        description:
          "Returns both period rows for the phase. A missing period comes back as `null` so the FE can tell DAY exists and NIGHT doesn't (or vice versa).",
        params: PhaseEnvironmentPhaseParamsSchema,
        response: {
          200: PhaseEnvironmentPairResponseSchema,
          400: ErrorSchema,
          404: ErrorSchema,
        },
        summary: 'Get DAY + NIGHT environment rows for a phase',
        tags: ['PhaseEnvironments'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof PhaseEnvironmentPairResponseSchema.static>(
          await controller.getByPhaseId(request.params.growPhaseId),
        )
      } catch (error) {
        const status = (error as { statusCode?: number })?.statusCode ?? 400
        const msg =
          status === 404 ? 'Grow phase record not found' : 'Failed to load phase environment'
        return reply.code(status as 400).send({ error: msg })
      }
    },
  )

  // 2. UPSERT a single period (DAY or NIGHT)
  router.put(
    '/api/grow-phases/:growPhaseId/environment/:period',
    {
      schema: {
        body: UpsertPhaseEnvironmentSchema,
        description:
          "Creates the row if it doesn't exist, replaces it if it does. Omitted fields are cleared to `null`.",
        params: PhaseEnvironmentPeriodParamsSchema,
        response: {
          200: PhaseEnvironmentResponseSchema,
          400: ErrorSchema,
          404: ErrorSchema,
        },
        summary: 'Upsert a DAY or NIGHT environment row for a phase',
        tags: ['PhaseEnvironments'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof PhaseEnvironmentResponseSchema.static>(
          await controller.upsert(request.params.growPhaseId, request.params.period, request.body),
        )
      } catch (error) {
        const status = (error as { statusCode?: number })?.statusCode ?? 400
        const msg =
          status === 404 ? 'Grow phase record not found' : 'Failed to upsert phase environment'
        return reply.code(status as 400).send({ error: msg })
      }
    },
  )

  // 3. DELETE a period row
  router.delete(
    '/api/grow-phases/:growPhaseId/environment/:period',
    {
      schema: {
        params: PhaseEnvironmentPeriodParamsSchema,
        response: {
          204: Type.Null({ description: 'Environment row deleted (no content)' }),
          400: ErrorSchema,
          404: ErrorSchema,
        },
        summary: 'Delete a DAY or NIGHT environment row for a phase',
        tags: ['PhaseEnvironments'],
      },
    },
    async (request, reply) => {
      try {
        await controller.remove(request.params.growPhaseId, request.params.period)
        return reply.code(204).send(null)
      } catch (error) {
        const status = (error as { statusCode?: number })?.statusCode ?? 400
        const msg =
          status === 404 ? 'Phase environment row not found' : 'Failed to delete phase environment'
        return reply.code(status as 400).send({ error: msg })
      }
    },
  )
}
