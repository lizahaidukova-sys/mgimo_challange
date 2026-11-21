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
  requireAdmin,
  requireAuth,
  requireStaff,
  revokeSession,
  verifyPassword,
  type AuthedRequest,
} from './auth';
import {
  createCourse,
  createLesson,
  createRoom,
  createSemester,
  createTeacher,
  createUser,
  deleteCourse,
  deleteLesson,
  deleteRoom,
  deleteSemester,
  deleteTeacher,
  deleteUser,
  listCourses,
  listLessons,
  listRooms,
  listSemesters,
  listTeachers,
  listUsers,
  resetDemo,
  updateCourse,
  updateLesson,
  updateRoom,
  updateSemester,
  updateTeacher,
  updateUser,
  type DeleteResult,
} from './adminRepo';
import {
  bookRetake,
  cancelRetake,
  deanDialogs,
  documents,
  markDialogRead,
  markStudentDialogsReadForStaff,
  messages,
  payments,
  retakeSlots,
  search,
  semesterResults,
  sendMessage,
  semesters,
  addRequestAttachment,
  attachmentForDownload,
  attachmentForStaffDownload,
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
  requestsForAttachment,
  sessionState,
  setRequestStatus,
  staffOverview,
  staffQueue,
  staffRequest,
  unreadCount,
} from './repo';
import { explainWithLlm } from './rules';
import {
  MAX_ATTACHMENT_BYTES,
  attachmentExtension,
  contentDisposition,
  readAttachmentFile,
  saveAttachmentFile,
} from './attachments';
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

app.get('/api/requests/:id/attachments/:attachmentId', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const attachmentId = Number(req.params.attachmentId);
  if (!Number.isInteger(id) || !Number.isInteger(attachmentId)) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  const file = attachmentForDownload(req.user!.id, id, attachmentId);
  if (!file) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  const buffer = readAttachmentFile(file.storagePath);
  if (!buffer) {
    res.status(404).json({ error: 'Файл недоступен' });
    return;
  }
  // inline: справку удобно сразу открыть в браузере, а не скачивать вслепую.
  // nosniff обязателен — файл пришёл от пользователя.
  res.setHeader('Content-Type', file.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', contentDisposition(file.fileName));
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(buffer);
});

// Сотрудник скачивает вложение любой заявки — доступ проверяется ролью.
app.get(
  '/api/staff/requests/:id/attachments/:attachmentId',
  requireStaff,
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const attachmentId = Number(req.params.attachmentId);
    if (!Number.isInteger(id) || !Number.isInteger(attachmentId)) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    const file = attachmentForStaffDownload(id, attachmentId);
    if (!file) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    const buffer = readAttachmentFile(file.storagePath);
    if (!buffer) {
      res.status(404).json({ error: 'Файл недоступен' });
      return;
    }
    res.setHeader('Content-Type', file.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', contentDisposition(file.fileName));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  },
);

// Загрузка файла: тело — сырые байты, тип и имя передаются заголовками.
// Так не нужен multipart-парсер, а браузер шлёт fetch с одним файлом.
app.put(
  '/api/requests/:id/attachments',
  requireAuth,
  express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES }),
  (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    if (req.user!.role !== 'student') {
      res.status(403).json({ error: 'Недостаточно прав' });
      return;
    }
    const request = requestsForAttachment(req.user!.id, id);
    if (!request) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    // К закрытой заявке файл не принимаем: переписка по ней уже закончена.
    if (request.status === 'ready') {
      res.status(400).json({ error: 'Заявка уже выполнена — приложить документ нельзя' });
      return;
    }

    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (buffer.length === 0) {
      res.status(400).json({ error: 'Файл пустой' });
      return;
    }
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      res.status(413).json({ error: `Файл больше ${MAX_ATTACHMENT_BYTES / 1024 / 1024} МБ` });
      return;
    }

    const mime = (req.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!attachmentExtension(mime)) {
      res.status(400).json({ error: 'Допустимы PDF, JPEG, PNG или WebP' });
      return;
    }

    const rawHeader = req.get('x-file-name') ?? '';
    // Клиент шлёт имя в percent-encoding: заголовки не поддерживают UTF-8.
    let rawName = 'документ';
    try {
      rawName = rawHeader ? decodeURIComponent(rawHeader) : 'документ';
    } catch {
      rawName = rawHeader || 'документ';
    }
    // Имя приходит от клиента: чистим путь и служебные символы, длину режем.
    const fileName =
      path.basename(rawName.trim()).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').slice(0, 120) ||
      'документ';

    const saved = saveAttachmentFile(id, buffer, mime);
    const attachment = addRequestAttachment(req.user!.id, id, {
      fileName,
      mime,
      size: buffer.length,
      storagePath: saved.storagePath,
    });
    res.status(201).json(attachment);
  },
);

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

// ---------- новые разделы ----------

app.get('/api/grades/history', requireAuth, (req: AuthedRequest, res) => {
  res.json({ semesters: semesterResults(req.user!.id), current: semesters() });
});

app.get('/api/retakes', requireAuth, (req: AuthedRequest, res) => {
  res.json({ rows: retakeSlots(req.user!.id) });
});

app.post('/api/retakes/:id/book', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  const result = bookRetake(req.user!.id, id);
  if (!result.ok) {
    res.status(400).json({ error: result.reason });
    return;
  }
  res.json({ ok: true });
});

app.post('/api/retakes/:id/cancel', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const ok = Number.isInteger(id) && cancelRetake(req.user!.id, id);
  if (!ok) {
    res.status(404).json({ error: 'Запись не найдена' });
    return;
  }
  res.json({ ok: true });
});

app.get('/api/documents', requireAuth, (req: AuthedRequest, res) => {
  res.json({ documents: documents(req.user!.id), payments: payments(req.user!.id) });
});

app.get('/api/messages', requireAuth, (req: AuthedRequest, res) => {
  const rows = messages(req.user!.id);
  // Открытая переписка = прочитанная: иначе бейдж непрочитанных сообщений
  // не гаснет никогда, даже когда студент всё прочитал.
  if (rows.some((row) => !row.mine && row.readAt === null)) {
    markDialogRead(req.user!.id);
  }
  res.json({ rows: messages(req.user!.id) });
});

const messageSchema = z.object({ body: z.string().min(2).max(2000) });

app.post('/api/messages', requireAuth, (req: AuthedRequest, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Сообщение слишком короткое' });
    return;
  }
  const created = sendMessage(req.user!.id, req.user!.id, parsed.data.body.trim());
  res.status(201).json(created);
});

app.get('/api/staff/dialogs', requireStaff, (_req: AuthedRequest, res) => {
  res.json({ rows: deanDialogs() });
});

app.post('/api/staff/dialogs/:userId/reply', requireStaff, (req: AuthedRequest, res) => {
  const userId = Number(req.params.userId);
  const parsed = messageSchema.safeParse(req.body);
  if (!Number.isInteger(userId) || !parsed.success) {
    res.status(400).json({ error: 'Проверьте сообщение' });
    return;
  }
  sendMessage(userId, req.user!.id, parsed.data.body.trim());
  res.status(201).json({ ok: true });
});

app.post('/api/staff/dialogs/:userId/read', requireStaff, (req: AuthedRequest, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    res.json({ marked: 0 });
    return;
  }
  const marked = markDialogRead(userId);
  // Деканат открыл диалог — уведомление о сообщении этого студента больше не «новое».
  markStudentDialogsReadForStaff(userId, req.user!.id);
  res.json({ marked });
});

// ---------- админка ----------

// Общая обвязка админских маршрутов: ограничения БД (внешний ключ, CHECK,
// UNIQUE) — это ошибка ввода, а не сбой сервера, поэтому 400, а не 500.
function adminHandler(
  handler: (req: AuthedRequest, res: express.Response) => void,
): express.RequestHandler {
  return (req, res, next) => {
    try {
      handler(req as AuthedRequest, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('constraint failed')) {
        res.status(400).json({ error: 'Проверьте поля: значение не подходит к связанным записям' });
        return;
      }
      next(error);
    }
  };
}

function readPaging(query: express.Request['query']): { query: string; limit: number; offset: number } {
  return {
    query: typeof query.query === 'string' ? query.query : '',
    limit: typeof query.limit === 'string' ? Number(query.limit) : 50,
    offset: typeof query.offset === 'string' ? Number(query.offset) : 0,
  };
}

function sendDelete(res: express.Response, result: DeleteResult): void {
  if (result.ok) {
    res.json({ ok: true });
    return;
  }
  if (result.reason === 'missing') {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  if (result.reason === 'self') {
    res.status(400).json({ error: 'Нельзя удалить свой аккаунт' });
    return;
  }
  res.status(400).json({ error: 'Удаление невозможно: есть связанные записи' });
}

function readId(req: express.Request): number | null {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Схемы описаны без .default(): zod сохраняет defaults и в .partial(),
// из-за чего PATCH с одним полем молча перезаписывал бы остальные.
// Поэтому необязательные поля помечены optional(), а значения по умолчанию
// подставляет маршрут создания.
const teacherSchema = z.object({
  fullName: z.string().min(2).max(120),
  title: z.string().max(120).optional(),
});

const roomSchema = z.object({
  name: z.string().min(1).max(40),
  building: z.string().max(40).optional(),
});

const courseSchema = z.object({
  title: z.string().min(2).max(160),
  teacherId: z.number().int().positive(),
  credits: z.number().int().min(0).max(10),
  controlForm: z.enum(['exam', 'pass']),
  hours: z.number().int().min(0).max(400),
});

const semesterSchema = z.object({
  title: z.string().min(2).max(60),
  number: z.number().int().min(1).max(12),
  startsOn: z.string().datetime(),
  endsOn: z.string().datetime(),
  sessionEndsOn: z.string().datetime(),
  isCurrent: z.union([z.literal(0), z.literal(1)]),
});

const personSchema = z.object({
  email: z.string().email().max(200),
  fullName: z.string().min(2).max(120),
  role: z.enum(['student', 'staff']),
  faculty: z.string().max(160).optional(),
  program: z.string().max(160).optional(),
  // 0 — у сотрудников деканата нет курса; у студентов 1–6.
  course: z.number().int().min(0).max(6).optional(),
  groupName: z.string().max(20).optional(),
});

const adminLessonSchema = z.object({
  courseId: z.number().int().positive(),
  roomId: z.number().int().positive(),
  groupName: z.string().max(20).min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  kind: z.string().max(40).optional(),
  status: z.enum(['normal', 'moved', 'cancelled']).optional(),
  note: z.string().max(400).optional(),
  previousStartsAt: z.string().datetime().nullable().optional(),
});

app.get(
  '/api/admin/teachers',
  requireAdmin,
  adminHandler((req, res) => {
    const paging = readPaging(req.query);
    res.json(listTeachers(paging.query, paging.limit, paging.offset));
  }),
);

app.post(
  '/api/admin/teachers',
  requireAdmin,
  adminHandler((req, res) => {
    const parsed = teacherSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Проверьте поля формы' });
      return;
    }
    res.status(201).json(
      createTeacher(req.user!.id, { fullName: parsed.data.fullName, title: parsed.data.title ?? '' }),
    );
  }),
);

app.patch(
  '/api/admin/teachers/:id',
  requireAdmin,
  adminHandler((req, res) => {
    const id = readId(req);
    const parsed = teacherSchema.partial().safeParse(req.body);
    if (id === null || !parsed.success) {
      res.status(400).json({ error: 'Проверьте поля формы' });
      return;
    }
    if (!updateTeacher(req.user!.id, id, parsed.data)) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    res.json({ ok: true });
  }),
);

app.delete(
  '/api/admin/teachers/:id',
  requireAdmin,
  adminHandler((req, res) => {
    const id = readId(req);
    if (id === null) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    sendDelete(res, deleteTeacher(req.user!.id, id));
  }),
);

app.get(
  '/api/admin/rooms',
  requireAdmin,
  adminHandler((req, res) => {
    const paging = readPaging(req.query);
    res.json(listRooms(paging.query, paging.limit, paging.offset));
  }),
);

app.post(
  '/api/admin/rooms',
  requireAdmin,
  adminHandler((req, res) => {
    const parsed = roomSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Проверьте поля формы' });
      return;
    }
    res.status(201).json(
      createRoom(req.user!.id, { name: parsed.data.name, building: parsed.data.building ?? '' }),
    );
  }),
);

app.patch(
  '/api/admin/rooms/:id',
  requireAdmin,
  adminHandler((req, res) => {
    const id = readId(req);
    const parsed = roomSchema.partial().safeParse(req.body);
    if (id === null || !parsed.success) {
      res.status(400).json({ error: 'Проверьте поля формы' });
      return;
    }
    if (!updateRoom(req.user!.id, id, parsed.data)) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    res.json({ ok: true });
  }),
);

app.delete(
  '/api/admin/rooms/:id',
  requireAdmin,
  adminHandler((req, res) => {
    const id = readId(req);
    if (id === null) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    sendDelete(res, deleteRoom(req.user!.id, id));
  }),
);

app.get(
  '/api/admin/courses',
  requireAdmin,
  adminHandler((req, res) => {
    const paging = readPaging(req.query);
    res.json(listCourses(paging.query, paging.limit, paging.offset));
  }),
);

app.post(
  '/api/admin/courses',
  requireAdmin,
  adminHandler((req, res) => {
    const parsed = courseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Проверьте поля формы' });
      return;
    }
    res.status(201).json(createCourse(req.user!.id, parsed.data));
  }),
);

app.patch(
  '/api/admin/courses/:id',
  requireAdmin,
  adminHandler((req, res) => {
    const id = readId(req);
    const parsed = courseSchema.partial().safeParse(req.body);
    if (id === null || !parsed.success) {
      res.status(400).json({ error: 'Проверьте поля формы' });
      return;
    }
    if (!updateCourse(req.user!.id, id, parsed.data)) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    res.json({ ok: true });
  }),
);

app.delete(
  '/api/admin/courses/:id',
  requireAdmin,
  adminHandler((req, res) => {
    const id = readId(req);
    if (id === null) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    sendDelete(res, deleteCourse(req.user!.id, id));
  }),
);

app.get(
  '/api/admin/semesters',
  requireAdmin,
  adminHandler((req, res) => {
    const paging = readPaging(req.query);
    res.json(listSemesters(paging.query, paging.limit, paging.offset));
  }),
);

app.post(
  '/api/admin/semesters',
  requireAdmin,
  adminHandler((req, res) => {
    const parsed = semesterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Проверьте поля формы' });
      return;
    }
    res.status(201).json(createSemester(req.user!.id, parsed.data));
  }),
);

app.patch(
  '/api/admin/semesters/:id',
  requireAdmin,
  adminHandler((req, res) => {
    const id = readId(req);
    const parsed = semesterSchema.partial().safeParse(req.body);
    if (id === null || !parsed.success) {
      res.status(400).json({ error: 'Проверьте поля формы' });
      return;
    }
    if (!updateSemester(req.user!.id, id, parsed.data)) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    res.json({ ok: true });
  }),
);

app.delete(
  '/api/admin/semesters/:id',
  requireAdmin,
  adminHandler((req, res) => {
    const id = readId(req);
    if (id === null) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    sendDelete(res, deleteSemester(req.user!.id, id));
  }),
);

app.get(
  '/api/admin/users',
  requireAdmin,
  adminHandler((req, res) => {
    const paging = readPaging(req.query);
    res.json(listUsers(paging.query, paging.limit, paging.offset));
  }),
);

app.post(
  '/api/admin/users',
  requireAdmin,
  adminHandler((req, res) => {
    const parsed = personSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Проверьте поля формы' });
      return;
    }
    const created = createUser(req.user!.id, {
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      role: parsed.data.role,
      faculty: parsed.data.faculty ?? '',
      program: parsed.data.program ?? '',
      course: parsed.data.course ?? 1,
      groupName: parsed.data.groupName ?? '',
    });
    if ('error' in created) {
      res.status(400).json({ error: created.error });
      return;
    }
    res.status(201).json(created);
  }),
);

app.patch(
  '/api/admin/users/:id',
  requireAdmin,
  adminHandler((req, res) => {
    const id = readId(req);
    const parsed = personSchema.partial().safeParse(req.body);
    if (id === null || !parsed.success) {
      res.status(400).json({ error: 'Проверьте поля формы' });
      return;
    }
    const updated = updateUser(req.user!.id, id, parsed.data);
    if (updated === false) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    if (updated && typeof updated === 'object') {
      res.status(400).json({ error: updated.error });
      return;
    }
    res.json({ ok: true });
  }),
);

app.delete(
  '/api/admin/users/:id',
  requireAdmin,
  adminHandler((req, res) => {
    const id = readId(req);
    if (id === null) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    sendDelete(res, deleteUser(req.user!.id, id));
  }),
);

app.get(
  '/api/admin/lessons',
  requireAdmin,
  adminHandler((req, res) => {
    const paging = readPaging(req.query);
    res.json(listLessons(paging.query, paging.limit, paging.offset));
  }),
);

app.post(
  '/api/admin/lessons',
  requireAdmin,
  adminHandler((req, res) => {
    const parsed = adminLessonSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Проверьте поля формы' });
      return;
    }
    if (new Date(parsed.data.endsAt) <= new Date(parsed.data.startsAt)) {
      res.status(400).json({ error: 'Окончание должно быть позже начала' });
      return;
    }
    res.status(201).json(
      createLesson(req.user!.id, {
        courseId: parsed.data.courseId,
        roomId: parsed.data.roomId,
        groupName: parsed.data.groupName,
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
        // Пара без явного вида и статуса — обычная лекция: в схеме БД NOT NULL.
        kind: parsed.data.kind ?? 'лекция',
        status: parsed.data.status ?? 'normal',
        note: parsed.data.note ?? '',
        previousStartsAt: parsed.data.previousStartsAt ?? null,
      }),
    );
  }),
);

app.patch(
  '/api/admin/lessons/:id',
  requireAdmin,
  adminHandler((req, res) => {
    const id = readId(req);
    const parsed = adminLessonSchema.partial().safeParse(req.body);
    if (id === null || !parsed.success) {
      res.status(400).json({ error: 'Проверьте поля формы' });
      return;
    }
    if (!updateLesson(req.user!.id, id, parsed.data)) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    res.json({ ok: true });
  }),
);

app.delete(
  '/api/admin/lessons/:id',
  requireAdmin,
  adminHandler((req, res) => {
    const id = readId(req);
    if (id === null) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    sendDelete(res, deleteLesson(req.user!.id, id));
  }),
);

// Перезапуск демо: сид удаляет таблицу сессий, поэтому текущая cookie умирает.
// Выдаём администратору новую сессию сразу в этом же ответе — иначе после
// перезагрузки страницы панель выкинула бы на форму входа.
app.post(
  '/api/admin/reset-demo',
  requireAdmin,
  adminHandler((req, res) => {
    void resetDemo(req.user!.id)
      .then((adminId) => {
        if (adminId !== null) createSession(res, adminId);
        res.json({ ok: true });
      })
      .catch((error: unknown) => {
        console.error('[admin] reset-demo failed', error);
        res.status(500).json({ error: 'Не удалось перезапустить демо-данные' });
      });
  }),
);

app.get('/api/search', requireAuth, (req: AuthedRequest, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  res.json({ hits: search(req.user!, query) });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Демо-страница входа подсказывает аккаунты — это требование конкурса.
app.get('/api/demo-accounts', (_req, res) => {
  res.json({
    accounts: [
      { email: 'student1@demo.local', role: 'student', note: 'Анна Королёва, есть долги' },
      { email: 'student2@demo.local', role: 'student', note: 'Дмитрий Соколов, один просроченный долг' },
      { email: 'staff@demo.local', role: 'staff', note: 'Ирина Белова, деканат' },
      { email: 'admin@demo.local', role: 'admin', note: 'Админ Концепта, редактирование базы' },
    ],
    password: 'demo12345',
  });
});

// Раздача собранного фронтенда в production.
// Express 5 не принимает regexp-маршруты — используем обычный middleware.
// Кэш-политика живёт здесь, а не в reverse proxy: иначе на одном ответе
// оказываются два разных Cache-Control (Caddy + Express).
const distDir = path.resolve('dist');
if (fs.existsSync(distDir)) {
  app.use(
    '/assets',
    express.static(path.join(distDir, 'assets'), {
      immutable: true,
      maxAge: '365d',
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  app.use(
    express.static(distDir, {
      // index.html и прочие файлы не кэшируются: после reseed нужна свежая сборка.
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-store');
      },
    }),
  );
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-store');
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
