import Fastify from 'fastify'
import cors from '@fastify/cors'
import { handleTelemetry } from './mqtt-handlers/telemetry-handler.js'
import { handleDeviceState } from './mqtt-handlers/device-state-handler.js'
import mqttMatch from 'mqtt-match'
import { Server as SocketIOServer } from 'socket.io'
import prismaPlugin from './plugins/prisma.js'
import swaggerPlugin from './plugins/swagger.js'
import growCycleRoutes from './api/modules/grow-cycles/grow-cycles.routes.js'
import growPhaseRoutes from './api/modules/grow-phases/grow-phases.routes.js'
import phaseEnvironmentRoutes from './api/modules/phase-environments/phase-environments.routes.js'
import automationRuleRoutes from './api/modules/automation-rules/automation-rules.routes.js'
import controllerRoutes from './api/modules/controllers/controllers.route.js'
import deviceRoutes from './api/modules/devices/devices.routes.js'
import sensorRoutes from './api/modules/sensors/sensors.routes.js'
import telemetryRoutes from './api/modules/telemetry/telemetry.routes.js'
import { MQTT_BROKER_URL, mqttClient } from './mqtt/client.js'
import { prisma } from './prisma.js'
import { automationScheduler } from './automation/scheduler.js'
import { intervalScheduler } from './automation/interval-scheduler.js'

// 1. Initialize Fastify and register CORS for the Frontend
const fastify = Fastify({
  ajv: {
    // Disable type coercion so JSON `null` for nullable numeric fields stays `null`
    // (default coercion converts `null` -> 0 which corrupts the PhaseEnvironment
    // payload semantics for our automation engine).
    customOptions: {
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: true,
    },
  },
  logger: true,
})
await fastify.register(cors, {
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  origin: '*',
})

// 2. Initialize Socket.io by binding it directly to Fastify's underlying HTTP server instance
export const io = new SocketIOServer(fastify.server, {
  cors: {
    methods: ['GET', 'POST'],
    origin: '*',
  },
})

// 2. Manage frontend socket connections
io.on('connection', (socket) => {
  console.log(`💻 Frontend Client Connected: ${socket.id}`)

  // Listen for commands coming FROM the frontend dashboard to control the Pi
  socket.on('ui_command', (data) => {
    console.log('Command received from UI dashboard:', data)

    // Relay the frontend action down to the RPi via MQTT
    const targetTopic = `devices/${data.deviceId}/commands`
    mqttClient.publish(
      targetTopic,
      JSON.stringify({
        action: data.action,
        pin: data.pin,
        timestamp: Date.now(),
      }),
    )

    // Persist an audit log row. Fire-and-forget so a slow DB doesn't
    // Block the dashboard round-trip; errors are logged but do not
    // Affect the MQTT publish.
    if (data?.deviceId && (data.action === 'ON' || data.action === 'OFF')) {
      prisma.deviceStateLog
        .create({
          data: {
            action: data.action,
            deviceId: data.deviceId,
            source: 'UI',
          },
        })
        .catch((error) => {
          console.error('[ui_command] Failed to write DeviceStateLog:', error)
        })
    }
  })

  socket.on('disconnect', () => console.log(`💻 Frontend Client Disconnected`))
})

// Dynamic Topic Registry Map
const topicRegistry: Record<string, (topic: string, message: Buffer) => void> = {
  'devices/+/state': handleDeviceState,
  'sensors/+/telemetry': handleTelemetry,
}

mqttClient.on('connect', () => {
  console.log(`\n⚡ Backend Server connected to MQTT Broker at: ${MQTT_BROKER_URL}`)

  // Subscribe to all registry definitions
  Object.keys(topicRegistry).forEach((topicPattern) => {
    mqttClient.subscribe(topicPattern, (err) => {
      if (err) {
        console.error(`❌ Subscription failed for ${topicPattern}:`, err)
      } else {
        console.log(`✔ Subscribed to: ${topicPattern}`)
      }
    })
  })
})

// Central Message Pipeline Disambiguation
mqttClient.on('message', (topic: string, message: Buffer) => {
  const matchingPattern = Object.keys(topicRegistry).find((pattern) => mqttMatch(pattern, topic))

  if (matchingPattern) {
    topicRegistry[matchingPattern](topic, message)
  } else {
    console.warn(`⚠️ Warning: Received data on unhandled topic: ${topic}`)
  }
})

await fastify.register(prismaPlugin)
await fastify.register(swaggerPlugin, { withUi: true })
await fastify.register(growCycleRoutes)
await fastify.register(growPhaseRoutes)
await fastify.register(phaseEnvironmentRoutes)
await fastify.register(automationRuleRoutes)
await fastify.register(controllerRoutes)
await fastify.register(deviceRoutes)
await fastify.register(sensorRoutes)
await fastify.register(telemetryRoutes)

// 5. Start the automation scheduler (60s tick)
automationScheduler.start()
const stopScheduler = () => automationScheduler.stop()
fastify.addHook('onClose', stopScheduler)

// 5b. Start the interval scheduler (5s tick for INTERVAL / duty-cycle rules)
intervalScheduler.start()
const stopInterval = () => intervalScheduler.stop()
fastify.addHook('onClose', stopInterval)

// 6. Start Fastify (Listen on Port 4000 for both REST and Socket.io traffic)
const start = async () => {
  try {
    await fastify.listen({ host: '0.0.0.0', port: 4000 })
    console.log('🚀 Unified Server engine listening on port 4000')
  } catch (error) {
    fastify.log.error(error)
    process.exit(1)
  }
}

start()
