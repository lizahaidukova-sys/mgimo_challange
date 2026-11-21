# Деплой на VPS

Выполняется, когда заказчик передаст сервер. До этого всё работает локально.

## 1. Что нужно

| Параметр | Требование |
|---|---|
| ОС | Linux, systemd |
| Node.js | 22+ |
| Память | 512 МБ достаточно |
| Порт | 8787 внутри, снаружи — 80/443 через reverse proxy |
| Домен | любой; можно без домена по IP, но тогда `Secure`-cookie требует HTTPS |

## 2. Порядок

Одной командой (идемпотентно, повторный запуск обновляет код):

```bash
REPO=https://github.com/<user>/<repo>.git DOMAIN=dean.example.ru bash deploy/install.sh
```

**Известная ловушка.** `npm ci` на сервере падает с «Missing: @emnapi/core from lock file»:
`package-lock.json` собран на Windows и не содержит платформенных optional-зависимостей
Tailwind для Linux. Установщик поэтому использует `npm install`. Если лок-файл
пересобран на Linux — можно вернуться к `npm ci`.

Скрипт делает всё из разделов 3–4: пользователя, Node, клон, `npm ci`, сборку,
`.env` со случайным секретом, сид, systemd, Caddy. Если `DOMAIN` не задан —
поднимает только приложение на `http://<IP>:8787`.

Вручную, если нужен контроль на каждом шаге:

```bash
sudo useradd -r -m -d /opt/dean dean || true
sudo mkdir -p /opt/dean/app && sudo chown -R dean:dean /opt/dean
sudo -u dean git clone <repo> /opt/dean/app
cd /opt/dean/app
sudo -u dean npm ci            # без компилятора: нативных зависимостей нет
sudo -u dean npm run build
sudo -u dean cp .env.example .env
# вписать SESSION_SECRET (openssl rand -hex 32) и APP_ORIGIN
sudo -u dean npm run seed
sudo -u dean PORT=8787 npm start
curl -s localhost:8787/api/health
```

## 3. systemd

Готовый файл: `deploy/dean.service`.

`/etc/systemd/system/dean.service`:

```ini
[Unit]
Description=Digital Dean prototype
After=network.target

[Service]
Type=simple
User=dean
WorkingDirectory=/opt/dean/app
EnvironmentFile=/opt/dean/app/.env
Environment=NODE_ENV=production
Environment=PORT=8787
ExecStart=/usr/bin/npx tsx server/index.ts
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dean
sudo systemctl status dean --no-pager
journalctl -u dean -n 50 --no-pager
```

## 4. Reverse proxy

Готовый файл: `deploy/Caddyfile`.

Вариант с Caddy (TLS автоматически):

```caddyfile
dean.example.ru {
    encode gzip
    reverse_proxy 127.0.0.1:8787
}
```

Если 443 занят другим процессом (на проверенном сервере порт держал `rclone`), сначала освободить порт либо слушать 8443 и проксировать на него.

## 4a. Фактический деплой (21.11.2026)

| Параметр | Значение |
|---|---|
| Сервер | 62.109.16.195, Ubuntu 24.04.5 LTS, 3.8 ГБ RAM, 59 ГБ диск |
| Домен | https://khaydukova.bitinterkgm.com (A-запись указывает на сервер) |
| TLS | Let's Encrypt, выпущен Caddy, действует до 19.02.2027 |
| Node | v22.23.5 |
| Caddy | v2.11.9 |
| Приложение | systemd `dean.service`, порт 8787, пользователь `dean` |
| Открыто | 80, 443, 22; ufw активен |
| Время ответа из РФ | 83 мс |

Проверено на живом домене:

| Проверка | Результат |
|---|---|
| `GET /` | 200 |
| `GET /api/health` | 200 |
| Вход всеми тремя аккаунтами | 200 |
| Cookie | `HttpOnly; Secure; SameSite=Lax` |
| Чужая заявка под студентом 1 | 404 |
| Staff-очередь под студентом | 403 |
| Мобильная вёрстка 360 px, 7 экранов | прокрутки нет, цели ≥ 44 px |
| Создание заявки | 201, появилась в очереди деканата |
| Смена статуса сотрудником | 200, студент получил уведомление |
| `robots.txt`, `noindex` | на месте |
| Доступ с зарубежного IP (Финляндия) | 200 |

## 5. Приёмка

| Проверка | Как | Ожидание |
|---|---|---|
| Доступ из РФ без VPN | открыть с российского IP | страница входа, без ошибок |
| Вход студента 1 | кнопка тестового аккаунта | главная с долгами |
| Вход студента 2 | другой аккаунт | другие данные, свой светофор |
| Чужая заявка | `/requests/3` под первым студентом | «Заявка не найдена» |
| Заявка и статус | создать, зайти сотрудником, сменить статус | студент видит новый статус |
| 360 px | DevTools или телефон | без горизонтальной прокрутки |
| Cookie | DevTools → Application | `HttpOnly`, `SameSite=Lax`, `Secure` |
| Секреты | `rg 'sk-|LLM_API_KEY' .next dist` | пусто |

## 6. Ограничения прототипа на сервере

- База — один файл, бэкап: `cp data/app.db data/backup-$(date +%F).db`.
- Перезапуск не теряет данные: SQLite в WAL, файл вне git.
- Сброс демо: `sudo -u dean npm run seed`.
- Логи не содержат паролей и payload'ов; пишется только факт входа и действий.

## 7. Если сервер недоступен из РФ

Запасной вариант — российский хостинг (Timeweb, Beget, Selectel), тот же порядок. Требование конкурса: прототип открывается из России без VPN до 28.11.
