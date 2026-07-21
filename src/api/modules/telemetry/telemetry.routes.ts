import type { FastifyInstance } from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { TelemetryController } from './telemetry.controller.js'
import {
  CreateTelemetrySchema,
  ErrorSchema,
  TelemetryArrayResponseSchema,
  TelemetryParamsGrowCycleIdSchema,
  TelemetryRangeQuerySchema,
  TelemetryResponseSchema,
} from './telemetry.schema.js'
import { cast } from '../../shared/cast.js'

export default async function telemetryRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>()
  const controller = new TelemetryController(server)

  // 1. READ ALL TELEMETRY FOR A GROW CYCLE
  router.get(
    '/api/telemetry/grow-cycle/:growCycleId',
    {
      schema: {
        description:
          'Returns every persisted telemetry row for the cycle, newest first, with the originating sensor summary.',
        params: TelemetryParamsGrowCycleIdSchema,
        response: { 200: TelemetryArrayResponseSchema, 400: ErrorSchema },
        summary: 'List telemetry readings for a grow cycle',
        tags: ['Telemetry'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof TelemetryArrayResponseSchema.static>(
          await controller.getByGrowCycleId(request.params.growCycleId),
        )
      } catch {
        return reply.code(400).send({ error: 'Failed to load telemetry readings' })
      }
    },
  )

  // 2. READ LATEST READING PER SENSOR TYPE
  router.get(
    '/api/telemetry/grow-cycle/:growCycleId/latest',
    {
      schema: {
        description:
          'Returns the most recent telemetry row per (sensor, sensorType) pair on the cycle. A multi-type sensor such as TEMP_HUMIDITY yields one row per emitted type.',
        params: TelemetryParamsGrowCycleIdSchema,
        response: { 200: TelemetryArrayResponseSchema, 400: ErrorSchema },
        summary: 'Latest reading per sensor type',
        tags: ['Telemetry'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof TelemetryArrayResponseSchema.static>(
          await controller.getLatestByGrowCycleId(request.params.growCycleId),
        )
      } catch {
        return reply.code(400).send({ error: 'Failed to load latest telemetry' })
      }
    },
  )

  // 3. READ TELEMETRY IN A DATE RANGE
  router.get(
    '/api/telemetry/grow-cycle/:growCycleId/range',
    {
      schema: {
        params: TelemetryParamsGrowCycleIdSchema,
        querystring: TelemetryRangeQuerySchema,
        response: { 200: TelemetryArrayResponseSchema, 400: ErrorSchema },
        summary: 'Telemetry readings within a time range',
        tags: ['Telemetry'],
      },
    },
    async (request, reply) => {
      try {
        return cast<typeof TelemetryArrayResponseSchema.static>(
          await controller.getByGrowCycleIdRange(
            request.params.growCycleId,
            request.query.from,
            request.query.to,
          ),
        )
      } catch {
        return reply.code(400).send({ error: 'Failed to load telemetry range' })
      }
    },
  )

  // 4. INGEST TELEMETRY
  router.post(
    '/api/telemetry',
    {
      schema: {
        body: CreateTelemetrySchema,
        description:
          "Persists a telemetry row. In the normal MQTT flow, the server resolves the sensor's controller's active grow cycle and writes one row per reading; readings with no active grow cycle are dropped with a warning.",
        response: {
          201: TelemetryResponseSchema,
          400: ErrorSchema,
        },
        summary: 'Ingest a single telemetry reading',
        tags: ['Telemetry'],
      },
    },
    async (request, reply) => {
      try {
        const reading = await controller.createTelemetry(request.body)
        return reply.code(201).send(cast<typeof TelemetryResponseSchema.static>(reading))
      } catch (error) {
        server.log.error(error)
        return reply.code(400).send({ error: 'Failed to ingest telemetry reading' })
      }
    },
  )
}
