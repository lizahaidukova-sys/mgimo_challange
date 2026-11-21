import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Вложения заявок лежат вне базы: файл на диске + строка метаданных в SQLite.
// Причины: база остаётся компактной (её бэкапят каждые 6 часов), а большое
// содержимое не раздувает WAL и не замедляет остальные запросы.

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// Разрешены только форматы, которые деканат реально принимает: скан или фото
// справки. PDF, JPEG, PNG и WebP. Исполняемые файлы и архивы — отказ,
// даже если браузер прислал «правильный» MIME.
const ALLOWED: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const storageRoot = process.env.ATTACHMENTS_DIR ?? path.resolve('./data/attachments');

export function attachmentExtension(mime: string): string | null {
  return ALLOWED[mime] ?? null;
}

export function attachmentStorageRoot(): string {
  fs.mkdirSync(storageRoot, { recursive: true });
  return storageRoot;
}

/**
 * Сохраняет файл под случайным именем: исходное имя приходит от пользователя и
 * не должно попадать в путь (иначе `../../etc/passwd`).
  */
export function saveAttachmentFile(
  requestId: number,
  buffer: Buffer,
  mime: string,
): { storagePath: string; fileNameOnDisk: string } {
  const extension = attachmentExtension(mime);
  if (!extension) throw new Error('unsupported mime');

  const dir = path.join(attachmentStorageRoot(), String(requestId));
  fs.mkdirSync(dir, { recursive: true });

  const fileNameOnDisk = `${crypto.randomUUID()}.${extension}`;
  const absolute = path.join(dir, fileNameOnDisk);
  fs.writeFileSync(absolute, buffer, { mode: 0o600 });

  // В базе храним путь относительно корня вложений: перенос каталога
  // не ломает ссылки, а абсолютный путь не утекает в ответы API.
  return { storagePath: path.join(String(requestId), fileNameOnDisk), fileNameOnDisk };
}

export function readAttachmentFile(storagePath: string): Buffer | null {
  const root = attachmentStorageRoot();
  const absolute = path.resolve(root, storagePath);
  // Защита от выхода за пределы каталога, даже если в базе окажется «../».
  if (!absolute.startsWith(path.resolve(root) + path.sep)) return null;
  try {
    return fs.readFileSync(absolute);
  } catch {
    return null;
  }
}

export function deleteAttachmentFile(storagePath: string): void {
  const absolute = path.resolve(attachmentStorageRoot(), storagePath);
  try {
    fs.unlinkSync(absolute);
  } catch {
    // Файла уже нет — для удаления записи это не ошибка.
  }
}

// Имя для заголовка Content-Disposition: кириллица требует filename*=UTF-8''.
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
