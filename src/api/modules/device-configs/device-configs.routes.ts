import { FastifyInstance } from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { DeviceConfigsController } from "./device-configs.controller.js";
import {
  CreateDeviceConfigSchema,
  UpdateDeviceConfigSchema,
  DeviceConfigParamsIdSchema,
  DeviceConfigParamsPhaseIdSchema,
} from "./device-configs.schema.js";

export default async function deviceConfigRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>();
  const controller = new DeviceConfigsController(server);

  // 1. READ ALL CONFIGS FOR A PHASE
  router.get(
    "/api/device-configs/phase/:phaseId",
    { schema: { params: DeviceConfigParamsPhaseIdSchema } },
    async (request, reply) => {
      try {
        return await controller.getConfigsByPhaseId(request.params.phaseId);
      } catch (error) {
        return reply
          .code(400)
          .send({ error: "Failed to load device configurations" });
      }
    },
  );

  // 2. READ ONE CONFIG
  router.get(
    "/api/device-configs/:id",
    { schema: { params: DeviceConfigParamsIdSchema } },
    async (request, reply) => {
      try {
        return await controller.getDeviceConfigById(request.params.id);
      } catch (error) {
        return reply
          .code(404)
          .send({ error: "Device configuration not found" });
      }
    },
  );

  // 3. CREATE
  router.post(
    "/api/device-configs",
    { schema: { body: CreateDeviceConfigSchema } },
    async (request, reply) => {
      try {
        const newConfig = await controller.createDeviceConfig(request.body);
        return reply.code(201).send(newConfig);
      } catch (error) {
        server.log.error(error);
        return reply
          .code(400)
          .send({ error: "Failed to create device configuration" });
      }
    },
  );

  // 4. UPDATE
  router.put(
    "/api/device-configs/:id",
    {
      schema: {
        params: DeviceConfigParamsIdSchema,
        body: UpdateDeviceConfigSchema,
      },
    },
    async (request, reply) => {
      try {
        return await controller.updateDeviceConfig(
          request.params.id,
          request.body,
        );
      } catch (error) {
        server.log.error(error);
        return reply
          .code(400)
          .send({ error: "Failed to update device configuration" });
      }
    },
  );

  // 5. DELETE
  router.delete(
    "/api/device-configs/:id",
    { schema: { params: DeviceConfigParamsIdSchema } },
    async (request, reply) => {
      try {
        await controller.deleteDeviceConfig(request.params.id);
        return reply.code(204).send();
      } catch (error) {
        return reply
          .code(404)
          .send({ error: "Device configuration deletion failed" });
      }
    },
  );
}
