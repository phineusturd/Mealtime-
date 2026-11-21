import type { CookingStep } from '../types/schedule';

/**
 * Parses either "7:00 PM", "19:00", or "7:00pm" into minutes since midnight (0–1439).
 */
export function parseTimeToMinutes(timeStr: string): number {
  const clean = timeStr.trim();
  const ampmMatch = clean.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = Number(ampmMatch[1]);
    const mins = Number(ampmMatch[2]);
    const period = ampmMatch[3].toUpperCase();
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return ((hours * 60 + mins) % 1440 + 1440) % 1440;
  }

  const h24Match = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (h24Match) {
    const hours = Number(h24Match[1]);
    const mins = Number(h24Match[2]);
    return ((hours * 60 + mins) % 1440 + 1440) % 1440;
  }

  return 19 * 60; // Default 7:00 PM
}

/**
 * Formats minutes since midnight into strictly 12-hour AM/PM clock time (e.g., "7:00 PM").
 */
export function formatMinutesTo12Hour(totalMins: number): string {
  const wrapped = ((Math.round(totalMins) % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const mins = wrapped % 60;
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mins).padStart(2, '0')} ${period}`;
}

/**
 * Normalizes any time string to strictly 12-hour AM/PM format (e.g., "19:00" -> "7:00 PM").
 */
export function formatTime12Hour(timeStr: string): string {
  return formatMinutesTo12Hour(parseTimeToMinutes(timeStr));
}

/**
 * Computes the 12-hour AM/PM clock time for a step starting `offsetBeforeEatMins` before dinner.
 */
export function formatClockAtOffset12Hour(
  eatTimeStr: string,
  offsetBeforeEatMins: number
): string {
  const eatMins = parseTimeToMinutes(eatTimeStr);
  return formatMinutesTo12Hour(eatMins - offsetBeforeEatMins);
}

/**
 * Shifts a 12-hour or 24-hour time string by `deltaMins` and returns 12-hour AM/PM format.
 */
export function shiftTime12Hour(timeStr: string, deltaMins: number): string {
  return formatMinutesTo12Hour(parseTimeToMinutes(timeStr) + deltaMins);
}

/**
 * Converts a time string into HTML `<input type="time">` value ("HH:MM"), used only for native picker bindings.
 */
export function toHtmlTimeValue(timeStr: string): string {
  const total = parseTimeToMinutes(timeStr);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Formats remaining seconds as MM:SS or H:MM:SS for live countertop timers.
 */
export function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationReadable(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/**
 * Sorts steps chronologically from earliest start (largest offset_before_eat_mins) to serve time.
 */
export function sortStepsChronologically(steps: CookingStep[]): CookingStep[] {
  return [...steps].sort((a, b) => {
    if (b.offset_before_eat_mins !== a.offset_before_eat_mins) {
      return b.offset_before_eat_mins - a.offset_before_eat_mins;
    }
    if (a.kind === 'active_prep' && b.kind !== 'active_prep') return -1;
    if (b.kind === 'active_prep' && a.kind !== 'active_prep') return 1;
    return b.duration_mins - a.duration_mins;
  });
}

/**
 * Formats the primary appliance string in uppercase high-contrast countertop badge style (e.g. "BREVILLE • 400°F").
 */
export function getPrimaryApplianceLabel(step: CookingStep): string {
  if (!step.equipment || step.equipment.length === 0) {
    return 'COUNTER PREP';
  }
  return step.equipment[0].toUpperCase();
}

export function isPassiveBackgroundStep(step: CookingStep): boolean {
  return step.kind === 'passive_cook' || step.kind === 'tempering';
}
