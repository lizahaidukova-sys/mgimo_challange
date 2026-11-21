import { computeSessionState } from '../server/rules';
import type { GradeRow } from '../shared/types';

// Проверка правил светофора: границы статусов и приоритет долгов.
// Не требует сервера и базы.

function row(partial: Partial<GradeRow>): GradeRow {
  return {
    enrollmentId: Math.floor(Math.random() * 10000),
    courseId: 1,
    title: partial.title ?? 'Без названия',
    teacherName: 'Преподаватель',
    credits: 3,
    hours: 108,
    semesterId: 1,
    controlForm: 'exam',
    grade: null,
    gradeLabel: '',
    status: 'debt',
    retakeCount: 0,
    debtSince: null,
    debtDeadline: null,
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
const past = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

const cases: { name: string; rows: GradeRow[]; severity: string; debts: number }[] = [
  {
    name: 'всё закрыто → зелёный',
    rows: [
      row({ title: 'A', status: 'passed', grade: 5 }),
      row({ title: 'B', status: 'passed', grade: 4 }),
    ],
    severity: 'green',
    debts: 0,
  },
  {
    name: 'один долг в срок → жёлтый',
    rows: [row({ title: 'A', status: 'passed', grade: 4 }), row({ title: 'B', debtDeadline: future })],
    severity: 'yellow',
    debts: 1,
  },
  {
    name: 'два долга → жёлтый',
    rows: [row({ title: 'A', debtDeadline: future }), row({ title: 'B', debtDeadline: future })],
    severity: 'yellow',
    debts: 2,
  },
  {
    name: 'три долга → красный',
    rows: [
      row({ title: 'A', debtDeadline: future }),
      row({ title: 'B', debtDeadline: future }),
      row({ title: 'C', debtDeadline: future }),
    ],
    severity: 'red',
    debts: 3,
  },
  {
    name: 'просроченный долг → красный даже при одном',
    rows: [row({ title: 'A', debtDeadline: past })],
    severity: 'red',
    debts: 1,
  },
  {
    name: 'граница: два долга и один просрочен → красный',
    rows: [row({ title: 'A', debtDeadline: past }), row({ title: 'B', debtDeadline: future })],
    severity: 'red',
    debts: 2,
  },
];

let failed = 0;
for (const testCase of cases) {
  const state = computeSessionState(testCase.rows);
  const ok = state.severity === testCase.severity && state.debts === testCase.debts;
  if (!ok) failed += 1;
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${testCase.name} — получили ${state.severity}/${state.debts}`,
  );
}

// Приоритет: ближайший срок первым.
const ordered = computeSessionState([
  row({ title: 'Позже', debtDeadline: future }),
  row({ title: 'Раньше', debtDeadline: new Date(Date.now() + 24 * 3600 * 1000).toISOString() }),
]);
const priorityOk = ordered.actions[0]?.title === 'Раньше';
if (!priorityOk) failed += 1;
console.log(`${priorityOk ? 'OK  ' : 'FAIL'} ближайший срок идёт первым`);

// GPA считается только по оценкам, а не по долгам.
const gpa = computeSessionState([
  row({ title: 'A', status: 'passed', grade: 5 }),
  row({ title: 'B', status: 'passed', grade: 3 }),
  row({ title: 'C', status: 'debt' }),
]);
const gpaOk = gpa.gpa === 4;
if (!gpaOk) failed += 1;
console.log(`${gpaOk ? 'OK  ' : 'FAIL'} средний балл считается только по оценкам — ${gpa.gpa}`);

if (failed > 0) {
  console.error(`\nПровалено проверок: ${failed}`);
  process.exit(1);
}
console.log('\nПравила светофора проверены.');
