// Export the OpenAPI 3.0 document for the PiGrow Server API.
//
// Usage:  npm run openapi:export
// Output: ./openapi.json
//
// This script boots a Fastify instance with the same plugin/route graph as
// Production (without the Swagger UI), asks @fastify/swagger for the
// Generated document, and writes it to disk. No DB or MQTT connection is
// Required because routes only connect to those at request time, not at
// Registration. This keeps the script safe to run in CI without external
// Services.
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox'

import swaggerPlugin from '../src/plugins/swagger.js'
import controllerRoutes from '../src/api/modules/controllers/controllers.route.js'
import deviceRoutes from '../src/api/modules/devices/devices.routes.js'
import growPhaseRoutes from '../src/api/modules/grow-phases/grow-phases.routes.js'
import phaseEnvironmentRoutes from '../src/api/modules/phase-environments/phase-environments.routes.js'
import automationRuleRoutes from '../src/api/modules/automation-rules/automation-rules.routes.js'
import growCycleRoutes from '../src/api/modules/grow-cycles/grow-cycles.routes.js'
import sensorRoutes from '../src/api/modules/sensors/sensors.routes.js'
import telemetryRoutes from '../src/api/modules/telemetry/telemetry.routes.js'

const app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>()

await app.register(swaggerPlugin, { withUi: false })
await app.register(controllerRoutes)
await app.register(deviceRoutes)
await app.register(growCycleRoutes)
await app.register(growPhaseRoutes)
await app.register(phaseEnvironmentRoutes)
await app.register(automationRuleRoutes)
await app.register(sensorRoutes)
await app.register(telemetryRoutes)

await app.ready()

const document = app.swagger()
const outPath = resolve(process.cwd(), 'openapi.json')
writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

const pathCount = Object.keys(document.paths ?? {}).length
const tagCount = (document.tags ?? []).length
console.log(`✔ OpenAPI document written to ${outPath}`)
console.log(`  ${pathCount} paths across ${tagCount} tags`)

await app.close()
process.exit(0)
