import type { DayNightPeriod as DayNightPeriodLiteral } from '../generated/client/enums.js'

/**
 * Resolve the current day/night period from a phase's clock schedule.
 *
 * `dayStartMinutes` is the minute-of-day (0..1440) when the photoperiod DAY begins.
 * `dayDurationMinutes` is how long the day lasts; night = 1440 - dayDurationMinutes.
 *
 * Day is a closed-open window: [dayStart, dayStart + dayDuration). The window may
 * wrap past midnight (e.g. 18/6 starting at 18:00 ends at 12:00 the next day),
 * which is handled by modulo arithmetic.
 *
 * Edge cases:
 *   - dayDurationMinutes === 1440 -> always DAY
 *   - dayDurationMinutes === 0    -> always NIGHT
 */
export function resolvePeriod(
  dayStartMinutes: number,
  dayDurationMinutes: number,
  now: Date = new Date(),
): DayNightPeriodLiteral {
  if (dayDurationMinutes >= 1440) {
    return 'DAY'
  }
  if (dayDurationMinutes <= 0) {
    return 'NIGHT'
  }

  const start = ((dayStartMinutes % 1440) + 1440) % 1440
  const end = (start + dayDurationMinutes) % 1440

  const minutesOfDay = now.getHours() * 60 + now.getMinutes()

  if (start === end) {
    // Defensive: should not happen because of the >=1440 / <=0 guards above.
    return 'NIGHT'
  }

  if (start < end) {
    // Window does not wrap: e.g. 06:00..24:00 for an 18/6 schedule starting at 6.
    return minutesOfDay >= start && minutesOfDay < end ? 'DAY' : 'NIGHT'
  }

  // Window wraps midnight: e.g. 18:00..12:00 for an 18/6 starting at 18.
  return minutesOfDay >= start || minutesOfDay < end ? 'DAY' : 'NIGHT'
}
