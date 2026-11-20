// Время в прототипе живёт в одном часовом поясе — Москва (UTC+3, без перехода
// на летнее время). Сервер может стоять в UTC, поэтому границы суток считаем
// явно, а не через локальную зону процесса.

export const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

// Начало календарных суток по Москве как момент UTC.
export function startOfMskDay(date: Date): Date {
  const shifted = new Date(date.getTime() + MSK_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - MSK_OFFSET_MS);
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

// День недели по Москве: 0 — воскресенье, 1 — понедельник.
export function mskWeekday(date: Date): number {
  return new Date(date.getTime() + MSK_OFFSET_MS).getUTCDay();
}

// Понедельник недели, в которую попадает дата (по Москве).
export function startOfMskWeek(date: Date): Date {
  const dayStart = startOfMskDay(date);
  const shift = (mskWeekday(dayStart) + 6) % 7;
  return addDays(dayStart, -shift);
}

// Сборка момента по московскому времени: день от базы, часы и минуты.
export function mskTime(base: Date, dayOffset: number, hours: number, minutes: number): Date {
  const day = addDays(startOfMskDay(base), dayOffset);
  return new Date(day.getTime() + hours * 60 * 60 * 1000 + minutes * 60 * 1000);
}
