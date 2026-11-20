import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/input';

export default function StaffAnnouncementsPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (title.trim().length < 3) {
      setError('Заголовок — не короче 3 символов');
      return;
    }
    if (body.trim().length < 5) {
      setError('Текст объявления слишком короткий');
      return;
    }
    setPending(true);
    try {
      await api.post('/api/staff/announcements', { title, body, audience });
      toast.success('Объявление опубликовано и разослано');
      navigate('/staff');
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : 'Не удалось опубликовать';
      setError(message);
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold sm:text-2xl">Новое объявление</h1>

      <Card>
        <CardHeader>
          <CardTitle>Объявление</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate>
            <div className="mb-3">
              <Label htmlFor="title">Заголовок</Label>
              <Input
                id="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={140}
                placeholder="Например: график пересдач"
                aria-invalid={Boolean(error)}
              />
            </div>
            <div className="mb-3">
              <Label htmlFor="body">Текст</Label>
              <Textarea
                id="body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                maxLength={2000}
                placeholder="Что и когда нужно сделать"
                aria-invalid={Boolean(error)}
              />
            </div>
            <div className="mb-3">
              <Label htmlFor="audience">Аудитория</Label>
              <Select
                id="audience"
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
              >
                <option value="all">Все студенты</option>
                <option value="МЭО-3-1">Группа МЭО-3-1</option>
              </Select>
            </div>

            <p className="mb-3 rounded-[8px] bg-[var(--bg)] p-3 text-xs text-[var(--muted)]">
              Объявление появится в уведомлениях получателей. Повторная публикация не создаёт
              дубликатов.
            </p>

            <FieldError>{error}</FieldError>

            <Button type="submit" className="mt-3 w-full" disabled={pending}>
              <Send className="size-4" />
              {pending ? 'Публикуем…' : 'Опубликовать'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
