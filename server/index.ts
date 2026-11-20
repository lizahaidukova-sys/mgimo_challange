import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { db, audit } from './db';
import {
  attachUser,
  checkLoginRate,
  clearLoginFailures,
  createSession,
  hashPassword,
  noteLoginFailure,
  requireAuth,
  requireStaff,
  revokeSession,
  verifyPassword,
  type AuthedRequest,
} from './auth';
import {
  createRequest,
  dashboard,
  getRequest,
  grades,
  lessonsForRange,
  listRequests,
  markAllRead,
  markNotificationRead,
  moveLesson,
  notifications,
  publishAnnouncement,
  sessionState,
  setRequestStatus,
  staffOverview,
  staffQueue,
  staffRequest,
  unreadCount,
} from './repo';
import { explainWithLlm } from './rules';
import { startOfMskDay, startOfMskWeek, addDays } from './time';
import type { RequestStatus, RequestType } from '../shared/types';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

// Заголовки безопасности для всех ответов.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// Проверка Origin для небезопасных методов: защита от CSRF при SameSite=Lax.
// Если APP_ORIGIN задан — сравниваем с ним; иначе с фактическим хостом запроса,
// чтобы проверка работала и без переменной окружения.
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const origin = req.get('origin');
  if (!origin) return next();
  const expected = process.env.APP_ORIGIN;
  let allowed = false;
  try {
    const originHost = new URL(origin).host;
    allowed = expected
      ? new URL(expected).host === originHost
      : originHost === req.get('host');
  } catch {
    allowed = false;
  }
  if (!allowed) {
    res.status(403).json({ error: 'Недостаточно прав' });
    return;
  }
  next();
});

app.use(attachUser);

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

app.post('/api/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Проверьте e-mail и пароль' });
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();
  if (!checkLoginRate(email)) {
    res.status(429).json({ error: 'Слишком много попыток. Попробуйте позже.' });
    return;
  }

  const row = db
    .prepare(`SELECT id, password_hash, role FROM users WHERE email = ?`)
    .get(email) as { id: number; password_hash: string; role: string } | undefined;

  // Одинаковый ответ для «нет пользователя» и «неверный пароль».
  if (!row || !verifyPassword(parsed.data.password, row.password_hash)) {
    // Считаем попытки и для несуществующего адреса: иначе перебор по базе
    // адресов шёл бы без ограничения.
    noteLoginFailure(email);
    audit(null, 'login.failed', 'user', row?.id ?? null, {});
    res.status(401).json({ error: 'Неверный e-mail или пароль' });
    return;
  }

  clearLoginFailures(email);
  createSession(res, row.id);
  // last_seen_at обновляется только при просмотре главной: иначе «что изменилось»
  // теряет точку отсчёта сразу после входа.
  audit(row.id, 'login.success', 'user', row.id, {});
  res.json({ ok: true, role: row.role });
});

app.post('/api/logout', (req: AuthedRequest, res) => {
  if (req.user && req.sessionId) {
    revokeSession(res, req.sessionId);
    audit(req.user.id, 'logout', 'user', req.user.id, {});
  } else {
    res.clearCookie('dean_session', { path: '/' });
  }
  res.json({ ok: true });
});

app.get('/api/me', (req: AuthedRequest, res) => {
  if (!req.user) {
    res.status(401).json({ error: 'Требуется вход' });
    return;
  }
  res.json(req.user);
});

// ---------- студент ----------

app.get('/api/dashboard', requireAuth, async (req: AuthedRequest, res) => {
  const data = dashboard(req.user!);
  const explained = await explainWithLlm(data.sessionState);
  res.json({ ...data, sessionState: explained });
});

app.get('/api/schedule', requireAuth, (req: AuthedRequest, res) => {
  const view = req.query.view === 'week' ? 'week' : 'day';
  const anchor = typeof req.query.date === 'string' ? new Date(req.query.date) : new Date();
  const at = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
  const from = view === 'week' ? startOfMskWeek(at) : startOfMskDay(at);
  const to = view === 'week' ? addDays(from, 7) : addDays(from, 1);
  res.json({
    view,
    from: from.toISOString(),
    to: to.toISOString(),
    lessons: lessonsForRange(req.user!.groupName, from.toISOString(), to.toISOString()),
  });
});

app.get('/api/grades', requireAuth, (req: AuthedRequest, res) => {
  res.json({ rows: grades(req.user!.id), state: sessionState(req.user!.id) });
});

app.get('/api/requests', requireAuth, (req: AuthedRequest, res) => {
  res.json({ rows: listRequests(req.user!.id) });
});

app.get('/api/requests/:id', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  const detail = getRequest(req.user!.id, id);
  if (!detail) {
    // Чужой и несуществующий id неразличимы.
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  res.json(detail);
});

const createRequestSchema = z.object({
  type: z.enum(['certificate_study', 'certificate_scholarship', 'retake_application']),
  payload: z.record(z.string(), z.string().max(500)).default({}),
});

app.post('/api/requests', requireAuth, (req: AuthedRequest, res) => {
  if (req.user!.role !== 'student') {
    res.status(403).json({ error: 'Недостаточно прав' });
    return;
  }
  const parsed = createRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Проверьте поля формы' });
    return;
  }
  const detail = createRequest(req.user!.id, {
    type: parsed.data.type as RequestType,
    payload: parsed.data.payload,
  });
  res.status(201).json(detail);
});

app.get('/api/notifications', requireAuth, (req: AuthedRequest, res) => {
  res.json({ rows: notifications(req.user!.id), unread: unreadCount(req.user!.id) });
});

app.post('/api/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  markNotificationRead(req.user!.id, id);
  res.json({ ok: true, unread: unreadCount(req.user!.id) });
});

app.post('/api/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
  markAllRead(req.user!.id);
  res.json({ ok: true, unread: 0 });
});

// ---------- сотрудник ----------

app.get('/api/staff/overview', requireStaff, (_req: AuthedRequest, res) => {
  res.json(staffOverview());
});

app.get('/api/staff/requests', requireStaff, (req: AuthedRequest, res) => {
  const status = typeof req.query.status === 'string' ? (req.query.status as RequestStatus) : undefined;
  const allowed: RequestStatus[] = ['submitted', 'in_progress', 'ready', 'rejected'];
  res.json({ rows: staffQueue(status && allowed.includes(status) ? status : undefined) });
});

app.get('/api/staff/requests/:id', requireStaff, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const detail = Number.isInteger(id) ? staffRequest(id) : null;
  if (!detail) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  res.json(detail);
});

const statusSchema = z.object({
  status: z.enum(['submitted', 'in_progress', 'ready', 'rejected']),
  comment: z.string().max(1000).default(''),
});

app.post('/api/staff/requests/:id/status', requireStaff, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = statusSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: 'Проверьте поля формы' });
    return;
  }
  if (parsed.data.status === 'rejected' && parsed.data.comment.trim().length < 5) {
    res.status(400).json({ error: 'Для отказа нужна причина не короче 5 символов' });
    return;
  }
  const ok = setRequestStatus(id, req.user!.id, parsed.data.status, parsed.data.comment);
  if (!ok) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  res.json({ ok: true });
});

const announcementSchema = z.object({
  title: z.string().min(3).max(140),
  body: z.string().min(5).max(2000),
  audience: z.string().min(1).max(40),
});

app.post('/api/staff/announcements', requireStaff, (req: AuthedRequest, res) => {
  const parsed = announcementSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Проверьте поля формы' });
    return;
  }
  const id = publishAnnouncement(req.user!.id, parsed.data);
  res.status(201).json({ id });
});

const lessonSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  status: z.enum(['normal', 'moved', 'cancelled']),
  note: z.string().max(400).default(''),
});

app.get('/api/staff/lessons', requireStaff, (req: AuthedRequest, res) => {
  const date = typeof req.query.date === 'string' ? new Date(req.query.date) : new Date();
  const start = startOfMskDay(Number.isNaN(date.getTime()) ? new Date() : date);
  const rows = db
    .prepare(
      `SELECT l.id, l.group_name, c.title AS course_title, l.starts_at, l.ends_at, l.status, l.note
       FROM lessons l JOIN courses c ON c.id = l.course_id
       WHERE l.starts_at >= ? AND l.starts_at < ? ORDER BY l.starts_at ASC`,
    )
    .all(start.toISOString(), addDays(start, 14).toISOString());
  res.json({ rows });
});

app.post('/api/staff/lessons/:id', requireStaff, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = lessonSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({ error: 'Проверьте поля формы' });
    return;
  }
  const updated = moveLesson(id, req.user!.id, parsed.data);
  if (!updated) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  res.json(updated);
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Демо-страница входа подсказывает аккаунты — это требование конкурса.
app.get('/api/demo-accounts', (_req, res) => {
  res.json({
    accounts: [
      { email: 'student1@demo.local', role: 'student', note: 'Анна Королёва, есть долги' },
      { email: 'student2@demo.local', role: 'student', note: 'Дмитрий Соколов, всё закрыто' },
      { email: 'staff@demo.local', role: 'staff', note: 'Ирина Белова, деканат' },
    ],
    password: 'demo12345',
  });
});

// Раздача собранного фронтенда в production.
// Express 5 не принимает regexp-маршруты — используем обычный middleware.
const distDir = path.resolve('dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  // Не логируем секреты и содержимое запросов.
  console.log(`server listening on http://localhost:${port}`);
});

export { app };

// Используется проверкой IDOR: пароль для тестового пользователя.
export const DEMO_PASSWORD = 'demo12345';
void hashPassword;
