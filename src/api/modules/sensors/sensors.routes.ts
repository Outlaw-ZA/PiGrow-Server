import { FastifyInstance } from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { SensorsController } from "./sensors.controller.js";
import {
  CreateSensorSchema,
  SensorParamsControllerIdSchema,
  SensorParamsIdSchema,
  UpdateSensorSchema,
} from "./sensors.schema.js";

export default async function sensorRoutes(server: FastifyInstance) {
  const router = server.withTypeProvider<TypeBoxTypeProvider>();
  const controller = new SensorsController(server);

  // 1. LIST SENSORS FOR A CONTROLLER
  router.get(
    "/api/sensors/controller/:controllerId",
    { schema: { params: SensorParamsControllerIdSchema } },
    async (request, reply) => {
      try {
        return await controller.getSensorsByControllerId(
          request.params.controllerId,
        );
      } catch (error) {
        return reply
          .code(400)
          .send({ error: "Failed to load sensor inventory" });
      }
    },
  );

  // 2. GET A SINGLE SENSOR
  router.get(
    "/api/sensors/:id",
    { schema: { params: SensorParamsIdSchema } },
    async (request, reply) => {
      try {
        return await controller.getSensorById(request.params.id);
      } catch (error) {
        return reply.code(404).send({ error: "Sensor not found" });
      }
    },
  );

  // 3. PROVISION A NEW SENSOR
  router.post(
    "/api/sensors",
    { schema: { body: CreateSensorSchema } },
    async (request, reply) => {
      try {
        const sensor = await controller.createSensor(request.body);
        return reply.code(201).send(sensor);
      } catch (error) {
        server.log.error(error);
        return reply.code(400).send({ error: "Failed to register sensor" });
      }
    },
  );

  // 4. UPDATE SENSOR CONFIGURATION
  router.put(
    "/api/sensors/:id",
    { schema: { params: SensorParamsIdSchema, body: UpdateSensorSchema } },
    async (request, reply) => {
      try {
        return await controller.updateSensor(
          request.params.id,
          request.body,
        );
      } catch (error) {
        server.log.error(error);
        return reply
          .code(400)
          .send({ error: "Failed to update sensor configuration" });
      }
    },
  );

  // 5. REMOVE A SENSOR
  router.delete(
    "/api/sensors/:id",
    { schema: { params: SensorParamsIdSchema } },
    async (request, reply) => {
      try {
        await controller.deleteSensor(request.params.id);
        return reply.code(204).send();
      } catch (error) {
        return reply.code(404).send({ error: "Sensor deletion failed" });
      }
    },
  );
}
