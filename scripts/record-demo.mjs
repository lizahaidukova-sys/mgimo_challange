#!/usr/bin/env node
// Демонстрационное видео прототипа: кадр на экран, фиксированная длительность,
// титры по фактической последовательности. Никаких монтажных трюков —
// каждый кадр снят в реальном браузере на работающем приложении.
//
//   node scripts/record-demo.mjs --view mobile    # docs/demo/demo-mobile.mp4
//   node scripts/record-demo.mjs --view desktop   # docs/demo/demo-desktop.mp4
//
// Требует ffmpeg в PATH и Chrome (CHROME_PATH или стандартный путь).
// Сервер сидируется и поднимается на временной базе, чтобы демо было одинаковым.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const view = readFlag('--view', 'mobile');
const outDir = readFlag('--out', 'docs/demo');
const port = Number(readFlag('--port', view === 'desktop' ? '8797' : '8796'));
const BASE = `http://127.0.0.1:${port}`;
const DB = `./data/record-${view}.db`;

// Два вида записываются отдельными файлами: 390×844 для телефона,
// 1440×900 для десктопа. Подпись на десктопе шире и стоит ниже.
const VIEWPORTS = {
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, scale: 780 },
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, scale: 1440 },
};
if (!VIEWPORTS[view]) throw new Error(`неизвестный вид: ${view} (mobile или desktop)`);
const viewport = VIEWPORTS[view];
const frameDir = join(outDir, `frames-${view}`);

function readFlag(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // поднимается
    }
    await wait(250);
  }
  throw new Error('сервер не поднялся');
}

async function login(email) {
  const response = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo12345' }),
  });
  if (!response.ok) throw new Error(`вход ${email}: ${response.status}`);
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

// Сценарий: экран, подпись, сколько держать, кому показывать.
// `open` — необязательное действие после загрузки (открыть модалку, выбрать вкладку).
// Порядок = порядок в видео.
const SCENES = [
  {
    path: '/login',
    caption: 'Вход: четыре демо-аккаунта, пароль подставляется кнопкой',
    hold: 4,
    anonymous: true,
  },
  {
    path: '/',
    caption: 'Главная: что сегодня, что изменилось, как дела с сессией',
    hold: 5.5,
  },
  { path: '/schedule', caption: 'Расписание: день, переносы отмечены статусом', hold: 4.5 },
  { path: '/schedule?view=week', caption: 'Неделя целиком: 22 пары, отмены отдельным цветом', hold: 4.5 },
  { path: '/grades', caption: 'Успеваемость: оценки, долги, светофор сессии', hold: 5 },
  {
    path: '/grades',
    caption: 'Долги отдельной вкладкой: что закрыть и в какой срок',
    hold: 4,
    open: async (page) => {
      await page.evaluate(() => {
        const tab = [...document.querySelectorAll('button[role="tab"]')].find((b) =>
          b.textContent?.includes('Долги'),
        );
        tab?.click();
      });
    },
  },
  { path: '/history', caption: 'Зачётка: пять семестров, GPA и тренд', hold: 4.5 },
  { path: '/requests', caption: 'Заявки: статус, срок в рабочих днях, история', hold: 4 },
  {
    path: '/requests/5',
    caption: 'Заявка отклонена: причина видна, студент прикладывает справку',
    hold: 5,
  },
  {
    path: '/retakes',
    caption: 'Пересдачи: только незакрытые дисциплины, сданное не предлагается',
    hold: 5,
  },
  {
    path: '/retakes',
    caption: 'Перед записью — подтверждение: дата, аудитория, преподаватель, места',
    hold: 5.5,
    open: async (page) => {
      await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find(
          (b) => b.textContent?.trim() === 'Записаться',
        );
        button?.click();
      });
      await wait(500);
    },
  },
  { path: '/notifications', caption: 'Уведомления: объявления, переносы, статусы, сообщения', hold: 4.5 },
  { path: '/messages', caption: 'Переписка с деканатом: ответ приходит в уведомления', hold: 4 },
  { path: '/requests/new', caption: 'Новая заявка: четыре шага, срок в рабочих днях', hold: 5 },
  { path: '/documents', caption: 'Документы и стипендия: номера, срок действия, выплаты', hold: 4.5 },
  { path: '/profile', caption: 'Профиль: данные студента и границы доступа', hold: 4 },

  { path: '/staff', caption: 'Деканат: сводка очереди и обязательства по срокам', hold: 5, role: 'staff' },
  { path: '/staff/requests', caption: 'Очередь по сроку, а не по дате подачи', hold: 4.5, role: 'staff' },
  {
    path: '/staff/requests/1',
    caption: 'Карточка заявки: данные, вложения, смена статуса',
    hold: 5.5,
    role: 'staff',
  },
  {
    path: '/staff/dialogs',
    caption: 'Переписка: ответ студенту уходит в его уведомления',
    hold: 4.5,
    role: 'staff',
  },
  { path: '/staff/announcements', caption: 'Объявление с выбором аудитории: все или группа', hold: 4, role: 'staff' },
  { path: '/staff/schedule', caption: 'Правка пары: перенос виден студенту как статус', hold: 4.5, role: 'staff' },

  {
    path: '/admin/lessons',
    caption: 'Админка для жюри: таблицы базы без SSH и SQL',
    hold: 5.5,
    role: 'admin',
  },
  { path: '/admin/teachers', caption: 'Преподаватели: поиск, создание, правка, удаление', hold: 4.5, role: 'admin' },
  { path: '/admin/courses', caption: 'Дисциплины: преподаватель, зачётные единицы, форма контроля', hold: 4.5, role: 'admin' },
  { path: '/admin/people', caption: 'Люди: студенты и сотрудники, аккаунты админов скрыты', hold: 4.5, role: 'admin' },
  { path: '/admin/semesters', caption: 'Семестры: границы задают зачётку и отсчёт до сессии', hold: 4, role: 'admin' },
  {
    path: '/admin/lessons',
    caption: 'Правка пары меняет то, что сразу видит студент',
    hold: 5,
    role: 'admin',
    open: async (page) => {
      await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find(
          (b) => b.textContent?.trim() === 'Изменить',
        );
        button?.click();
      });
      await wait(600);
    },
  },
];

async function main() {
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(`${DB}${suffix}`)) rmSync(`${DB}${suffix}`);
  }

  const env = { ...process.env, PORT: String(port), DATABASE_PATH: DB, NODE_ENV: 'test' };

  // Сид отдельным процессом, чтобы родитель не держал файл базы.
  await new Promise((resolveOnce, reject) => {
    const seed = spawn(
      process.execPath,
      ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'scripts/seed.ts'],
      { env, stdio: 'ignore' },
    );
    seed.once('exit', (code) => (code === 0 ? resolveOnce() : reject(new Error('сид упал'))));
  });

  const server = spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', '--import', 'tsx', 'server/index.ts'],
    { env, stdio: 'ignore' },
  );

  let browser = null;
  try {
    await waitForServer();
    const studentCookie = await login('student1@demo.local');
    const staffCookie = await login('staff@demo.local');
    const adminCookie = await login('admin@demo.local');

    // puppeteer-core нужен только записи, приложению — нет:
    // поэтому импорт динамический, чтобы обычный запуск не тянул браузер.
    const { default: puppeteer } = await import('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--no-sandbox', '--hide-scrollbars'],
    });

    const page = await browser.newPage();
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
    });

    const setSession = (cookie) =>
      page.setCookie({
        name: 'dean_session',
        value: cookie.split('=')[1] ?? '',
        domain: '127.0.0.1',
        path: '/',
      });

    const clearSession = () => page.deleteCookie({ name: 'dean_session', domain: '127.0.0.1', path: '/' });

    await setSession(studentCookie);

    const frames = [];
    let captionStart = 0;

    for (const scene of SCENES) {
      if (scene.anonymous) await clearSession();
      else if (scene.role === 'staff') await setSession(staffCookie);
      else if (scene.role === 'admin') await setSession(adminCookie);
      else await setSession(studentCookie);

      await page.goto(`${BASE}${scene.path}`, { waitUntil: 'networkidle0' });
      await wait(800);

      if (scene.open) await scene.open(page);

      if (scene.caption) await showCaption(page, scene.caption, view);
      else await hideCaption(page);

      const path = join(frameDir, `f${String(frames.length).padStart(4, '0')}.png`);
      await page.screenshot({ path });
      frames.push({ path, hold: scene.hold });
      captionStart += scene.hold;
    }

    console.log(`вид: ${view}, кадров: ${frames.length}, длительность: ${captionStart.toFixed(1)} с`);

    const listLines = [];
    for (const frame of frames) {
      const absolute = resolve(frame.path).replace(/\\/g, '/');
      listLines.push(`file '${absolute}'`);
      listLines.push(`duration ${frame.hold.toFixed(3)}`);
    }
    listLines.push(`file '${resolve(frames[frames.length - 1].path).replace(/\\/g, '/')}'`);
    const listPath = resolve(outDir, `frames-${view}.txt`);
    writeFileSync(listPath, listLines.join('\n'), 'utf8');

    // Подписи рисуются в самой странице перед снимком: так шрифт, переносы
    // и фон контролируются CSS, а не экранированием ffmpeg.
    const filterChain = [`scale=${viewport.scale}:-2:flags=lanczos`, 'fps=25', 'format=yuv420p'].join(',');

    const output = join(outDir, `demo-${view}.mp4`);
    await runFfmpeg([
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-vf', filterChain,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '22',
      '-movflags', '+faststart',
      output,
    ]);
    rmSync(listPath, { force: true });
    rmSync(frameDir, { recursive: true, force: true });
    console.log(`видео: ${output}`);
  } finally {
    await browser?.close().catch(() => {});
    server.kill();
    await new Promise((resolveOnce) => {
      const timer = setTimeout(resolveOnce, 4000);
      server.once('exit', () => {
        clearTimeout(timer);
        resolveOnce();
      });
    });
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        if (existsSync(`${DB}${suffix}`)) rmSync(`${DB}${suffix}`);
      } catch {
        // Windows держит файл до выхода процесса — не мешает записи.
      }
    }
  }
}

async function showCaption(page, text, viewName) {
  await page.evaluate(
    ({ caption, view: v }) => {
      let node = document.getElementById('demo-caption');
      if (!node) {
        node = document.createElement('div');
        node.id = 'demo-caption';
        Object.assign(node.style, {
          position: 'fixed',
          left: v === 'desktop' ? 'auto' : '12px',
          right: v === 'desktop' ? '24px' : '12px',
          bottom: v === 'desktop' ? '24px' : '78px',
          maxWidth: v === 'desktop' ? '520px' : 'none',
          zIndex: '9999',
          background: 'rgba(16,24,40,0.9)',
          color: '#fff',
          font: v === 'desktop' ? '500 17px/1.4 "Segoe UI", Arial, sans-serif' : '500 15px/1.35 "Segoe UI", Arial, sans-serif',
          padding: '10px 14px',
          borderRadius: '10px',
          textAlign: 'center',
          pointerEvents: 'none',
        });
        document.body.appendChild(node);
      }
      node.textContent = caption;
    },
    { caption: text, view: viewName },
  );
}

async function hideCaption(page) {
  await page.evaluate(() => document.getElementById('demo-caption')?.remove());
}

function runFfmpeg(argv) {
  return new Promise((resolveOnce, reject) => {
    const ffmpeg = spawn('ffmpeg', argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    const errors = [];
    ffmpeg.stderr.on('data', (chunk) => errors.push(chunk.toString()));
    ffmpeg.once('exit', (code) => {
      if (code === 0) resolveOnce();
      else reject(new Error(errors.join('').slice(-800)));
    });
  });
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('Chrome не найден: задайте CHROME_PATH');
  return found;
}

void main().catch((error) => {
  console.error('запись не удалась:', error.message);
  process.exit(1);
});
