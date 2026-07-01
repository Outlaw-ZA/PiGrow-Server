import { prisma } from "../prisma.js";
import { resolvePeriod } from "./period.js";
import { issueAutoCommand } from "./command-publisher.js";
import type { DeviceAction as DeviceActionLiteral } from "../generated/client/enums.js";

const TICK_MS = 60_000;

/**
 * Automation scheduler. Runs every TICK_MS. For each controller with an active
 * grow cycle:
 *
 * 1. Drives every `LIGHT` device on the controller to match the current
 *    day/night period (resolved from the active phase's clock schedule).
 *    LIGHT devices are not eligible for AutomationRule rows — they are driven
 *    directly by the grow-phase clock.
 *
 * 2. Enforces enabled `ALWAYS_ON` / `ALWAYS_OFF` rules scoped to the active
 *    phase or cycle. These phase/cycle-scoped pins drive non-LIGHT devices to
 *    a fixed state and suppress any `ABOVE_MAX` / `BELOW_MIN` rules for the
 *    same (device, scope, period) on the threshold evaluator path.
 *
 * Per-device `automationMode` is the global override and always wins:
 *   - MANUAL       — skip; no automated drive.
 *   - SCHEDULED    — light devices only (used by LIGHT).
 *   - THRESHOLD    — evaluate against PhaseEnvironment; on a LIGHT this is a no-op.
 *   - ALWAYS_ON    — drive ON; never drive OFF (overrides rule-level ALWAYS_OFF).
 *   - ALWAYS_OFF   — drive OFF; never drive ON (overrides rule-level ALWAYS_ON).
 *
 * Hysteresis lives in `issueAutoCommand`: if the device's most recent
 * DeviceStateLog already records the desired action, the call is a no-op.
 *
 * No-op when there is no active grow cycle or no active phase on a controller.
 */
export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null;

  start() {
    if (this.timer) return;
    // Run once immediately so behavior is observable on dev startup, then on tick.
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Exposed for tests and manual invocation.
  async tick(now: Date = new Date()) {
    const activeCycles = await prisma.growCycle.findMany({
      where: { isActive: true },
      include: {
        phases: { where: { isActive: true }, take: 1 },
        controller: {
          select: {
            id: true,
            devices: { where: { type: "LIGHT" } },
          },
        },
      },
    });

    for (const cycle of activeCycles) {
      const activePhase = cycle.phases[0];
      if (!activePhase) continue;

      const period = resolvePeriod(
        activePhase.dayStartMinutes,
        activePhase.dayDurationMinutes,
        now,
      );
      const lightAction: DeviceActionLiteral =
        period === "DAY" ? "ON" : "OFF";

      // (1) Drive LIGHT devices directly from the clock.
      for (const device of cycle.controller.devices) {
        if (device.automationMode === "MANUAL") continue;
        if (device.automationMode === "THRESHOLD") continue;
        if (device.automationMode === "ALWAYS_ON" && lightAction === "OFF") continue;
        if (device.automationMode === "ALWAYS_OFF" && lightAction === "ON") continue;

        const result = await issueAutoCommand(
          device.id,
          lightAction,
          `${period === "DAY" ? "day cycle start" : "night cycle start"} (phase ${activePhase.id})`,
        );
        if (result.issued) {
          console.log(
            `[scheduler] cycle=${cycle.id} phase=${activePhase.id} device=${device.id} action=${lightAction} (${period})`,
          );
        }
      }

      // (2) Enforce ALWAYS_ON / ALWAYS_OFF rules scoped to the active phase
      //     (preferred) or active cycle. Filter by `period` matching the
      //     current period or being null (both).
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
        include: { device: true },
      });

      for (const rule of alwaysRules) {
        if (!rule.device) continue;
        if (rule.device.type === "LIGHT") continue; // defensive — LIGHTs are ineligible
        if (rule.device.automationMode === "MANUAL") continue;
        const target: DeviceActionLiteral =
          rule.condition === "ALWAYS_ON" ? "ON" : "OFF";
        if (rule.device.automationMode === "ALWAYS_ON" && target === "OFF") continue;
        if (rule.device.automationMode === "ALWAYS_OFF" && target === "ON") continue;

        const result = await issueAutoCommand(
          rule.device.id,
          target,
          `${rule.condition} rule (${rule.id})`,
        );
        if (result.issued) {
          console.log(
            `[scheduler] cycle=${cycle.id} phase=${activePhase.id} rule=${rule.id} device=${rule.device.id} action=${target} (${rule.condition})`,
          );
        }
      }
    }
  }
}

export const automationScheduler = new AutomationScheduler();

// Backward-compat re-export for any caller still using the old name.
export { AutomationScheduler as LightScheduler };
export const lightScheduler = automationScheduler;
