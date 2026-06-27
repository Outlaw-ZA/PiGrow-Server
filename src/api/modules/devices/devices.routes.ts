import { FastifyInstance } from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { DevicesController } from "./devices.controller.js";
import {
  DeviceParamsGrowCycleIdSchema,
  DeviceParamsIdSchema,
  CreateDeviceSchema,
  BatchCreateDeviceSchema,
  UpdateDeviceSchema,
  DeviceCommandSchema,
} from "./devices.schema.js";

export default async function deviceRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>();
  const controller = new DevicesController(server);

  // 1. GET ALL DEVICES ASSIGNED TO A SPECIFIC GROW
  router.get(
    "/api/devices/grow-cycle/:growCycleId",
    { schema: { params: DeviceParamsGrowCycleIdSchema } },
    async (request, reply) => {
      try {
        return await controller.getDevicesByGrowCycleId(
          request.params.growCycleId,
        );
      } catch (error) {
        return reply
          .code(400)
          .send({ error: "Failed to load hardware profiles" });
      }
    },
  );

  // 2. GET SINGLE DEVICE SPECIFICATIONS
  router.get(
    "/api/devices/:id",
    { schema: { params: DeviceParamsIdSchema } },
    async (request, reply) => {
      try {
        return await controller.getDeviceById(request.params.id);
      } catch (error) {
        return reply
          .code(404)
          .send({ error: "Physical hardware device not found" });
      }
    },
  );

  // 3. PROVISION A NEW DEVICE ONTO A GROW
  router.post(
    "/api/devices",
    { schema: { body: CreateDeviceSchema } },
    async (request, reply) => {
      try {
        const newDevice = await controller.createDevice(request.body);
        return reply.code(201).send(newDevice);
      } catch (error) {
        server.log.error(error);
        return reply
          .code(400)
          .send({ error: "Failed to map new hardware device" });
      }
    },
  );

  // 4. BULK PROVISION MULTIPLE DEVICES ONTO A GROW
  router.post(
    "/api/devices/batch",
    { schema: { body: BatchCreateDeviceSchema } },
    async (request, reply) => {
      try {
        const newDevices = await controller.createDevicesBatch(request.body);
        return reply.code(201).send(newDevices);
      } catch (error) {
        server.log.error(error);
        return reply
          .code(400)
          .send({ error: "Failed to map batch hardware devices" });
      }
    },
  );

  // 5. CHANGE DEVICE CONFIGURATION OR GPIO PIN
  router.put(
    "/api/devices/:id",
    { schema: { params: DeviceParamsIdSchema, body: UpdateDeviceSchema } },
    async (request, reply) => {
      try {
        return await controller.updateDevice(request.params.id, request.body);
      } catch (error) {
        server.log.error(error);
        return reply
          .code(400)
          .send({ error: "Hardware parameter update rejected" });
      }
    },
  );

  // 6. UNMAP / REMOVE A DEVICE
  router.delete(
    "/api/devices/:id",
    { schema: { params: DeviceParamsIdSchema } },
    async (request, reply) => {
      try {
        await controller.deleteDevice(request.params.id);
        return reply.code(204).send();
      } catch (error) {
        return reply.code(404).send({ error: "Hardware profile deletion failed" });
      }
    },
  );

  // 7. SEND ON/OFF COMMAND TO A DEVICE
  router.post(
    "/api/devices/:id/command",
    {
      schema: {
        params: DeviceParamsIdSchema,
        body: DeviceCommandSchema,
      },
    },
    async (request, reply) => {
      try {
        return await controller.sendCommand(
          request.params.id,
          request.body.action,
        );
      } catch (error) {
        return reply
          .code(404)
          .send({ error: "Device command dispatch failed" });
      }
    },
  );
}
