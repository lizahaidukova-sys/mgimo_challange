import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

// Встроенный модуль node:sqlite (Node 22.5+): без нативной сборки,
// без node-gyp и без prebuilt-бинарников под конкретную платформу.
// Поэтому `npm ci` на чистой машине не требует Visual Studio или компилятора.

const dbPath = process.env.DATABASE_PATH ?? './data/app.db';
if (dbPath !== ':memory:') {
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
}

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Обёртка над транзакцией: node:sqlite не имеет db.transaction(), как у better-sqlite3.
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Колонки добавляются в уже существующие базы: пересоздавать её на сервере нельзя.
function addColumnIfMissing(table: string, column: string, ddl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

// SQLite не умеет менять CHECK через ALTER TABLE. База, созданная до роли admin,
// хранит CHECK (role IN ('student','staff')) и отвергнет администратора при вставке.
// Пересоздаём таблицу с тем же набором колонок: id и внешние ключи сохраняются,
// потому что ссылающиеся таблицы по-прежнему указывают на имя `users`.
function widenUsersRoleCheck(): void {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
    .get() as { sql: string } | undefined;
  if (!row || row.sql.includes("'admin'")) return;

  // PRAGMA бесполезен внутри транзакции — переключаем до её начала.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    transaction(() => {
      db.exec(`
        CREATE TABLE users_migrated (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('student','staff','admin')),
          full_name TEXT NOT NULL,
          faculty TEXT NOT NULL DEFAULT '',
          program TEXT NOT NULL DEFAULT '',
          course INTEGER NOT NULL DEFAULT 1,
          group_name TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        INSERT INTO users_migrated (id, email, password_hash, role, full_name, faculty, program, course, group_name, created_at)
          SELECT id, email, password_hash, role, full_name, faculty, program, course, group_name, created_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_migrated RENAME TO users;
      `);
    });
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  // Строки, ссылающиеся на удалённого пользователя, не должны остаться сиротами.
  const broken = db.prepare(`PRAGMA foreign_key_check`).all();
  if (broken.length > 0) {
    throw new Error(`миграция users нарушила внешние ключи: ${broken.length} строк`);
  }
}

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('student','staff','admin')),
      full_name TEXT NOT NULL,
      faculty TEXT NOT NULL DEFAULT '',
      program TEXT NOT NULL DEFAULT '',
      course INTEGER NOT NULL DEFAULT 1,
      group_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      building TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      credits INTEGER NOT NULL DEFAULT 3,
      control_form TEXT NOT NULL CHECK (control_form IN ('exam','pass'))
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id),
      room_id INTEGER NOT NULL REFERENCES rooms(id),
      group_name TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'лекция',
      status TEXT NOT NULL DEFAULT 'normal' CHECK (status IN ('normal','moved','cancelled')),
      note TEXT,
      previous_starts_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_lessons_group_date ON lessons(group_name, starts_at);

    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id INTEGER NOT NULL REFERENCES courses(id),
      grade INTEGER,
      status TEXT NOT NULL CHECK (status IN ('passed','pending','debt','failed')),
      retake_count INTEGER NOT NULL DEFAULT 0,
      debt_since TEXT,
      debt_deadline TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE (user_id, course_id)
    );
    CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id);

    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      template TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'submitted',
      due_at TEXT NOT NULL,
      staff_comment TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);

    CREATE TABLE IF NOT EXISTS request_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      comment TEXT,
      actor_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_request_events_request ON request_events(request_id);

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      audience TEXT NOT NULL DEFAULT 'all',
      published_at TEXT NOT NULL,
      author_id INTEGER NOT NULL REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      ref_id INTEGER,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      dedupe_key TEXT UNIQUE,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id INTEGER,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);

    CREATE TABLE IF NOT EXISTS semesters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      number INTEGER NOT NULL,
      starts_on TEXT NOT NULL,
      ends_on TEXT NOT NULL,
      session_ends_on TEXT NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS retake_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id),
      room_id INTEGER NOT NULL REFERENCES rooms(id),
      starts_at TEXT NOT NULL,
      duration_min INTEGER NOT NULL DEFAULT 90,
      capacity INTEGER NOT NULL DEFAULT 8,
      comment TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_retake_slots_date ON retake_slots(starts_at);

    CREATE TABLE IF NOT EXISTS retake_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot_id INTEGER NOT NULL REFERENCES retake_slots(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      UNIQUE (slot_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_id INTEGER REFERENCES requests(id),
      kind TEXT NOT NULL,
      number TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      valid_until TEXT,
      issued_by TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      amount INTEGER NOT NULL,
      period TEXT NOT NULL,
      paid_at TEXT,
      status TEXT NOT NULL DEFAULT 'paid'
    );
    CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at);

    -- Файлы, приложенные студентом к заявке: справка от врача, скан, фото.
    -- Содержимое лежит отдельным файлом на диске (storage_path), в базе — только
    -- метаданные. Так база остаётся маленькой, а бэкап базы не тянет гигабайты.
    CREATE TABLE IF NOT EXISTS request_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_request_attachments_request ON request_attachments(request_id);
  `);

  // Колонки, добавленные позже: нужны для зачётки и объявлений по группам.
  addColumnIfMissing('courses', 'hours', 'INTEGER');
  addColumnIfMissing('enrollments', 'semester_id', 'INTEGER');
  addColumnIfMissing('enrollments', 'hours', 'INTEGER');
  addColumnIfMissing('requests', 'priority', "TEXT NOT NULL DEFAULT 'normal'");

  // После CREATE TABLE IF NOT EXISTS: на существующей базе таблица уже есть,
  // и CHECK в ней всё ещё старый.
  widenUsersRoleCheck();
}

migrate();

export function audit(
  actorId: number | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  meta: Record<string, unknown> = {},
): void {
  db.prepare(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, meta_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    actorId,
    action,
    entity,
    entityId === null ? null : String(entityId),
    JSON.stringify(meta),
    new Date().toISOString(),
  );
}
