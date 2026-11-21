#!/usr/bin/env bash
# Установка прототипа на чистый сервер Ubuntu/Debian.
# Запускать от пользователя с sudo. Идемпотентно: повторный запуск обновляет код.
#
#   REPO=https://github.com/<user>/<repo>.git bash deploy/install.sh
#
# Переменные:
#   REPO   — ссылка на репозиторий (обязательна)
#   DOMAIN — домен для Caddy; если пусто, наружу отдаётся http://IP:8787

set -euo pipefail

APP_USER=dean
APP_DIR=/opt/dean/app
REPO="${REPO:?укажите REPO=<ссылка на репозиторий>}"
DOMAIN="${DOMAIN:-}"

echo "== 1/7 пользователь и каталоги =="
if ! id "$APP_USER" >/dev/null 2>&1; then
  sudo useradd -r -m -d /opt/dean -s /usr/sbin/nologin "$APP_USER"
fi
sudo mkdir -p "$APP_DIR"
sudo chown -R "$APP_USER:$APP_USER" /opt/dean

echo "== 2/7 Node.js 22 =="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

echo "== 3/7 код =="
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --all
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard origin/HEAD
else
  sudo -u "$APP_USER" git clone "$REPO" "$APP_DIR"
fi

echo "== 4/7 зависимости и сборка =="
cd "$APP_DIR"
# npm ci не подходит: package-lock собран на Windows и не содержит
# платформенных optional-зависимостей (Tailwind oxide WASM для Linux).
sudo -u "$APP_USER" npm install --no-audit --no-fund
sudo -u "$APP_USER" npm run build

echo "== 5/7 конфигурация =="
if [ ! -f "$APP_DIR/.env" ]; then
  sudo -u "$APP_USER" cp .env.example .env
  SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  sudo -u "$APP_USER" sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=${SECRET}|" .env
  if [ -n "$DOMAIN" ]; then
    sudo -u "$APP_USER" sed -i "s|^APP_ORIGIN=.*|APP_ORIGIN=https://${DOMAIN}|" .env
  else
    IP="$(curl -fsS https://api.ipify.org || echo localhost)"
    sudo -u "$APP_USER" sed -i "s|^APP_ORIGIN=.*|APP_ORIGIN=http://${IP}:8787|" .env
  fi
  echo "создан .env (секрет сгенерирован, значения не печатаются)"
else
  echo ".env уже существует — не трогаю"
fi

echo "== 6/7 демо-данные =="
sudo -u "$APP_USER" npm run seed

echo "== 7/7 сервис =="
sudo cp deploy/dean.service /etc/systemd/system/dean.service
sudo systemctl daemon-reload
sudo systemctl enable dean
sudo systemctl restart dean
sleep 2
curl -fsS "http://127.0.0.1:8787/api/health" && echo

if [ -n "$DOMAIN" ] && command -v caddy >/dev/null 2>&1; then
  sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
  sudo sed -i "s|dean.example.ru|${DOMAIN}|" /etc/caddy/Caddyfile
  sudo systemctl reload caddy
  echo "Caddy настроен на https://${DOMAIN}"
else
  echo "Caddy не установлен или домен не задан — прототип доступен по http://<IP>:8787"
  echo "Для TLS: sudo apt install caddy, затем повторить с DOMAIN=<домен>"
fi

echo
echo "Готово. Проверка:"
echo "  systemctl status dean --no-pager"
echo "  journalctl -u dean -n 50 --no-pager"
echo "  тестовые аккаунты: student1@demo.local / student2@demo.local / staff@demo.local, пароль demo12345"
