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

// Временная база проверок не должна попадать в коммит.
// На Windows файл может оставаться заблокированным до выхода процесса — ошибку игнорируем.
async function cleanupVerifyDb(): Promise<void> {
  // Windows отпускает handles не мгновенно после выхода процесса — пробуем несколько раз.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let remaining = false;
    for (const suffix of ['', '-wal', '-shm']) {
      const file = `${VERIFY_DB}${suffix}`;
      if (!existsSync(file)) continue;
      try {
        rmSync(file);
      } catch {
        remaining = true;
      }
    }
    if (!remaining) return;
    await wait(300);
  }
}

function runOnce(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], {
      env,
      stdio: 'ignore',
    });
    proc.once('error', reject);
    proc.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${args.join(' ')} завершился с кодом ${code}`));
    });
  });
}

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
}

async function main(): Promise<void> {
  // Сид и сервер запускаются отдельными процессами: родитель не должен
  // открывать файл временной базы, иначе на Windows его нельзя удалить.
  const env = {
    ...process.env,
    PORT: String(PORT),
    DATABASE_PATH: VERIFY_DB,
    NODE_ENV: 'test',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --disable-warning=ExperimentalWarning`.trim(),
  };
  await runOnce(['node_modules/tsx/dist/cli.mjs', 'scripts/seed.ts'], env);

  // Запускаем tsx напрямую, без shell: иначе kill() убивает обёртку,
  // а сервер продолжает держать порт и остаётся старым кодом.
  const child = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', 'node_modules/tsx/dist/cli.mjs', 'server/index.ts'],
    { env, stdio: 'ignore' },
  );

  try {
    await waitForServer();

    const cookieA = await login('student1@demo.local');
    const cookieB = await login('student2@demo.local');
    const cookieStaff = await login('staff@demo.local');
    const cookieAdmin = await login('admin@demo.local');

    // Идентификаторы берём из данных: сид может меняться, тест — нет.
    async function requestIds(cookie: string): Promise<number[]> {
      const response = await fetch(`${BASE}/api/requests`, { headers: { cookie } });
      const data = (await response.json()) as { rows: { id: number }[] };
      return data.rows.map((row) => row.id);
    }
    const idsA = await requestIds(cookieA);
    const idsB = await requestIds(cookieB);
    check('студент А видит свои заявки', idsA.length > 0, `заявок: ${idsA.length}`);
    const foreignForA = idsB[0];
    const ownForB = idsB[0];
    if (!foreignForA) throw new Error('у студента Б нет заявок для проверки');
    check(
      'студент Б видит свою заявку',
      (await status(`/api/requests/${ownForB}`, cookieB)) === 200,
      'ожидали 200',
    );
    check(
      'студент А не видит чужую заявку',
      (await status(`/api/requests/${foreignForA}`, cookieA)) === 404,
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
    // Админка — отдельная роль: ни студент, ни сотрудник деканата в неё не проходят.
    check(
      'студент не открывает админку',
      (await status('/api/admin/lessons', cookieA)) === 403,
      'ожидали 403',
    );
    check(
      'сотрудник не открывает админку',
      (await status('/api/admin/lessons', cookieStaff)) === 403,
      'ожидали 403',
    );
    check(
      'администратор открывает админку',
      (await status('/api/admin/lessons', cookieAdmin)) === 200,
      'ожидали 200',
    );
    check(
      'без сессии админка недоступна',
      (await status('/api/admin/teachers')) === 401,
      'ожидали 401',
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
    const statusChange = await fetch(`${BASE}/api/staff/requests/${ownForB}/status`, {
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
    const rejection = await fetch(`${BASE}/api/staff/requests/${ownForB}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieStaff },
      body: JSON.stringify({ status: 'rejected', comment: '   ' }),
    });
    check(
      'отказ без причины не сохраняется',
      rejection.status === 400,
      `получили ${rejection.status}`,
    );

    // Лимит попыток должен работать и для несуществующих адресов.
    let limited = 0;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await fetch(`${BASE}/api/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@demo.local', password: `bad${attempt}` }),
      });
      limited = response.status;
    }
    check('перебор по неизвестному адресу упирается в лимит', limited === 429, `11-я попытка: ${limited}`);

    // Пересдачи: сданную дисциплину пересдать нельзя, а слоты по сданному
    // не должны попадать в список — иначе вкладка предлагает записаться зря.
    const retakesA = (await (
      await fetch(`${BASE}/api/retakes`, { headers: { cookie: cookieA } })
    ).json()) as { rows: { id: number; courseTitle: string; eligible: boolean; myBookingId: number | null }[] };
    const retakesB = (await (
      await fetch(`${BASE}/api/retakes`, { headers: { cookie: cookieB } })
    ).json()) as { rows: { id: number; courseTitle: string; eligible: boolean; myBookingId: number | null }[] };

    check(
      'студенту не показывают слоты по сданным дисциплинам',
      retakesA.rows.length > 0 && retakesA.rows.every((slot) => slot.eligible),
      `слотов: ${retakesA.rows.map((slot) => slot.courseTitle).join(', ') || 'нет'}`,
    );
    check(
      'у Дмитрия в списке только его долг',
      retakesB.rows.length === 1 && retakesB.rows[0]!.courseTitle === 'Международная торговля',
      `слотов: ${retakesB.rows.map((slot) => slot.courseTitle).join(', ') || 'нет'}`,
    );

    // Прямой запрос мимо UI: торговля у Анны сдана на 5, но её слот есть у Дмитрия.
    // Записаться мимо формы нельзя — сервер проверяет зачётку, а не список в UI.
    const tradeSlotId = retakesB.rows[0]!.id;
    const bypass = await fetch(`${BASE}/api/retakes/${tradeSlotId}/book`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({}),
    });
    check(
      'запись на пересдачу сданной дисциплины отклоняется',
      bypass.status === 400,
      `получили ${bypass.status}`,
    );

    // Переписка: обе стороны должны увидеть ответ в уведомлениях.
    // Форма ответа задана сервером (server/index.ts), поэтому проверяем её здесь.
    const readNotifications = async (
      cookie: string,
    ): Promise<{ unread: number; kinds: string[] }> => {
      const response = await fetch(`${BASE}/api/notifications`, { headers: { cookie } });
      const raw: unknown = await response.json();
      if (!raw || typeof raw !== 'object' || !('unread' in raw) || !('rows' in raw)) {
        throw new Error('неожиданный ответ /api/notifications');
      }
      const rows = Array.isArray(raw.rows) ? raw.rows : [];
      const kinds = rows
        .map((row) => (row && typeof row === 'object' && 'kind' in row ? String(row.kind) : ''))
        .filter(Boolean);
      const unread = typeof raw.unread === 'number' ? raw.unread : Number(raw.unread);
      if (!Number.isFinite(unread)) throw new Error('unread не число');
      return { unread, kinds };
    };

    const staffUnreadBefore = (await readNotifications(cookieStaff)).unread;
    await fetch(`${BASE}/api/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ body: 'Проверка уведомления для деканата' }),
    });
    const staffNotesAfter = await readNotifications(cookieStaff);
    check(
      'студент пишет — деканат получает уведомление',
      staffNotesAfter.unread === staffUnreadBefore + 1,
      `было ${staffUnreadBefore}, стало ${staffNotesAfter.unread}`,
    );
    check(
      'уведомление о сообщении студента видно в списке',
      staffNotesAfter.kinds.includes('message'),
      `виды: ${staffNotesAfter.kinds.join(', ')}`,
    );

    const studentUnreadBefore = (await readNotifications(cookieA)).unread;
    await fetch(`${BASE}/api/staff/dialogs/1/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieStaff },
      body: JSON.stringify({ body: 'Ответ деканата для проверки' }),
    });
    check(
      'деканат отвечает — студент получает уведомление',
      (await readNotifications(cookieA)).unread === studentUnreadBefore + 1,
      `было ${studentUnreadBefore}`,
    );

    // Открытие переписки гасит и счётчик сообщений, и уведомление о них.
    await fetch(`${BASE}/api/messages`, { headers: { cookie: cookieA } });
    const studentUnreadAfterRead = (await readNotifications(cookieA)).unread;
    check(
      'открытая переписка гасит уведомление о сообщении',
      studentUnreadAfterRead < studentUnreadBefore + 1,
      `стало ${studentUnreadAfterRead}`,
    );

    // Вложения заявок: файл видит только владелец и деканат.
    const attachmentsB = (await (
      await fetch(`${BASE}/api/requests/5`, { headers: { cookie: cookieB } })
    ).json()) as { attachments: { id: number; fileName: string }[] };
    const attachmentId = attachmentsB.attachments[0]?.id;
    check(
      'у заявки Дмитрия есть приложенный документ',
      Boolean(attachmentId),
      `файлов: ${attachmentsB.attachments.length}`,
    );
    if (attachmentId) {
      check(
        'автор скачивает свой документ',
        (await status(`/api/requests/5/attachments/${attachmentId}`, cookieB)) === 200,
        'ожидали 200',
      );
      check(
        'другой студент не скачивает чужой документ',
        (await status(`/api/requests/5/attachments/${attachmentId}`, cookieA)) === 404,
        'ожидали 404',
      );
      check(
        'деканат скачивает документ заявки',
        (await status(`/api/staff/requests/5/attachments/${attachmentId}`, cookieStaff)) === 200,
        'ожидали 200',
      );
    }

    // Загрузка: чужую заявку, неподдерживаемый тип и выполненную заявку — отказ.
    const pdfBytes = '%PDF-1.4\ntest\n%%EOF\n';
    const uploadTo = (requestId: number, cookie: string, type = 'application/pdf') =>
      fetch(`${BASE}/api/requests/${requestId}/attachments`, {
        method: 'PUT',
        headers: { 'content-type': type, 'x-file-name': encodeURIComponent('справка.pdf'), cookie },
        body: pdfBytes,
      });
    check(
      'студент прикладывает файл к своей заявке',
      (await uploadTo(6, cookieB)).status === 201,
      'ожидали 201',
    );
    check(
      'файл к чужой заявке не принимается',
      (await uploadTo(1, cookieB)).status === 404,
      'ожидали 404',
    );
    check(
      'неподдерживаемый тип файла отклоняется',
      (await uploadTo(6, cookieB, 'application/zip')).status === 400,
      'ожидали 400',
    );
    check(
      'сотрудник не прикладывает файлы за студента',
      (await uploadTo(6, cookieStaff)).status === 403,
      'ожидали 403',
    );

    // Новые разделы: пересдачи, документы, сообщения — тоже только свои.
    const studentADocs = await fetch(`${BASE}/api/documents`, { headers: { cookie: cookieA } });
    const studentBDocs = await fetch(`${BASE}/api/documents`, { headers: { cookie: cookieB } });
    const aDoc = (await studentADocs.json()) as { documents: { number: string }[] };
    const bDoc = (await studentBDocs.json()) as { documents: { number: string }[] };
    check(
      'документы у студентов разные',
      aDoc.documents.length > 0 &&
        bDoc.documents.length > 0 &&
        !aDoc.documents.some((doc) => bDoc.documents.some((other) => other.number === doc.number)),
      `номера: ${aDoc.documents.map((d) => d.number).join(',')} / ${bDoc.documents.map((d) => d.number).join(',')}`,
    );

    const aMessages = await fetch(`${BASE}/api/messages`, { headers: { cookie: cookieA } });
    const aMessageRows = (await aMessages.json()) as { rows: { body: string }[] };
    check(
      'студент не видит переписку другого студента',
      !aMessageRows.rows.some((row) => row.body.includes('перенести пересдачу по торговле')),
      `сообщений: ${aMessageRows.rows.length}`,
    );

    const staffDialogs = await fetch(`${BASE}/api/staff/dialogs`, { headers: { cookie: cookieA } });
    check(
      'студент не может читать все диалоги деканата',
      staffDialogs.status === 403,
      `получили ${staffDialogs.status}`,
    );

    const replyAsStudent = await fetch(`${BASE}/api/staff/dialogs/2/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ body: 'подмена' }),
    });
    check(
      'студент не может ответить от имени деканата',
      replyAsStudent.status === 403,
      `получили ${replyAsStudent.status}`,
    );

    // Ответ на чужой запрос не должен раскрывать существование ресурса.
    const foreign = await fetch(`${BASE}/api/requests/${foreignForA}`, { headers: { cookie: cookieA } });
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
      const timer = setTimeout(resolve, 5000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
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
  await cleanupVerifyDb();
}

void main();
