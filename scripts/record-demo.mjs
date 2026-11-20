#!/usr/bin/env node
// Демонстрационное видео прототипа: кадр на экран, фиксированная длительность,
// титры по фактической последовательности. Никаких монтажных трюков —
// каждый кадр снят в реальном браузере на работающем приложении.
//
//   node scripts/record-demo.mjs [--out docs/demo] [--port 8796]
//
// Требует ffmpeg в PATH и Chrome (CHROME_PATH или стандартный путь).
// Сервер сидируется и поднимается на временной базе, чтобы демо было одинаковым.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const outDir = readFlag('--out', 'docs/demo');
const port = Number(readFlag('--port', '8796'));
const BASE = `http://127.0.0.1:${port}`;
const frameDir = join(outDir, 'frames');
const DB = './data/record.db';

function readFlag(name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(timeoutMs = 25000) {
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

// Сценарий: экран, подпись, сколько держать. Порядок = порядок в видео.
const SCENES = [
  {
    path: '/',
    caption: 'Главная: что сегодня, что изменилось, как дела с сессией',
    hold: 5,
  },
  { path: '/schedule', caption: 'Расписание: день и неделя, переносы отмечены', hold: 4.5 },
  { path: '/schedule?view=week', caption: null, hold: 4.5 },
  { path: '/grades', caption: 'Успеваемость: оценки, долги, светофор сессии', hold: 5 },
  { path: '/requests', caption: 'Заявки: статус, срок, история', hold: 4 },
  { path: '/requests/1', caption: null, hold: 3.5 },
  { path: '/notifications', caption: 'Уведомления: переносы, статусы, объявления', hold: 4 },
  { path: '/requests/new', caption: 'Новая заявка: четыре шага, срок в рабочих днях', hold: 5 },
  { path: '/staff', caption: 'Деканат: очередь и обязательства', hold: 4.5, role: 'staff' },
  { path: '/staff/requests', caption: null, hold: 4, role: 'staff' },
  { path: '/staff/requests/1', caption: 'Смена статуса: причина отказа обязательна', hold: 5, role: 'staff' },
  { path: '/profile', caption: 'Профиль: данные студента и границы доступа', hold: 3.5 },
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

    // puppeteer-core нужен только записи, приложению — нет:
    // поэтому импорт динамический, чтобы обычный запуск не тянул браузер.
    const { default: puppeteer } = await import('puppeteer-core');
    browser = await puppeteer.launch({
      executablePath: findChrome(),
      headless: true,
      args: ['--no-sandbox', '--hide-scrollbars'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

    const setSession = (cookie) =>
      page.setCookie({
        name: 'dean_session',
        value: cookie.split('=')[1] ?? '',
        domain: '127.0.0.1',
        path: '/',
      });

    await setSession(studentCookie);

    const frames = [];
    let captionStart = 0;
    const captions = [];

    for (const scene of SCENES) {
      if (scene.role === 'staff') await setSession(staffCookie);
      else await setSession(studentCookie);

      await page.goto(`${BASE}${scene.path}`, { waitUntil: 'networkidle0' });
      await wait(700);

      if (scene.caption) await showCaption(page, scene.caption);
      else await hideCaption(page);

      const path = join(frameDir, `f${String(frames.length).padStart(4, '0')}.png`);
      await page.screenshot({ path });
      frames.push({ path, hold: scene.hold });

      if (scene.caption) {
        captions.push({
          from: captionStart,
          to: captionStart + scene.hold,
          text: scene.caption,
        });
      }
      captionStart += scene.hold;
    }

    console.log(`кадров: ${frames.length}, длительность: ${captionStart.toFixed(1)} с`);

    const listLines = [];
    for (const frame of frames) {
      const absolute = resolve(frame.path).replace(/\\/g, '/');
      listLines.push(`file '${absolute}'`);
      listLines.push(`duration ${frame.hold.toFixed(3)}`);
    }
    listLines.push(`file '${resolve(frames[frames.length - 1].path).replace(/\\/g, '/')}'`);
    const listPath = resolve(outDir, 'frames.txt');
    writeFileSync(listPath, listLines.join('\n'), 'utf8');

    // Подписи рисуются в самой странице перед снимком: так шрифт, переносы
    // и фон контролируются CSS, а не экранированием ffmpeg.
    const filterChain = ['scale=780:-2:flags=lanczos', 'fps=25', 'format=yuv420p'].join(',');

    const output = join(outDir, 'demo.mp4');
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
        // файл ещё держит процесс — он в .gitignore
      }
    }
  }
}

// Плашка с подписью живёт в DOM поверх интерфейса, но не перехватывает клики.
async function showCaption(page, text) {
  await page.evaluate((caption) => {
    let node = document.getElementById('demo-caption');
    if (!node) {
      node = document.createElement('div');
      node.id = 'demo-caption';
      Object.assign(node.style, {
        position: 'fixed',
        left: '12px',
        right: '12px',
        bottom: '78px',
        zIndex: '9999',
        background: 'rgba(16,24,40,0.88)',
        color: '#fff',
        font: '500 15px/1.35 "Segoe UI", Arial, sans-serif',
        padding: '10px 14px',
        borderRadius: '10px',
        textAlign: 'center',
        pointerEvents: 'none',
      });
      document.body.appendChild(node);
    }
    node.textContent = caption;
  }, text);
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
