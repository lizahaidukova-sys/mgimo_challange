import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';

// Проверка изоляции данных: студент Б не должен читать заявку студента А.
// Скрипт работает на отдельной временной базе, чтобы не портить демо-данные:
// создаёт её сидом, поднимает сервер на свободном порту и проверяет коды ответов.

const PORT = Number(process.env.VERIFY_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const VERIFY_DB = './data/verify.db';

// Путь к базе выставляется до импорта seed: модуль server/db читает env при загрузке.
process.env.DATABASE_PATH = VERIFY_DB;
for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(`${VERIFY_DB}${suffix}`)) rmSync(`${VERIFY_DB}${suffix}`);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs = 20000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      // сервер ещё поднимается
    }
    await wait(300);
  }
  throw new Error('сервер не поднялся');
}

async function login(email: string): Promise<string> {
  const response = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo12345' }),
  });
  if (!response.ok) throw new Error(`вход ${email}: ${response.status}`);
  const cookie = response.headers.get('set-cookie');
  if (!cookie) throw new Error('нет cookie сессии');
  return cookie.split(';')[0] ?? '';
}

async function status(path: string, cookie?: string): Promise<number> {
  const response = await fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie } : undefined,
    redirect: 'manual',
  });
  return response.status;
}

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
}

async function main(): Promise<void> {
  const { seed } = await import('../db/seed');
  seed();

  const child = spawn('npx', ['tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: VERIFY_DB, NODE_ENV: 'test' },
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });

  try {
    await waitForServer();

    const cookieA = await login('student1@demo.local');
    const cookieB = await login('student2@demo.local');
    const cookieStaff = await login('staff@demo.local');

    // Заявка 3 принадлежит студенту 2.
    check('студент Б видит свою заявку', (await status('/api/requests/3', cookieB)) === 200, 'ожидали 200');
    check(
      'студент А не видит чужую заявку',
      (await status('/api/requests/3', cookieA)) === 404,
      'ожидали 404 (не 403, чтобы не раскрывать существование)',
    );
    check(
      'несуществующая заявка тоже 404',
      (await status('/api/requests/999999', cookieA)) === 404,
      'ожидали 404',
    );
    check(
      'студент не может открыть staff-очередь',
      (await status('/api/staff/requests', cookieA)) === 403,
      'ожидали 403',
    );
    check(
      'сотрудник открывает очередь',
      (await status('/api/staff/requests', cookieStaff)) === 200,
      'ожидали 200',
    );
    check('без сессии главная недоступна', (await status('/api/dashboard')) === 401, 'ожидали 401');
    check(
      'подделанная cookie не даёт доступа',
      (await status('/api/dashboard', 'dean_session=forged-token')) === 401,
      'ожидали 401',
    );

    // Студент Б создаёт заявку и видит только её.
    const created = await fetch(`${BASE}/api/requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieB },
      body: JSON.stringify({ type: 'certificate_study', payload: { purpose: 'тест' } }),
    });
    check('студент может создать заявку', created.status === 201, `получили ${created.status}`);

    if (created.status === 201) {
      const body = (await created.json()) as { id: number };
      check(
        'новая заявка студента Б недоступна студенту А',
        (await status(`/api/requests/${body.id}`, cookieA)) === 404,
        'ожидали 404',
      );
      check(
        'новая заявка доступна автору',
        (await status(`/api/requests/${body.id}`, cookieB)) === 200,
        'ожидали 200',
      );
    }

    // Смена статуса: студент не должен иметь такой возможности.
    const statusChange = await fetch(`${BASE}/api/staff/requests/3/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ status: 'ready', comment: 'подмена' }),
    });
    check(
      'студент не может менять статус заявки',
      statusChange.status === 403,
      `получили ${statusChange.status}`,
    );

    // Чужой Origin не должен проходить мутацию даже с валидной cookie.
    const foreignOrigin = await fetch(`${BASE}/api/requests`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookieB,
        origin: 'https://evil.example',
      },
      body: JSON.stringify({ type: 'certificate_study', payload: { purpose: 'csrf' } }),
    });
    check(
      'мутация с чужим Origin отклоняется',
      foreignOrigin.status === 403,
      `получили ${foreignOrigin.status}`,
    );

    // Отказ без причины отклоняется.
    const rejection = await fetch(`${BASE}/api/staff/requests/3/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieStaff },
      body: JSON.stringify({ status: 'rejected', comment: '   ' }),
    });
    check(
      'отказ без причины не сохраняется',
      rejection.status === 400,
      `получили ${rejection.status}`,
    );

    // Ответ на чужой запрос не должен раскрывать существование ресурса.
    const foreign = await fetch(`${BASE}/api/requests/3`, { headers: { cookie: cookieA } });
    const foreignBody = (await foreign.text()).trim();
    const missing = await fetch(`${BASE}/api/requests/999999`, { headers: { cookie: cookieA } });
    const missingBody = (await missing.text()).trim();
    check(
      'чужой и несуществующий id неразличимы по телу ответа',
      foreignBody === missingBody,
      `тела: ${foreignBody} / ${missingBody}`,
    );
  } finally {
    child.kill();
    // Ждём завершения: на Windows файл базы остаётся заблокированным до выхода процесса.
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      setTimeout(resolve, 3000);
    });
  }

  const failed = results.filter((result) => !result.ok);
  for (const result of results) {
    console.log(`${result.ok ? 'OK  ' : 'FAIL'} ${result.name} — ${result.detail}`);
  }
  if (failed.length > 0) {
    console.error(`\nПровалено проверок: ${failed.length}`);
    process.exit(1);
  }
  console.log(`\nВсе проверки пройдены: ${results.length}`);
  // Временная база проверок не должна попадать в коммит; ошибку удаления игнорируем.
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      if (existsSync(`${VERIFY_DB}${suffix}`)) rmSync(`${VERIFY_DB}${suffix}`);
    } catch {
      // файл ещё держит процесс — он уже в .gitignore
    }
  }
}

void main();
