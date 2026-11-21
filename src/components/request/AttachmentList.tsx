import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileUp, Paperclip } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { RequestAttachment } from '@shared/types';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/input';

// Деканат может потребовать справку (например, медицинскую) — студент
// прикладывает файл прямо в карточке заявки. Тот же список видят сотрудники.

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_HINT = 'PDF, JPEG, PNG или WebP до 5 МБ';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function AttachmentList({
  requestId,
  attachments,
  canUpload,
  onUploaded,
  downloadBase,
}: {
  requestId: number;
  attachments: RequestAttachment[];
  canUpload: boolean;
  onUploaded: () => void;
  /** Базовый путь скачивания: у студента свой, у деканата — staff-маршрут. */
  downloadBase?: string;
}) {
  const base = downloadBase ?? `/api/requests/${requestId}/attachments`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function upload(file: File) {
    setError(null);
    // Проверяем на клиенте, чтобы не гонять 5 МБ зря; сервер проверяет повторно.
    if (!ALLOWED.includes(file.type)) {
      setError(`Формат не подходит. Допустимы: ${ALLOWED_HINT}`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`Файл больше 5 МБ (${formatSize(file.size)}). Сожмите скан или сфотографируйте страницу.`);
      return;
    }
    setPending(true);
    try {
      await api.upload(`/api/requests/${requestId}/attachments`, file);
      toast.success('Документ приложен');
      onUploaded();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'Не удалось приложить документ';
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      {attachments.length > 0 ? (
        <ul className="space-y-2">
          {attachments.map((file) => (
            <li key={file.id}>
              <a
                href={`${base}/${file.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center gap-2 rounded-[8px] border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)]"
              >
                <Paperclip className="size-4 shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1 break-words font-medium">{file.fileName}</span>
                <span className="shrink-0 text-xs text-[var(--muted)]">{formatSize(file.size)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--muted)]">
          {canUpload
            ? 'Файлов пока нет. Если деканат просит справку, приложите её здесь.'
            : 'Файлов нет.'}
        </p>
      )}

      {canUpload ? (
        <div className="mt-3">
          <input
            ref={inputRef}
            id={`attachment-${requestId}`}
            type="file"
            accept={ALLOWED.join(',')}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
          >
            <FileUp className="size-4" />
            {pending ? 'Загружаем…' : 'Приложить документ'}
          </Button>
          <p className="mt-1.5 text-xs text-[var(--muted)]">{ALLOWED_HINT}</p>
        </div>
      ) : null}

      <FieldError>{error}</FieldError>
    </div>
  );
}
