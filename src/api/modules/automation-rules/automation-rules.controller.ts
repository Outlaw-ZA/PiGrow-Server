import { FastifyInstance } from "fastify";
import type {
  RuleCondition as RuleConditionLiteral,
  DayNightPeriod as DayNightPeriodLiteral,
  SensorType as SensorTypeLiteral,
  DeviceAction as DeviceActionLiteral,
} from "../../../generated/client/enums.js";

interface CreateRuleInput {
  growCycleId?: string;
  growPhaseId?: string;
  deviceId: string;
  watchedSensorType?: SensorTypeLiteral | null;
  period?: DayNightPeriodLiteral | null;
  condition: RuleConditionLiteral;
  action: DeviceActionLiteral;
  cooldownSeconds?: number;
  enabled?: boolean;
}

interface UpdateRuleInput {
  deviceId?: string;
  watchedSensorType?: SensorTypeLiteral | null;
  period?: DayNightPeriodLiteral | null;
  condition?: RuleConditionLiteral;
  action?: DeviceActionLiteral;
  cooldownSeconds?: number;
  enabled?: boolean;
}

export class AutomationRulesError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "AutomationRulesError";
    this.statusCode = statusCode;
  }
}

export class AutomationRulesController {
  private prisma;

  constructor(server: FastifyInstance) {
    this.prisma = server.prisma;
  }

  // Validate that:
  //   - exactly one of (growCycleId, growPhaseId) is set
  //   - SCHEDULE_ON / SCHEDULE_OFF are rejected (lights are driven directly by
  //     the grow-phase clock, so schedule conditions can never fire)
  //   - for ALWAYS_ON / ALWAYS_OFF, action must match the condition
  //   - for ALWAYS_ON / ALWAYS_OFF, watchedSensorType must be null
  //   - for ABOVE_MAX / BELOW_MIN, watchedSensorType must be set
  private validateScopeAndPeriod(input: {
    growCycleId?: string | null;
    growPhaseId?: string | null;
    period?: DayNightPeriodLiteral | null;
    condition: RuleConditionLiteral;
    action?: DeviceActionLiteral;
    watchedSensorType?: SensorTypeLiteral | null;
  }) {
    const hasCycle = !!input.growCycleId;
    const hasPhase = !!input.growPhaseId;
    if (hasCycle === hasPhase) {
      throw new AutomationRulesError(
        "Exactly one of growCycleId / growPhaseId must be set on an automation rule",
      );
    }

    if (input.condition === "SCHEDULE_ON" || input.condition === "SCHEDULE_OFF") {
      throw new AutomationRulesError(
        "SCHEDULE_ON/SCHEDULE_OFF conditions are no longer supported; light scheduling is automatic from the grow-phase clock",
      );
    }

    if (
      input.condition === "ALWAYS_ON" ||
      input.condition === "ALWAYS_OFF"
    ) {
      const expectedAction =
        input.condition === "ALWAYS_ON" ? "ON" : "OFF";
      if (input.action !== undefined && input.action !== expectedAction) {
        throw new AutomationRulesError(
          `action must be ${expectedAction} for condition ${input.condition}`,
        );
      }
      if (
        input.watchedSensorType !== undefined &&
        input.watchedSensorType !== null
      ) {
        throw new AutomationRulesError(
          "watchedSensorType must be null for ALWAYS_ON / ALWAYS_OFF rules",
        );
      }
    } else {
      // ABOVE_MAX / BELOW_MIN
      if (
        input.watchedSensorType === undefined ||
        input.watchedSensorType === null
      ) {
        throw new AutomationRulesError(
          "watchedSensorType is required for ABOVE_MAX / BELOW_MIN rules",
        );
      }
    }
  }

  // Throws if the device is missing or is a LIGHT. Lights are not eligible for
  // automation rules — they're driven directly by the grow-phase clock.
  private async assertDeviceEligibleForRule(deviceId: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { id: true, type: true },
    });
    if (!device) {
      throw new AutomationRulesError("Device not found", 400);
    }
    if (device.type === "LIGHT") {
      throw new AutomationRulesError(
        "LIGHT devices are not eligible for automation rules; light scheduling is driven by the grow-phase day/night clock",
        400,
      );
    }
    return device;
  }

  // 1. LIST by grow cycle (cycle-scoped rules only).
  async getByGrowCycleId(growCycleId: string) {
    return await this.prisma.automationRule.findMany({
      where: { growCycleId, growPhaseId: null },
      orderBy: { createdAt: "asc" },
    });
  }

  // 2. LIST by grow phase (phase-scoped rules).
  async getByGrowPhaseId(growPhaseId: string) {
    return await this.prisma.automationRule.findMany({
      where: { growPhaseId, growCycleId: null },
      orderBy: { createdAt: "asc" },
    });
  }

  // 3. LIST by device.
  async getByDeviceId(deviceId: string) {
    return await this.prisma.automationRule.findMany({
      where: { deviceId },
      orderBy: { createdAt: "asc" },
    });
  }

  // 4. CREATE
  async create(body: CreateRuleInput) {
    this.validateScopeAndPeriod({
      growCycleId: body.growCycleId ?? null,
      growPhaseId: body.growPhaseId ?? null,
      period: body.period ?? null,
      condition: body.condition,
      action: body.action,
      watchedSensorType: body.watchedSensorType ?? null,
    });

    await this.assertDeviceEligibleForRule(body.deviceId);

    return await this.prisma.automationRule.create({
      data: {
        growCycleId: body.growCycleId ?? null,
        growPhaseId: body.growPhaseId ?? null,
        deviceId: body.deviceId,
        watchedSensorType: body.watchedSensorType ?? null,
        period: body.period ?? null,
        condition: body.condition,
        action: body.action,
        cooldownSeconds: body.cooldownSeconds ?? 180,
        enabled: body.enabled ?? true,
      },
    });
  }

  // 5. UPDATE — scope is immutable. If the caller changes period or condition,
  //    re-validate. If deviceId changes, re-check eligibility (LIGHT forbidden).
  async update(id: string, body: UpdateRuleInput) {
    const existing = await this.prisma.automationRule.findUniqueOrThrow({
      where: { id },
    });

    const nextCondition = body.condition ?? existing.condition;
    const nextPeriod =
      body.period === undefined ? existing.period : body.period;
    const nextAction = body.action ?? (existing.action as DeviceActionLiteral);
    const nextWatchedSensorType =
      body.watchedSensorType === undefined
        ? (existing.watchedSensorType as SensorTypeLiteral | null)
        : body.watchedSensorType;

    this.validateScopeAndPeriod({
      growCycleId: existing.growCycleId,
      growPhaseId: existing.growPhaseId,
      period: nextPeriod,
      condition: nextCondition,
      action: nextAction,
      watchedSensorType: nextWatchedSensorType,
    });

    if (body.deviceId && body.deviceId !== existing.deviceId) {
      await this.assertDeviceEligibleForRule(body.deviceId);
    }

    return await this.prisma.automationRule.update({
      where: { id },
      data: body,
    });
  }

  // 6. TOGGLE enabled flag.
  async toggle(id: string) {
    const existing = await this.prisma.automationRule.findUniqueOrThrow({
      where: { id },
    });
    const updated = await this.prisma.automationRule.update({
      where: { id },
      data: { enabled: !existing.enabled },
    });
    return { id: updated.id, enabled: updated.enabled };
  }

  // 7. DELETE
  async remove(id: string) {
    await this.prisma.automationRule.delete({ where: { id } });
  }
}
