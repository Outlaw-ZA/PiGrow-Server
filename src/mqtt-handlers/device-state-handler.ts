import { prisma } from '../prisma.js'
import { DEVICE_STATE_CHANGED, deviceEvents } from '../events.js'
import { commandTracker } from '../automation/command-tracker.js'

/**
 * Handles `devices/<deviceId>/state` MQTT messages published by the Pi.
 *
 * Payload: { action: "ON" | "OFF"; timestamp: number }
 *
 * Reconciles `Device.isActive` with the reported state and writes a
 * `DeviceStateLog` row with `source: "AUTO" reason: "state confirmed"`.
 * That row is the source of truth for the evaluator's hysteresis check
 * on subsequent ticks: if a fan has already physically been turned on
 * and the Pi reports the state, the evaluator will not issue a redundant
 * ON command.
 */
export async function handleDeviceState(topic: string, messageBuffer: Buffer): Promise<void> {
  try {
    const parts = topic.split('/')
    const deviceId = parts[1]
    if (!deviceId) {
      console.warn(`[device-state] Ignoring malformed topic: ${topic}`)
      return
    }

    let payload: { action?: 'ON' | 'OFF'; timestamp?: number }
    try {
      payload = JSON.parse(messageBuffer.toString())
    } catch {
      console.warn(`[device-state] Non-JSON payload on ${topic}; dropping.`)
      return
    }

    if (payload?.action !== 'ON' && payload?.action !== 'OFF') {
      console.warn(`[device-state] Unknown action "${payload?.action}" on ${topic}`)
      return
    }

    // Confirm any tracked command that matches this state report.
    const commandId =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>).commandId
        : undefined
    if (typeof commandId === 'string') {
      commandTracker.confirm(commandId)
    }

    const device = await prisma.device.findUnique({
      select: { id: true, isActive: true },
      where: { id: deviceId },
    })
    if (!device) {
      console.warn(`[device-state] Unknown device id: ${deviceId}`)
      return
    }

    const reportedIsActive = payload.action === 'ON'
    if (device.isActive === reportedIsActive) {
      // No-op reconciliation: device already in the reported state.
      return
    }

    await prisma.$transaction([
      prisma.device.update({
        data: { isActive: reportedIsActive },
        where: { id: deviceId },
      }),
      prisma.deviceStateLog.create({
        data: {
          action: payload.action,
          deviceId,
          reason: 'state confirmed',
          source: 'AUTO',
        },
      }),
    ])

    deviceEvents.emit(DEVICE_STATE_CHANGED, { deviceId, isActive: reportedIsActive })

    console.log(
      `[device-state] device=${deviceId} reconciled to ${payload.action} (was ${device.isActive ? 'ON' : 'OFF'})`,
    )
  } catch (error) {
    console.error('[device-state] Failed to process MQTT payload:', error)
  }
}
