// Человеческие подписи полей заявки. Единый источник для кабинета студента и деканата.
export const REQUEST_FIELD_LABEL: Record<string, string> = {
  purpose: 'Назначение',
  addressee: 'Куда предоставить',
  format: 'Формат',
  discipline: 'Дисциплина',
  reason: 'Причина',
  preferredDate: 'Желаемая дата',
};

export function requestFieldLabel(key: string): string {
  return REQUEST_FIELD_LABEL[key] ?? key;
}
