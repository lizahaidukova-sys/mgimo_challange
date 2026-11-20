import { readFileSync, writeFileSync } from 'node:fs';
import { marked } from 'marked';

// Собирает docs/09-jury-description.md в автономный HTML для печати в PDF.
// Картинки встраиваются как data: URI, чтобы PDF не зависел от путей.

const md = readFileSync('docs/09-jury-description.md', 'utf8');

const renderer = new marked.Renderer();
const image = renderer.image.bind(renderer);
renderer.image = (token) => {
  const href = token.href;
  if (!href || href.startsWith('http') || href.startsWith('data:')) return image(token);
  try {
    const buffer = readFileSync(`docs/${href}`);
    const mime = href.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return image({ ...token, href: `data:${mime};base64,${buffer.toString('base64')}` });
  } catch {
    return `<p><em>Скриншот не найден: ${href}</em></p>`;
  }
};

const body = marked.parse(md, { renderer, async: false }) as string;

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Цифровой деканат — описание работы</title>
<style>
  :root { --fg:#101828; --muted:#667085; --border:#e4e7ec; --accent:#1d4ed8; }
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: "Segoe UI", "Inter", system-ui, sans-serif; color: var(--fg); font-size: 11.5pt; line-height: 1.55; max-width: 100%; }
  h1 { font-size: 22pt; margin: 0 0 6pt; }
  /* Две картинки подряд читаются как пара, а не как две страницы. */
  p:has(> img) + p:has(> img) { display: inline-block; width: 48%; vertical-align: top; }
  p:has(> img) + p:has(> img) img { max-width: 100%; }
  h2 { font-size: 15pt; margin: 18pt 0 6pt; border-bottom: 1px solid var(--border); padding-bottom: 4pt; page-break-after: avoid; }
  h3 { font-size: 12.5pt; margin: 12pt 0 4pt; page-break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 10.5pt; page-break-inside: auto; }
  th, td { border: 1px solid var(--border); padding: 5pt 7pt; text-align: left; vertical-align: top; }
  th { background: #f7f8fa; font-weight: 600; }
  tr { page-break-inside: avoid; }
  code { background: #f2f4f7; padding: 1pt 4pt; border-radius: 3px; font-size: 10pt; }
  pre { background: #f7f8fa; border: 1px solid var(--border); padding: 8pt; border-radius: 6pt; overflow-x: auto; font-size: 9.5pt; page-break-inside: avoid; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 8pt 0; padding: 6pt 10pt; border-left: 3px solid var(--accent); background: #f7f9ff; color: var(--fg); }
  img { max-width: 72mm; border: 1px solid var(--border); border-radius: 4pt; display: block; margin: 8pt auto; page-break-inside: avoid; }
  hr { border: none; border-top: 1px solid var(--border); margin: 16pt 0; }
  a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>${body}</body>
</html>`;

writeFileSync('docs/jury.html', html);
console.log(`docs/jury.html готов: ${(html.length / 1024).toFixed(0)} КБ`);
