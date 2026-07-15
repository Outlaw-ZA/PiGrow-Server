import crypto from 'node:crypto'
import { mqttClient } from '../mqtt/client.js'
import { prisma } from '../prisma.js'
import { DEVICE_STATE_CHANGED, deviceEvents } from '../events.js'
import { commandTracker } from './command-tracker.js'

/**
 * Issue an automated device command and persist a DeviceStateLog row.
 * Used by both the light scheduler and the threshold evaluator.
 *
 * Hysteresis is enforced here: if the device's latest DeviceStateLog row
 * already records this action (from any source), the command is a no-op.
 * That way the scheduler/evaluator can re-tick freely without flapping the relay.
 */
export async function issueAutoCommand(
  deviceId: string,
  action: 'ON' | 'OFF',
  reason: string,
  options?: { force?: boolean },
): Promise<{ issued: boolean; reason: string }> {
  const device = await prisma.device.findUnique({
    select: { id: true, isActive: true, pinNumber: true },
    where: { id: deviceId },
  })
  if (!device) {
    return { issued: false, reason: 'device not found' }
  }

  // Hysteresis: if the device's most recent state log already records this action,
  // Skip the command. This applies across all sources (MANUAL, AUTO, UI) so an
  // Operator's manual toggle is respected by the automation engine.
  // When force=true (retry path), skip hysteresis — the DB state is already correct,
  // We just need to re-deliver the MQTT message.
  if (!options?.force) {
    const last = await prisma.deviceStateLog.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { action: true },
      where: { deviceId },
    })
    if (last?.action === action) {
      return { issued: false, reason: 'device already in this state' }
    }
  }

  if (options?.force) {
    // Retry path: DB already reflects the desired state. Just re-send MQTT.
    const commandId = crypto.randomUUID()
    commandTracker.track(commandId, deviceId, action)

    mqttClient.publish(
      `devices/${deviceId}/commands`,
      JSON.stringify({
        action,
        commandId,
        pin: device.pinNumber,
        timestamp: Date.now(),
      }),
    )

    return { issued: true, reason: `${reason} (force)` }
  }

  // Persist state transition + audit row in a single transaction.
  await prisma.$transaction([
    prisma.device.update({
      data: { isActive: action === 'ON' },
      where: { id: deviceId },
    }),
    prisma.deviceStateLog.create({
      data: { action, deviceId, reason, source: 'AUTO' },
    }),
  ])

  const commandId = crypto.randomUUID()
  commandTracker.track(commandId, deviceId, action)

  deviceEvents.emit(DEVICE_STATE_CHANGED, { deviceId, isActive: action === 'ON' })

  mqttClient.publish(
    `devices/${deviceId}/commands`,
    JSON.stringify({
      action,
      commandId,
      pin: device.pinNumber,
      timestamp: Date.now(),
    }),
  )

  return { issued: true, reason }
}
