import { FastifyInstance } from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { ControllersController } from "../controllers/controllers.controller.js";
import {
  ControllerParamsIdSchema,
  CreateControllerSchema,
  UpdateControllerSchema,
  HeartbeatSchema,
} from "./controllers.schema.js";

export default async function controllerRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>();
  const controller = new ControllersController(server);

  // 1. GET ALL REGISTERED RASPBERRY PIS
  router.get("/api/controllers", async (request, reply) => {
    return await controller.getAllControllers();
  });

  // 2. GET SINGLE HUBS SYSTEM TOPOLOGY
  router.get(
    "/api/controllers/:id",
    { schema: { params: ControllerParamsIdSchema } },
    async (request, reply) => {
      console.log({ request });
      try {
        return await controller.getControllerById(request.params.id);
      } catch (error) {
        return reply
          .code(404)
          .send({ error: "Raspberry Pi configuration profile not found" });
      }
    },
  );

  // 3. REGISTER / HEARTBEAT PROVISION APPARATUS
  router.post(
    "/api/controllers",
    { schema: { body: CreateControllerSchema } },
    async (request, reply) => {
      try {
        const hardwareHub = await controller.createController(request.body);
        return reply.code(201).send(hardwareHub);
      } catch (error) {
        server.log.error(error);
        return reply
          .code(400)
          .send({ error: "Failed to map controller network identity" });
      }
    },
  );

  // 4. ALTER METADATA OR STATUS SIGNAL
  router.put(
    "/api/controllers/:id",
    {
      schema: {
        params: ControllerParamsIdSchema,
        body: UpdateControllerSchema,
      },
    },
    async (request, reply) => {
      try {
        return await controller.updateController(
          request.params.id,
          request.body,
        );
      } catch (error) {
        server.log.error(error);
        return reply
          .code(400)
          .send({ error: "Unable to reconcile device parameters" });
      }
    },
  );

  // 5. UNREGISTER HUB APPARATUS
  router.delete(
    "/api/controllers/:id",
    { schema: { params: ControllerParamsIdSchema } },
    async (request, reply) => {
      try {
        await controller.deleteController(request.params.id);
        return reply.code(204).send();
      } catch (error) {
        return reply.code(404).send({ error: "Profile unlinking rejected" });
      }
    },
  );

  // 6. PI HEARTBEAT STATUS REPORTING
  router.patch(
    "/api/controllers/:id/heartbeat",
    {
      schema: {
        params: ControllerParamsIdSchema,
        body: HeartbeatSchema,
      },
    },
    async (request, reply) => {
      try {
        return await controller.heartbeat(
          request.params.id,
          request.body.status,
        );
      } catch (error) {
        return reply
          .code(404)
          .send({ error: "Controller not found for heartbeat update" });
      }
    },
  );
}
