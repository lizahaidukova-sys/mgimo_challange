import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import {
  REQUEST_TYPE_LABEL,
  type RequestDetail,
  type RequestType,
} from '@shared/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, Input, Label, Textarea } from '@/components/ui/input';

const templates: { type: RequestType; description: string; due: string }[] = [
  {
    type: 'certificate_study',
    description: 'Подтверждает, что вы учитесь. Подходит для визы, банка, работодателя.',
    due: 'до 3 рабочих дней',
  },
  {
    type: 'certificate_scholarship',
    description: 'Для стипендиального отдела и социальных выплат.',
    due: 'до 5 рабочих дней',
  },
  {
    type: 'retake_application',
    description: 'Заявление на пересдачу с указанием причины и желаемой даты.',
    due: 'до 2 рабочих дней',
  },
];

const fieldsByType: Record<RequestType, { name: string; label: string; placeholder: string }[]> = {
  certificate_study: [
    { name: 'purpose', label: 'Для чего нужна справка', placeholder: 'Например, для оформления визы' },
    { name: 'addressee', label: 'Куда предоставить', placeholder: 'Консульство, банк, работодатель' },
    { name: 'format', label: 'Формат', placeholder: 'Бумажная с печатью или электронная' },
  ],
  certificate_scholarship: [
    { name: 'purpose', label: 'Для чего нужна справка', placeholder: 'Например, для социальной стипендии' },
    { name: 'addressee', label: 'Куда предоставить', placeholder: 'Стипендиальный отдел' },
    { name: 'format', label: 'Формат', placeholder: 'Бумажная с печатью или электронная' },
  ],
  retake_application: [
    { name: 'discipline', label: 'Дисциплина', placeholder: 'Например, Международная торговля' },
    { name: 'reason', label: 'Причина пересдачи', placeholder: 'Кратко, без личных данных' },
    { name: 'preferredDate', label: 'Желаемая дата', placeholder: 'Например, следующая неделя' },
  ],
};

export default function NewRequestPage() {
  const navigate = useNavigate();
  const [type, setType] = useState<RequestType>('certificate_study');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const fields = fieldsByType[type];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const missing = fields.find((field) => (values[field.name] ?? '').trim().length === 0);
    if (missing) {
      setError(`Заполните поле «${missing.label}»`);
      return;
    }

    setPending(true);
    try {
      const created = await api.post<RequestDetail>('/api/requests', {
        type,
        payload: Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim())),
      });
      toast.success(`Заявка №${created.id} подана`);
      navigate(`/requests/${created.id}`, { replace: true });
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'Не удалось подать заявку';
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <Link
        to="/requests"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-[var(--muted)] hover:text-[var(--fg)]"
      >
        <ArrowLeft className="size-4" />
        К заявкам
      </Link>

      <h1 className="text-xl font-semibold sm:text-2xl">Новая заявка</h1>

      <Card>
        <CardHeader>
          <CardTitle>Что нужно получить</CardTitle>
        </CardHeader>
        <CardContent>
          <fieldset>
            <legend className="sr-only">Тип заявки</legend>
            <div className="space-y-2">
              {templates.map((template) => (
                <label
                  key={template.type}
                  className={`flex cursor-pointer gap-3 rounded-[8px] border p-3 ${
                    type === template.type
                      ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                      : 'border-[var(--border)] bg-[var(--surface)]'
                  }`}
                >
                  <input
                    type="radio"
                    name="request-type"
                    value={template.type}
                    checked={type === template.type}
                    onChange={() => {
                      setType(template.type);
                      setValues({});
                      setError(null);
                    }}
                    className="mt-1 size-4"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{REQUEST_TYPE_LABEL[template.type]}</span>
                    <span className="block text-xs text-[var(--muted)]">{template.description}</span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">
                      Срок: {template.due}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Данные для заявки</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate>
            {fields.map((field, index) => (
              <div key={field.name} className={index === fields.length - 1 ? '' : 'mb-3'}>
                <Label htmlFor={field.name}>{field.label}</Label>
                {field.name === 'reason' ? (
                  <Textarea
                    id={field.name}
                    value={values[field.name] ?? ''}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.name]: event.target.value }))
                    }
                    placeholder={field.placeholder}
                    maxLength={500}
                  />
                ) : (
                  <Input
                    id={field.name}
                    value={values[field.name] ?? ''}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.name]: event.target.value }))
                    }
                    placeholder={field.placeholder}
                    maxLength={500}
                    aria-invalid={Boolean(error)}
                  />
                )}
              </div>
            ))}

            <p className="mb-3 rounded-[8px] bg-[var(--bg)] p-3 text-xs text-[var(--muted)]">
              Статус и срок будут видны в разделе «Заявки». Персональные данные не нужны: достаточно
              назначения и краткого описания.
            </p>

            <FieldError>{error}</FieldError>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row-reverse">
              <Button type="submit" disabled={pending} className="sm:flex-1">
                {pending ? 'Отправляем…' : 'Подать заявку'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate('/requests')}
                className="sm:flex-1"
              >
                Отмена
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
