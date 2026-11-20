import { db, transaction } from '../server/db';
import { hashPassword } from '../server/auth';
import { mskTime, startOfMskWeek, mskWeekday } from '../server/time';

// Все данные вымышленные. ФИО, группы, оценки и аудитории созданы для демонстрации.
// Реальные студенты и преподаватели не используются.

const DEMO_PASSWORD = 'demo12345';

function iso(date: Date): string {
  return date.toISOString();
}

// Все времена в сиде заданы по Москве, а не по локальной зоне сервера.
function at(base: Date, dayOffset: number, hours: number, minutes: number): Date {
  return mskTime(base, dayOffset, hours, minutes);
}

// Понедельник текущей недели по Москве: расписание всегда «на этой неделе».
function mondayOfThisWeek(): Date {
  return startOfMskWeek(new Date());
}

export function seed(): void {
  const now = new Date();
  const passwordHash = hashPassword(DEMO_PASSWORD);

  transaction(() => {
    for (const table of [
      'audit_log',
      'notifications',
      'announcements',
      'request_events',
      'requests',
      'enrollments',
      'lessons',
      'courses',
      'rooms',
      'teachers',
      'sessions',
      'users',
    ]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    db.prepare(`DELETE FROM sqlite_sequence`).run();
  });

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
    'МЭО-3-1',
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
    'МЭО-3-1',
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

  const students = db.prepare(`SELECT id, email FROM users WHERE role = 'student'`).all() as {
    id: number;
    email: string;
  }[];
  const staff = db.prepare(`SELECT id FROM users WHERE role = 'staff'`).get() as { id: number };
  const student1 = students.find((s) => s.email === 'student1@demo.local')!;
  const student2 = students.find((s) => s.email === 'student2@demo.local')!;

  const insertTeacher = db.prepare(`INSERT INTO teachers (full_name, title) VALUES (?, ?)`);
  const teacherIds = [
    ['Елена Мартынова', 'доцент, к.э.н.'],
    ['Павел Дорохов', 'профессор, д.э.н.'],
    ['Ольга Ким', 'старший преподаватель'],
    ['Артём Волков', 'доцент'],
    ['Мария Лебедева', 'доцент, к.ф.-м.н.'],
  ].map(([fullName, title]) => Number(insertTeacher.run(fullName, title).lastInsertRowid));

  const insertRoom = db.prepare(`INSERT INTO rooms (name, building) VALUES (?, ?)`);
  const roomIds = [
    ['315', 'корпус 1'],
    ['402', 'корпус 1'],
    ['214', 'корпус 2'],
    ['501', 'корпус 2'],
    ['ауд. 12', 'корпус 3'],
  ].map(([name, building]) => Number(insertRoom.run(name, building).lastInsertRowid));

  const insertCourse = db.prepare(
    `INSERT INTO courses (title, teacher_id, credits, control_form) VALUES (?, ?, ?, ?)`,
  );
  const courses = [
    { title: 'Микроэкономика II', teacher: 0, credits: 4, form: 'exam' as const },
    { title: 'Эконометрика', teacher: 4, credits: 4, form: 'exam' as const },
    { title: 'Философия', teacher: 2, credits: 2, form: 'pass' as const },
    { title: 'Международная торговля', teacher: 1, credits: 5, form: 'exam' as const },
    { title: 'Иностранный язык (профессиональный)', teacher: 2, credits: 3, form: 'pass' as const },
  ].map((course) =>
    Number(
      insertCourse.run(
        course.title,
        teacherIds[course.teacher],
        course.credits,
        course.form,
      ).lastInsertRowid,
    ),
  );

  const monday = mondayOfThisWeek();
  const todayOffset = (mskWeekday(new Date()) + 6) % 7;

  const insertLesson = db.prepare(
    `INSERT INTO lessons (course_id, room_id, group_name, starts_at, ends_at, kind, status, note, previous_starts_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  type LessonSeed = {
    course: number;
    room: number;
    day: number;
    hour: number;
    minutes: number;
    duration: number;
    kind: string;
    status?: 'normal' | 'moved' | 'cancelled';
    note?: string;
    previousHour?: number;
  };

  const week: LessonSeed[] = [
    // понедельник
    { course: 4, room: 0, day: 0, hour: 10, minutes: 0, duration: 90, kind: 'лекция' },
    { course: 0, room: 1, day: 0, hour: 12, minutes: 10, duration: 90, kind: 'семинар' },
    // вторник
    { course: 1, room: 2, day: 1, hour: 9, minutes: 0, duration: 90, kind: 'лекция' },
    { course: 2, room: 0, day: 1, hour: 11, minutes: 10, duration: 90, kind: 'семинар' },
    // среда
    { course: 3, room: 3, day: 2, hour: 10, minutes: 0, duration: 90, kind: 'практикум' },
    {
      course: 4,
      room: 1,
      day: 2,
      hour: 14,
      minutes: 0,
      duration: 90,
      kind: 'семинар',
      status: 'moved',
      note: 'Перенос по просьбе преподавателя, аудитория изменена на 402.',
      previousHour: 12,
    },
    // четверг
    { course: 1, room: 2, day: 3, hour: 9, minutes: 0, duration: 90, kind: 'семинар' },
    {
      course: 0,
      room: 0,
      day: 3,
      hour: 11,
      minutes: 10,
      duration: 90,
      kind: 'практикум',
      status: 'cancelled',
      note: 'Отменено: преподаватель на конференции. Задание в LMS.',
    },
    // пятница
    { course: 2, room: 4, day: 4, hour: 10, minutes: 0, duration: 90, kind: 'семинар' },
    { course: 3, room: 3, day: 4, hour: 12, minutes: 10, duration: 90, kind: 'лекция' },
  ];

  // Расписание создаётся на предыдущую, текущую и следующую неделю,
  // чтобы день/неделя всегда содержали данные.
  for (const weekOffset of [-1, 0, 1]) {
    for (const item of week) {
      const start = at(monday, weekOffset * 7 + item.day, item.hour, item.minutes);
      const end = new Date(start.getTime() + item.duration * 60 * 1000);
      // На текущей неделе дни до сегодняшнего оставляем как есть — это история.
      const previous =
        item.previousHour !== undefined
          ? at(monday, weekOffset * 7 + item.day, item.previousHour, item.minutes)
          : null;
      insertLesson.run(
        courses[item.course],
        roomIds[item.room],
        'МЭО-3-1',
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

  const insertEnrollment = db.prepare(
    `INSERT INTO enrollments (user_id, course_id, grade, status, retake_count, debt_since, debt_deadline, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // Анна: два долга, один с близким сроком → жёлтый светофор.
  insertEnrollment.run(student1.id, courses[0], 4, 'passed', 0, null, null, iso(at(now, -1, 15, 30)));
  insertEnrollment.run(student1.id, courses[1], null, 'debt', 0, iso(at(now, -21, 10, 0)), iso(at(now, 4, 23, 59)), iso(now));
  insertEnrollment.run(student1.id, courses[2], null, 'debt', 0, iso(at(now, -14, 10, 0)), iso(at(now, 9, 23, 59)), iso(now));
  insertEnrollment.run(student1.id, courses[3], 5, 'passed', 0, null, null, iso(at(now, -20, 12, 0)));
  insertEnrollment.run(student1.id, courses[4], null, 'pending', 0, null, null, iso(now));

  // Дмитрий: всё закрыто → зелёный; данные отличаются, чтобы было видно разделение.
  insertEnrollment.run(student2.id, courses[0], 3, 'passed', 1, null, null, iso(at(now, -30, 12, 0)));
  insertEnrollment.run(student2.id, courses[1], 4, 'passed', 0, null, null, iso(at(now, -25, 12, 0)));
  insertEnrollment.run(student2.id, courses[2], 5, 'passed', 0, null, null, iso(at(now, -12, 12, 0)));
  insertEnrollment.run(student2.id, courses[3], 2, 'failed', 1, iso(at(now, -30, 10, 0)), iso(at(now, -2, 23, 59)), iso(at(now, -2, 9, 0)));
  insertEnrollment.run(student2.id, courses[4], 4, 'passed', 0, null, null, iso(at(now, -18, 12, 0)));

  const insertRequest = db.prepare(
    `INSERT INTO requests (user_id, type, template, payload_json, status, due_at, staff_comment, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertEvent = db.prepare(
    `INSERT INTO request_events (request_id, status, comment, actor_id, created_at) VALUES (?, ?, ?, ?, ?)`,
  );

  const request1 = Number(
    insertRequest.run(
      student1.id,
      'certificate_study',
      'Справка об обучении',
      JSON.stringify({ purpose: 'Для оформления визы', addressee: 'Консульство Италии', format: 'Бумажная, с печатью' }),
      'in_progress',
      iso(at(now, 1, 18, 0)),
      null,
      iso(at(now, -1, 9, 30)),
      iso(at(now, -1, 14, 10)),
    ).lastInsertRowid,
  );
  insertEvent.run(request1, 'submitted', 'Заявка создана', student1.id, iso(at(now, -1, 9, 30)));
  insertEvent.run(request1, 'in_progress', 'Принята в работу, готовится', staff.id, iso(at(now, -1, 14, 10)));

  const request2 = Number(
    insertRequest.run(
      student1.id,
      'certificate_scholarship',
      'Справка для стипендии',
      JSON.stringify({ purpose: 'Для социальной стипендии', addressee: 'Стипендиальный отдел', format: 'Электронная' }),
      'ready',
      iso(at(now, -3, 18, 0)),
      'Готово, можно забрать в кабинете 214.',
      iso(at(now, -8, 11, 0)),
      iso(at(now, -4, 16, 20)),
    ).lastInsertRowid,
  );
  insertEvent.run(request2, 'submitted', 'Заявка создана', student1.id, iso(at(now, -8, 11, 0)));
  insertEvent.run(request2, 'ready', 'Готово, можно забрать в кабинете 214.', staff.id, iso(at(now, -4, 16, 20)));

  const request3 = Number(
    insertRequest.run(
      student2.id,
      'retake_application',
      'Заявление на пересдачу',
      JSON.stringify({ discipline: 'Международная торговля', reason: 'Не явился по болезни', preferredDate: 'следующая неделя' }),
      'rejected',
      iso(at(now, -5, 18, 0)),
      'Нужна медицинская справка. Приложите её и подайте заново.',
      iso(at(now, -7, 10, 15)),
      iso(at(now, -6, 12, 0)),
    ).lastInsertRowid,
  );
  insertEvent.run(request3, 'submitted', 'Заявка создана', student2.id, iso(at(now, -7, 10, 15)));
  insertEvent.run(request3, 'rejected', 'Нужна медицинская справка. Приложите её и подайте заново.', staff.id, iso(at(now, -6, 12, 0)));

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
      body: 'Пересдачи проходят с 24 по 29 ноября. Запись — через заявку в кабинете, не позднее чем за день.',
      audience: 'all',
      at: at(now, -2, 12, 0),
    },
    {
      title: 'Перенос практикума по иностранному языку',
      body: 'Практикум в среду перенесён с 12:10 на 14:00, аудитория 402.',
      audience: 'МЭО-3-1',
      at: at(now, -1, 18, 40),
    },
    {
      title: 'Справки можно заказать онлайн',
      body: 'Бумажную справку готовят до трёх рабочих дней, электронную — до пяти. Статус виден в разделе «Заявки».',
      audience: 'all',
      at: at(now, -5, 10, 0),
    },
  ];

  for (const item of announcements) {
    const id = Number(
      insertAnnouncement.run(item.title, item.body, item.audience, iso(item.at), staff.id)
        .lastInsertRowid,
    );
    for (const student of students) {
      if (item.audience === 'all' || item.audience === 'МЭО-3-1') {
        insertNotification.run(
          student.id,
          'announcement',
          id,
          item.title,
          item.body,
          `announcement:${id}:${student.id}`,
          item.at.getTime() < now.getTime() - 24 * 3600 * 1000 ? iso(item.at) : null,
          iso(item.at),
        );
      }
    }
  }

  insertNotification.run(
    student1.id,
    'request_status',
    request1,
    'Заявка №1: в работе',
    'Принята в работу, готовится.',
    `request:${request1}:seed`,
    null,
    iso(at(now, -1, 14, 10)),
  );
  insertNotification.run(
    student1.id,
    'request_status',
    request2,
    'Заявка №2: готова',
    'Готово, можно забрать в кабинете 214.',
    `request:${request2}:seed`,
    iso(at(now, -3, 9, 0)),
    iso(at(now, -4, 16, 20)),
  );
  insertNotification.run(
    student2.id,
    'request_status',
    request3,
    'Заявка №3: отклонена',
    'Нужна медицинская справка. Приложите её и подайте заново.',
    `request:${request3}:seed`,
    null,
    iso(at(now, -6, 12, 0)),
  );

  // Одна непрочитанная смена расписания для наглядности «что изменилось».
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
  insertNotification.run(
    student2.id,
    'schedule_change',
    null,
    'Перенос занятия',
    'Иностранный язык: перенесено на 14:00, аудитория 402.',
    `lesson:moved:${student2.id}:seed`,
    null,
    iso(at(now, -1, 18, 40)),
  );

  void todayOffset;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  seed();
  console.log(`Готово. Демо-пароль для всех аккаунтов: ${DEMO_PASSWORD}`);
  console.log('student1@demo.local — Анна Королёва, есть долги');
  console.log('student2@demo.local — Дмитрий Соколов, всё закрыто');
  console.log('staff@demo.local — Ирина Белова, деканат');
}
