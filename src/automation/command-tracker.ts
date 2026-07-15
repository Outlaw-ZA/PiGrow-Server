const MAX_RETRIES = 3
const RETRY_INTERVAL_MS = 30_000

export interface TrackedCommand {
  commandId: string
  deviceId: string
  action: 'ON' | 'OFF'
  issuedAt: Date
  retries: number
  confirmed: boolean
}

export class CommandTracker {
  private commands = new Map<string, TrackedCommand>()
  private timer: ReturnType<typeof setInterval> | null = null
  private retryHandler: ((cmd: TrackedCommand) => Promise<void>) | null = null

  track(commandId: string, deviceId: string, action: 'ON' | 'OFF'): void {
    this.commands.set(commandId, {
      action,
      commandId,
      confirmed: false,
      deviceId,
      issuedAt: new Date(),
      retries: 0,
    })
    this.pruneStale()
  }

  confirm(commandId: string): boolean {
    const cmd = this.commands.get(commandId)
    if (!cmd) {
      return false
    }
    cmd.confirmed = true
    this.commands.delete(commandId)
    return true
  }

  setRetryHandler(handler: (cmd: TrackedCommand) => Promise<void>): void {
    this.retryHandler = handler
  }

  startRetryLoop(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => void this.retryTick(), RETRY_INTERVAL_MS)
  }

  stopRetryLoop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getUnconfirmed(): TrackedCommand[] {
    const unconfirmed: TrackedCommand[] = []
    for (const cmd of this.commands.values()) {
      if (!cmd.confirmed) {
        unconfirmed.push(cmd)
      }
    }
    return unconfirmed
  }

  private async retryTick(): Promise<void> {
    if (!this.retryHandler) {
      return
    }
    const unconfirmed = this.getUnconfirmed()
    const agedOut: string[] = []

    for (const cmd of unconfirmed) {
      const elapsed = Date.now() - cmd.issuedAt.getTime()
      if (elapsed < RETRY_INTERVAL_MS) {
        continue
      }

      if (cmd.retries >= MAX_RETRIES) {
        console.warn(
          `[command-tracker] Device ${cmd.deviceId} action ${cmd.action} failed after ${MAX_RETRIES} retries; giving up.`,
        )
        agedOut.push(cmd.commandId)
        continue
      }

      cmd.retries++
      cmd.issuedAt = new Date()
      console.log(
        `[command-tracker] Retry ${cmd.retries}/${MAX_RETRIES} for device ${cmd.deviceId} action ${cmd.action}`,
      )
      await this.retryHandler(cmd).catch((error: Error) =>
        console.error(`[command-tracker] Retry handler failed:`, error),
      )
    }

    for (const id of agedOut) {
      this.commands.delete(id)
    }

    this.pruneStale()
  }

  private pruneStale(): void {
    const cutoff = Date.now() - 5 * 60 * 1000
    for (const [id, cmd] of this.commands) {
      if (cmd.issuedAt.getTime() < cutoff) {
        this.commands.delete(id)
      }
    }
  }
}

export const commandTracker = new CommandTracker()
