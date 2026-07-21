import Fastify from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'

// Import your modules directly from their structural folders
import controllerRoutes from './controllers/controllers.route.js'
import deviceRoutes from './devices/devices.routes.js'
import growPhaseRoutes from './grow-phases/grow-phases.routes.js'
import phaseEnvironmentRoutes from './phase-environments/phase-environments.routes.js'
import automationRuleRoutes from './automation-rules/automation-rules.routes.js'
import growCycleRoutes from './grow-cycles/grow-cycles.routes.js'
import sensorRoutes from './sensors/sensors.routes.js'
import telemetryRoutes from './telemetry/telemetry.routes.js'
import provisioningRoutes from './provisioning/provisioning.routes.js'
import nutrientsRoutes from './nutrients/nutrients.routes.js'
import phaseNutrientsRoutes from './phase-nutrients/phase-nutrients.routes.js'
import { closeDatabase, prisma } from '../../prisma.js'
import { endMqtt } from '../../mqtt/client.js'
import swaggerPlugin from '../../plugins/swagger.js'

export async function createTestApp() {
  const server = Fastify({
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
        useDefaults: true,
      },
    },
  }).withTypeProvider<TypeBoxTypeProvider>()

  // Attach a clean instance of your database client
  server.decorate('prisma', prisma)

  // Mirror production swagger registration so route schemas (incl. response
  // Schemas) are validated during tests. The UI is intentionally NOT mounted
  // In tests to keep the test app lean.
  await server.register(swaggerPlugin, { withUi: false })

  // Unify all route clusters under the test execution context
  await server.register(controllerRoutes)
  await server.register(deviceRoutes)
  await server.register(growCycleRoutes)
  await server.register(growPhaseRoutes)
  await server.register(phaseEnvironmentRoutes)
  await server.register(automationRuleRoutes)
  await server.register(sensorRoutes)
  await server.register(telemetryRoutes)
  await server.register(provisioningRoutes)
  await server.register(nutrientsRoutes)
  await server.register(phaseNutrientsRoutes)

  await server.ready()

  return { prisma, server }
}

// Tear down both the Fastify instance and the underlying pg pool so the
// Node test process can exit cleanly. Without `closeDatabase()` the pg
// Pool keeps an idle connection alive, which makes `node --test` log
// "Promise resolution is still pending" and wait 30-60s per file.
export async function teardownTestApp(server: any): Promise<void> {
  if (server && typeof server.close === 'function') {
    try {
      // Fastify's close is idempotent and resolves immediately when the
      // Server is already closed, so this is safe to call from any `after`.
      await Promise.race([server.close(), new Promise((resolve) => setTimeout(resolve, 2000))])
    } catch {
      // Ignore — best effort
    }
  }
  await Promise.all([closeDatabase(), endMqtt()])
}
