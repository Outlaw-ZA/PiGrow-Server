import type { FastifyInstance } from 'fastify'
import type {
  DayNightPeriod as DayNightPeriodLiteral,
  DeviceAction as DeviceActionLiteral,
  RuleCondition as RuleConditionLiteral,
  SensorType as SensorTypeLiteral,
} from '../../../generated/client/enums.js'

interface CreateRuleInput {
  growCycleId?: string
  growPhaseId?: string
  deviceId: string
  watchedSensorType?: SensorTypeLiteral | null
  period?: DayNightPeriodLiteral | null
  condition: RuleConditionLiteral
  action: DeviceActionLiteral
  cooldownSeconds?: number
  intervalOnSeconds?: number | null
  intervalCycleSeconds?: number | null
  enabled?: boolean
}

interface UpdateRuleInput {
  deviceId?: string
  watchedSensorType?: SensorTypeLiteral | null
  period?: DayNightPeriodLiteral | null
  condition?: RuleConditionLiteral
  action?: DeviceActionLiteral
  cooldownSeconds?: number
  intervalOnSeconds?: number | null
  intervalCycleSeconds?: number | null
  enabled?: boolean
}

export class AutomationRulesError extends Error {
  statusCode: number
  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'AutomationRulesError'
    this.statusCode = statusCode
  }
}

export class AutomationRulesController {
  private prisma

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma
  }

  // Validate that:
  //   - exactly one of (growCycleId, growPhaseId) is set
  //   - SCHEDULE_ON / SCHEDULE_OFF are rejected (lights are driven directly by
  //     The grow-phase clock, so schedule conditions can never fire)
  //   - for ALWAYS_ON / ALWAYS_OFF, action must match the condition
  //   - for ALWAYS_ON / ALWAYS_OFF, watchedSensorType must be null
  //   - for INTERVAL, watchedSensorType must be null, action must be ON, and
  //     IntervalOnSeconds / intervalCycleSeconds must be set and valid
  //   - for any threshold condition (ABOVE_MAX / BELOW_MIN / ABOVE_MIN /
  //     BELOW_MAX / ABOVE_TARGET / BELOW_TARGET), watchedSensorType must be set
  //   - for any non-INTERVAL condition, the interval duration fields must be
  //     Null (interval schedules are a separate, time-based rule shape)
  private validateScopeAndPeriod(input: {
    growCycleId?: string | null
    growPhaseId?: string | null
    period?: DayNightPeriodLiteral | null
    condition: RuleConditionLiteral
    action?: DeviceActionLiteral
    watchedSensorType?: SensorTypeLiteral | null
    intervalOnSeconds?: number | null
    intervalCycleSeconds?: number | null
  }) {
    const hasCycle = Boolean(input.growCycleId)
    const hasPhase = Boolean(input.growPhaseId)
    if (hasCycle === hasPhase) {
      throw new AutomationRulesError(
        'Exactly one of growCycleId / growPhaseId must be set on an automation rule',
      )
    }

    if (input.condition === 'SCHEDULE_ON' || input.condition === 'SCHEDULE_OFF') {
      throw new AutomationRulesError(
        'SCHEDULE_ON/SCHEDULE_OFF conditions are no longer supported; light scheduling is automatic from the grow-phase clock',
      )
    }

    if (input.condition === 'INTERVAL') {
      if (input.watchedSensorType !== undefined && input.watchedSensorType !== null) {
        throw new AutomationRulesError('watchedSensorType must be null for INTERVAL rules')
      }
      if (input.action !== undefined && input.action !== 'ON') {
        throw new AutomationRulesError('action must be ON for condition INTERVAL')
      }
      if (input.intervalOnSeconds === undefined || input.intervalOnSeconds === null) {
        throw new AutomationRulesError('intervalOnSeconds is required for INTERVAL rules')
      }
      if (input.intervalCycleSeconds === undefined || input.intervalCycleSeconds === null) {
        throw new AutomationRulesError('intervalCycleSeconds is required for INTERVAL rules')
      }
      if (input.intervalCycleSeconds <= input.intervalOnSeconds) {
        throw new AutomationRulesError(
          'intervalCycleSeconds must be greater than intervalOnSeconds',
        )
      }
      return
    }

    // Non-INTERVAL: the interval duration fields must be null/unset.
    if (
      (input.intervalOnSeconds !== undefined && input.intervalOnSeconds !== null) ||
      (input.intervalCycleSeconds !== undefined && input.intervalCycleSeconds !== null)
    ) {
      throw new AutomationRulesError(
        'intervalOnSeconds and intervalCycleSeconds must be null for non-INTERVAL rules',
      )
    }

    if (input.condition === 'ALWAYS_ON' || input.condition === 'ALWAYS_OFF') {
      const expectedAction = input.condition === 'ALWAYS_ON' ? 'ON' : 'OFF'
      if (input.action !== undefined && input.action !== expectedAction) {
        throw new AutomationRulesError(
          `action must be ${expectedAction} for condition ${input.condition}`,
        )
      }
      if (input.watchedSensorType !== undefined && input.watchedSensorType !== null) {
        throw new AutomationRulesError(
          'watchedSensorType must be null for ALWAYS_ON / ALWAYS_OFF rules',
        )
      }
    } else {
      // ABOVE_MAX / BELOW_MIN / ABOVE_MIN / BELOW_MAX / ABOVE_TARGET / BELOW_TARGET
      if (input.watchedSensorType === undefined || input.watchedSensorType === null) {
        throw new AutomationRulesError(
          'watchedSensorType is required for threshold conditions (ABOVE_MAX, BELOW_MIN, ABOVE_MIN, BELOW_MAX, ABOVE_TARGET, BELOW_TARGET)',
        )
      }
    }
  }

  // Throws if the device is missing or is a LIGHT. Lights are not eligible for
  // Automation rules — they're driven directly by the grow-phase clock.
  private async assertDeviceEligibleForRule(deviceId: string) {
    const device = await this.prisma.device.findUnique({
      select: { id: true, type: true },
      where: { id: deviceId },
    })
    if (!device) {
      throw new AutomationRulesError('Device not found', 400)
    }
    if (device.type === 'LIGHT') {
      throw new AutomationRulesError(
        'LIGHT devices are not eligible for automation rules; light scheduling is driven by the grow-phase day/night clock',
        400,
      )
    }
    return device
  }

  // 1. LIST by grow cycle (cycle-scoped rules only).
  async getByGrowCycleId(growCycleId: string) {
    return await this.prisma.automationRule.findMany({
      orderBy: { createdAt: 'asc' },
      where: { growCycleId, growPhaseId: null },
    })
  }

  // 2. LIST by grow phase (phase-scoped rules).
  async getByGrowPhaseId(growPhaseId: string) {
    return await this.prisma.automationRule.findMany({
      orderBy: { createdAt: 'asc' },
      where: { growCycleId: null, growPhaseId },
    })
  }

  // 3. LIST by device.
  async getByDeviceId(deviceId: string) {
    return await this.prisma.automationRule.findMany({
      orderBy: { createdAt: 'asc' },
      where: { deviceId },
    })
  }

  // 4. CREATE
  async create(body: CreateRuleInput) {
    this.validateScopeAndPeriod({
      action: body.action,
      condition: body.condition,
      growCycleId: body.growCycleId ?? null,
      growPhaseId: body.growPhaseId ?? null,
      intervalCycleSeconds: body.intervalCycleSeconds ?? null,
      intervalOnSeconds: body.intervalOnSeconds ?? null,
      period: body.period ?? null,
      watchedSensorType: body.watchedSensorType ?? null,
    })

    await this.assertDeviceEligibleForRule(body.deviceId)

    return await this.prisma.automationRule.create({
      data: {
        action: body.action,
        condition: body.condition,
        cooldownSeconds: body.cooldownSeconds ?? 180,
        deviceId: body.deviceId,
        enabled: body.enabled ?? true,
        growCycleId: body.growCycleId ?? null,
        growPhaseId: body.growPhaseId ?? null,
        intervalCycleSeconds: body.intervalCycleSeconds ?? null,
        intervalOnSeconds: body.intervalOnSeconds ?? null,
        period: body.period ?? null,
        watchedSensorType: body.watchedSensorType ?? null,
      },
    })
  }

  // 5. UPDATE — scope is immutable. If the caller changes period or condition,
  //    Re-validate. If deviceId changes, re-check eligibility (LIGHT forbidden).
  async update(id: string, body: UpdateRuleInput) {
    const existing = await this.prisma.automationRule.findUniqueOrThrow({
      where: { id },
    })

    const nextCondition = body.condition ?? existing.condition
    const nextPeriod = body.period === undefined ? existing.period : body.period
    const nextAction = body.action ?? (existing.action as DeviceActionLiteral)
    const nextWatchedSensorType =
      body.watchedSensorType === undefined
        ? (existing.watchedSensorType as SensorTypeLiteral | null)
        : body.watchedSensorType
    const nextIntervalOnSeconds =
      body.intervalOnSeconds === undefined ? existing.intervalOnSeconds : body.intervalOnSeconds
    const nextIntervalCycleSeconds =
      body.intervalCycleSeconds === undefined
        ? existing.intervalCycleSeconds
        : body.intervalCycleSeconds

    this.validateScopeAndPeriod({
      action: nextAction,
      condition: nextCondition,
      growCycleId: existing.growCycleId,
      growPhaseId: existing.growPhaseId,
      intervalCycleSeconds: nextIntervalCycleSeconds,
      intervalOnSeconds: nextIntervalOnSeconds,
      period: nextPeriod,
      watchedSensorType: nextWatchedSensorType,
    })

    if (body.deviceId && body.deviceId !== existing.deviceId) {
      await this.assertDeviceEligibleForRule(body.deviceId)
    }

    return await this.prisma.automationRule.update({
      data: body,
      where: { id },
    })
  }

  // 6. TOGGLE enabled flag.
  async toggle(id: string) {
    const existing = await this.prisma.automationRule.findUniqueOrThrow({
      where: { id },
    })
    const updated = await this.prisma.automationRule.update({
      data: { enabled: !existing.enabled },
      where: { id },
    })
    return { enabled: updated.enabled, id: updated.id }
  }

  // 7. DELETE
  async remove(id: string) {
    await this.prisma.automationRule.delete({ where: { id } })
  }
}
