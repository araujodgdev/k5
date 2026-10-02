import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = (await readFile(resolve('../../docs/manual-lume.md'), 'utf8')).replace(/\r\n/g, '\n');
const version = createHash('sha256').update(source).digest('hex').slice(0, 20);
const slug = (title: string) => title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sections = source.split(/^## /m).slice(1).map(section => {
  const end = section.indexOf('\n');
  const title = section.slice(0, end).trim();
  const content = section.slice(end).trim();
  if (Buffer.byteLength(content, 'utf8') > 12_000) throw new Error(`Divida a seção ${title} antes de indexar.`);
  return { id: createHash('sha256').update(`${version}:${title}`).digest('hex').slice(0, 40), title, content, href: `/manual-lume.md#${slug(title)}` };
});
if (!sections.length) throw new Error('O manual precisa de seções.');
await mkdir('src/lib/platform-help', { recursive: true });
const json = `${JSON.stringify({ version, model: '@cf/baai/bge-m3', dimensions: 1024, sections }, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const [compiled, manual] = await Promise.all([
    readFile('src/lib/platform-help/content.json', 'utf8'),
    readFile('public/manual-lume.md', 'utf8'),
  ]);
  if (compiled.replace(/\r\n/g, '\n') !== json || manual.replace(/\r\n/g, '\n') !== source) throw new Error('Execute pnpm help:generate para atualizar o manual compilado.');
} else {
  await writeFile('src/lib/platform-help/content.json', json);
  await writeFile('public/manual-lume.md', source);
}
console.log(JSON.stringify({ version, sections: sections.length }));
