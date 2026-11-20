import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Проверка, что секреты не попали в репозиторий и в клиентский бандл.
// Ищет по коду и конфигам, исключая node_modules, dist и .git.

const root = process.cwd();
const skipDirs = new Set(['node_modules', '.git', 'dist', 'data', '.next']);
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.html', '.css', '.env']);

const patterns: { name: string; regex: RegExp }[] = [
  { name: 'похоже на ключ OpenAI', regex: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'SESSION_SECRET с длинным значением', regex: /SESSION_SECRET\s*=\s*[A-Za-z0-9]{32,}/ },
  { name: 'LLM_API_KEY с длинным значением', regex: /LLM_API_KEY\s*=\s*[^\s'"`]{20,}/ },
  { name: 'пароль в открытом виде в коде', regex: /password\s*[:=]\s*['"][^'"]{6,}['"]/i },
];

// Легитимные исключения: демо-пароль конкурса и тестовые данные.
const allowed = [
  /password\s*[:=]\s*['"]demo12345['"]/i,
  /passwordHash|password_hash|hashPassword|verifyPassword/,
];

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (!skipDirs.has(entry)) walk(full, files);
      continue;
    }
    if (entry === '.env' || entry === '.env.local') continue;
    const dot = entry.lastIndexOf('.');
    const ext = dot === -1 ? '' : entry.slice(dot);
    if (extensions.has(ext) || entry.startsWith('.env')) files.push(full);
  }
  return files;
}

let problems = 0;
for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of patterns) {
    if (!pattern.regex.test(text)) continue;
    const lines = text.split('\n');
    lines.forEach((line, index) => {
      if (!pattern.regex.test(line)) return;
      if (allowed.some((allow) => allow.test(line))) return;
      problems += 1;
      console.log(`FAIL ${relative(root, file)}:${index + 1} — ${pattern.name}`);
    });
  }
}

// Клиентский бандл: там не должно быть серверных имён переменных.
try {
  const assets = readdirSync('dist/assets').filter((name) => name.endsWith('.js'));
  for (const asset of assets) {
    const text = readFileSync(join('dist/assets', asset), 'utf8');
    for (const needle of ['LLM_API_KEY', 'SESSION_SECRET', 'DATABASE_PATH']) {
      if (text.includes(needle)) {
        problems += 1;
        console.log(`FAIL dist/assets/${asset} — содержит ${needle}`);
      }
    }
  }
} catch {
  console.log('SKIP клиентский бандл не собран (dist/assets нет)');
}

if (problems > 0) {
  console.error(`\nНайдено проблем: ${problems}`);
  process.exit(1);
}
console.log('Секретов в репозитории и клиентском бандле не найдено.');
