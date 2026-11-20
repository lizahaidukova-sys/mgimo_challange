import { db, audit } from './db';
import {
  REQUEST_DUE_DAYS,
  REQUEST_STATUS_LABEL,
  REQUEST_TYPE_LABEL,
  type GradeRow,
  type Lesson,
  type NotificationRow,
  type RequestDetail,
  type RequestRow,
  type RequestStatus,
  type RequestType,
  type SessionState,
  type SessionUser,
  type StaffOverview,
  type StaffRequestRow,
  type DashboardData,
  GRADE_LABEL,
} from '../shared/types';
import { computeSessionState } from './rules';
import { startOfMskDay, startOfMskWeek, addDays, mskWeekday } from './time';

// ---------- расписание ----------

const lessonSelect = `
  SELECT l.id, l.course_id, c.title AS course_title, t.full_name AS teacher_name,
         r.name AS room_name, r.building, l.starts_at, l.ends_at, l.kind, l.status,
         l.note, l.previous_starts_at
  FROM lessons l
  JOIN courses c ON c.id = l.course_id
  JOIN teachers t ON t.id = c.teacher_id
  JOIN rooms r ON r.id = l.room_id
`;

function mapLesson(row: Record<string, unknown>): Lesson {
  return {
    id: row.id as number,
    courseId: row.course_id as number,
    courseTitle: row.course_title as string,
    teacherName: row.teacher_name as string,
    roomName: row.room_name as string,
    building: row.building as string,
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
    kind: row.kind as string,
    status: row.status as Lesson['status'],
    note: (row.note as string | null) ?? null,
    previousStartsAt: (row.previous_starts_at as string | null) ?? null,
  };
}

export function lessonsForRange(groupName: string, fromIso: string, toIso: string): Lesson[] {
  const rows = db
    .prepare(
      `${lessonSelect} WHERE l.group_name = ? AND l.starts_at >= ? AND l.starts_at < ?
       ORDER BY l.starts_at ASC`,
    )
    .all(groupName, fromIso, toIso) as Record<string, unknown>[];
  return rows.map(mapLesson);
}

export function nextLesson(groupName: string, fromIso: string): Lesson | null {
  const row = db
    .prepare(
      `${lessonSelect} WHERE l.group_name = ? AND l.starts_at >= ? AND l.status != 'cancelled'
       ORDER BY l.starts_at ASC LIMIT 1`,
    )
    .get(groupName, fromIso) as Record<string, unknown> | undefined;
  return row ? mapLesson(row) : null;
}

export function moveLesson(
  lessonId: number,
  actorId: number,
  patch: { startsAt: string; endsAt: string; status: 'normal' | 'moved' | 'cancelled'; note: string },
): Lesson | null {
  const existing = db
    .prepare(`SELECT id, group_name, starts_at FROM lessons WHERE id = ?`)
    .get(lessonId) as { id: number; group_name: string; starts_at: string } | undefined;
  if (!existing) return null;

  // Старое время сохраняется только если время действительно изменилось:
  // иначе повторное «перенесено» затирало бы исходное время пары.
  const timeChanged =
    new Date(existing.starts_at).getTime() !== new Date(patch.startsAt).getTime();
  const previousStartsAt = timeChanged ? existing.starts_at : null;

  db.prepare(
    `UPDATE lessons SET starts_at = ?, ends_at = ?, status = ?, note = ?,
      previous_starts_at = COALESCE(?, previous_starts_at), updated_at = ?
      WHERE id = ?`,
  ).run(
    patch.startsAt,
    patch.endsAt,
    patch.status,
    patch.note,
    previousStartsAt,
    new Date().toISOString(),
    lessonId,
  );

  const students = db
    .prepare(`SELECT id FROM users WHERE role = 'student' AND group_name = ?`)
    .all(existing.group_name) as { id: number }[];
  const title = patch.status === 'cancelled' ? 'Занятие отменено' : 'Перенос занятия';
  for (const student of students) {
    notify(
      student.id,
      'schedule_change',
      title,
      patch.note || 'Проверьте расписание: пара изменилась.',
      lessonId,
      `lesson:${lessonId}:${patch.status}:${patch.startsAt}`,
    );
  }

  audit(actorId, 'lesson.update', 'lesson', lessonId, { status: patch.status });
  const row = db
    .prepare(`${lessonSelect} WHERE l.id = ?`)
    .get(lessonId) as Record<string, unknown> | undefined;
  return row ? mapLesson(row) : null;
}

// ---------- успеваемость ----------

export function grades(userId: number): GradeRow[] {
  const rows = db
    .prepare(
      `SELECT e.id AS enrollment_id, c.id AS course_id, c.title, t.full_name AS teacher_name,
              c.credits, c.control_form, e.grade, e.status, e.retake_count,
              e.debt_since, e.debt_deadline, e.updated_at
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       JOIN teachers t ON t.id = c.teacher_id
       WHERE e.user_id = ?
       ORDER BY c.title ASC`,
    )
    .all(userId) as Record<string, unknown>[];

  return rows.map((row) => ({
    enrollmentId: row.enrollment_id as number,
    courseId: row.course_id as number,
    title: row.title as string,
    teacherName: row.teacher_name as string,
    credits: row.credits as number,
    controlForm: row.control_form as 'exam' | 'pass',
    grade: (row.grade as number | null) ?? null,
    gradeLabel: row.grade ? GRADE_LABEL[row.grade as number] ?? '' : '',
    status: row.status as GradeRow['status'],
    retakeCount: row.retake_count as number,
    debtSince: (row.debt_since as string | null) ?? null,
    debtDeadline: (row.debt_deadline as string | null) ?? null,
    updatedAt: row.updated_at as string,
  }));
}

export function sessionState(userId: number): SessionState {
  return computeSessionState(grades(userId));
}

// ---------- заявки ----------

function mapRequest(row: Record<string, unknown>): RequestRow {
  const dueAt = row.due_at as string;
  const status = row.status as RequestStatus;
  return {
    id: row.id as number,
    type: row.type as RequestType,
    typeLabel: REQUEST_TYPE_LABEL[row.type as RequestType],
    status,
    statusLabel: REQUEST_STATUS_LABEL[status],
    dueAt,
    staffComment: (row.staff_comment as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    overdue:
      (status === 'submitted' || status === 'in_progress') &&
      new Date(dueAt).getTime() < Date.now(),
    payload: JSON.parse((row.payload_json as string) || '{}') as Record<string, string>,
  };
}

export function listRequests(userId: number): RequestRow[] {
  const rows = db
    .prepare(`SELECT * FROM requests WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId) as Record<string, unknown>[];
  return rows.map(mapRequest);
}

// Чужой id отдаёт null — вызывающий код отвечает 404, не 403.
export function getRequest(userId: number, requestId: number): RequestDetail | null {
  const row = db
    .prepare(`SELECT * FROM requests WHERE id = ? AND user_id = ?`)
    .get(requestId, userId) as Record<string, unknown> | undefined;
  if (!row) return null;

  const events = db
    .prepare(
      `SELECT e.id, e.status, e.comment, e.created_at, u.full_name AS actor_name
       FROM request_events e JOIN users u ON u.id = e.actor_id
       WHERE e.request_id = ? ORDER BY e.created_at ASC`,
    )
    .all(requestId) as Record<string, unknown>[];

  return {
    ...mapRequest(row),
    events: events.map((event) => ({
      id: event.id as number,
      status: event.status as RequestStatus,
      comment: (event.comment as string | null) ?? null,
      actorName: event.actor_name as string,
      createdAt: event.created_at as string,
    })),
  };
}

// Срок в рабочих днях по Москве: считаем от начала следующих суток,
// чтобы заявка, поданная в пятницу вечером, не получала срок в субботу.
function addWorkingDays(from: Date, days: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < days) {
    result.setUTCDate(result.getUTCDate() + 1);
    const weekday = mskWeekday(result);
    if (weekday !== 0 && weekday !== 6) added += 1;
  }
  // Срок — конец рабочего дня по Москве (18:00), а не «ровно сейчас + N суток».
  const dayStart = startOfMskDay(result);
  return new Date(dayStart.getTime() + 18 * 60 * 60 * 1000);
}

export function createRequest(
  userId: number,
  input: { type: RequestType; payload: Record<string, string> },
): RequestDetail {
  const now = new Date();
  const dueAt = addWorkingDays(now, REQUEST_DUE_DAYS[input.type]).toISOString();
  const template = REQUEST_TYPE_LABEL[input.type];
  const info = db
    .prepare(
      `INSERT INTO requests (user_id, type, template, payload_json, status, due_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'submitted', ?, ?, ?)`,
    )
    .run(
      userId,
      input.type,
      template,
      JSON.stringify(input.payload),
      dueAt,
      now.toISOString(),
      now.toISOString(),
    );
  const requestId = Number(info.lastInsertRowid);

  db.prepare(
    `INSERT INTO request_events (request_id, status, comment, actor_id, created_at)
     VALUES (?, 'submitted', 'Заявка создана', ?, ?)`,
  ).run(requestId, userId, now.toISOString());

  audit(userId, 'request.create', 'request', requestId, { type: input.type });
  const detail = getRequest(userId, requestId);
  if (!detail) throw new Error('request not persisted');
  return detail;
}

// ---------- сотрудник деканата ----------

export function staffQueue(status?: RequestStatus): StaffRequestRow[] {
  const base = `SELECT r.*, u.full_name AS student_name, u.group_name AS student_group
    FROM requests r JOIN users u ON u.id = r.user_id`;
  const rows = (
    status
      ? db.prepare(`${base} WHERE r.status = ? ORDER BY r.due_at ASC`).all(status)
      : db.prepare(`${base} ORDER BY r.due_at ASC`).all()
  ) as Record<string, unknown>[];
  return rows.map((row) => ({
    ...mapRequest(row),
    studentName: row.student_name as string,
    studentGroup: row.student_group as string,
  }));
}

export function staffOverview(): StaffOverview {
  const rows = db.prepare(`SELECT status, due_at FROM requests`).all() as {
    status: RequestStatus;
    due_at: string;
  }[];
  const byStatus: Record<RequestStatus, number> = {
    submitted: 0,
    in_progress: 0,
    ready: 0,
    rejected: 0,
  };
  let overdue = 0;
  let oldest: string | null = null;
  const todayStart = startOfMskDay(new Date()).toISOString();
  let todayRequests = 0;

  for (const row of rows) {
    byStatus[row.status] += 1;
    if (
      (row.status === 'submitted' || row.status === 'in_progress') &&
      new Date(row.due_at).getTime() < Date.now()
    ) {
      overdue += 1;
    }
    if (row.status === 'submitted') {
      if (!oldest || row.due_at < oldest) oldest = row.due_at;
      if (row.due_at >= todayStart) todayRequests += 1;
    }
  }

  return { total: rows.length, byStatus, overdue, oldestSubmittedAt: oldest, todayRequests };
}

export function staffRequest(requestId: number): (RequestDetail & { studentName: string; studentGroup: string }) | null {
  const row = db
    .prepare(
      `SELECT r.*, u.full_name AS student_name, u.group_name AS student_group
       FROM requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?`,
    )
    .get(requestId) as Record<string, unknown> | undefined;
  if (!row) return null;
  const detail = getRequest(row.user_id as number, requestId);
  if (!detail) return null;
  return { ...detail, studentName: row.student_name as string, studentGroup: row.student_group as string };
}

export function setRequestStatus(
  requestId: number,
  actorId: number,
  status: RequestStatus,
  comment: string,
): boolean {
  const row = db
    .prepare(`SELECT id, user_id, status FROM requests WHERE id = ?`)
    .get(requestId) as { id: number; user_id: number; status: RequestStatus } | undefined;
  if (!row) return false;

  const now = new Date().toISOString();
  const trimmed = comment.trim();
  db.prepare(`UPDATE requests SET status = ?, staff_comment = ?, updated_at = ? WHERE id = ?`).run(
    status,
    trimmed || null,
    now,
    requestId,
  );
  db.prepare(
    `INSERT INTO request_events (request_id, status, comment, actor_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(requestId, status, trimmed || null, actorId, now);

  notify(
    row.user_id,
    'request_status',
    `Заявка №${requestId}: ${REQUEST_STATUS_LABEL[status].toLowerCase()}`,
    trimmed || 'Статус заявки изменился. Откройте заявку, чтобы увидеть подробности.',
    requestId,
    `request:${requestId}:${status}:${now}`,
  );

  audit(actorId, 'request.status', 'request', requestId, { from: row.status, to: status });
  return true;
}

// ---------- объявления и уведомления ----------

export function notify(
  userId: number,
  kind: NotificationRow['kind'],
  title: string,
  body: string,
  refId: number | null,
  dedupeKey: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO notifications (user_id, kind, ref_id, title, body, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, kind, refId, title, body, dedupeKey, new Date().toISOString());
}

export function publishAnnouncement(
  actorId: number,
  input: { title: string; body: string; audience: string },
): number {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO announcements (title, body, audience, published_at, author_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(input.title, input.body, input.audience, now, actorId);
  const announcementId = Number(info.lastInsertRowid);

  const recipients = db
    .prepare(
      input.audience === 'all'
        ? `SELECT id FROM users WHERE role = 'student'`
        : `SELECT id FROM users WHERE role = 'student' AND group_name = ?`,
    )
    .all(...(input.audience === 'all' ? [] : [input.audience])) as { id: number }[];

  for (const recipient of recipients) {
    notify(
      recipient.id,
      'announcement',
      input.title,
      input.body,
      announcementId,
      `announcement:${announcementId}:${recipient.id}`,
    );
  }

  audit(actorId, 'announcement.publish', 'announcement', announcementId, {
    audience: input.audience,
    recipients: recipients.length,
  });
  return announcementId;
}

export function notifications(userId: number): NotificationRow[] {
  const rows = db
    .prepare(
      `SELECT id, kind, ref_id, title, body, read_at, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as number,
    kind: row.kind as NotificationRow['kind'],
    refId: (row.ref_id as number | null) ?? null,
    title: row.title as string,
    body: row.body as string,
    readAt: (row.read_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

export function markNotificationRead(userId: number, notificationId: number): boolean {
  const info = db
    .prepare(`UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`)
    .run(new Date().toISOString(), notificationId, userId);
  return info.changes > 0;
}

export function markAllRead(userId: number): number {
  return db
    .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`)
    .run(new Date().toISOString(), userId).changes;
}

export function unreadCount(userId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL`)
    .get(userId) as { c: number };
  return row.c;
}

// ---------- главная ----------

export function dashboard(user: SessionUser): DashboardData {
  const now = new Date();
  const dayStart = startOfMskDay(now);
  const dayEnd = addDays(dayStart, 1);
  const todayLessons = lessonsForRange(user.groupName, dayStart.toISOString(), dayEnd.toISOString());

  const weekStart = startOfMskWeek(now);
  const weekEnd = addDays(weekStart, 7);
  const week = lessonsForRange(user.groupName, weekStart.toISOString(), weekEnd.toISOString());

  const seen = db
    .prepare(`SELECT last_seen_at FROM users WHERE id = ?`)
    .get(user.id) as { last_seen_at: string | null };
  const since = seen.last_seen_at ?? addDays(now, -3).toISOString();

  const sinceMs = new Date(since).getTime();
  const changes: DashboardData['changes'] = [];
  for (const lesson of week) {
    if (lesson.status !== 'normal' && lesson.previousStartsAt && lesson.startsAt >= since) {
      changes.push({
        id: `lesson-${lesson.id}`,
        kind: 'schedule',
        title: lesson.status === 'cancelled' ? 'Занятие отменено' : 'Перенос занятия',
        body: `${lesson.courseTitle}: ${lesson.status === 'cancelled' ? 'отменено' : 'перенесено'}, ${lesson.roomName}.`,
        at: lesson.startsAt,
      });
    }
  }
  for (const grade of grades(user.id)) {
    if (grade.grade !== null && grade.updatedAt >= since) {
      changes.push({
        id: `grade-${grade.enrollmentId}`,
        kind: 'grade',
        title: 'Новая оценка',
        body: `${grade.title}: ${grade.gradeLabel}.`,
        at: grade.updatedAt,
      });
    }
  }
  for (const note of notifications(user.id).filter((n) => n.kind === 'announcement').slice(0, 2)) {
    changes.push({
      id: `note-${note.id}`,
      kind: 'announcement',
      title: 'Объявление деканата',
      body: note.title,
      at: note.createdAt,
    });
  }
  for (const request of listRequests(user.id).slice(0, 3)) {
    changes.push({
      id: `request-${request.id}-${request.status}`,
      kind: 'request',
      title: `Заявка №${request.id}`,
      body: `${request.typeLabel}: ${request.statusLabel.toLowerCase()}.`,
      at: request.updatedAt,
    });
  }

  const sorted = changes
    .filter((change) => new Date(change.at).getTime() >= sinceMs)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 4);

  const state = computeSessionState(grades(user.id));
  const active = listRequests(user.id).filter(
    (request) => request.status === 'submitted' || request.status === 'in_progress',
  );

  const upcoming = nextLesson(user.groupName, now.toISOString());

  // Точку отсчёта двигаем не чаще раза в 30 минут: иначе повторное открытие
  // главной во время демонстрации обнуляло бы список изменений.
  const lastSeenMs = seen.last_seen_at ? new Date(seen.last_seen_at).getTime() : 0;
  if (now.getTime() - lastSeenMs > 30 * 60 * 1000) {
    db.prepare(`UPDATE users SET last_seen_at = ? WHERE id = ?`).run(now.toISOString(), user.id);
  }

  return {
    user,
    todayLessons,
    changes: sorted,
    sessionState: state,
    activeRequests: active,
    unreadNotifications: unreadCount(user.id),
    nextDeadline: upcoming ? { title: upcoming.courseTitle, at: upcoming.startsAt } : null,
  };
}

export { mapLesson };
