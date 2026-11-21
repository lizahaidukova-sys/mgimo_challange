import { db, audit } from './db';
import { hashPassword } from './auth';

// CRUD для админ-панели. Отдельно от repo.ts: там предметные выборки для
// кабинета студента и деканата, здесь — плоское редактирование демо-базы.
//
// Правила, общие для всех сущностей:
// - запись возвращается в camelCase, как её ждёт форма;
// - удаление со связями блокируется (не каскадит): жюри не должно снести
//   половину демо одним кликом;
// - каждая мутация пишет строку в audit_log с id администратора.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function clampOffset(offset: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.max(0, Math.trunc(offset));
}

function like(query: string): string {
  // Экранируем символы LIKE: иначе «%» в поиске вытащит всё.
  const escaped = query.trim().replace(/[\\%_]/g, (char) => `\\${char}`);
  return `%${escaped}%`;
}

function countRows(sql: string, params: (string | number)[]): number {
  const row = db.prepare(sql).get(...params) as { c: number } | undefined;
  return row?.c ?? 0;
}

export type DeleteResult = { ok: true } | { ok: false; reason: 'missing' | 'blocked' | 'self' };

const BLOCKED: DeleteResult = { ok: false, reason: 'blocked' };
const MISSING: DeleteResult = { ok: false, reason: 'missing' };

function hasRefs(table: string, column: string, id: number): boolean {
  return countRows(`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} = ?`, [id]) > 0;
}

// ---------- преподаватели ----------

export interface TeacherRow {
  id: number;
  fullName: string;
  title: string;
}

export function listTeachers(
  query: string,
  limit: number,
  offset: number,
): { rows: TeacherRow[]; total: number } {
  const value = like(query);
  const total = countRows(`SELECT COUNT(*) AS c FROM teachers WHERE full_name LIKE ? ESCAPE '\\'`, [
    value,
  ]);
  const rows = db
    .prepare(
      `SELECT id, full_name, title FROM teachers
       WHERE full_name LIKE ? ESCAPE '\\'
       ORDER BY full_name ASC LIMIT ? OFFSET ?`,
    )
    .all(value, clampLimit(limit), clampOffset(offset)) as Record<string, unknown>[];
  return {
    rows: rows.map((row) => ({
      id: row.id as number,
      fullName: row.full_name as string,
      title: row.title as string,
    })),
    total,
  };
}

export function createTeacher(
  actorId: number,
  input: { fullName: string; title: string },
): { id: number } {
  const id = Number(
    db.prepare(`INSERT INTO teachers (full_name, title) VALUES (?, ?)`).run(input.fullName, input.title)
      .lastInsertRowid,
  );
  audit(actorId, 'admin.create', 'teacher', id, { fullName: input.fullName });
  return { id };
}

export function updateTeacher(
  actorId: number,
  id: number,
  patch: { fullName?: string; title?: string },
): boolean {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (patch.fullName !== undefined) {
    sets.push('full_name = ?');
    params.push(patch.fullName);
  }
  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(patch.title);
  }
  if (sets.length === 0) return exists('teachers', id);
  const result = db
    .prepare(`UPDATE teachers SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params, id);
  if (result.changes === 0) return false;
  audit(actorId, 'admin.update', 'teacher', id, patch);
  return true;
}

export function deleteTeacher(actorId: number, id: number): DeleteResult {
  if (!exists('teachers', id)) return MISSING;
  if (hasRefs('courses', 'teacher_id', id)) return BLOCKED;
  db.prepare(`DELETE FROM teachers WHERE id = ?`).run(id);
  audit(actorId, 'admin.delete', 'teacher', id, {});
  return { ok: true };
}

// ---------- аудитории ----------

export interface RoomRow {
  id: number;
  name: string;
  building: string;
}

export function listRooms(
  query: string,
  limit: number,
  offset: number,
): { rows: RoomRow[]; total: number } {
  const value = like(query);
  const total = countRows(`SELECT COUNT(*) AS c FROM rooms WHERE name LIKE ? ESCAPE '\\'`, [value]);
  const rows = db
    .prepare(
      `SELECT id, name, building FROM rooms
       WHERE name LIKE ? ESCAPE '\\'
       ORDER BY name ASC LIMIT ? OFFSET ?`,
    )
    .all(value, clampLimit(limit), clampOffset(offset)) as Record<string, unknown>[];
  return {
    rows: rows.map((row) => ({
      id: row.id as number,
      name: row.name as string,
      building: row.building as string,
    })),
    total,
  };
}

export function createRoom(actorId: number, input: { name: string; building: string }): { id: number } {
  const id = Number(
    db.prepare(`INSERT INTO rooms (name, building) VALUES (?, ?)`).run(input.name, input.building)
      .lastInsertRowid,
  );
  audit(actorId, 'admin.create', 'room', id, { name: input.name });
  return { id };
}

export function updateRoom(
  actorId: number,
  id: number,
  patch: { name?: string; building?: string },
): boolean {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    params.push(patch.name);
  }
  if (patch.building !== undefined) {
    sets.push('building = ?');
    params.push(patch.building);
  }
  if (sets.length === 0) return exists('rooms', id);
  const result = db.prepare(`UPDATE rooms SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  if (result.changes === 0) return false;
  audit(actorId, 'admin.update', 'room', id, patch);
  return true;
}

export function deleteRoom(actorId: number, id: number): DeleteResult {
  if (!exists('rooms', id)) return MISSING;
  // Аудитория занята парой или слотом пересдачи — сначала правят расписание.
  if (hasRefs('lessons', 'room_id', id) || hasRefs('retake_slots', 'room_id', id)) return BLOCKED;
  db.prepare(`DELETE FROM rooms WHERE id = ?`).run(id);
  audit(actorId, 'admin.delete', 'room', id, {});
  return { ok: true };
}

// ---------- дисциплины ----------

export interface CourseRow {
  id: number;
  title: string;
  teacherId: number;
  teacherName: string;
  credits: number;
  controlForm: 'exam' | 'pass';
  hours: number;
}

export function listCourses(
  query: string,
  limit: number,
  offset: number,
): { rows: CourseRow[]; total: number } {
  const value = like(query);
  const total = countRows(`SELECT COUNT(*) AS c FROM courses WHERE title LIKE ? ESCAPE '\\'`, [value]);
  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.teacher_id, t.full_name AS teacher_name, c.credits,
              c.control_form, COALESCE(c.hours, 0) AS hours
       FROM courses c JOIN teachers t ON t.id = c.teacher_id
       WHERE c.title LIKE ? ESCAPE '\\'
       ORDER BY c.title ASC LIMIT ? OFFSET ?`,
    )
    .all(value, clampLimit(limit), clampOffset(offset)) as Record<string, unknown>[];
  return {
    rows: rows.map((row) => ({
      id: row.id as number,
      title: row.title as string,
      teacherId: row.teacher_id as number,
      teacherName: row.teacher_name as string,
      credits: row.credits as number,
      controlForm: row.control_form as CourseRow['controlForm'],
      hours: row.hours as number,
    })),
    total,
  };
}

export function createCourse(
  actorId: number,
  input: { title: string; teacherId: number; credits: number; controlForm: string; hours: number },
): { id: number } {
  const id = Number(
    db
      .prepare(
        `INSERT INTO courses (title, teacher_id, credits, control_form, hours)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.title, input.teacherId, input.credits, input.controlForm, input.hours)
      .lastInsertRowid,
  );
  audit(actorId, 'admin.create', 'course', id, { title: input.title });
  return { id };
}

export function updateCourse(
  actorId: number,
  id: number,
  patch: {
    title?: string;
    teacherId?: number;
    credits?: number;
    controlForm?: string;
    hours?: number;
  },
): boolean {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  const map: [keyof typeof patch, string][] = [
    ['title', 'title'],
    ['teacherId', 'teacher_id'],
    ['credits', 'credits'],
    ['controlForm', 'control_form'],
    ['hours', 'hours'],
  ];
  for (const [key, column] of map) {
    const value = patch[key];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      params.push(value);
    }
  }
  if (sets.length === 0) return exists('courses', id);
  const result = db.prepare(`UPDATE courses SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  if (result.changes === 0) return false;
  audit(actorId, 'admin.update', 'course', id, patch);
  return true;
}

export function deleteCourse(actorId: number, id: number): DeleteResult {
  if (!exists('courses', id)) return MISSING;
  if (
    hasRefs('enrollments', 'course_id', id) ||
    hasRefs('lessons', 'course_id', id) ||
    hasRefs('retake_slots', 'course_id', id)
  ) {
    return BLOCKED;
  }
  db.prepare(`DELETE FROM courses WHERE id = ?`).run(id);
  audit(actorId, 'admin.delete', 'course', id, {});
  return { ok: true };
}

// ---------- семестры ----------

export interface SemesterRow {
  id: number;
  title: string;
  number: number;
  startsOn: string;
  endsOn: string;
  sessionEndsOn: string;
  isCurrent: number;
}

export function listSemesters(
  query: string,
  limit: number,
  offset: number,
): { rows: SemesterRow[]; total: number } {
  const value = like(query);
  const total = countRows(`SELECT COUNT(*) AS c FROM semesters WHERE title LIKE ? ESCAPE '\\'`, [
    value,
  ]);
  const rows = db
    .prepare(
      `SELECT id, title, number, starts_on, ends_on, session_ends_on, is_current
       FROM semesters
       WHERE title LIKE ? ESCAPE '\\'
       ORDER BY number ASC LIMIT ? OFFSET ?`,
    )
    .all(value, clampLimit(limit), clampOffset(offset)) as Record<string, unknown>[];
  return {
    rows: rows.map((row) => ({
      id: row.id as number,
      title: row.title as string,
      number: row.number as number,
      startsOn: row.starts_on as string,
      endsOn: row.ends_on as string,
      sessionEndsOn: row.session_ends_on as string,
      isCurrent: row.is_current as number,
    })),
    total,
  };
}

export function createSemester(
  actorId: number,
  input: {
    title: string;
    number: number;
    startsOn: string;
    endsOn: string;
    sessionEndsOn: string;
    isCurrent: number;
  },
): { id: number } {
  const id = Number(
    db
      .prepare(
        `INSERT INTO semesters (title, number, starts_on, ends_on, session_ends_on, is_current)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.title, input.number, input.startsOn, input.endsOn, input.sessionEndsOn, input.isCurrent)
      .lastInsertRowid,
  );
  audit(actorId, 'admin.create', 'semester', id, { title: input.title });
  return { id };
}

export function updateSemester(
  actorId: number,
  id: number,
  patch: {
    title?: string;
    number?: number;
    startsOn?: string;
    endsOn?: string;
    sessionEndsOn?: string;
    isCurrent?: number;
  },
): boolean {
  const sets: string[] = [];
  const params: (string | number)[] = [];
  const map: [keyof typeof patch, string][] = [
    ['title', 'title'],
    ['number', 'number'],
    ['startsOn', 'starts_on'],
    ['endsOn', 'ends_on'],
    ['sessionEndsOn', 'session_ends_on'],
    ['isCurrent', 'is_current'],
  ];
  for (const [key, column] of map) {
    const value = patch[key];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      params.push(value);
    }
  }
  if (sets.length === 0) return exists('semesters', id);
  const result = db.prepare(`UPDATE semesters SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  if (result.changes === 0) return false;
  audit(actorId, 'admin.update', 'semester', id, patch);
  return true;
}

export function deleteSemester(actorId: number, id: number): DeleteResult {
  if (!exists('semesters', id)) return MISSING;
  if (hasRefs('enrollments', 'semester_id', id)) return BLOCKED;
  db.prepare(`DELETE FROM semesters WHERE id = ?`).run(id);
  audit(actorId, 'admin.delete', 'semester', id, {});
  return { ok: true };
}

// ---------- люди ----------

export interface UserRow {
  id: number;
  email: string;
  fullName: string;
  role: 'student' | 'staff';
  faculty: string;
  program: string;
  course: number;
  groupName: string;
}

export function listUsers(
  query: string,
  limit: number,
  offset: number,
): { rows: UserRow[]; total: number } {
  const value = like(query);
  // Администраторы в список не попадают: пароль и роль админа панель не меняет.
  const where = `role IN ('student','staff') AND (full_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')`;
  const total = countRows(`SELECT COUNT(*) AS c FROM users WHERE ${where}`, [value, value]);
  const rows = db
    .prepare(
      `SELECT id, email, full_name, role, faculty, program, course, group_name
       FROM users WHERE ${where}
       ORDER BY role ASC, full_name ASC LIMIT ? OFFSET ?`,
    )
    .all(value, value, clampLimit(limit), clampOffset(offset)) as Record<string, unknown>[];
  return {
    rows: rows.map((row) => ({
      id: row.id as number,
      email: row.email as string,
      fullName: row.full_name as string,
      role: row.role as UserRow['role'],
      faculty: row.faculty as string,
      program: row.program as string,
      course: row.course as number,
      groupName: row.group_name as string,
    })),
    total,
  };
}

export function createUser(
  actorId: number,
  input: {
    email: string;
    fullName: string;
    role: 'student' | 'staff';
    faculty: string;
    program: string;
    course: number;
    groupName: string;
  },
): { id: number } | { error: string } {
  const email = input.email.trim().toLowerCase();
  if (db.prepare(`SELECT 1 FROM users WHERE email = ?`).get(email)) {
    return { error: 'Пользователь с таким e-mail уже есть' };
  }
  // Пароль не редактируется: новый человек входит тем же демо-паролем.
  const id = Number(
    db
      .prepare(
        `INSERT INTO users (email, password_hash, role, full_name, faculty, program, course, group_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        email,
        hashPassword('demo12345'),
        input.role,
        input.fullName,
        input.faculty,
        input.program,
        input.course,
        input.groupName,
        new Date().toISOString(),
      ).lastInsertRowid,
  );
  audit(actorId, 'admin.create', 'user', id, { email, role: input.role });
  return { id };
}

export function updateUser(
  actorId: number,
  id: number,
  patch: {
    email?: string;
    fullName?: string;
    role?: 'student' | 'staff';
    faculty?: string;
    program?: string;
    course?: number;
    groupName?: string;
  },
): boolean | { error: string } {
  const target = db.prepare(`SELECT role FROM users WHERE id = ?`).get(id) as
    | { role: string }
    | undefined;
  if (!target) return false;
  if (target.role === 'admin') return { error: 'Аккаунт администратора здесь не редактируется' };

  const sets: string[] = [];
  const params: (string | number)[] = [];
  const map: [keyof typeof patch, string][] = [
    ['email', 'email'],
    ['fullName', 'full_name'],
    ['role', 'role'],
    ['faculty', 'faculty'],
    ['program', 'program'],
    ['course', 'course'],
    ['groupName', 'group_name'],
  ];
  for (const [key, column] of map) {
    let value = patch[key];
    if (value === undefined) continue;
    if (key === 'email' && typeof value === 'string') {
      value = value.trim().toLowerCase();
      const taken = db
        .prepare(`SELECT 1 FROM users WHERE email = ? AND id != ?`)
        .get(value, id);
      if (taken) return { error: 'Пользователь с таким e-mail уже есть' };
    }
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return true;
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  audit(actorId, 'admin.update', 'user', id, { ...patch, email: undefined });
  return true;
}

export function deleteUser(actorId: number, id: number): DeleteResult {
  if (!exists('users', id)) return MISSING;
  // Себя удалять нельзя: иначе панель останется без единственного администратора.
  if (actorId === id) return { ok: false, reason: 'self' };
  const target = db.prepare(`SELECT role FROM users WHERE id = ?`).get(id) as
    | { role: string }
    | undefined;
  if (target?.role === 'admin') return { ok: false, reason: 'self' };
  const refs: [string, string][] = [
    ['requests', 'user_id'],
    ['request_events', 'actor_id'],
    ['enrollments', 'user_id'],
    ['messages', 'user_id'],
    ['messages', 'author_id'],
    ['notifications', 'user_id'],
    ['documents', 'user_id'],
    ['payments', 'user_id'],
    ['retake_bookings', 'user_id'],
    ['announcements', 'author_id'],
  ];
  if (refs.some(([table, column]) => hasRefs(table, column, id))) return BLOCKED;
  db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  audit(actorId, 'admin.delete', 'user', id, {});
  return { ok: true };
}

// ---------- пары ----------

export interface LessonRow {
  id: number;
  courseId: number;
  courseTitle: string;
  roomId: number;
  roomName: string;
  groupName: string;
  startsAt: string;
  endsAt: string;
  kind: string;
  status: 'normal' | 'moved' | 'cancelled';
  note: string;
  previousStartsAt: string | null;
}

export function listLessons(
  _query: string,
  limit: number,
  offset: number,
): { rows: LessonRow[]; total: number } {
  const total = countRows(`SELECT COUNT(*) AS c FROM lessons`, []);
  const rows = db
    .prepare(
      `SELECT l.id, l.course_id, c.title AS course_title, l.room_id, r.name AS room_name,
              l.group_name, l.starts_at, l.ends_at, l.kind, l.status, l.note, l.previous_starts_at
       FROM lessons l
       JOIN courses c ON c.id = l.course_id
       JOIN rooms r ON r.id = l.room_id
       ORDER BY l.starts_at ASC LIMIT ? OFFSET ?`,
    )
    .all(clampLimit(limit), clampOffset(offset)) as Record<string, unknown>[];
  return {
    rows: rows.map((row) => ({
      id: row.id as number,
      courseId: row.course_id as number,
      courseTitle: row.course_title as string,
      roomId: row.room_id as number,
      roomName: row.room_name as string,
      groupName: row.group_name as string,
      startsAt: row.starts_at as string,
      endsAt: row.ends_at as string,
      kind: row.kind as string,
      status: row.status as LessonRow['status'],
      note: (row.note as string | null) ?? '',
      previousStartsAt: (row.previous_starts_at as string | null) ?? null,
    })),
    total,
  };
}

export interface LessonInput {
  courseId: number;
  roomId: number;
  groupName: string;
  startsAt: string;
  endsAt: string;
  kind: string;
  status: 'normal' | 'moved' | 'cancelled';
  note: string;
  previousStartsAt: string | null;
}

export function createLesson(actorId: number, input: LessonInput): { id: number } {
  const id = Number(
    db
      .prepare(
        `INSERT INTO lessons
           (course_id, room_id, group_name, starts_at, ends_at, kind, status, note, previous_starts_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.courseId,
        input.roomId,
        input.groupName,
        input.startsAt,
        input.endsAt,
        input.kind,
        input.status,
        input.note,
        input.previousStartsAt,
        new Date().toISOString(),
      ).lastInsertRowid,
  );
  audit(actorId, 'admin.create', 'lesson', id, { groupName: input.groupName });
  return { id };
}

// Правка пары администратором намеренно НЕ вызывает moveLesson из repo.ts:
// тот рассылает уведомления студентам. Правки в админке — предзаполнение демо,
// после них полагается reset-demo, а не письмо группе.
export function updateLesson(
  actorId: number,
  id: number,
  patch: Partial<LessonInput>,
): boolean {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const map: [keyof LessonInput, string][] = [
    ['courseId', 'course_id'],
    ['roomId', 'room_id'],
    ['groupName', 'group_name'],
    ['startsAt', 'starts_at'],
    ['endsAt', 'ends_at'],
    ['kind', 'kind'],
    ['status', 'status'],
    ['note', 'note'],
    ['previousStartsAt', 'previous_starts_at'],
  ];
  for (const [key, column] of map) {
    const value = patch[key];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      params.push(value);
    }
  }
  if (sets.length === 0) return exists('lessons', id);
  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  const result = db.prepare(`UPDATE lessons SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  if (result.changes === 0) return false;
  audit(actorId, 'admin.update', 'lesson', id, patch);
  return true;
}

export function deleteLesson(actorId: number, id: number): DeleteResult {
  if (!exists('lessons', id)) return MISSING;
  db.prepare(`DELETE FROM lessons WHERE id = ?`).run(id);
  audit(actorId, 'admin.delete', 'lesson', id, {});
  return { ok: true };
}

// ---------- служебное ----------

function exists(table: string, id: number): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id));
}

// Демо-сид выполняется в процессе сервера: node:sqlite спокойно открывает
// второй коннект к тому же файлу (WAL включён), поэтому dynamic import безопасен.
// Сид пересоздаёт пользователей, значит сессии и id администратора пропадают:
// возвращаем id нового админа, чтобы маршрут выдал ему свежую сессию.
export async function resetDemo(actorId: number): Promise<number | null> {
  const { seed } = await import('../db/seed');
  seed();
  audit(actorId, 'admin.reset', 'demo', null, {});
  const admin = db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get() as
    | { id: number }
    | undefined;
  return admin?.id ?? null;
}
