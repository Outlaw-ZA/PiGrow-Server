import Fastify from "fastify";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";

// Import your modules directly from their structural folders
import controllerRoutes from "./controllers/controllers.route.js";
import deviceRoutes from "./devices/devices.routes.js";
import growPhaseRoutes from "./grow-phases/grow-phases.routes.js";
import growCycleRoutes from "./grow-cycles/grow-cycles.routes.js";
import deviceConfigRoutes from "./device-configs/device-configs.routes.js";
import telemetryRoutes from "./telemetry/telemetry.routes.js";
import { prisma } from "../../prisma.js";

export async function createTestApp() {
  const server = Fastify().withTypeProvider<TypeBoxTypeProvider>();

  // Attach a clean instance of your database client
  server.decorate("prisma", prisma);

  // Unify all route clusters under the test execution context
  await server.register(controllerRoutes);
  await server.register(deviceRoutes);
  await server.register(growCycleRoutes);
  await server.register(growPhaseRoutes);
  await server.register(deviceConfigRoutes);
  await server.register(telemetryRoutes);

  await server.ready();

  return { server, prisma };
}
