import { prisma } from '../prisma.js'
import { resolvePeriod } from './period.js'
import { issueAutoCommand } from './command-publisher.js'
import type {
  DayNightPeriod as DayNightPeriodLiteral,
  SensorType as SensorTypeLiteral,
} from '../generated/client/enums.js'

interface EvaluateArgs {
  growCycleId: string
  sensorId?: string // Optional — staleness check is skipped when omitted
  sensorType: SensorTypeLiteral
  value: number
  now?: Date
}

interface EnvFields {
  tempMin: number | null
  tempMax: number | null
  tempTarget: number | null
  humidityMin: number | null
  humidityMax: number | null
  humidityTarget: number | null
  co2Min: number | null
  co2Max: number | null
  co2Target: number | null
}

// Map a SensorType to the matching pair of threshold fields on PhaseEnvironment.
const SENSOR_TO_ENV_KEY: Record<SensorTypeLiteral, keyof EnvFields | null> = {
  CO2: 'co2Max',
  EC: null,
  HUMIDITY: 'humidityMax',
  PH: null,
  TEMPERATURE: 'tempMax', // Sentinel — see resolveBoundary for min/max pair
  TEMP_HUMIDITY: 'tempMax', // Prefers temperature when paired,
}

// Returns the relevant min/max/target triple for a sensor type, or null when
// PhaseEnvironment has no thresholds for that type.
function getBoundaryFields(
  sensorType: SensorTypeLiteral,
  env: EnvFields,
): { min: number | null; max: number | null; target: number | null } | null {
  switch (sensorType) {
    case 'TEMPERATURE':
    case 'TEMP_HUMIDITY': {
      return { max: env.tempMax, min: env.tempMin, target: env.tempTarget }
    }
    case 'HUMIDITY': {
      return {
        max: env.humidityMax,
        min: env.humidityMin,
        target: env.humidityTarget,
      }
    }
    case 'CO2': {
      return { max: env.co2Max, min: env.co2Min, target: env.co2Target }
    }
    case 'PH':
    case 'EC': {
      return null
    }
  }
}

// Touch SENSOR_TO_ENV_KEY to keep the map referenced (the runtime lookup
// Is in getBoundaryFields; the map is left as documentation for callers).
void SENSOR_TO_ENV_KEY

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
const STALE_SENSOR_MS = 120_000 // 2 minutes — 4x a typical 30s interval

export async function evaluateThresholds({
  growCycleId,
  sensorId,
  sensorType,
  value,
  now = new Date(),
}: EvaluateArgs): Promise<void> {
  const cycle = await prisma.growCycle.findUnique({
    select: {
      id: true,
      isActive: true,
      phases: {
        select: { dayDurationMinutes: true, dayStartMinutes: true, id: true },
        take: 1,
        where: { isActive: true },
      },
    },
    where: { id: growCycleId },
  })
  if (!cycle || !cycle.isActive) {
    return
  }
  const activePhase = cycle.phases[0]
  if (!activePhase) {
    return
  }

  // Sensor-staleness gate: if the sensor's lastActive timestamp exceeds
  // The staleness window, skip threshold evaluation and warn. This
  // Prevents the engine from holding a stale command indefinitely when
  // A sensor goes silent (dead I2C, loose jumper, etc.).
  if (sensorId) {
    const sensor = await prisma.sensor.findUnique({
      select: { lastActive: true },
      where: { id: sensorId },
    })
    if (sensor?.lastActive && now.getTime() - sensor.lastActive.getTime() > STALE_SENSOR_MS) {
      console.warn(
        `[evaluator] Sensor ${sensorId} lastActive ${sensor.lastActive.toISOString()} is stale (>${STALE_SENSOR_MS}ms); skipping evaluation.`,
      )
      return
    }
  }

  const period = resolvePeriod(activePhase.dayStartMinutes, activePhase.dayDurationMinutes, now)

  const env = await prisma.phaseEnvironment.findUnique({
    select: {
      co2Max: true,
      co2Min: true,
      co2Target: true,
      humidityMax: true,
      humidityMin: true,
      humidityTarget: true,
      tempMax: true,
      tempMin: true,
      tempTarget: true,
    },
    where: { growPhaseId_period: { growPhaseId: activePhase.id, period } },
  })

  // Without an environment row for this period, no rule has a threshold to
  // Compare against. Schedule rules run via the scheduler tick.
  if (!env) {
    return
  }

  const boundary = getBoundaryFields(sensorType, env)
  if (!boundary) {
    return
  }

  const rules = await prisma.automationRule.findMany({
    include: { device: true },
    where: {
      enabled: true,
      condition: {
        in: ['ABOVE_MAX', 'BELOW_MIN', 'ABOVE_MIN', 'BELOW_MAX', 'ABOVE_TARGET', 'BELOW_TARGET'],
      },
      watchedSensorType: sensorType,
      // LIGHT devices are not eligible for automation rules; this filter is
      // Defensive in case a stale row exists from before that constraint.
      device: { type: { not: 'LIGHT' } },
      OR: [
        { growCycleId: null, growPhaseId: activePhase.id },
        { growCycleId: cycle.id, growPhaseId: null },
      ],
      AND: [
        {
          OR: [{ period }, { period: null }],
        },
      ],
    },
  })

  // Per-device suppression: if an enabled ALWAYS_ON / ALWAYS_OFF rule covers
  // This device within the active scope + current period, threshold rules for
  // That same (device, scope, period) are skipped. The ALWAYS_* rule itself
  // Is enforced by the automation scheduler on its 60s tick.
  const alwaysRules = await prisma.automationRule.findMany({
    select: { deviceId: true, period: true },
    where: {
      AND: [{ OR: [{ period }, { period: null }] }],
      OR: [
        { growCycleId: null, growPhaseId: activePhase.id },
        { growCycleId: cycle.id, growPhaseId: null },
      ],
      condition: { in: ['ALWAYS_ON', 'ALWAYS_OFF'] },
      enabled: true,
    },
  })
  const pinnedDeviceIds = new Set(alwaysRules.map((r) => r.deviceId))

  for (const rule of rules) {
    if (rule.period !== null && rule.period !== period) {
      continue
    }

    // Suppression: an enabled ALWAYS_* rule for this device + scope + period
    // Pins the device; threshold rules for that device in that scope + period
    // Are skipped. The pin is enforced by the automation scheduler.
    if (pinnedDeviceIds.has(rule.deviceId)) {
      continue
    }

    if (!rule.device) {
      continue
    }
    if (rule.device.automationMode === 'ALWAYS_ON' && rule.action === 'OFF') {
      continue
    }
    if (rule.device.automationMode === 'ALWAYS_OFF' && rule.action === 'ON') {
      continue
    }

    // Cooldown: skip if the rule fired recently.
    if (rule.lastTriggeredAt) {
      const elapsedMs = now.getTime() - rule.lastTriggeredAt.getTime()
      if (elapsedMs < rule.cooldownSeconds * 1000) {
        continue
      }
    }

    let shouldFire = false
    let reason = ''

    if (rule.condition === 'ABOVE_MAX') {
      if (boundary.max !== null && value > boundary.max) {
        shouldFire = true
        reason = `${sensorType} ${value} > max ${boundary.max} (${period})`
      }
    } else if (rule.condition === 'BELOW_MIN') {
      if (boundary.min !== null && value < boundary.min) {
        shouldFire = true
        reason = `${sensorType} ${value} < min ${boundary.min} (${period})`
      }
    } else if (rule.condition === 'ABOVE_MIN') {
      if (boundary.min !== null && value > boundary.min) {
        shouldFire = true
        reason = `${sensorType} ${value} > min ${boundary.min} (${period})`
      }
    } else if (rule.condition === 'BELOW_MAX') {
      if (boundary.max !== null && value < boundary.max) {
        shouldFire = true
        reason = `${sensorType} ${value} < max ${boundary.max} (${period})`
      }
    } else if (rule.condition === 'ABOVE_TARGET') {
      if (boundary.target !== null && value > boundary.target) {
        shouldFire = true
        reason = `${sensorType} ${value} > target ${boundary.target} (${period})`
      }
    } else if (rule.condition === 'BELOW_TARGET') {
      if (boundary.target !== null && value < boundary.target) {
        shouldFire = true
        reason = `${sensorType} ${value} < target ${boundary.target} (${period})`
      }
    }

    if (!shouldFire) {
      continue
    }

    // Persist lastTriggeredAt *before* the command so concurrent ticks on
    // The same rule respect cooldown.
    await prisma.automationRule.update({
      data: { lastTriggeredAt: now },
      where: { id: rule.id },
    })

    const result = await issueAutoCommand(rule.device.id, rule.action, reason)
    if (result.issued) {
      console.log(
        `[evaluator] cycle=${cycle.id} rule=${rule.id} device=${rule.device.id} action=${rule.action} value=${value}`,
      )
    }

    // Mark the device as "threshold-held" for the interval scheduler so an
    // Interval schedule on the same device yields while this condition is
    // Actively asserting. heldUntil = now + cooldownSeconds; the scheduler
    // Fully suspends the device while the hold is fresh. Refreshed on every
    // Fire, so a persistent condition keeps the hold alive.
    await prisma.deviceThresholdHold.upsert({
      create: {
        deviceId: rule.device.id,
        heldUntil: new Date(now.getTime() + rule.cooldownSeconds * 1000),
        ruleId: rule.id,
      },
      update: {
        heldUntil: new Date(now.getTime() + rule.cooldownSeconds * 1000),
        ruleId: rule.id,
      },
      where: { deviceId: rule.device.id },
    })
  }
}
