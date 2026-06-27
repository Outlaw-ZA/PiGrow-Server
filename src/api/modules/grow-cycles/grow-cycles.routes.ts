import { FastifyInstance } from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import {
  GrowCyclesController,
  SkipPhaseError,
  ControllerBusyError,
} from "./grow-cycles.controller.js";
import {
  CreateGrowCycleSchema,
  UpdateGrowCycleSchema,
  GrowCycleParamsIdSchema,
  SkipPhaseQuerySchema,
} from "./grow-cycles.schema.js";

export default async function growCycleRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>();

  // Instantiate the controller exactly once for this group of routes
  const controller = new GrowCyclesController(server);

  // 1. READ ALL
  router.get("/api/grow-cycles", async (request, reply) => {
    return await controller.getAllGrowCycles();
  });

  // 2. READ ONE
  router.get(
    "/api/grow-cycles/:id",
    { schema: { params: GrowCycleParamsIdSchema } },
    async (request, reply) => {
      try {
        return await controller.getGrowCycleById(request.params.id);
      } catch (error) {
        return reply.code(404).send({ error: "Grow cycle record not found" });
      }
    },
  );

  // 3. CREATE
  router.post(
    "/api/grow-cycles",
    { schema: { body: CreateGrowCycleSchema } },
    async (request, reply) => {
      try {
        const newGrowCycle = await controller.createGrowCycle(request.body);
        return reply.code(201).send(newGrowCycle);
      } catch (error) {
        if (error instanceof ControllerBusyError) {
          return reply.code(409).send({ error: error.message });
        }
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code: string }).code === "P2002"
        ) {
          return reply
            .code(409)
            .send({ error: "Controller already has an active grow cycle" });
        }
        router.log.error(error);
        return reply
          .code(400)
          .send({ error: "Failed to create grow cycle record" });
      }
    },
  );

  // 4. UPDATE
  router.put(
    "/api/grow-cycles/:id",
    {
      schema: { params: GrowCycleParamsIdSchema, body: UpdateGrowCycleSchema },
    },
    async (request, reply) => {
      try {
        return await controller.updateGrowCycle(
          request.params.id,
          request.body,
        );
      } catch (error) {
        if (error instanceof ControllerBusyError) {
          return reply.code(409).send({ error: error.message });
        }
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code: string }).code === "P2002"
        ) {
          return reply
            .code(409)
            .send({ error: "Controller already has an active grow cycle" });
        }
        router.log.error(error);
        return reply
          .code(400)
          .send({ error: "Failed to update grow cycle record" });
      }
    },
  );

  // 5. DELETE
  router.delete(
    "/api/grow-cycles/:id",
    { schema: { params: GrowCycleParamsIdSchema } },
    async (request, reply) => {
      try {
        await controller.deleteGrowCycle(request.params.id);
        return reply.code(204).send();
      } catch (error) {
        return reply.code(404).send({ error: "Record could not be deleted" });
      }
    },
  );

  // 6. SKIP ACTIVE PHASE (atomic)
  router.post(
    "/api/grow-cycles/:id/skip-phase",
    {
      schema: {
        params: GrowCycleParamsIdSchema,
        querystring: SkipPhaseQuerySchema,
      },
    },
    async (request, reply) => {
      try {
        return await controller.skipPhase(
          request.params.id,
          request.query.today,
        );
      } catch (error) {
        if (error instanceof SkipPhaseError) {
          return reply.code(400).send({ error: error.message });
        }
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code: string }).code === "P2025"
        ) {
          return reply
            .code(404)
            .send({ error: "Grow cycle record not found" });
        }
        router.log.error(error);
        return reply
          .code(400)
          .send({ error: "Failed to skip active grow phase" });
      }
    },
  );

  // 7. END GROW (atomic)
  router.post(
    "/api/grow-cycles/:id/end-grow",
    {
      schema: {
        params: GrowCycleParamsIdSchema,
        querystring: SkipPhaseQuerySchema,
      },
    },
    async (request, reply) => {
      try {
        return await controller.endGrow(
          request.params.id,
          request.query.today,
        );
      } catch (error) {
        if (error instanceof SkipPhaseError) {
          return reply.code(400).send({ error: error.message });
        }
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code: string }).code === "P2025"
        ) {
          return reply
            .code(404)
            .send({ error: "Grow cycle record not found" });
        }
        router.log.error(error);
        return reply
          .code(400)
          .send({ error: "Failed to end grow cycle" });
      }
    },
  );
}
