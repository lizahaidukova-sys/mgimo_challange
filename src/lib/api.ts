// Тонкий клиент API. Ошибки приводятся к человеческому тексту,
// 401 поднимается как специальный класс, чтобы UI увёл на вход.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Сервер недоступен или ответил 5xx — это не «сессия истекла» и не «нет прав».
// Отдельный класс нужен, чтобы UI не отправлял человека на экран входа зря.
export class TransportError extends Error {
  constructor(message = 'Сервер недоступен. Проверьте соединение и повторите.') {
    super(message);
  }
}

async function parseError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (data?.error) return data.error;
  } catch {
    // тело не JSON — используем общий текст
  }
  if (response.status === 401) return 'Требуется вход';
  if (response.status === 403) return 'Недостаточно прав';
  if (response.status === 404) return 'Не найдено';
  return 'Не удалось выполнить запрос. Повторите.';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
      ...init,
    });
  } catch {
    throw new TransportError();
  }
  if (!response.ok) {
    if (response.status >= 500) throw new TransportError();
    throw new ApiError(await parseError(response), response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
};
