import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const dateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/Moscow',
});
const shortDateFmt = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'Europe/Moscow',
});
const timeFmt = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Moscow',
});
const weekdayFmt = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  timeZone: 'Europe/Moscow',
});

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

export function formatShortDate(iso: string): string {
  return shortDateFmt.format(new Date(iso));
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function formatWeekday(iso: string): string {
  const value = weekdayFmt.format(new Date(iso));
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatDateTime(iso: string): string {
  return `${formatShortDate(iso)} ${formatTime(iso)}`;
}

export function isoDay(date: Date): string {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString();
}

export function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 0) {
    // Событие в будущем: срок заявки, ближайшая пересдача.
    const ahead = Math.abs(minutes);
    if (ahead < 60) return `через ${ahead} мин`;
    const aheadHours = Math.round(ahead / 60);
    if (aheadHours < 24) return `через ${aheadHours} ч`;
    return `через ${Math.round(aheadHours / 24)} дн`;
  }
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} дн назад`;
  return formatShortDate(iso);
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
