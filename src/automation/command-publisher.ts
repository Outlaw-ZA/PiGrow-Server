import { mqttClient } from '../mqtt/client.js'
import { prisma } from '../prisma.js'

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
  const last = await prisma.deviceStateLog.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { action: true },
    where: { deviceId },
  })
  if (last?.action === action) {
    return { issued: false, reason: 'device already in this state' }
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

  mqttClient.publish(
    `devices/${deviceId}/commands`,
    JSON.stringify({
      action,
      pin: device.pinNumber,
      timestamp: Date.now(),
    }),
  )

  return { issued: true, reason }
}
