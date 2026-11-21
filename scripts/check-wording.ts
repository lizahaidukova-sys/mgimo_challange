import { computeSessionState } from '../server/rules';

// Проверка формулировок светофора: сроки, приоритет, тон, отсутствие прогнозов.
// Не эталон красноречия, а защита от бессмыслицы вроде «сессия закроется».

const day = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * day).toISOString();

const base = {
  enrollmentId: 1,
  courseId: 1,
  title: 'Эконометрика',
  teacherName: 'Мария Лебедева',
  credits: 4,
  hours: 144,
  controlForm: 'exam' as const,
  grade: null,
  gradeLabel: '',
  status: 'debt' as const,
  retakeCount: 0,
  debtSince: inDays(-20),
  debtDeadline: inDays(4),
  updatedAt: inDays(-1),
  semesterId: 5,
};

const second = {
  ...base,
  enrollmentId: 2,
  courseId: 2,
  title: 'Философия',
  controlForm: 'pass' as const,
  debtDeadline: inDays(9),
};

const cases: { name: string; text: string; mustMention?: string[]; mustNotMention?: string[] }[] = [
  {
    name: 'жёлтый, два долга в срок',
    text: computeSessionState([second, base], inDays(60)).explanation,
    mustMention: ['Эконометрика', 'через 4 дня', 'Философия', 'До конца сессии'],
    mustNotMention: ['скорее всего', 'сессия закроется'],
  },
  {
    name: 'красный, просрочка',
    text: computeSessionState(
      [{ ...base, status: 'failed' as const, debtDeadline: inDays(-3) }, second],
      inDays(60),
    ).explanation,
    mustMention: ['Просрочено', 'прошёл'],
    mustNotMention: ['скорее всего'],
  },
  {
    name: 'зелёный',
    text: computeSessionState(
      [{ ...base, status: 'passed' as const, grade: 5, debtDeadline: null }],
      inDays(60),
    ).explanation,
    mustMention: ['Долгов нет'],
  },
  {
    name: 'без срока сессии',
    text: computeSessionState([{ ...base, debtDeadline: null }], null).explanation,
    mustMention: ['Эконометрика', 'Ближайший'],
    mustNotMention: ['undefined', 'NaN', 'До конца сессии'],
  },
  {
    name: 'один долг, просрочен',
    text: computeSessionState(
      [{ ...base, debtDeadline: inDays(-1) }],
      inDays(60),
    ).explanation,
    mustMention: ['Срок прошёл'],
    mustNotMention: ['Единственный просрочен', 'Просрочено 1 из 1'],
  },
  {
    name: 'два долга, оба просрочены',
    text: computeSessionState(
      [
        { ...base, debtDeadline: inDays(-2) },
        { ...second, debtDeadline: inDays(-5) },
      ],
      inDays(60),
    ).explanation,
    mustMention: ['Оба просрочены'],
  },
  {
    name: 'срок сегодня',
    text: computeSessionState([{ ...base, debtDeadline: inDays(0) }], inDays(60)).explanation,
    mustMention: ['срок сегодня'],
    mustNotMention: ['через 0'],
  },
];

let failed = 0;
for (const testCase of cases) {
  const problems: string[] = [];
  for (const phrase of testCase.mustMention ?? []) {
    if (!testCase.text.toLowerCase().includes(phrase.toLowerCase())) problems.push(`нет «${phrase}»`);
  }
  for (const phrase of testCase.mustNotMention ?? []) {
    if (testCase.text.toLowerCase().includes(phrase.toLowerCase())) problems.push(`лишнее «${phrase}»`);
  }
  // Двойная пунктуация и заглавная после кавычки — частая ошибка склейки.
  if (/\.\.|,\s*,/.test(testCase.text)) problems.push('двойная пунктуация');
  if (/»\s+[А-ЯA-Z]/.test(testCase.text)) problems.push('заглавная после кавычки');

  const ok = problems.length === 0;
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${testCase.name}: ${testCase.text}`);
  if (!ok) console.log(`     ${problems.join('; ')}`);
}

if (failed > 0) {
  console.error(`\nПровалено: ${failed}`);
  process.exit(1);
}
console.log('\nФормулировки светофора проверены.');
