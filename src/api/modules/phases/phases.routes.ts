import { FastifyInstance } from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { PhasesController } from "./phases.controller.js";
import {
  CreatePhaseSchema,
  UpdatePhaseSchema,
  ParamsIdSchema,
  ParamsCycleIdSchema,
} from "./phases.schema.js";

export default async function cycleRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>();

  // Instantiate the controller exactly once for this group of routes
  const controller = new PhasesController(server);

  // READ ALL
  router.get(
    "/phases/:cycle_id",
    { schema: { params: ParamsCycleIdSchema } },
    async (request, reply) => {
      return await controller.getAllPhases(request.params.cycle_id);
    },
  );

  // READ ONE
  router.get(
    "/phases/:id",
    { schema: { params: ParamsIdSchema } },
    async (request, reply) => {
      try {
        return await controller.getPhaseById(request.params.id);
      } catch (error) {
        return reply.code(404).send({ error: "Phase record not found" });
      }
    },
  );

  // CREATE
  router.post(
    "/phases",
    { schema: { body: CreatePhaseSchema } },
    async (request, reply) => {
      try {
        const newCycle = await controller.createPhase(request.body);
        return reply.code(201).send(newCycle);
      } catch (error) {
        router.log.error(error);
        return reply.code(400).send({ error: "Failed to create phase record" });
      }
    },
  );

  // UPDATE
  router.put(
    "/phases/:id",
    { schema: { params: ParamsIdSchema, body: UpdatePhaseSchema } },
    async (request, reply) => {
      try {
        return await controller.updatePhase(request.params.id, request.body);
      } catch (error) {
        router.log.error(error);
        return reply.code(400).send({ error: "Failed to update phase record" });
      }
    },
  );

  // DELETE
  router.delete(
    "/phases/:id",
    { schema: { params: ParamsIdSchema } },
    async (request, reply) => {
      try {
        await controller.deletePhase(request.params.id);
        return reply.code(204).send();
      } catch (error) {
        return reply.code(404).send({ error: "Record could not be deleted" });
      }
    },
  );
}
