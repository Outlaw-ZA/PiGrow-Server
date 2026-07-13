import type { SensorData } from '../types.js'
import { prisma } from '../prisma.js'
import { io } from '../server.js'
import { evaluateThresholds } from '../automation/evaluator.js'

/**
 * Parses `sensors/<sensorId>/telemetry` payloads into telemetry rows.
 * A single payload may carry one reading or many (e.g. TEMP_HUMIDITY probes
 * publish both temperature and humidity in one go).
 *
 * Each reading is persisted against the sensor's controller's currently
 * active grow cycle. If no active grow cycle exists, the reading is dropped
 * and a warning is logged — telemetry rows require a non-null growCycleId
 * by schema.
 *
 * After persisting, every reading is fed to the threshold evaluator, which
 * may fire automation rules against the active grow cycle's phase environment.
 */
export async function handleTelemetry(topic: string, messageBuffer: Buffer): Promise<void> {
  try {
    const sensorId = topic.split('/')[1]
    if (!sensorId) {
      console.warn(`[telemetry] Ignoring malformed topic: ${topic}`)
      return
    }

    const payload: SensorData = JSON.parse(messageBuffer.toString())
    if (!payload?.readings || payload.readings.length === 0) {
      console.warn(`[telemetry] Empty payload from sensor ${sensorId}`)
      return
    }

    const sensor = await prisma.sensor.findUnique({
      include: {
        controller: {
          include: {
            growCycles: { take: 1, where: { isActive: true } },
          },
        },
      },
      where: { id: sensorId },
    })

    if (!sensor) {
      console.warn(`[telemetry] Unknown sensor id: ${sensorId}`)
      return
    }

    const activeGrowCycle = sensor.controller.growCycles[0]
    if (!activeGrowCycle) {
      console.warn(
        `[telemetry] Sensor ${sensorId} has no active grow cycle on controller ${sensor.controller.id}; dropping ${payload.readings.length} reading(s).`,
      )
      return
    }

    const persisted = await prisma.$transaction(
      payload.readings.map((reading) =>
        prisma.telemetry.create({
          data: {
            growCycleId: activeGrowCycle.id,
            sensorId: sensor.id,
            sensorType: reading.sensorType,
            value: reading.value,
          },
        }),
      ),
    )

    await prisma.sensor.update({
      data: { lastActive: new Date() },
      where: { id: sensor.id },
    })

    // Mark the controller ONLINE on every telemetry receipt. The RPi cannot
    // Reach the HTTP API on port 4000 (cross-subnet routing restriction), so
    // The heartbeat endpoint is unreachable — telemetry presence is the only
    // Reliable liveness signal.
    if (sensor.controller.status !== 'ONLINE') {
      await prisma.controller.update({
        data: { status: 'ONLINE', updatedAt: new Date() },
        where: { id: sensor.controller.id },
      }).catch((error: Error) =>
        console.error('[telemetry] Failed to update controller status:', error),
      )
    }

    console.log(
      `\n[telemetry] sensor=${sensor.name} (${sensor.id}) stored=${persisted.length} reading(s)`,
    )

    for (const row of persisted) {
      io.emit('frontend_telemetry', {
        growCycleId: row.growCycleId,
        sensorId: sensor.id,
        sensorName: sensor.name,
        sensorType: row.sensorType,
        timestamp: row.createdAt,
        value: row.value,
      })

      // Threshold evaluation is fire-and-forget so a slow evaluator never
      // Blocks the persistence path. Errors are logged inside the evaluator.
      void evaluateThresholds({
        growCycleId: activeGrowCycle.id,
        sensorId: sensor.id,
        sensorType: row.sensorType,
        value: row.value,
      }).catch((error) => {
        console.error('[telemetry] Threshold evaluator threw:', error)
      })
    }
  } catch (error) {
    console.error('[telemetry] Failed to process MQTT payload:', error)
  }
}
