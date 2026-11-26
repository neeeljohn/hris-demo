export const MNL = 8 * 3_600_000; // Manila is UTC+8
export const DAY = 86_400_000;

export const manilaDate = (ms = Date.now()) => new Date(ms + MNL).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

export type Shift = { id: string | null; name: string; startMinute: number; endMinute: number; graceMinutes: number };
export const DEFAULT_SHIFT: Shift = { id: null, name: 'Day', startMinute: 480, endMinute: 1020, graceMinutes: 10 };
const EARLY_MINUTES = 120; // can clock in up to 2 hours before the shift

export const shiftLength = (s: Shift) =>
  s.endMinute > s.startMinute ? s.endMinute - s.startMinute : s.endMinute + 1440 - s.startMinute;
export const shiftStartMs = (s: Shift, date: string) =>
  Date.parse(`${date}T00:00:00Z`) - MNL + s.startMinute * 60_000;
export const shiftEndMs = (s: Shift, date: string) => shiftStartMs(s, date) + shiftLength(s) * 60_000;

// Which work date does "now" belong to? Night shifts belong to the day they start.
export function workDateFor(s: Shift, now = Date.now()) {
  const today = manilaDate(now);
  for (const d of [addDays(today, -1), today, addDays(today, 1)]) {
    if (now >= shiftStartMs(s, d) - EARLY_MINUTES * 60_000 && now <= shiftEndMs(s, d)) return d;
  }
  return today;
}

export const isLate = (s: Shift, date: string, at: number) =>
  at > shiftStartMs(s, date) + s.graceMinutes * 60_000;

export const fmtMinute = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const shiftLabel = (s: Shift) => `${fmtMinute(s.startMinute)} – ${fmtMinute(s.endMinute)}`;