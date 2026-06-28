import type { SensorData } from "../types.js";
import { prisma } from "../prisma.js";
import { io } from "../server.js";

/**
 * Parses `sensors/<sensorId>/telemetry` payloads into telemetry rows.
 * A single payload may carry one reading or many (e.g. TEMP_HUMIDITY probes
 * publish both temperature and humidity in one go).
 *
 * Each reading is persisted against the sensor's controller's currently
 * active grow cycle. If no active grow cycle exists, the reading is dropped
 * and a warning is logged — telemetry rows require a non-null growCycleId
 * by schema.
 */
export async function handleTelemetry(
  topic: string,
  messageBuffer: Buffer,
): Promise<void> {
  try {
    const sensorId = topic.split("/")[1];
    if (!sensorId) {
      console.warn(`[telemetry] Ignoring malformed topic: ${topic}`);
      return;
    }

    const payload: SensorData = JSON.parse(messageBuffer.toString());
    if (!payload?.readings || payload.readings.length === 0) {
      console.warn(`[telemetry] Empty payload from sensor ${sensorId}`);
      return;
    }

    const sensor = await prisma.sensor.findUnique({
      where: { id: sensorId },
      include: {
        controller: {
          include: {
            growCycles: { where: { isActive: true }, take: 1 },
          },
        },
      },
    });

    if (!sensor) {
      console.warn(`[telemetry] Unknown sensor id: ${sensorId}`);
      return;
    }

    const activeGrowCycle = sensor.controller.growCycles[0];
    if (!activeGrowCycle) {
      console.warn(
        `[telemetry] Sensor ${sensorId} has no active grow cycle on controller ${sensor.controller.id}; dropping ${payload.readings.length} reading(s).`,
      );
      return;
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
    );

    await prisma.sensor.update({
      where: { id: sensor.id },
      data: { lastActive: new Date() },
    });

    console.log(
      `\n[telemetry] sensor=${sensor.name} (${sensor.id}) stored=${persisted.length} reading(s)`,
    );

    for (const row of persisted) {
      io.emit("frontend_telemetry", {
        sensorId: sensor.id,
        sensorName: sensor.name,
        sensorType: row.sensorType,
        value: row.value,
        growCycleId: row.growCycleId,
        timestamp: row.createdAt,
      });
    }
  } catch (err) {
    console.error("[telemetry] Failed to process MQTT payload:", err);
  }
}
