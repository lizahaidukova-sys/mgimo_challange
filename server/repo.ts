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
import {
  DOCUMENT_KIND_LABEL,
  PAYMENT_KIND_LABEL,
  type Semester,
  type SemesterResult,
  type RetakeSlot,
  type DocumentRow,
  type PaymentRow,
  type MessageRow,
  type DeanMessage,
  type SearchHit,
} from '../shared/types';
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
              e.debt_since, e.debt_deadline, e.updated_at,
              COALESCE(c.hours, 0) AS hours, e.semester_id
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
    hours: (row.hours as number) ?? 0,
    semesterId: (row.semester_id as number | null) ?? null,
  }));
}

export function sessionState(userId: number): SessionState {
  return computeSessionState(grades(userId), currentSemesterEnd());
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
    attachments: requestAttachments(requestId),
  };
}

export interface AttachmentRow {
  id: number;
  requestId: number;
  fileName: string;
  mime: string;
  size: number;
  createdAt: string;
}

export function requestAttachments(requestId: number): AttachmentRow[] {
  const rows = db
    .prepare(
      `SELECT id, request_id, file_name, mime, size, created_at
       FROM request_attachments WHERE request_id = ? ORDER BY created_at ASC`,
    )
    .all(requestId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as number,
    requestId: row.request_id as number,
    fileName: row.file_name as string,
    mime: row.mime as string,
    size: row.size as number,
    createdAt: row.created_at as string,
  }));
}

/**
 * Заявка, к которой студенту разрешено приложить файл.
 *
 * Возвращает null и для чужой, и для несуществующей заявки: экран должен
 * отвечать 404 одинаково, иначе перебором id можно выяснить, что заявка есть.
 */
export function requestsForAttachment(userId: number, requestId: number): {
  status: RequestStatus;
  staffComment: string | null;
} | null {
  const row = db
    .prepare(`SELECT status, staff_comment FROM requests WHERE id = ? AND user_id = ?`)
    .get(requestId, userId) as { status: RequestStatus; staff_comment: string | null } | undefined;
  return row ? { status: row.status, staffComment: row.staff_comment } : null;
}

export function addRequestAttachment(
  userId: number,
  requestId: number,
  input: { fileName: string; mime: string; size: number; storagePath: string },
): AttachmentRow {
  const now = new Date().toISOString();
  const id = Number(
    db
      .prepare(
        `INSERT INTO request_attachments (request_id, user_id, file_name, mime, size, storage_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(requestId, userId, input.fileName, input.mime, input.size, input.storagePath, now)
      .lastInsertRowid,
  );
  // Событие в истории: деканат должен видеть, что студент дослал документ.
  db.prepare(
    `INSERT INTO request_events (request_id, status, comment, actor_id, created_at)
     VALUES (?, (SELECT status FROM requests WHERE id = ?), ?, ?, ?)`,
  ).run(requestId, requestId, `Приложен документ: ${input.fileName}`, userId, now);

  db.prepare(`UPDATE requests SET updated_at = ? WHERE id = ?`).run(now, requestId);
  audit(userId, 'request.attach', 'request', requestId, { fileName: input.fileName, size: input.size });
  return { id, requestId, fileName: input.fileName, mime: input.mime, size: input.size, createdAt: now };
}

export function attachmentForDownload(
  userId: number,
  requestId: number,
  attachmentId: number,
): { fileName: string; mime: string; storagePath: string } | null {
  const row = db
    .prepare(
      `SELECT a.file_name, a.mime, a.storage_path
       FROM request_attachments a JOIN requests r ON r.id = a.request_id
       WHERE a.id = ? AND a.request_id = ? AND r.user_id = ?`,
    )
    .get(attachmentId, requestId, userId) as
    | { file_name: string; mime: string; storage_path: string }
    | undefined;
  return row ? { fileName: row.file_name, mime: row.mime, storagePath: row.storage_path } : null;
}

export function attachmentForStaffDownload(
  requestId: number,
  attachmentId: number,
): { fileName: string; mime: string; storagePath: string } | null {
  const row = db
    .prepare(
      `SELECT file_name, mime, storage_path FROM request_attachments
       WHERE id = ? AND request_id = ?`,
    )
    .get(attachmentId, requestId) as
    | { file_name: string; mime: string; storage_path: string }
    | undefined;
  return row ? { fileName: row.file_name, mime: row.mime, storagePath: row.storage_path } : null;
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
  const rows = db.prepare(`SELECT status, due_at, created_at FROM requests`).all() as {
    status: RequestStatus;
    due_at: string;
    created_at: string;
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
      // «Старейшая новая» — по времени подачи, а не по сроку: это разные вещи.
      if (!oldest || row.created_at < oldest) oldest = row.created_at;
      if (row.created_at >= todayStart) todayRequests += 1;
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
  return Number(info.changes) > 0;
}

export function markAllRead(userId: number): number {
  return Number(
    db
      .prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`)
      .run(new Date().toISOString(), userId).changes,
  );
}

export function unreadCount(userId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL`)
    .get(userId) as { c: number };
  return row.c;
}

// Конец сессии текущего семестра: нужен светофору для честного срока.
function currentSemesterEnd(): string | null {
  const row = db
    .prepare(`SELECT session_ends_on FROM semesters WHERE is_current = 1 LIMIT 1`)
    .get() as { session_ends_on: string } | undefined;
  return row?.session_ends_on ?? null;
}

// ---------- зачётка по семестрам ----------

export function semesters(): Semester[] {
  const rows = db
    .prepare(`SELECT id, title, number, starts_on, ends_on, session_ends_on, is_current
              FROM semesters ORDER BY number ASC`)
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as number,
    title: row.title as string,
    number: row.number as number,
    startsOn: row.starts_on as string,
    endsOn: row.ends_on as string,
    sessionEndsOn: row.session_ends_on as string,
    isCurrent: Boolean(row.is_current),
  }));
}

// История успеваемости: по семестрам, с GPA и зачётами.
export function semesterResults(userId: number): SemesterResult[] {
  const all = grades(userId);
  return semesters()
    .map((semester) => {
      const rows = all.filter((row) => row.semesterId === semester.id);
      const graded = rows.filter((row) => row.grade !== null);
      const gpa =
        graded.length > 0
          ? Math.round(
              (graded.reduce((sum, row) => sum + (row.grade as number), 0) / graded.length) * 100,
            ) / 100
          : null;
      return {
        semester,
        rows,
        gpa,
        passed: rows.filter((row) => row.status === 'passed').length,
        total: rows.length,
        credits: rows
          .filter((row) => row.status === 'passed')
          .reduce((sum, row) => sum + row.credits, 0),
      };
    })
    .filter((result) => result.rows.length > 0);
}

// ---------- пересдачи ----------

// По регламенту прототипа пересдать дисциплину можно, только если она не закрыта:
// статус «долг» или «не сдано». Сданная дисциплина закрыта даже при пересдачах
// в истории — иначе вкладка предлагала бы записаться на то, что уже сдано.
export const RETAKE_LIMIT = 2;

type SlotRow = Record<string, unknown>;

function mapSlotUserState(userId: number, row: SlotRow): RetakeSlot {
  const courseId = row.course_id as number;
  const enrollment = db
    .prepare(`SELECT status, grade, retake_count FROM enrollments WHERE user_id = ? AND course_id = ?`)
    .get(userId, courseId) as
    | { status: string; grade: number | null; retake_count: number }
    | undefined;

  const base = {
    id: row.id as number,
    courseId,
    courseTitle: row.course_title as string,
    teacherName: row.teacher_name as string,
    roomName: row.room_name as string,
    startsAt: row.starts_at as string,
    durationMin: row.duration_min as number,
    capacity: row.capacity as number,
    booked: row.booked as number,
    myBookingId: (row.my_booking_id as number | null) ?? null,
    comment: (row.comment as string | null) ?? null,
    retakeCount: enrollment?.retake_count ?? 0,
    retakeLimit: RETAKE_LIMIT,
  };

  // Дисциплина не входит в учебный план студента — записываться некуда.
  if (!enrollment) {
    return { ...base, eligible: false, blockedReason: 'not_enrolled' as const };
  }
  const open = enrollment.status === 'debt' || enrollment.status === 'failed';
  if (!open) {
    return { ...base, eligible: false, blockedReason: 'passed' as const };
  }
  if (enrollment.retake_count >= RETAKE_LIMIT) {
    return { ...base, eligible: false, blockedReason: 'limit' as const };
  }
  return { ...base, eligible: true, blockedReason: null };
}

/**
 * Слоты пересдач для студента.
 *
 * `includeIneligible` нужен только админке и проверкам: обычному пользователю
 * сданные дисциплины не показываются вовсе, иначе список выглядит как «можно
 * записаться на что угодно».
 */
export function retakeSlots(userId: number, includeIneligible = false): RetakeSlot[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.course_id, c.title AS course_title, t.full_name AS teacher_name,
              r.name AS room_name, s.starts_at, s.duration_min, s.capacity, s.comment,
              (SELECT COUNT(*) FROM retake_bookings b WHERE b.slot_id = s.id) AS booked,
              (SELECT b.id FROM retake_bookings b WHERE b.slot_id = s.id AND b.user_id = ?) AS my_booking_id
       FROM retake_slots s
       JOIN courses c ON c.id = s.course_id
       JOIN teachers t ON t.id = c.teacher_id
       JOIN rooms r ON r.id = s.room_id
       WHERE s.starts_at >= ?
       ORDER BY s.starts_at ASC`,
    )
    .all(userId, addDays(new Date(), -1).toISOString()) as SlotRow[];

  const slots = rows.map((row) => mapSlotUserState(userId, row));
  if (includeIneligible) return slots;

  // Своя запись видна всегда: отменить её студент должен даже при смене статуса.
  return slots.filter((slot) => slot.eligible || slot.myBookingId !== null);
}

/** Причина отказа в пересдаче для слота, или null если запись разрешена. */
function retakeEligibility(userId: number, courseId: number): string | null {
  const enrollment = db
    .prepare(`SELECT status, grade, retake_count FROM enrollments WHERE user_id = ? AND course_id = ?`)
    .get(userId, courseId) as
    | { status: string; grade: number | null; retake_count: number }
    | undefined;

  if (!enrollment) return 'Дисциплина не входит в ваш учебный план';
  const open = enrollment.status === 'debt' || enrollment.status === 'failed';
  if (!open) {
    return 'Дисциплина сдана — пересдача не требуется';
  }
  if (enrollment.retake_count >= RETAKE_LIMIT) {
    return `Лимит пересдач исчерпан (${RETAKE_LIMIT})`;
  }
  return null;
}

export function bookRetake(
  userId: number,
  slotId: number,
): { ok: true } | { ok: false; reason: string } {
  const slot = db
    .prepare(
      `SELECT s.id, s.course_id, s.capacity, s.starts_at,
              (SELECT COUNT(*) FROM retake_bookings b WHERE b.slot_id = s.id) AS booked
       FROM retake_slots s WHERE s.id = ?`,
    )
    .get(slotId) as
    | { id: number; course_id: number; capacity: number; starts_at: string; booked: number }
    | undefined;

  if (!slot) return { ok: false, reason: 'Слот не найден' };
  if (new Date(slot.starts_at).getTime() < Date.now()) {
    return { ok: false, reason: 'Пересдача уже прошла' };
  }
  const blocked = retakeEligibility(userId, slot.course_id);
  if (blocked) return { ok: false, reason: blocked };
  const existing = db
    .prepare(`SELECT id FROM retake_bookings WHERE slot_id = ? AND user_id = ?`)
    .get(slotId, userId);
  if (existing) return { ok: false, reason: 'Вы уже записаны на этот слот' };
  if (Number(slot.booked) >= slot.capacity) return { ok: false, reason: 'Мест не осталось' };

  db.prepare(
    `INSERT INTO retake_bookings (slot_id, user_id, created_at) VALUES (?, ?, ?)`,
  ).run(slotId, userId, new Date().toISOString());
  audit(userId, 'retake.book', 'retake_slot', slotId, { courseId: slot.course_id });
  return { ok: true };
}

export function cancelRetake(userId: number, slotId: number): boolean {
  const info = db
    .prepare(`DELETE FROM retake_bookings WHERE slot_id = ? AND user_id = ?`)
    .run(slotId, userId);
  return Number(info.changes) > 0;
}

// ---------- документы и стипендия ----------

export function documents(userId: number): DocumentRow[] {
  const rows = db
    .prepare(
      `SELECT id, kind, number, issued_at, valid_until, issued_by, request_id
       FROM documents WHERE user_id = ? ORDER BY issued_at DESC`,
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as number,
    kind: row.kind as string,
    kindLabel: DOCUMENT_KIND_LABEL[row.kind as string] ?? (row.kind as string),
    number: row.number as string,
    issuedAt: row.issued_at as string,
    validUntil: (row.valid_until as string | null) ?? null,
    issuedBy: row.issued_by as string,
    requestId: (row.request_id as number | null) ?? null,
  }));
}

export function payments(userId: number): PaymentRow[] {
  const rows = db
    .prepare(
      `SELECT id, kind, amount, period, paid_at, status FROM payments
       WHERE user_id = ? ORDER BY id DESC`,
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as number,
    kind: row.kind as string,
    kindLabel: PAYMENT_KIND_LABEL[row.kind as string] ?? (row.kind as string),
    amount: row.amount as number,
    period: row.period as string,
    paidAt: (row.paid_at as string | null) ?? null,
    status: row.status as 'paid' | 'pending',
  }));
}

// ---------- переписка с деканатом ----------

export function messages(userId: number): MessageRow[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.body, m.read_at, m.created_at, u.full_name AS author_name, u.role AS author_role
       FROM messages m JOIN users u ON u.id = m.author_id
       WHERE m.user_id = ? ORDER BY m.created_at ASC`,
    )
    .all(userId) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as number,
    body: row.body as string,
    authorName: row.author_name as string,
    mine: row.author_role === 'student',
    readAt: (row.read_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

export function sendMessage(userId: number, authorId: number, body: string): MessageRow {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO messages (user_id, author_id, body, read_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(userId, authorId, body, authorId === userId ? now : null, now);
  const messageId = Number(info.lastInsertRowid);

  // Переписка должна быть видна обеим сторонам, а не только в разделе «Сообщения»:
  // иначе ответ деканата теряется, пока студент не откроет страницу сам.
  const author = db
    .prepare(`SELECT full_name, role FROM users WHERE id = ?`)
    .get(authorId) as { full_name: string; role: string } | undefined;
  const preview = body.length > 140 ? `${body.slice(0, 140)}…` : body;

  if (authorId !== userId) {
    // Деканат написал студенту.
    notify(
      userId,
      'message',
      'Сообщение от деканата',
      preview,
      messageId,
      `message:${messageId}:to:${userId}`,
    );
  }
  if (author?.role === 'student') {
    // Студент написал в деканат: уведомляем всех, кто может ответить.
    const recipients = db
      .prepare(`SELECT id FROM users WHERE role IN ('staff','admin')`)
      .all() as { id: number }[];
    for (const recipient of recipients) {
      notify(
        recipient.id,
        'message',
        `Сообщение от студента: ${author.full_name}`,
        preview,
        messageId,
        `message:${messageId}:to:${recipient.id}`,
      );
    }
  }

  audit(authorId, 'message.send', 'message', messageId, {});
  return {
    id: messageId,
    body,
    authorName: '',
    mine: authorId === userId,
    readAt: null,
    createdAt: now,
  };
}

export function deanDialogs(): DeanMessage[] {
  const rows = db
    .prepare(
      `SELECT m.id, m.user_id, m.body, m.created_at, m.read_at, u.full_name AS student_name, u.group_name,
              a.role AS author_role
       FROM messages m
       JOIN users u ON u.id = m.user_id
       JOIN users a ON a.id = m.author_id
       ORDER BY m.created_at ASC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as number,
    userId: row.user_id as number,
    studentName: row.student_name as string,
    studentGroup: row.group_name as string,
    body: row.body as string,
    mine: row.author_role === 'staff',
    createdAt: row.created_at as string,
    readAt: (row.read_at as string | null) ?? null,
  }));
}

export function markDialogRead(userId: number): number {
  const now = new Date().toISOString();
  const changes = Number(
    db
      .prepare(
        `UPDATE messages SET read_at = ? WHERE user_id = ? AND read_at IS NULL AND author_id != ?`,
      )
      .run(now, userId, userId).changes,
  );
  // Прочитанная переписка закрывает и уведомления о ней: иначе бейдж горит,
  // хотя человек уже видел сообщение.
  db.prepare(
    `UPDATE notifications SET read_at = ?
     WHERE user_id = ? AND kind = 'message' AND read_at IS NULL
       AND ref_id IN (SELECT id FROM messages WHERE user_id = ? AND author_id != ?)`,
  ).run(now, userId, userId, userId);
  return changes;
}

/** Деканат открыл диалог: гасим уведомления о сообщениях этого студента. */
export function markStudentDialogsReadForStaff(studentId: number, staffId: number): void {
  db.prepare(
    `UPDATE notifications SET read_at = ?
     WHERE user_id = ? AND kind = 'message' AND read_at IS NULL
       AND ref_id IN (SELECT id FROM messages WHERE user_id = ? AND author_id = ?)`,
  ).run(new Date().toISOString(), staffId, studentId, studentId);
}

// ---------- поиск по кабинету ----------

export function search(user: SessionUser, query: string): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits: SearchHit[] = [];

  for (const row of grades(user.id)) {
    if (!row.title.toLowerCase().includes(needle)) continue;
    hits.push({
      kind: 'grade',
      title: row.title,
      detail:
        row.grade !== null
          ? `Оценка: ${row.grade} (${row.gradeLabel})`
          : row.status === 'debt' || row.status === 'failed'
            ? 'Есть долг'
            : 'Ещё не закрыта',
      href: '/grades',
    });
  }

  const lessons = db
    .prepare(
      `SELECT l.starts_at, c.title FROM lessons l JOIN courses c ON c.id = l.course_id
       WHERE l.group_name = ? AND l.starts_at >= ? AND lower(c.title) LIKE ?
       ORDER BY l.starts_at ASC LIMIT 5`,
    )
    .all(user.groupName, new Date().toISOString(), `%${needle}%`) as {
    starts_at: string;
    title: string;
  }[];
  for (const lesson of lessons) {
    hits.push({
      kind: 'lesson',
      title: lesson.title,
      detail: new Intl.DateTimeFormat('ru-RU', {
        dateStyle: 'long',
        timeStyle: 'short',
        timeZone: 'Europe/Moscow',
      }).format(new Date(lesson.starts_at)),
      href: '/schedule',
    });
  }

  for (const request of listRequests(user.id)) {
    if (!request.typeLabel.toLowerCase().includes(needle)) continue;
    hits.push({
      kind: 'request',
      title: `${request.typeLabel} №${request.id}`,
      detail: request.statusLabel,
      href: `/requests/${request.id}`,
    });
  }

  for (const document of documents(user.id)) {
    if (!document.kindLabel.toLowerCase().includes(needle)) continue;
    hits.push({
      kind: 'document',
      title: document.kindLabel,
      detail: `№${document.number}`,
      href: '/documents',
    });
  }

  return hits.slice(0, 12);
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

  // Окно изменений фиксировано: последние трое суток. Так блок не зависит от
  // скрытого «последнего визита» и не пустеет при повторном открытии.
  const sinceMs = addDays(now, -3).getTime();
  const changes: DashboardData['changes'] = [];
  for (const lesson of week) {
    if (
      lesson.status !== 'normal' &&
      lesson.previousStartsAt !== null &&
      new Date(lesson.startsAt).getTime() >= sinceMs
    ) {
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
    if (grade.grade !== null && new Date(grade.updatedAt).getTime() >= sinceMs) {
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

  const state = computeSessionState(grades(user.id), currentSemesterEnd());
  const active = listRequests(user.id).filter(
    (request) => request.status === 'submitted' || request.status === 'in_progress',
  );

  const upcoming = nextLesson(user.groupName, now.toISOString());

  // Дедлайны на ближайшие дни: долги, заявки, пересдачи.
  const todayDeadlines: DashboardData['todayDeadlines'] = [];
  for (const action of state.actions) {
    if (!action.deadline) continue;
    const days = Math.ceil((new Date(action.deadline).getTime() - now.getTime()) / 86_400_000);
    if (days > 7) continue;
    todayDeadlines.push({
      title: action.title,
      detail: days < 0 ? 'срок прошёл' : days === 0 ? 'сегодня' : `через ${days} дн.`,
      at: action.deadline,
      urgent: days <= 2,
    });
  }
  for (const request of active) {
    const days = Math.ceil((new Date(request.dueAt).getTime() - now.getTime()) / 86_400_000);
    if (days > 7) continue;
    todayDeadlines.push({
      title: `Заявка №${request.id}`,
      detail: days < 0 ? 'срок прошёл' : days === 0 ? 'сегодня' : `через ${days} дн.`,
      at: request.dueAt,
      urgent: request.overdue,
    });
  }
  todayDeadlines.sort((a, b) => (a.at < b.at ? -1 : 1));

  const currentSemester = semesters().find((semester) => semester.isCurrent) ?? null;
  const daysToSession = currentSemester
    ? Math.max(
        0,
        Math.ceil(
          (new Date(currentSemester.sessionEndsOn).getTime() - now.getTime()) / 86_400_000,
        ),
      )
    : 0;

  const currentRows = grades(user.id).filter(
    (row) => currentSemester === null || row.semesterId === currentSemester.id,
  );
  const progress = {
    passed: currentRows.filter((row) => row.status === 'passed').length,
    total: currentRows.length,
    credits: currentRows
      .filter((row) => row.status === 'passed')
      .reduce((sum, row) => sum + row.credits, 0),
    plannedCredits: currentRows.reduce((sum, row) => sum + row.credits, 0),
  };

  const unreadMessages = Number(
    (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM messages WHERE user_id = ? AND read_at IS NULL AND author_id != ?`,
        )
        .get(user.id, user.id) as { c: number }
    ).c,
  );

  const retakeSoon =
    retakeSlots(user.id).find((slot) => slot.myBookingId !== null) ?? null;
  const scholarshipRows = payments(user.id);
  const latestPayment = scholarshipRows[0];
  const scholarship = latestPayment
    ? {
        period: latestPayment.period,
        amount: latestPayment.amount,
        paid: latestPayment.status === 'paid',
      }
    : null;

  return {
    user,
    todayLessons,
    changes: sorted,
    sessionState: state,
    activeRequests: active,
    unreadNotifications: unreadCount(user.id),
    nextDeadline: upcoming ? { title: upcoming.courseTitle, at: upcoming.startsAt } : null,
    nextLesson: upcoming,
    daysToSession,
    progress,
    todayDeadlines,
    unreadMessages,
    retakeSoon,
    scholarship,
  };
}

export { mapLesson };
