import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db, transaction } from '../server/db';
import { hashPassword } from '../server/auth';
import { attachmentStorageRoot } from '../server/attachments';
import { mskTime, startOfMskWeek, startOfMskDay, addDays } from '../server/time';

// Все данные вымышленные. Студенты, преподаватели, оценки и заявки созданы
// для демонстрации. Совпадения с реальными людьми случайны.
//
// Наполнение сознательно густое: пустой кабинет выглядит как макет,
// а не как рабочий сервис. Поэтому три курса истории, полная неделя пар,
// пересдачи, документы, стипендия и переписка с деканатом.

const DEMO_PASSWORD = 'demo12345';
const GROUP = 'МЭО-3-1';

function iso(date: Date): string {
  return date.toISOString();
}

function at(base: Date, dayOffset: number, hours: number, minutes: number): Date {
  return mskTime(base, dayOffset, hours, minutes);
}

export function seed(): void {
  const now = new Date();
  const passwordHash = hashPassword(DEMO_PASSWORD);

  transaction(() => {
    for (const table of [
      'messages',
      'payments',
      'documents',
      'retake_bookings',
      'retake_slots',
      'audit_log',
      'notifications',
      'announcements',
      'request_events',
      'request_attachments',
      'requests',
      'enrollments',
      'lessons',
      'courses',
      'rooms',
      'teachers',
      'sessions',
      'semesters',
      'users',
    ]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    db.prepare(`DELETE FROM sqlite_sequence`).run();
  });

  // ---------- семестры: 5 прошедших и текущий ----------

  const insertSemester = db.prepare(
    `INSERT INTO semesters (title, number, starts_on, ends_on, session_ends_on, is_current)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  // Осенний семестр 2024 → весенний 2026, затем текущий осенний 2026.
  const semesterSpecs = [
    { title: '1 курс, осень', number: 1, start: -730, end: -610, session: -580 },
    { title: '1 курс, весна', number: 2, start: -580, end: -460, session: -430 },
    { title: '2 курс, осень', number: 3, start: -430, end: -310, session: -280 },
    { title: '2 курс, весна', number: 4, start: -280, end: -160, session: -130 },
    { title: '3 курс, осень', number: 5, start: -60, end: 60, session: 75 },
  ];

  const semesters = semesterSpecs.map((spec, index) =>
    Number(
      insertSemester.run(
        spec.title,
        spec.number,
        iso(at(now, spec.start, 9, 0)),
        iso(at(now, spec.end, 18, 0)),
        iso(at(now, spec.session, 18, 0)),
        index === semesterSpecs.length - 1 ? 1 : 0,
      ).lastInsertRowid,
    ),
  );
  const currentSemester = semesters[semesters.length - 1];

  // ---------- люди ----------

  const insertUser = db.prepare(
    `INSERT INTO users (email, password_hash, role, full_name, faculty, program, course, group_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  insertUser.run(
    'student1@demo.local',
    passwordHash,
    'student',
    'Анна Королёва',
    'Факультет международных экономических отношений',
    'Экономика',
    3,
    GROUP,
    iso(now),
  );
  insertUser.run(
    'student2@demo.local',
    passwordHash,
    'student',
    'Дмитрий Соколов',
    'Факультет международных экономических отношений',
    'Экономика',
    3,
    GROUP,
    iso(now),
  );
  insertUser.run(
    'staff@demo.local',
    passwordHash,
    'staff',
    'Ирина Белова',
    'Деканат МЭО',
    'Сотрудник деканата',
    0,
    '',
    iso(now),
  );
  insertUser.run(
    'admin@demo.local',
    passwordHash,
    'admin',
    'Админ Концепта',
    'Деканат МЭО',
    'Администратор концепта',
    0,
    '',
    iso(now),
  );

  const students = db.prepare(`SELECT id, email FROM users WHERE role = 'student'`).all() as {
    id: number;
    email: string;
  }[];
  const staff = db.prepare(`SELECT id FROM users WHERE role = 'staff'`).get() as { id: number };
  const student1 = students.find((entry) => entry.email === 'student1@demo.local')!;
  const student2 = students.find((entry) => entry.email === 'student2@demo.local')!;

  const insertTeacher = db.prepare(`INSERT INTO teachers (full_name, title) VALUES (?, ?)`);
  const teacherNames: [string, string][] = [
    ['Елена Мартынова', 'доцент, к.э.н.'],
    ['Павел Дорохов', 'профессор, д.э.н.'],
    ['Ольга Ким', 'старший преподаватель'],
    ['Артём Волков', 'доцент'],
    ['Мария Лебедева', 'доцент, к.ф.-м.н.'],
    ['Сергей Гордеев', 'профессор, д.э.н.'],
    ['Наталья Орлова', 'доцент, к.ю.н.'],
    ['Илья Романов', 'старший преподаватель'],
  ];
  const teachers = teacherNames.map(([name, title]) =>
    Number(insertTeacher.run(name, title).lastInsertRowid),
  );
  const teacherId = (name: string): number => {
    const index = teacherNames.findIndex(([fullName]) => fullName.startsWith(name));
    return teachers[index]!;
  };

  const insertRoom = db.prepare(`INSERT INTO rooms (name, building) VALUES (?, ?)`);
  const roomSpecs: [string, string][] = [
    ['315', 'корпус 1'],
    ['402', 'корпус 1'],
    ['214', 'корпус 2'],
    ['501', 'корпус 2'],
    ['ауд. 12', 'корпус 3'],
    ['108', 'корпус 2'],
  ];
  const rooms = roomSpecs.map(([name, building]) =>
    Number(insertRoom.run(name, building).lastInsertRowid),
  );

  const insertCourse = db.prepare(
    `INSERT INTO courses (title, teacher_id, credits, control_form, hours) VALUES (?, ?, ?, ?, ?)`,
  );

  // Дисциплины текущего семестра: 8 штук.
  const currentCourses = [
    { title: 'Микроэкономика II', teacher: teacherId('Елена'), credits: 4, form: 'exam', hours: 144 },
    { title: 'Эконометрика', teacher: teacherId('Мария'), credits: 4, form: 'exam', hours: 144 },
    { title: 'Философия', teacher: teacherId('Ольга Ким'), credits: 2, form: 'pass', hours: 72 },
    { title: 'Международная торговля', teacher: teacherId('Павел'), credits: 5, form: 'exam', hours: 180 },
    { title: 'Иностранный язык (профессиональный)', teacher: teacherId('Наталья'), credits: 3, form: 'pass', hours: 108 },
    { title: 'Бухгалтерский учёт', teacher: teacherId('Сергей'), credits: 3, form: 'exam', hours: 108 },
    { title: 'Правовое регулирование бизнеса', teacher: teacherId('Наталья'), credits: 3, form: 'pass', hours: 108 },
    { title: 'Анализ данных в экономике', teacher: teacherId('Илья'), credits: 4, form: 'exam', hours: 144 },
  ].map((course) =>
    Number(
      insertCourse.run(
        course.title,
        course.teacher,
        course.credits,
        course.form,
        course.hours,
      ).lastInsertRowid,
    ),
  );

  // Дисциплины прошлых семестров: нужны для зачётки и среднего балла по семестрам.
  const pastSpecs: { title: string; teacher: string; credits: number; form: 'exam' | 'pass'; sem: number }[] = [
    { title: 'Экономическая теория', teacher: 'Павел', credits: 4, form: 'exam', sem: 0 },
    { title: 'Математический анализ', teacher: 'Мария', credits: 4, form: 'exam', sem: 0 },
    { title: 'История экономических учений', teacher: 'Ольга Ким', credits: 2, form: 'pass', sem: 0 },
    { title: 'Введение в специальность', teacher: 'Сергей', credits: 2, form: 'pass', sem: 0 },
    { title: 'История России', teacher: 'Артём', credits: 3, form: 'exam', sem: 0 },
    { title: 'Микроэкономика I', teacher: 'Елена', credits: 4, form: 'exam', sem: 1 },
    { title: 'Статистика', teacher: 'Мария', credits: 4, form: 'exam', sem: 1 },
    { title: 'Макроэкономика I', teacher: 'Павел', credits: 4, form: 'exam', sem: 1 },
    { title: 'Информатика', teacher: 'Илья', credits: 3, form: 'pass', sem: 1 },
    { title: 'Физическая культура', teacher: 'Артём', credits: 0, form: 'pass', sem: 1 },
    { title: 'Макроэкономика II', teacher: 'Павел', credits: 4, form: 'exam', sem: 2 },
    { title: 'Теория вероятностей', teacher: 'Мария', credits: 4, form: 'exam', sem: 2 },
    { title: 'Международные экономические отношения', teacher: 'Сергей', credits: 4, form: 'exam', sem: 2 },
    { title: 'Право', teacher: 'Наталья', credits: 2, form: 'pass', sem: 2 },
    { title: 'Иностранный язык (базовый)', teacher: 'Наталья', credits: 3, form: 'pass', sem: 2 },
    { title: 'Экономика фирмы', teacher: 'Елена', credits: 4, form: 'exam', sem: 3 },
    { title: 'Финансы', teacher: 'Сергей', credits: 4, form: 'exam', sem: 3 },
    { title: 'Маркетинг', teacher: 'Артём', credits: 3, form: 'exam', sem: 3 },
    { title: 'Деловой иностранный язык', teacher: 'Наталья', credits: 3, form: 'pass', sem: 3 },
    { title: 'Философия науки', teacher: 'Ольга Ким', credits: 2, form: 'pass', sem: 3 },
  ];

  const pastCourses = pastSpecs.map((spec) =>
    Number(
      insertCourse.run(
        spec.title,
        teacherId(spec.teacher),
        spec.credits,
        spec.form,
        spec.credits * 36,
      ).lastInsertRowid,
    ),
  );

  // ---------- зачётка ----------

  const insertEnrollment = db.prepare(
    `INSERT INTO enrollments (user_id, course_id, grade, status, retake_count, debt_since, debt_deadline, updated_at, semester_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // Прошлые семестры: у Анны и Дмитрия разные оценки — видно, что данные разные.
  const annaGrades = [4, 5, 5, 4, 4, 4, 5, 4, 4, 5, 5, 4, 5, 4, 4, 5, 4, 5, 4, 5];
  const dmitryGrades = [3, 3, 4, 4, 3, 3, 4, 3, 4, 4, 4, 3, 4, 4, 3, 4, 3, 4, 4, 4];

  pastCourses.forEach((courseId, index) => {
    const semesterId = semesters[pastSpecs[index]!.sem]!;
    const updatedAt = iso(at(now, -400 + index * 15, 12, 0));
    insertEnrollment.run(
      student1.id,
      courseId,
      annaGrades[index]!,
      'passed',
      0,
      null,
      null,
      updatedAt,
      semesterId,
    );
    insertEnrollment.run(
      student2.id,
      courseId,
      dmitryGrades[index]!,
      'passed',
      0,
      null,
      null,
      updatedAt,
      semesterId,
    );
  });

  // Текущий семестр у Анны: 2 долга, 1 в процессе, остальные закрыты.
  insertEnrollment.run(student1.id, currentCourses[0]!, 4, 'passed', 0, null, null, iso(at(now, -1, 15, 30)), currentSemester);
  insertEnrollment.run(student1.id, currentCourses[1]!, null, 'debt', 0, iso(at(now, -21, 10, 0)), iso(at(now, 4, 23, 59)), iso(at(now, -21, 10, 0)), currentSemester);
  insertEnrollment.run(student1.id, currentCourses[2]!, null, 'debt', 0, iso(at(now, -14, 10, 0)), iso(at(now, 9, 23, 59)), iso(at(now, -14, 10, 0)), currentSemester);
  insertEnrollment.run(student1.id, currentCourses[3]!, 5, 'passed', 0, null, null, iso(at(now, -20, 12, 0)), currentSemester);
  insertEnrollment.run(student1.id, currentCourses[4]!, null, 'pending', 0, null, null, iso(now), currentSemester);
  insertEnrollment.run(student1.id, currentCourses[5]!, 4, 'passed', 0, null, null, iso(at(now, -8, 12, 0)), currentSemester);
  insertEnrollment.run(student1.id, currentCourses[6]!, null, 'pending', 0, null, null, iso(now), currentSemester);
  insertEnrollment.run(student1.id, currentCourses[7]!, 5, 'passed', 0, null, null, iso(at(now, -3, 12, 0)), currentSemester);

  // Дмитрий: один просроченный долг, остальное закрыто.
  insertEnrollment.run(student2.id, currentCourses[0]!, 3, 'passed', 1, null, null, iso(at(now, -40, 12, 0)), currentSemester);
  insertEnrollment.run(student2.id, currentCourses[1]!, 4, 'passed', 0, null, null, iso(at(now, -35, 12, 0)), currentSemester);
  insertEnrollment.run(student2.id, currentCourses[2]!, 5, 'passed', 0, null, null, iso(at(now, -30, 12, 0)), currentSemester);
  insertEnrollment.run(student2.id, currentCourses[3]!, 2, 'failed', 1, iso(at(now, -30, 10, 0)), iso(at(now, -2, 23, 59)), iso(at(now, -2, 9, 0)), currentSemester);
  insertEnrollment.run(student2.id, currentCourses[4]!, 4, 'passed', 0, null, null, iso(at(now, -25, 12, 0)), currentSemester);
  insertEnrollment.run(student2.id, currentCourses[5]!, 3, 'passed', 0, null, null, iso(at(now, -20, 12, 0)), currentSemester);
  insertEnrollment.run(student2.id, currentCourses[6]!, 4, 'passed', 0, null, null, iso(at(now, -15, 12, 0)), currentSemester);
  insertEnrollment.run(student2.id, currentCourses[7]!, 3, 'passed', 0, null, null, iso(at(now, -10, 12, 0)), currentSemester);

  // ---------- расписание: полная неделя, 22 пары ----------

  const monday = startOfMskWeek(now);
  const insertLesson = db.prepare(
    `INSERT INTO lessons (course_id, room_id, group_name, starts_at, ends_at, kind, status, note, previous_starts_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  type LessonSeed = {
    course: number;
    room: number;
    day: number;
    hour: number;
    minute: number;
    duration: number;
    kind: string;
    status?: 'normal' | 'moved' | 'cancelled';
    note?: string;
    previousHour?: number;
  };

  // Понедельник — пятница, реальная нагрузка третьего курса.
  const week: LessonSeed[] = [
    { course: 3, room: 0, day: 0, hour: 10, minute: 0, duration: 90, kind: 'лекция' },
    { course: 0, room: 1, day: 0, hour: 12, minute: 10, duration: 90, kind: 'семинар' },
    { course: 5, room: 2, day: 0, hour: 14, minute: 0, duration: 90, kind: 'практикум' },
    { course: 1, room: 2, day: 1, hour: 9, minute: 0, duration: 90, kind: 'лекция' },
    { course: 2, room: 0, day: 1, hour: 11, minute: 10, duration: 90, kind: 'семинар' },
    { course: 7, room: 3, day: 1, hour: 14, minute: 0, duration: 90, kind: 'лабораторная' },
    { course: 3, room: 3, day: 2, hour: 10, minute: 0, duration: 90, kind: 'практикум' },
    {
      course: 4,
      room: 1,
      day: 2,
      hour: 14,
      minute: 0,
      duration: 90,
      kind: 'семинар',
      status: 'moved',
      note: 'Аудитория изменена на 402, вход со двора.',
      previousHour: 12,
    },
    { course: 6, room: 4, day: 2, hour: 16, minute: 0, duration: 90, kind: 'семинар' },
    { course: 1, room: 2, day: 3, hour: 9, minute: 0, duration: 90, kind: 'семинар' },
    {
      course: 0,
      room: 0,
      day: 3,
      hour: 11,
      minute: 10,
      duration: 90,
      kind: 'практикум',
      status: 'cancelled',
      note: 'Отменено: преподаватель на конференции. Задание в LMS.',
    },
    { course: 7, room: 3, day: 3, hour: 14, minute: 0, duration: 90, kind: 'лабораторная' },
    { course: 2, room: 4, day: 4, hour: 10, minute: 0, duration: 90, kind: 'семинар' },
    { course: 3, room: 3, day: 4, hour: 12, minute: 10, duration: 90, kind: 'лекция' },
    { course: 5, room: 5, day: 4, hour: 15, minute: 0, duration: 90, kind: 'консультация' },
    // суббота: одна пара, чтобы демо не выглядело пустым в выходной
    { course: 4, room: 1, day: 5, hour: 11, minute: 0, duration: 90, kind: 'консультация' },
  ];

  // Прошлая, текущая и следующая недели.
  for (const weekOffset of [-1, 0, 1]) {
    for (const item of week) {
      const start = at(monday, weekOffset * 7 + item.day, item.hour, item.minute);
      const end = new Date(start.getTime() + item.duration * 60 * 1000);
      const previous =
        item.previousHour !== undefined
          ? at(monday, weekOffset * 7 + item.day, item.previousHour, item.minute)
          : null;
      insertLesson.run(
        currentCourses[item.course]!,
        rooms[item.room]!,
        GROUP,
        iso(start),
        iso(end),
        item.kind,
        item.status ?? 'normal',
        item.note ?? null,
        previous ? iso(previous) : null,
        iso(now),
      );
    }
  }

  // ---------- заявки ----------

  const insertRequest = db.prepare(
    `INSERT INTO requests (user_id, type, template, payload_json, status, due_at, staff_comment, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEvent = db.prepare(
    `INSERT INTO request_events (request_id, status, comment, actor_id, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertAttachment = db.prepare(
    `INSERT INTO request_attachments (request_id, user_id, file_name, mime, size, storage_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  type RequestSeed = {
    user: number;
    type: string;
    template: string;
    payload: Record<string, string>;
    status: string;
    dueDays: number;
    comment: string | null;
    createdDays: number;
    updatedDays: number;
  };

  const requestSeeds: RequestSeed[] = [
    {
      user: student1.id,
      type: 'certificate_study',
      template: 'Справка об обучении',
      payload: { purpose: 'Для оформления визы', addressee: 'Консульство Италии', format: 'Бумажная, с печатью' },
      status: 'in_progress',
      dueDays: 1,
      comment: null,
      createdDays: -1,
      updatedDays: -1,
    },
    {
      user: student1.id,
      type: 'certificate_scholarship',
      template: 'Справка для стипендии',
      payload: { purpose: 'Для социальной стипендии', addressee: 'Стипендиальный отдел', format: 'Электронная' },
      status: 'ready',
      dueDays: -3,
      comment: 'Готово, можно забрать в кабинете 214.',
      createdDays: -8,
      updatedDays: -4,
    },
    {
      user: student1.id,
      type: 'certificate_study',
      template: 'Справка об обучении',
      payload: { purpose: 'Для военкомата', addressee: 'Военный комиссариат', format: 'Бумажная, с печатью' },
      status: 'ready',
      dueDays: -12,
      comment: 'Готово, забрать в 214.',
      createdDays: -18,
      updatedDays: -14,
    },
    {
      user: student1.id,
      type: 'retake_application',
      template: 'Заявление на пересдачу',
      payload: { discipline: 'Философия', reason: 'Зачёт не получен', preferredDate: '24 ноября' },
      status: 'submitted',
      dueDays: 2,
      comment: null,
      createdDays: 0,
      updatedDays: 0,
    },
    {
      user: student2.id,
      type: 'retake_application',
      template: 'Заявление на пересдачу',
      payload: { discipline: 'Международная торговля', reason: 'Не явился по болезни', preferredDate: 'следующая неделя' },
      status: 'rejected',
      dueDays: -5,
      comment: 'Нужна медицинская справка. Приложите её и подайте заново.',
      createdDays: -7,
      updatedDays: -6,
    },
    {
      user: student2.id,
      type: 'certificate_study',
      template: 'Справка об обучении',
      payload: { purpose: 'Для банка', addressee: 'Сбербанк', format: 'Электронная' },
      status: 'submitted',
      dueDays: 3,
      comment: null,
      createdDays: -1,
      updatedDays: -1,
    },
  ];

  for (const request of requestSeeds) {
    const requestId = Number(
      insertRequest.run(
        request.user,
        request.type,
        request.template,
        JSON.stringify(request.payload),
        request.status,
        iso(at(now, request.dueDays, 18, 0)),
        request.comment,
        iso(at(now, request.createdDays, 9, 30)),
        iso(at(now, request.updatedDays, 14, 10)),
      ).lastInsertRowid,
    );
    insertEvent.run(
      requestId,
      'submitted',
      'Заявка создана',
      request.user,
      iso(at(now, request.createdDays, 9, 30)),
    );
    if (request.status !== 'submitted') {
      insertEvent.run(
        requestId,
        request.status,
        request.comment,
        staff.id,
        iso(at(now, request.updatedDays, 14, 10)),
      );
    }

    // Дмитрий по заявке на пересдачу уже дослал справку — так в демо видно,
    // как выглядит требование деканата и ответ студента на него.
    if (request.user === student2.id && request.status === 'rejected') {
      const attachmentName = 'справка-врача.pdf';
      const storagePath = path.join(String(requestId), `${randomUUID()}.pdf`);
      const absolute = path.join(attachmentStorageRoot(), storagePath);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      if (!fs.existsSync(absolute)) {
        // Минимальный валидный PDF: демо-файл, реальных данных в нём нет.
        const demoPdf =
          '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
          '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
          '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\n' +
          'trailer<</Root 1 0 R>>\n%%EOF\n';
        fs.writeFileSync(absolute, demoPdf, { mode: 0o600 });
      }
      insertAttachment.run(
        requestId,
        request.user,
        attachmentName,
        'application/pdf',
        fs.statSync(absolute).size,
        storagePath,
        iso(at(now, request.updatedDays + 1, 10, 5)),
      );
      insertEvent.run(
        requestId,
        request.status,
        `Приложен документ: ${attachmentName}`,
        request.user,
        iso(at(now, request.updatedDays + 1, 10, 5)),
      );
    }
  }

  // ---------- пересдачи: слоты и записи ----------

  const insertSlot = db.prepare(
    `INSERT INTO retake_slots (course_id, room_id, starts_at, duration_min, capacity, comment)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertBooking = db.prepare(
    `INSERT INTO retake_bookings (slot_id, user_id, created_at) VALUES (?, ?, ?)`,
  );

  // Слоты публикуются только по незакрытым дисциплинам: пересдавать сданное нельзя,
  // поэтому слотов по Микроэкономике II и Анализу данных здесь нет.
  const econSlot = Number(
    insertSlot.run(currentCourses[1]!, rooms[0]!, iso(at(now, 3, 10, 0)), 90, 8, 'Эконометрика, пересдача экзамена').lastInsertRowid,
  );
  const philoSlot = Number(
    insertSlot.run(currentCourses[2]!, rooms[1]!, iso(at(now, 5, 12, 0)), 60, 10, 'Философия, пересдача зачёта').lastInsertRowid,
  );
  const tradeSlot = Number(
    insertSlot.run(currentCourses[3]!, rooms[3]!, iso(at(now, 4, 14, 0)), 90, 6, 'Международная торговля, комиссия').lastInsertRowid,
  );
  // Дмитрий уже записан на пересдачу по торговле: это его единственный долг.
  insertBooking.run(tradeSlot, student2.id, iso(at(now, -3, 12, 0)));
  void econSlot;
  void philoSlot;

  // ---------- документы ----------

  const insertDocument = db.prepare(
    `INSERT INTO documents (user_id, request_id, kind, number, issued_at, valid_until, issued_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  insertDocument.run(
    student1.id,
    null,
    'study',
    'МЭО-2026/1842',
    iso(at(now, -14, 12, 0)),
    null,
    'Деканат МЭО',
  );
  insertDocument.run(
    student1.id,
    null,
    'scholarship',
    'МЭО-2026/1591',
    iso(at(now, -60, 12, 0)),
    iso(at(now, 30, 12, 0)),
    'Деканат МЭО',
  );
  insertDocument.run(
    student2.id,
    null,
    'study',
    'МЭО-2026/1799',
    iso(at(now, -22, 12, 0)),
    null,
    'Деканат МЭО',
  );

  // ---------- стипендия ----------

  const insertPayment = db.prepare(
    `INSERT INTO payments (user_id, kind, amount, period, paid_at, status) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const months = ['август', 'сентябрь', 'октябрь', 'ноябрь'];
  months.forEach((month, index) => {
    const paid = index < months.length - 1;
    insertPayment.run(
      student1.id,
      index % 2 === 0 ? 'scholarship' : 'increased',
      index % 2 === 0 ? 3000 : 6500,
      month,
      paid ? iso(at(now, -90 + index * 30, 10, 0)) : null,
      paid ? 'paid' : 'pending',
    );
    insertPayment.run(
      student2.id,
      'scholarship',
      3000,
      month,
      paid ? iso(at(now, -90 + index * 30, 10, 0)) : null,
      paid ? 'paid' : 'pending',
    );
  });

  // ---------- переписка с деканатом ----------

  const insertMessage = db.prepare(
    `INSERT INTO messages (user_id, author_id, body, read_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  );
  insertMessage.run(
    student1.id,
    student1.id,
    'Здравствуйте! Подскажите, когда будет готова справка для стипендии?',
    iso(at(now, -8, 10, 5)),
    iso(at(now, -8, 10, 5)),
  );
  insertMessage.run(
    student1.id,
    staff.id,
    'Добрый день! Справка готова, можно забрать в кабинете 214 с 10:00 до 17:00.',
    iso(at(now, -4, 16, 20)),
    iso(at(now, -4, 16, 20)),
  );
  insertMessage.run(
    student1.id,
    student1.id,
    'Спасибо, заберу завтра.',
    iso(at(now, -3, 9, 0)),
    iso(at(now, -3, 9, 0)),
  );
  insertMessage.run(
    student2.id,
    student2.id,
    'Здравствуйте, можно перенести пересдачу по торговле на следующую неделю?',
    null,
    iso(at(now, -2, 11, 30)),
  );

  // ---------- объявления ----------

  const insertAnnouncement = db.prepare(
    `INSERT INTO announcements (title, body, audience, published_at, author_id) VALUES (?, ?, ?, ?, ?)`,
  );
  const insertNotification = db.prepare(
    `INSERT OR IGNORE INTO notifications (user_id, kind, ref_id, title, body, dedupe_key, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const announcements: { title: string; body: string; audience: string; at: Date }[] = [
    {
      title: 'График пересдач опубликован',
      body: 'Пересдачи проходят с 24 по 29 ноября. Запись — в разделе «Пересдачи», не позднее чем за день.',
      audience: 'all',
      at: at(now, -2, 12, 0),
    },
    {
      title: 'Перенос практикума по иностранному языку',
      body: 'Практикум в среду перенесён с 12:10 на 14:00, аудитория 402.',
      audience: GROUP,
      at: at(now, -1, 18, 40),
    },
    {
      title: 'Справки можно заказать онлайн',
      body: 'Бумажную справку готовят до трёх рабочих дней, электронную — до пяти. Статус виден в разделе «Заявки».',
      audience: 'all',
      at: at(now, -5, 10, 0),
    },
    {
      title: 'Стипендия за ноябрь',
      body: 'Начисление до 25 ноября. Если сумма не пришла до 28-го — напишите в деканат через раздел «Сообщения».',
      audience: 'all',
      at: at(now, -6, 9, 30),
    },
  ];

  for (const item of announcements) {
    const announcementId = Number(
      insertAnnouncement.run(item.title, item.body, item.audience, iso(item.at), staff.id)
        .lastInsertRowid,
    );
    for (const student of students) {
      insertNotification.run(
        student.id,
        'announcement',
        announcementId,
        item.title,
        item.body,
        `announcement:${announcementId}:${student.id}`,
        item.at.getTime() < now.getTime() - 24 * 3600 * 1000 ? iso(item.at) : null,
        iso(item.at),
      );
    }
  }

  insertNotification.run(
    student1.id,
    'schedule_change',
    null,
    'Перенос занятия',
    'Иностранный язык: перенесено на 14:00, аудитория 402.',
    `lesson:moved:${student1.id}:seed`,
    null,
    iso(at(now, -1, 18, 40)),
  );

  // Пример уведомления о переписке: у Анны есть непрочитанный ответ деканата.
  const answerMessage = db
    .prepare(
      `SELECT id FROM messages WHERE user_id = ? AND author_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(student1.id, staff.id) as { id: number } | undefined;
  if (answerMessage) {
    insertNotification.run(
      student1.id,
      'message',
      answerMessage.id,
      'Сообщение от деканата',
      'Добрый день! Справка готова, можно забрать в кабинете 214 с 10:00 до 17:00.',
      `message:${answerMessage.id}:to:${student1.id}`,
      null,
      iso(at(now, -4, 16, 20)),
    );
  }

  void startOfMskDay;
  void addDays;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  seed();
  console.log(`Готово. Демо-пароль для всех аккаунтов: ${DEMO_PASSWORD}`);
  console.log('student1@demo.local — Анна Королёва, есть долги');
  console.log('student2@demo.local — Дмитрий Соколов, один просроченный долг');
  console.log('staff@demo.local — Ирина Белова, деканат');
  console.log('admin@demo.local — Админ Концепта, редактирование базы');
}
