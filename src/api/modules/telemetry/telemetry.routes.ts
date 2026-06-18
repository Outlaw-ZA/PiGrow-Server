import { FastifyInstance } from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { TelemetryController } from "./telemetry.controller.js";
import {
  CreateTelemetrySchema,
  TelemetryParamsGrowCycleIdSchema,
  TelemetryRangeQuerySchema,
} from "./telemetry.schema.js";

export default async function telemetryRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>();
  const controller = new TelemetryController(server);

  // 1. READ ALL TELEMETRY FOR A GROW CYCLE
  router.get(
    "/api/telemetry/grow-cycle/:growCycleId",
    { schema: { params: TelemetryParamsGrowCycleIdSchema } },
    async (request, reply) => {
      try {
        return await controller.getByGrowCycleId(
          request.params.growCycleId,
        );
      } catch (error) {
        return reply
          .code(400)
          .send({ error: "Failed to load telemetry readings" });
      }
    },
  );

  // 2. READ LATEST READING PER SENSOR TYPE
  router.get(
    "/api/telemetry/grow-cycle/:growCycleId/latest",
    { schema: { params: TelemetryParamsGrowCycleIdSchema } },
    async (request, reply) => {
      try {
        return await controller.getLatestByGrowCycleId(
          request.params.growCycleId,
        );
      } catch (error) {
        return reply
          .code(400)
          .send({ error: "Failed to load latest telemetry" });
      }
    },
  );

  // 3. READ TELEMETRY IN A DATE RANGE
  router.get(
    "/api/telemetry/grow-cycle/:growCycleId/range",
    {
      schema: {
        params: TelemetryParamsGrowCycleIdSchema,
        querystring: TelemetryRangeQuerySchema,
      },
    },
    async (request, reply) => {
      try {
        return await controller.getByGrowCycleIdRange(
          request.params.growCycleId,
          request.query.from,
          request.query.to,
        );
      } catch (error) {
        return reply
          .code(400)
          .send({ error: "Failed to load telemetry range" });
      }
    },
  );

  // 4. INGEST TELEMETRY
  router.post(
    "/api/telemetry",
    { schema: { body: CreateTelemetrySchema } },
    async (request, reply) => {
      try {
        const reading = await controller.createTelemetry(request.body);
        return reply.code(201).send(reading);
      } catch (error) {
        server.log.error(error);
        return reply
          .code(400)
          .send({ error: "Failed to ingest telemetry reading" });
      }
    },
  );
}
