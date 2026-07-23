import { prisma } from '../prisma.js'
import { resolvePeriod } from './period.js'
import { issueAutoCommand } from './command-publisher.js'
import { evaluateThresholds } from './evaluator.js'
import { commandTracker } from './command-tracker.js'
import { getSocketEmitter } from './socket-emitter.js'
import type { DeviceAction as DeviceActionLiteral } from '../generated/client/enums.js'

const TICK_MS = 30_000

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
 * 3. Re-evaluates threshold rules using the latest telemetry per sensor type.
 *    This is a safety net if the real-time evaluator (triggered by MQTT)
 *    misses a condition — e.g., dropped MQTT message, stale sensor, or race.
 *
 * 4. Auto-advances the cycle to its next phase when the active phase's `endAt`
 *    has passed, or completes the cycle on the final phase. The pass is
 *    per-cycle (try/catch wraps each cycle) so a failure on cycle A never
 *    blocks cycle B. Two Socket.IO events are emitted on transition:
 *      - `cycle_phase_changed`  — advanced to next phase
 *      - `cycle_completed`      — final phase ended, cycle deactivated
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
  private timer: NodeJS.Timeout | null = null

  start() {
    if (this.timer) {
      return
    }
    // Run once immediately so behavior is observable on dev startup, then on tick.
    void this.tick()
    this.timer = setInterval(() => void this.tick(), TICK_MS)

    commandTracker.setRetryHandler(async (cmd) => {
      await issueAutoCommand(cmd.deviceId, cmd.action, `retry (#${cmd.retries})`, { force: true })
    })
    commandTracker.startRetryLoop()
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    commandTracker.stopRetryLoop()
  }

  // Exposed for tests and manual invocation.
  async tick(now: Date = new Date()) {
    // (0) Max-run-time enforcement: force-OFF any device that has been ON
    //     Longer than its maxOnSeconds ceiling, regardless of automation state.
    //     This is the independent backstop that prevents a stuck sensor or
    //     A rule logic error from cooking a tent.
    {
      const overrunDevices = await prisma.device.findMany({
        select: { id: true, maxOnSeconds: true },
        where: {
          isActive: true,
          maxOnSeconds: { not: null },
        },
      })
      for (const dev of overrunDevices) {
        const lastLog = await prisma.deviceStateLog.findFirst({
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
          where: { action: 'ON', deviceId: dev.id },
        })
        if (
          lastLog &&
          now.getTime() - lastLog.createdAt.getTime() > (dev.maxOnSeconds as number) * 1000
        ) {
          console.log(
            `[scheduler] max-run-time exceeded for device ${dev.id} (limit ${dev.maxOnSeconds}s); force-OFF`,
          )
          await issueAutoCommand(dev.id, 'OFF', `max-run-time ${dev.maxOnSeconds}s exceeded`)
        }
      }
    }

    const activeCycles = await prisma.growCycle.findMany({
      include: {
        controller: {
          select: {
            devices: { where: { type: 'LIGHT' } },
            id: true,
          },
        },
        phases: { take: 1, where: { isActive: true } },
      },
      where: { isActive: true },
    })

    for (const cycle of activeCycles) {
      const activePhase = cycle.phases[0]
      if (!activePhase) {
        continue
      }

      const period = resolvePeriod(activePhase.dayStartMinutes, activePhase.dayDurationMinutes, now)
      const lightAction: DeviceActionLiteral = period === 'DAY' ? 'ON' : 'OFF'

      // (1) Drive LIGHT devices directly from the clock.
      for (const device of cycle.controller.devices) {
        if (device.automationMode === 'MANUAL') {
          continue
        }
        if (device.automationMode === 'THRESHOLD') {
          continue
        }
        if (device.automationMode === 'ALWAYS_ON' && lightAction === 'OFF') {
          continue
        }
        if (device.automationMode === 'ALWAYS_OFF' && lightAction === 'ON') {
          continue
        }

        const result = await issueAutoCommand(
          device.id,
          lightAction,
          `${period === 'DAY' ? 'day cycle start' : 'night cycle start'} (phase ${activePhase.id})`,
        )
        if (result.issued) {
          console.log(
            `[scheduler] cycle=${cycle.id} phase=${activePhase.id} device=${device.id} action=${lightAction} (${period})`,
          )
        } else {
          // Hysteresis prevented a duplicate command, but we still write a log
          // Entry so the device state history chart shows the state at each tick.
          // Skip — don't crash the whole scheduler — if the device was deleted
          // Between the cycle load and this write (P2003 FK violation).
          try {
            await prisma.deviceStateLog.create({
              data: {
                action: lightAction,
                deviceId: device.id,
                reason: `${period === 'DAY' ? 'day cycle tick' : 'night cycle tick'} (phase ${activePhase.id})`,
                source: 'AUTO',
              },
            })
          } catch (error) {
            if (
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              (error as { code: string }).code === 'P2003'
            ) {
              continue
            }
            throw error
          }
        }
      }

      // (2) Enforce ALWAYS_ON / ALWAYS_OFF rules scoped to the active phase
      //     (preferred) or active cycle. Filter by `period` matching the
      //     Current period or being null (both).
      const alwaysRules = await prisma.automationRule.findMany({
        include: { device: true },
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

      for (const rule of alwaysRules) {
        if (!rule.device) {
          continue
        }
        if (rule.device.type === 'LIGHT') {
          continue
        } // Defensive — LIGHTs are ineligible
        const target: DeviceActionLiteral = rule.condition === 'ALWAYS_ON' ? 'ON' : 'OFF'
        if (rule.device.automationMode === 'ALWAYS_ON' && target === 'OFF') {
          continue
        }
        if (rule.device.automationMode === 'ALWAYS_OFF' && target === 'ON') {
          continue
        }

        const result = await issueAutoCommand(
          rule.device.id,
          target,
          `${rule.condition} rule (${rule.id})`,
        )
        if (result.issued) {
          console.log(
            `[scheduler] cycle=${cycle.id} phase=${activePhase.id} rule=${rule.id} device=${rule.device.id} action=${target} (${rule.condition})`,
          )
        } else {
          // Same defensive skip as the LIGHT cycle tick write above: the rule
          // Device may have been deleted between the load and this write.
          try {
            await prisma.deviceStateLog.create({
              data: {
                action: target,
                deviceId: rule.device.id,
                reason: `${rule.condition} rule tick (${rule.id})`,
                source: 'AUTO',
              },
            })
          } catch (error) {
            if (
              typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              (error as { code: string }).code === 'P2003'
            ) {
              continue
            }
            throw error
          }
        }
      }

      // (3) Re-evaluate threshold rules using the latest telemetry per sensor type.
      //     This provides a safety net if the real-time evaluator (triggered by MQTT)
      //     Misses a condition — e.g., dropped MQTT message, stale sensor, or race.
      {
        const sensors = await prisma.sensor.findMany({
          include: {
            controller: {
              select: {
                growCycles: { select: { id: true }, take: 1, where: { isActive: true } },
                id: true,
              },
            },
          },
          where: { controllerId: cycle.controller.id },
        })

        for (const sensor of sensors) {
          const activeCycle = sensor.controller.growCycles[0]
          if (!activeCycle) {
            continue
          }

          const latest = await prisma.telemetry.findFirst({
            orderBy: { createdAt: 'desc' },
            select: { sensorType: true, value: true },
            where: { growCycleId: activeCycle.id, sensorId: sensor.id },
          })
          if (!latest) {
            continue
          }

          await evaluateThresholds({
            growCycleId: activeCycle.id,
            now,
            sensorId: sensor.id,
            sensorType: latest.sensorType,
            value: latest.value,
          }).catch((error: Error) => {
            console.error(
              `[scheduler] Threshold re-evaluation failed for sensor ${sensor.id}:`,
              error,
            )
          })
        }
      }

      // (4) Auto-advance phase. When the active phase's `endAt` (UTC date)
      //     Has passed, transition to the next phase by `order`; if there is
      //     No next phase, complete the cycle (deactivate the cycle and
      //     Clear all phases). Each cycle is wrapped in try/catch so a
      //     Failure on cycle A doesn't block cycle B.
      try {
        if (!cycle.startAt) {
          console.warn(
            `[scheduler] cycle=${cycle.id} skipped auto-advance: cycle has no startAt (not started yet)`,
          )
        } else if (!activePhase.endAt) {
          console.warn(
            `[scheduler] cycle=${cycle.id} phase=${activePhase.id} skipped auto-advance: active phase has no endAt`,
          )
        } else {
          const today = new Date(now)
          today.setUTCHours(0, 0, 0, 0)
          const endAt = new Date(activePhase.endAt)
          endAt.setUTCHours(0, 0, 0, 0)

          if (today.getTime() >= endAt.getTime()) {
            const nextPhase = await prisma.growPhase.findFirst({
              orderBy: { order: 'asc' },
              select: { id: true, order: true },
              where: {
                growCycleId: cycle.id,
                order: { gt: activePhase.order },
              },
            })

            const advancedAt = new Date()

            if (nextPhase) {
              await prisma.$transaction([
                prisma.growPhase.updateMany({
                  data: { isActive: false },
                  where: { growCycleId: cycle.id },
                }),
                prisma.growPhase.update({
                  data: { isActive: true },
                  where: { id: nextPhase.id },
                }),
              ])
              console.log(
                `[scheduler] cycle=${cycle.id} auto-advanced from phase=${activePhase.id} (order=${activePhase.order}) to phase=${nextPhase.id} (order=${nextPhase.order})`,
              )
              const io = await getSocketEmitter()
              io?.emit('cycle_phase_changed', {
                advancedAt,
                cycleId: cycle.id,
                fromPhaseId: activePhase.id,
                toPhaseId: nextPhase.id,
              })
            } else {
              // Final phase ended — complete the cycle.
              await prisma.$transaction([
                prisma.growPhase.updateMany({
                  data: { isActive: false },
                  where: { growCycleId: cycle.id },
                }),
                prisma.growCycle.update({
                  data: { isActive: false },
                  where: { id: cycle.id },
                }),
              ])
              console.log(
                `[scheduler] cycle=${cycle.id} auto-completed after final phase=${activePhase.id} (order=${activePhase.order})`,
              )
              const io = await getSocketEmitter()
              io?.emit('cycle_completed', {
                completedAt: advancedAt,
                completedPhaseId: activePhase.id,
                cycleId: cycle.id,
              })
            }
          }
        }
      } catch (error) {
        console.error(
          `[scheduler] auto-advance failed for cycle=${cycle.id}; continuing with next cycle.`,
          error,
        )
      }
    }
  }
}

export const automationScheduler = new AutomationScheduler()

// Backward-compat re-export for any caller still using the old name.
export { AutomationScheduler as LightScheduler }
export const lightScheduler = automationScheduler
