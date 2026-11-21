import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { db } from './db';
import type { Role, SessionUser } from '../shared/types';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'dean_session';

// Секрет нужен как «перец» для хэша токена: утечка файла базы не даёт
// восстановить действующие токены. Без секрета сервер не стартует в production.
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';
if (!SESSION_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('SESSION_SECRET не задан: скопируйте .env.example в .env и заполните');
}
if (!SESSION_SECRET) {
  console.warn('[auth] SESSION_SECRET не задан — используется небезопасное значение для разработки');
}
const SECRET = SESSION_SECRET || 'dev-only-insecure-secret';

// Secure-cookie только по HTTPS. Если прототип открыт по http:// (IP без TLS),
// флаг Secure не даст браузеру отправить cookie, и вход будет «молча» ломаться.
function cookieIsSecure(): boolean {
  const origin = process.env.APP_ORIGIN?.trim();
  if (origin) return origin.startsWith('https://');
  return process.env.NODE_ENV === 'production';
}

export interface AuthedRequest extends Request {
  user?: SessionUser;
  sessionId?: number;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function tokenDigest(value: string): string {
  return crypto.createHmac('sha256', SECRET).update(value).digest('hex');
}

export function createSession(res: Response, userId: number): string {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`,
  ).run(userId, tokenDigest(token), expiresAt, new Date().toISOString());

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieIsSecure(),
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
  return token;
}

export function revokeSession(res: Response, sessionId: number): void {
  db.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(
    new Date().toISOString(),
    sessionId,
  );
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function readSession(token: string): { user: SessionUser; sessionId: number } | null {
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, s.revoked_at,
              u.id, u.email, u.role, u.full_name, u.faculty, u.program, u.course, u.group_name
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenDigest(token)) as
    | {
        session_id: number;
        expires_at: string;
        revoked_at: string | null;
        id: number;
        email: string;
        role: Role;
        full_name: string;
        faculty: string;
        program: string;
        course: number;
        group_name: string;
      }
    | undefined;

  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;

  return {
    sessionId: row.session_id,
    user: {
      id: row.id,
      email: row.email,
      role: row.role,
      fullName: row.full_name,
      faculty: row.faculty,
      program: row.program,
      course: row.course,
      groupName: row.group_name,
    },
  };
}

export function attachUser(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE_NAME];
  if (typeof token === 'string' && token.length > 0) {
    const session = readSession(token);
    if (session) {
      req.user = session.user;
      req.sessionId = session.sessionId;
    }
  }
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Требуется вход' });
    return;
  }
  next();
}

export function requireStaff(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Требуется вход' });
    return;
  }
  if (req.user.role !== 'staff') {
    res.status(403).json({ error: 'Недостаточно прав' });
    return;
  }
  next();
}

// Редактирование всей базы: отдельная роль, staff его не получает.
export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Требуется вход' });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Недостаточно прав' });
    return;
  }
  next();
}

// Лимит попыток входа: 10 на e-mail за 10 минут. Хранится в памяти процесса.
const attempts = new Map<string, { count: number; resetAt: number }>();

export function checkLoginRate(email: string): boolean {
  const now = Date.now();
  const entry = attempts.get(email);
  if (!entry || entry.resetAt < now) return true;
  return entry.count < 10;
}

export function noteLoginFailure(email: string): void {
  const now = Date.now();
  const entry = attempts.get(email);
  if (!entry || entry.resetAt < now) {
    attempts.set(email, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return;
  }
  entry.count += 1;
}

export function clearLoginFailures(email: string): void {
  attempts.delete(email);
}
