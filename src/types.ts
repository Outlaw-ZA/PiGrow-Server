import type { SensorType } from "./generated/client/enums.js";

export type { SensorType };

/**
 * A single numeric reading emitted by a physical sensor.
 */
export interface TelemetryReading {
  sensorType: SensorType;
  value: number;
}

/**
 * MQTT payload for `sensors/<sensorId>/telemetry`.
 * A single payload can carry one reading or several — useful for combo
 * sensors like `TEMP_HUMIDITY` probes that publish both metrics at once.
 */
export interface SensorData {
  readings: TelemetryReading[];
}
