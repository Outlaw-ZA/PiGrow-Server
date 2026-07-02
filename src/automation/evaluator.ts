import { prisma } from "../prisma.js";
import { resolvePeriod } from "./period.js";
import { issueAutoCommand } from "./command-publisher.js";
import type {
  SensorType as SensorTypeLiteral,
  DayNightPeriod as DayNightPeriodLiteral,
} from "../generated/client/enums.js";

interface EvaluateArgs {
  growCycleId: string;
  sensorType: SensorTypeLiteral;
  value: number;
  now?: Date;
}

interface EnvFields {
  tempMin: number | null;
  tempMax: number | null;
  tempTarget: number | null;
  humidityMin: number | null;
  humidityMax: number | null;
  humidityTarget: number | null;
  co2Min: number | null;
  co2Max: number | null;
  co2Target: number | null;
}

// Map a SensorType to the matching pair of threshold fields on PhaseEnvironment.
const SENSOR_TO_ENV_KEY: Record<SensorTypeLiteral, keyof EnvFields | null> = {
  TEMPERATURE: "tempMax", // sentinel — see resolveBoundary for min/max pair
  HUMIDITY: "humidityMax",
  TEMP_HUMIDITY: "tempMax", // prefers temperature when paired
  CO2: "co2Max",
  PH: null,
  EC: null,
};

// Returns the relevant min/max/target triple for a sensor type, or null when
// PhaseEnvironment has no thresholds for that type.
function getBoundaryFields(
  sensorType: SensorTypeLiteral,
  env: EnvFields,
): { min: number | null; max: number | null; target: number | null } | null {
  switch (sensorType) {
    case "TEMPERATURE":
    case "TEMP_HUMIDITY":
      return { min: env.tempMin, max: env.tempMax, target: env.tempTarget };
    case "HUMIDITY":
      return {
        min: env.humidityMin,
        max: env.humidityMax,
        target: env.humidityTarget,
      };
    case "CO2":
      return { min: env.co2Min, max: env.co2Max, target: env.co2Target };
    case "PH":
    case "EC":
      return null;
  }
}

// Touch SENSOR_TO_ENV_KEY to keep the map referenced (the runtime lookup
// is in getBoundaryFields; the map is left as documentation for callers).
void SENSOR_TO_ENV_KEY;

/**
 * Evaluate threshold rules for one persisted telemetry reading.
 *
 * Steps:
 *   1. Resolve the active phase for the grow cycle.
 *   2. Resolve the current day/night period.
 *   3. Load the PhaseEnvironment for the active phase + current period.
 *   4. For each enabled rule whose `watchedSensorType` matches and whose
 *      `period` matches (or is null), compare `value` to the matching
 *      threshold boundary. Apply cooldown and hysteresis. Issue the action
 *      via issueAutoCommand.
 */
export async function evaluateThresholds({
  growCycleId,
  sensorType,
  value,
  now = new Date(),
}: EvaluateArgs): Promise<void> {
  const cycle = await prisma.growCycle.findUnique({
    where: { id: growCycleId },
    select: {
      id: true,
      isActive: true,
      phases: {
        where: { isActive: true },
        take: 1,
        select: { id: true, dayStartMinutes: true, dayDurationMinutes: true },
      },
    },
  });
  if (!cycle || !cycle.isActive) return;
  const activePhase = cycle.phases[0];
  if (!activePhase) return;

  const period = resolvePeriod(
    activePhase.dayStartMinutes,
    activePhase.dayDurationMinutes,
    now,
  );

  const env = await prisma.phaseEnvironment.findUnique({
    where: { growPhaseId_period: { growPhaseId: activePhase.id, period } },
    select: {
      tempMin: true,
      tempMax: true,
      tempTarget: true,
      humidityMin: true,
      humidityMax: true,
      humidityTarget: true,
      co2Min: true,
      co2Max: true,
      co2Target: true,
    },
  });

  // Without an environment row for this period, no rule has a threshold to
  // compare against. Schedule rules run via the scheduler tick.
  if (!env) return;

  const boundary = getBoundaryFields(sensorType, env);
  if (!boundary) return;

  const rules = await prisma.automationRule.findMany({
    where: {
      enabled: true,
      condition: {
        in: [
          "ABOVE_MAX",
          "BELOW_MIN",
          "ABOVE_MIN",
          "BELOW_MAX",
          "ABOVE_TARGET",
          "BELOW_TARGET",
        ],
      },
      watchedSensorType: sensorType,
      // LIGHT devices are not eligible for automation rules; this filter is
      // defensive in case a stale row exists from before that constraint.
      device: { type: { not: "LIGHT" } },
      OR: [
        { growPhaseId: activePhase.id, growCycleId: null },
        { growCycleId: cycle.id, growPhaseId: null },
      ],
      AND: [
        {
          OR: [{ period }, { period: null }],
        },
      ],
    },
    include: { device: true },
  });

  // Per-device suppression: if an enabled ALWAYS_ON / ALWAYS_OFF rule covers
  // this device within the active scope + current period, threshold rules for
  // that same (device, scope, period) are skipped. The ALWAYS_* rule itself
  // is enforced by the automation scheduler on its 60s tick.
  const alwaysRules = await prisma.automationRule.findMany({
    where: {
      enabled: true,
      condition: { in: ["ALWAYS_ON", "ALWAYS_OFF"] },
      OR: [
        { growPhaseId: activePhase.id, growCycleId: null },
        { growCycleId: cycle.id, growPhaseId: null },
      ],
      AND: [{ OR: [{ period }, { period: null }] }],
    },
    select: { deviceId: true, period: true },
  });
  const pinnedDeviceIds = new Set(alwaysRules.map((r) => r.deviceId));

  for (const rule of rules) {
    if (rule.period !== null && rule.period !== period) continue;

    // Suppression: an enabled ALWAYS_* rule for this device + scope + period
    // pins the device; threshold rules for that device in that scope + period
    // are skipped. The pin is enforced by the automation scheduler.
    if (pinnedDeviceIds.has(rule.deviceId)) continue;

    if (!rule.device) continue;
    if (rule.device.automationMode === "MANUAL") continue;
    if (rule.device.automationMode === "ALWAYS_ON" && rule.action === "OFF") continue;
    if (rule.device.automationMode === "ALWAYS_OFF" && rule.action === "ON") continue;

    // Cooldown: skip if the rule fired recently.
    if (rule.lastTriggeredAt) {
      const elapsedMs = now.getTime() - rule.lastTriggeredAt.getTime();
      if (elapsedMs < rule.cooldownSeconds * 1000) continue;
    }

    let shouldFire = false;
    let reason = "";

    if (rule.condition === "ABOVE_MAX") {
      if (boundary.max !== null && value > boundary.max) {
        shouldFire = true;
        reason = `${sensorType} ${value} > max ${boundary.max} (${period})`;
      }
    } else if (rule.condition === "BELOW_MIN") {
      if (boundary.min !== null && value < boundary.min) {
        shouldFire = true;
        reason = `${sensorType} ${value} < min ${boundary.min} (${period})`;
      }
    } else if (rule.condition === "ABOVE_MIN") {
      if (boundary.min !== null && value > boundary.min) {
        shouldFire = true;
        reason = `${sensorType} ${value} > min ${boundary.min} (${period})`;
      }
    } else if (rule.condition === "BELOW_MAX") {
      if (boundary.max !== null && value < boundary.max) {
        shouldFire = true;
        reason = `${sensorType} ${value} < max ${boundary.max} (${period})`;
      }
    } else if (rule.condition === "ABOVE_TARGET") {
      if (boundary.target !== null && value > boundary.target) {
        shouldFire = true;
        reason = `${sensorType} ${value} > target ${boundary.target} (${period})`;
      }
    } else if (rule.condition === "BELOW_TARGET") {
      if (boundary.target !== null && value < boundary.target) {
        shouldFire = true;
        reason = `${sensorType} ${value} < target ${boundary.target} (${period})`;
      }
    }

    if (!shouldFire) continue;

    // Persist lastTriggeredAt *before* the command so concurrent ticks on
    // the same rule respect cooldown.
    await prisma.automationRule.update({
      where: { id: rule.id },
      data: { lastTriggeredAt: now },
    });

    const result = await issueAutoCommand(rule.device.id, rule.action, reason);
    if (result.issued) {
      console.log(
        `[evaluator] cycle=${cycle.id} rule=${rule.id} device=${rule.device.id} action=${rule.action} value=${value}`,
      );
    }
  }
}
