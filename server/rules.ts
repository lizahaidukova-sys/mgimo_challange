import type { GradeRow, SessionState } from '../shared/types';

// Правила светофора. Детерминированы и воспроизводимы: модель сюда не встроена.
// Порог «3 долга» — допущение концепта, не норматив вуза (см. docs/08-limits.md).

const RED_DEBTS = 3;
const YELLOW_DEBTS = 1;

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export function computeSessionState(
  rows: GradeRow[],
  sessionEndsOn: string | null = null,
): SessionState {
  const debts = rows.filter((row) => row.status === 'debt' || row.status === 'failed');
  const graded = rows.filter((row) => row.grade !== null && row.grade !== undefined);
  const gpa =
    graded.length > 0
      ? Math.round(
          (graded.reduce((sum, row) => sum + (row.grade as number), 0) / graded.length) * 100,
        ) / 100
      : null;

  const now = Date.now();
  const overdue = debts.filter(
    (row) => row.debtDeadline !== null && new Date(row.debtDeadline).getTime() < now,
  );

  const ordered = [...debts].sort((a, b) => {
    if (a.debtDeadline === b.debtDeadline) return a.title.localeCompare(b.title);
    if (a.debtDeadline === null) return 1;
    if (b.debtDeadline === null) return -1;
    return a.debtDeadline < b.debtDeadline ? -1 : 1;
  });

  const actions = ordered.map((row) => ({
    courseId: row.courseId,
    title: row.title,
    deadline: row.debtDeadline,
    daysLeft: daysUntil(row.debtDeadline),
    why:
      row.status === 'failed'
        ? 'Неудовлетворительно, нужна пересдача'
        : row.controlForm === 'exam'
          ? 'Экзамен не сдан'
          : 'Зачёт не получен',
  }));

  const daysToSession = daysUntil(sessionEndsOn);

  let severity: SessionState['severity'] = 'green';
  if (debts.length >= RED_DEBTS || overdue.length > 0) severity = 'red';
  else if (debts.length >= YELLOW_DEBTS) severity = 'yellow';

  const headline =
    severity === 'green'
      ? 'Сессия без риска'
      : severity === 'yellow'
        ? 'Есть что закрыть'
        : overdue.length > 0
          ? 'Есть просроченные долги'
          : 'Три долга и больше';

  return {
    severity,
    debts: debts.length,
    overdue: overdue.length,
    gpa,
    headline,
    explanation: buildExplanation(severity, debts.length, overdue.length, ordered, daysToSession),
    actions,
    generatedBy: 'rules',
    daysToSession,
  };
}

function buildExplanation(
  severity: SessionState['severity'],
  debts: number,
  overdue: number,
  ordered: GradeRow[],
  daysToSession: number | null,
): string {
  if (severity === 'green') {
    return 'Все дисциплины семестра закрыты. Долгов нет.';
  }

  const first = ordered[0];
  const second = ordered[1];
  const firstDays = first ? daysUntil(first.debtDeadline) : null;

  // Собираем предложения по одному: склейка через шаблоны давала «дня..» и
  // заглавную букву после кавычки.
  const sentences: string[] = [];

  // Про просрочку говорим отдельным предложением, только если долгов больше
  // одного: для единственного долга срок назовёт следующая фраза.
  if (overdue > 0 && debts > 1) {
    sentences.push(
      overdue === debts
        ? debts === 2
          ? 'Оба просрочены.'
          : 'Все просрочены.'
        : `Просрочено ${overdue} из ${debts}.`,
    );
  } else if (debts > 2) {
    // Для одного-двух долгов счёт уже виден в заголовке — не повторяем.
    sentences.push(`Всего ${debts} ${plural(debts, 'долг', 'долга', 'долгов')}.`);
  }

  if (first) {
    if (firstDays === null) {
      sentences.push(`Ближайший — «${first.title}».`);
    } else if (firstDays < 0) {
      sentences.push(
        `Ближайший — «${first.title}», срок прошёл ${Math.abs(firstDays)} ${plural(Math.abs(firstDays), 'день', 'дня', 'дней')} назад.`,
      );
    } else if (firstDays === 0) {
      sentences.push(`Ближайший — «${first.title}», срок сегодня.`);
    } else {
      sentences.push(
        `Ближайший — «${first.title}», срок через ${firstDays} ${plural(firstDays, 'день', 'дня', 'дней')}.`,
      );
    }
  }

  if (second) {
    sentences.push(`Следующий — «${second.title}».`);
  }

  if (daysToSession !== null) {
    sentences.push(
      daysToSession <= 0
        ? 'Сессия закончилась.'
        : `До конца сессии ${daysToSession} ${plural(daysToSession, 'день', 'дня', 'дней')}.`,
    );
  }

  return sentences.join(' ');
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const LLM_TIMEOUT_MS = 3000;

// Опциональная переформулировка. Модель получает готовые числа и не может изменить статус.
export async function explainWithLlm(state: SessionState): Promise<SessionState> {
  const apiKey = process.env.LLM_API_KEY;
  const baseUrl = process.env.LLM_BASE_URL;
  const model = process.env.LLM_MODEL;
  if (!apiKey || !baseUrl || !model) return state;

  const facts = {
    severity: state.severity,
    debts: state.debts,
    overdue: state.overdue,
    gpa: state.gpa,
    actions: state.actions.map((action) => ({ title: action.title, deadline: action.deadline })),
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 180,
        messages: [
          {
            role: 'system',
            content:
              'Ты пишешь короткое объяснение статуса сессии для студента. Не меняй числа и статус, не добавляй факты. Только переформулируй, 2 предложения, без вступлений.',
          },
          { role: 'user', content: JSON.stringify(facts) },
        ],
      }),
    });
    clearTimeout(timer);
    if (!response.ok) return state;
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return state;
    return { ...state, explanation: text, generatedBy: 'llm' };
  } catch {
    return state;
  }
}
