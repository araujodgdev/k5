import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const priorDir = resolve(dir, '..');
const root = resolve(priorDir, '../../..');
const require = createRequire(resolve(root, 'apps/web/package.json'));
const PizZip = require('pizzip');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const previous = await json(resolve(priorDir, 'publication-result.json'));
const base = await json(resolve(priorDir, 'import-manifest.json'));
const collection = await json(resolve(priorDir, 'collection-manifest.json'));
const metadata = await json(resolve(priorDir, 'metadados20260922.json'));
const mirrors = await json(resolve(priorDir, '20260831.json'));
const zipBytes = await readFile(resolve(priorDir, 'textos20260922.zip'));
const entries = Object.values(new PizZip(zipBytes).files).filter(entry => !entry.dir);
const checkpoint = previous.checkpoint;
if (!checkpoint.publicationConfirmed || checkpoint.nextZipIndex !== 5 || checkpoint.nextMirrorIndex !== 3)
  throw new Error('Checkpoint anterior não corresponde ao lote esperado.');
const metadataById = new Map(metadata.map(item => [String(item.SeqDocumento), item]));
if (metadataById.size !== metadata.length) throw new Error('SeqDocumento duplicado nos metadados.');
const topicByKey = new Map(base.topics.map(topic => [topic.key, topic]));
const subjectKeys = item => [...new Set((item.assuntos ?? '').split(/[,;.]/).map(part => part.trim())
  .filter(Boolean).map(part => `cnj:${Number(part)}`))];
const cleanHtml = value => value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').trim();
const metaResource = collection.resources[0];
const zipResource = collection.resources[1];
const mirrorResource = collection.resources[2];
await mkdir(resolve(dir, 'documents'), { recursive: true });
const batch = { collectedAt: new Date().toISOString(), expectedPreviousRunId: previous.runId, records: [], topics: [], relations: [], originals: [], partition: {
  key: base.partition.key, query: base.partition.query, status: 'partial', checkpoint: {
    ...checkpoint, nextZipIndex: checkpoint.nextZipIndex, nextMirrorIndex: checkpoint.nextMirrorIndex,
    status: 'prepared_not_published', publicationConfirmed: false, remotePersistence: 'pending',
    previousPublicationRunId: previous.runId, publicationRunId: null,
  } } };
const verification = { previousRunId: previous.runId, resourceHashes: { zip: hash(zipBytes) }, documents: [] };
const previouslyPublished = new Set(previous.records.map(record => record.sourceJudgmentId));
for (let index = checkpoint.nextZipIndex; index < Math.min(entries.length, checkpoint.nextZipIndex + 10); index++) {
  const entry = entries[index];
  const id = entry.name.replace(/\.txt$/, '');
  if (!/^\d+$/.test(id)) throw new Error(`Nome de documento inesperado: ${entry.name}`);
  const sourceJudgmentId = `stj-dje:${id}`;
  if (previouslyPublished.has(sourceJudgmentId)) throw new Error('Íntegra já publicada no lote anterior.');
  const item = metadataById.get(id);
  if (!item) throw new Error(`Documento sem metadados: ${id}`);
  const bytes = entry.asNodeBuffer();
  const raw = bytes.toString('utf8');
  const text = cleanHtml(raw);
  if (text.length < 100 || !/^(DECISÃO|ACÓRDÃO)/.test(text)) throw new Error(`Conteúdo não reconhecido: ${id}`);
  const originalPath = resolve(dir, 'documents', `dje-${id}.html`);
  const textPath = resolve(dir, 'documents', `dje-${id}.txt`);
  await writeFile(originalPath, bytes);
  await writeFile(textPath, text);
  batch.records.push({ sourceJudgmentId, tribunal: 'STJ', courtUnit: null, caseNumber: item.processo,
    className: item.processo.replace(/\s+\d.*$/, ''), rapporteur: item.NM_MINISTRO ?? null,
    title: item.processo, decisionDate: null, sourceUpdatedAt: zipResource.lastModified,
    sourceUrl: zipResource.url, ementa: null, fullText: text, fullTextStatus: 'ready' });
  batch.originals.push({ path: originalPath, extension: 'html', sourceJudgmentId, kind: 'full_text',
    captureMethod: 'official_download', sha256: hash(bytes), sourceUrl: zipResource.url });
  for (const topicKey of subjectKeys(item)) {
    if (!topicByKey.has(topicKey)) throw new Error(`Assunto sem catálogo: ${topicKey}`);
    batch.relations.push({ sourceJudgmentId, topicKey, provenance: 'official_metadata', sourceUrl: metaResource.url });
  }
  verification.documents.push({ sourceJudgmentId, sourceIndex: index, nativeId: id,
    metadata: item, originalSha256: hash(bytes), textSha256: hash(Buffer.from(text)),
    originalBytes: bytes.length, textBytes: Buffer.byteLength(text), textPath, originalPath });
  batch.partition.checkpoint.nextZipIndex = index + 1;
}
for (let index = checkpoint.nextMirrorIndex; index < Math.min(mirrors.length, checkpoint.nextMirrorIndex + 5); index++) {
  const item = mirrors[index];
  const sourceJudgmentId = item.id;
  if (!sourceJudgmentId || previouslyPublished.has(sourceJudgmentId) || !item.ementa?.trim())
    throw new Error(`Espelho inválido ou repetido no índice ${index}`);
  const ementa = cleanHtml(item.ementa).replace(/\s+/g, ' ').trim();
  const textPath = resolve(dir, 'documents', `mirror-${sourceJudgmentId}-ementa.txt`);
  await writeFile(textPath, ementa);
  batch.records.push({ sourceJudgmentId, tribunal: 'STJ', courtUnit: item.nomeOrgaoJulgador,
    caseNumber: item.numeroProcesso, className: item.descricaoClasse, rapporteur: item.ministroRelator,
    title: `${item.siglaClasse} ${item.numeroProcesso}`,
    decisionDate: item.dataDecisao.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'),
    sourceUpdatedAt: mirrorResource.lastModified, sourceUrl: mirrorResource.url,
    ementa, fullText: null, fullTextStatus: 'pending' });
  verification.documents.push({ sourceJudgmentId, sourceIndex: index, nativeId: item.id,
    metadata: item, textSha256: hash(Buffer.from(ementa)), textBytes: Buffer.byteLength(ementa), textPath });
  batch.partition.checkpoint.nextMirrorIndex = index + 1;
}
const usedKeys = new Set(batch.relations.map(relation => relation.topicKey));
for (const key of usedKeys) {
  let parent = topicByKey.get(key)?.parentKey;
  while (parent && !usedKeys.has(parent)) { usedKeys.add(parent); parent = topicByKey.get(parent)?.parentKey; }
}
batch.topics = base.topics.filter(topic => usedKeys.has(topic.key));
if (new Set(batch.records.map(record => record.sourceJudgmentId)).size !== batch.records.length)
  throw new Error('Identificadores duplicados no lote.');
const queue = new Map();
for (let index = 0; index < entries.length; index++) {
  const id = entries[index].name.replace(/\.txt$/, '');
  const item = metadataById.get(id);
  const keys = subjectKeys(item);
  for (const key of keys.length ? keys : ['unclassified']) {
    if (!queue.has(key)) queue.set(key, { topicKey: key, label: topicByKey.get(key)?.label ?? null, documents: [] });
    queue.get(key).documents.push({ sourceJudgmentId: `stj-dje:${id}`, zipIndex: index,
      status: index < checkpoint.nextZipIndex ? 'published_previous_batch' :
        index < batch.partition.checkpoint.nextZipIndex ? 'prepared_pending_publication' : 'pending' });
  }
}
const progress = { fullTextsPrepared: batch.records.filter(record => record.fullText).length,
  ementasPrepared: batch.records.filter(record => record.ementa).length, topicsInBatch: batch.topics.length,
  relations: batch.relations.length, topicQueues: queue.size,
  nextZipIndex: batch.partition.checkpoint.nextZipIndex, zipTotal: entries.length,
  nextMirrorIndex: batch.partition.checkpoint.nextMirrorIndex, mirrorTotal: mirrors.length,
  fulltextMetadataWithoutFileInThisZip: metadata.length - entries.length, status: 'prepared_not_published' };
await writeFile(resolve(dir, 'import-manifest.json'), JSON.stringify(batch, null, 2));
await writeFile(resolve(dir, 'verification.json'), JSON.stringify(verification, null, 2));
await writeFile(resolve(dir, 'topic-queue.json'), JSON.stringify({ source: metaResource.url, queue: [...queue.values()], mirrorTopicStatus: 'unclassified_pending_official_evidence' }, null, 2));
await writeFile(resolve(dir, 'progress.json'), JSON.stringify(progress, null, 2));
console.log(JSON.stringify(progress));
