import fp from 'fastify-plugin'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import type { FastifyPluginAsync } from 'fastify'

export interface SwaggerPluginOptions {
  withUi?: boolean
}

const swaggerPlugin: FastifyPluginAsync<SwaggerPluginOptions> = async (fastify, opts) => {
  const withUi = opts.withUi ?? true

  await fastify.register(swagger, {
    openapi: {
      info: {
        description:
          'REST API for the PiGrow indoor-grow automation backend. Every route is mounted under `/api`. The PiGrow client dashboard, Raspberry Pi MQTT bridge, and external integrators consume these endpoints.',
        title: 'PiGrow Server API',
        version: '1.0.0',
      },
      openapi: '3.0.3',
      tags: [
        { description: 'Raspberry Pi hub registration and heartbeat', name: 'Controllers' },
        { description: 'GPIO relay / actuator inventory per controller', name: 'Devices' },
        { description: 'Sensor probe inventory per controller', name: 'Sensors' },
        { description: 'Grow run scheduling and lifecycle', name: 'GrowCycles' },
        { description: 'Phases within a grow cycle, with day/night schedule', name: 'GrowPhases' },
        {
          description: 'Per-phase DAY / NIGHT environmental thresholds',
          name: 'PhaseEnvironments',
        },
        { description: 'Per-device trigger rules (threshold + ALWAYS_*)', name: 'AutomationRules' },
        { description: 'Sensor telemetry ingestion and queries', name: 'Telemetry' },
      ],
    },
  })

  if (withUi) {
    await fastify.register(swaggerUi, {
      routePrefix: '/documentation',
      uiConfig: {
        deepLinking: true,
        docExpansion: 'list',
      },
    })
  }
}

export default fp(swaggerPlugin, {
  name: 'pigrow-swagger',
})
