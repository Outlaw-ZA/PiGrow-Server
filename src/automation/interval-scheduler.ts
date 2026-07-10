import { prisma } from '../prisma.js'
import { resolvePeriod } from './period.js'
import { issueAutoCommand } from './command-publisher.js'
import type { DeviceAction as DeviceActionLiteral } from '../generated/client/enums.js'

const TICK_MS = 5000

/**
 * Interval scheduler. Runs every TICK_MS and duty-cycles the devices of
 * enabled `INTERVAL` automation rules (e.g. fan 30s ON every 5 min).
 *
 * For each controller with an active grow cycle:
 *   1. Resolve the current day/night period from the active phase's clock.
 *   2. Find every enabled INTERVAL rule scoped to the active phase (preferred)
 *      or the active cycle, whose `period` matches or is null, on a non-LIGHT
 *      device.
 *   3. Skip devices with a non-expired `DeviceThresholdHold` (a threshold rule
 *      is actively asserting that device — "threshold overrides interval").
 *   4. Otherwise compute the desired action from the rule's `createdAt`
 *      alignment epoch and issue it via `issueAutoCommand`. Hysteresis in
 *      `issueAutoCommand` prevents redundant writes; this scheduler is
 *      stateless apart from the (DB-backed) holds and never writes
 *      `lastTriggeredAt` on interval rules.
 *
 * Device `automationMode` always wins (consistent with the light/always
 * scheduler): MANUAL -> skip; ALWAYS_ON -> never turn OFF; ALWAYS_OFF ->
 * never turn ON; THRESHOLD/SCHEDULED -> proceed.
 *
 * Stale holds (`heldUntil < now`) are deleted at the end of every tick.
 *
 * No-op when there is no active grow cycle or no active phase.
 */
export class IntervalScheduler {
  private timer: NodeJS.Timeout | null = null

  start() {
    if (this.timer) {
      return
    }
    void this.tick()
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  // Exposed for tests and manual invocation.
  async tick(now: Date = new Date()) {
    const activeCycles = await prisma.growCycle.findMany({
      select: {
        id: true,
        phases: {
          select: {
            dayDurationMinutes: true,
            dayStartMinutes: true,
            id: true,
          },
          take: 1,
          where: { isActive: true },
        },
      },
      where: { isActive: true },
    })

    for (const cycle of activeCycles) {
      const activePhase = cycle.phases[0]
      if (!activePhase) {
        continue
      }

      const period = resolvePeriod(activePhase.dayStartMinutes, activePhase.dayDurationMinutes, now)

      const rules = await prisma.automationRule.findMany({
        select: {
          action: true,
          createdAt: true,
          device: {
            select: { automationMode: true, id: true },
          },
          deviceId: true,
          id: true,
          intervalCycleSeconds: true,
          intervalOnSeconds: true,
        },
        where: {
          enabled: true,
          condition: 'INTERVAL',
          // LIGHT devices are not eligible for automation rules; this filter
          // is defensive in case a stale row exists from before that constraint.
          device: { type: { not: 'LIGHT' } },
          OR: [
            { growPhaseId: activePhase.id, growCycleId: null },
            { growCycleId: cycle.id, growPhaseId: null },
          ],
          AND: [{ OR: [{ period }, { period: null }] }],
        },
      })

      if (rules.length === 0) {
        continue
      }

      // One read for all non-expired holds on the involved devices.
      const deviceIds = rules.map((r) => r.deviceId)
      const activeHolds = await prisma.deviceThresholdHold.findMany({
        select: { deviceId: true },
        where: {
          deviceId: { in: deviceIds },
          heldUntil: { gt: now },
        },
      })
      const heldDeviceIds = new Set(activeHolds.map((h) => h.deviceId))

      for (const rule of rules) {
        if (rule.intervalOnSeconds === null || rule.intervalCycleSeconds === null) {
          // A row with condition=INTERVAL but null durations would be invalid
          // By API validation; skip defensively.
          continue
        }

        if (heldDeviceIds.has(rule.deviceId)) {
          // Threshold rule is actively asserting this device. Yield entirely.
          continue
        }

        const mode = rule.device.automationMode
        if (mode === 'MANUAL') {
          continue
        }

        const onMs = rule.intervalOnSeconds * 1000
        const cycleMs = rule.intervalCycleSeconds * 1000
        const elapsedMs = now.getTime() - rule.createdAt.getTime()
        const position = ((elapsedMs % cycleMs) + cycleMs) % cycleMs
        const desiredAction: DeviceActionLiteral = position < onMs ? 'ON' : 'OFF'

        // Device-level automationMode always wins.
        if (mode === 'ALWAYS_ON' && desiredAction === 'OFF') {
          continue
        }
        if (mode === 'ALWAYS_OFF' && desiredAction === 'ON') {
          continue
        }

        const result = await issueAutoCommand(
          rule.deviceId,
          desiredAction,
          `INTERVAL rule (${rule.id})`,
        )
        if (result.issued) {
          console.log(
            `[interval-scheduler] cycle=${cycle.id} phase=${activePhase.id} rule=${rule.id} device=${rule.deviceId} action=${desiredAction}`,
          )
        }
      }
    }

    // Clean up expired holds globally. Cheap (bounded by recently-expired rows).
    await prisma.deviceThresholdHold.deleteMany({
      where: { heldUntil: { lt: now } },
    })
  }
}

export const intervalScheduler = new IntervalScheduler()
