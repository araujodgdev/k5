import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { database } from '@/lib/database';
import type { InstallationRef } from '@/lib/judicial/contracts';
import { ResearchError } from './contracts';
import { canUseResearchSource } from './policy';
import { findInstallation } from '@/lib/judicial/repositories/installations';
import { getResearchOriginal, putResearchOriginal } from './storage';
import { assertResearchLease, claimResearchJob, completeResearchJob, deferResearchJob, failResearchJob, renewResearchLease, type ResearchJobRow } from './jobs';

const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 300;
const MAX_OCR_PIXELS = 16_000_000;
const MAX_PAGE_TEXT_CHARS = 200_000;
const MAX_PAGES_PER_PASS = 8;
const MAX_PASS_MS = 60_000;
const MAX_PAGE_MS = 30_000;
const extractionWorkerId = `research-extract-${randomUUID()}`;

async function bounded<T>(promise: Promise<T>, timeoutMs: number, operation: string,
  lateCleanup?: (value: T) => Promise<unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  if (lateCleanup) void promise.then(value => { if (timedOut) void lateCleanup(value); }).catch(() => {});
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; reject(new ResearchError('unsupported', `${operation} excedeu o tempo limite.`)); }, timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function stageResearchPdf(installation: InstallationRef, judgmentId: string, bytes: Uint8Array,
  sourceUrl: string, collectedAt = new Date().toISOString()): Promise<string> {
  if (!canUseResearchSource(installation,'store_document')) throw new ResearchError('source_disabled','Documento não autorizado para o acervo.');
  if (bytes.length<8 || bytes.length>MAX_PDF_BYTES || Buffer.from(bytes.subarray(0,5)).toString('ascii')!=='%PDF-') {
    throw new ResearchError('invalid_input','PDF inválido ou acima de 50 MB.');
  }
  const material=await database.prepare(`SELECT m.id FROM research_material m JOIN research_judgment j ON j.id=m.judgment_id
    WHERE j.id=? AND j.installation_id=? AND j.status='active' AND m.kind='full_text'`)
    .get<{id:string}>(judgmentId,installation.id);
  if (!material) throw new ResearchError('not_found','Material não encontrado.');
  const metadata=await database.prepare(`SELECT tribunal,court_unit,case_number,title,decision_date,source_url,
    source_updated_at,metadata_revision FROM research_judgment WHERE id=?`).get<{
      tribunal:string;court_unit:string|null;case_number:string|null;title:string;decision_date:string|null;
      source_url:string|null;source_updated_at:string|null;metadata_revision:number;
    }>(judgmentId);
  if (!metadata) throw new ResearchError('not_found','Julgado não encontrado.');
  const key=await putResearchOriginal(bytes,'pdf');
  const currentSource=await findInstallation(installation.id);
  if (!currentSource || !canUseResearchSource(currentSource,'store_document')) {
    throw new ResearchError('source_disabled','Fonte deixou de permitir guardar o PDF.');
  }
  const versionId=randomUUID();
  await database.prepare(`INSERT INTO research_material_version
    (id,material_id,sha256,mime_type,byte_size,storage_key,text_content,parser_version,citation_metadata_json,
      metadata_revision,source_url,source_updated_at,collected_at)
    VALUES(?,?,?,'application/pdf',?,?,NULL,'research-pdf-v1',?,?,?,?,?)
    ON CONFLICT(material_id,sha256,parser_version,metadata_revision) DO NOTHING`)
    .run(versionId,material.id,sha(bytes),bytes.length,key,JSON.stringify({tribunal:metadata.tribunal,
      courtUnit:metadata.court_unit,caseNumber:metadata.case_number,title:metadata.title,
      decisionDate:metadata.decision_date,sourceUrl:metadata.source_url}),metadata.metadata_revision,
      sourceUrl,metadata.source_updated_at,collectedAt);
  const row=await database.prepare(`SELECT id,published_at FROM research_material_version WHERE material_id=? AND sha256=?
    AND parser_version='research-pdf-v1' AND metadata_revision=?`)
    .get<{id:string;published_at:string|null}>(material.id,sha(bytes),metadata.metadata_revision);
  if (!row) throw new Error('Falha ao preparar PDF.');
  if (!row.published_at) await database.prepare(`UPDATE research_material SET status='processing',updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND current_version_id IS NULL`).run(material.id);
  return row.id;
}

async function extractPages(bytes: Buffer, versionId: string, lease?:{job:ResearchJobRow;workerId:string}) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({data:new Uint8Array(bytes)});
  let pdf: Awaited<typeof task.promise>;
  try { pdf = await bounded(task.promise,MAX_PAGE_MS,'Abertura do PDF'); }
  catch (error) { await task.destroy(); throw error; }
  const sections: Array<{page:number;text:string;method:'text_layer'|'ocr'}> = [];
  if (pdf.numPages > MAX_PDF_PAGES) {
    await task.destroy();
    throw new ResearchError('unsupported','PDF acima do limite de 300 páginas para extração.');
  }
  let processed=0;
  const passStarted=Date.now();
  try {
    for (let page=1;page<=pdf.numPages;page++) {
      const cached=await database.prepare(`SELECT text_content,method FROM research_extract_checkpoint
        WHERE material_version_id=? AND page_number=?`).get<{text_content:string;method:'text_layer'|'ocr'}>(versionId,page);
      if (cached) { sections.push({page,text:cached.text_content,method:cached.method}); continue; }
      if (processed>=MAX_PAGES_PER_PASS || Date.now()-passStarted>=MAX_PASS_MS) return {sections,complete:false};
      if (lease && !await renewResearchLease(lease.job,lease.workerId)) throw new ResearchError('forbidden','Lease de extração expirado.');
      const rendered=await bounded(pdf.getPage(page),MAX_PAGE_MS,'Leitura da página');
      try {
        const textLayer=await bounded(rendered.getTextContent(),MAX_PAGE_MS,'Leitura do texto');
        let content=textLayer.items.map(item => 'str' in item ? item.str : '').join(' ').replace(/\s+/g,' ').trim();
        let method:'text_layer'|'ocr'='text_layer';
        if (!content) {
          const viewport=rendered.getViewport({scale:1.5});
          if (viewport.width*viewport.height>MAX_OCR_PIXELS) throw new ResearchError('unsupported','Página acima do limite de renderização OCR.');
          const {createCanvas}=await import('@napi-rs/canvas');
          const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
          await bounded(rendered.render({canvas,canvasContext:canvas.getContext('2d'),viewport} as never).promise,
            MAX_PAGE_MS,'Renderização OCR');
          const {createWorker}=await import('tesseract.js');
          const worker=await bounded(createWorker(['por','eng']),MAX_PAGE_MS,'Inicialização OCR',value=>value.terminate());
          try {
            content=(await bounded(worker.recognize(canvas.toBuffer('image/png')),MAX_PAGE_MS,'Reconhecimento OCR'))
              .data.text.replace(/\s+/g,' ').trim();
          } finally { await worker.terminate(); }
          method='ocr';
        }
        if (content.length>MAX_PAGE_TEXT_CHARS) throw new ResearchError('unsupported','Página acima do limite de texto extraído.');
        if (lease && !await renewResearchLease(lease.job,lease.workerId)) throw new ResearchError('forbidden','Lease de extração expirado.');
        await database.prepare(`INSERT OR IGNORE INTO research_extract_checkpoint
          (material_version_id,page_number,text_content,method) VALUES(?,?,?,?)`).run(versionId,page,content,method);
        sections.push({page,text:content,method});
        processed++;
      } finally { rendered.cleanup(); }
    }
    return {sections,complete:true};
  } finally { await task.destroy(); }
}

async function publishExtracted(versionId:string, sections:Array<{page:number;text:string}>, lease:{job:ResearchJobRow;workerId:string}) {
  if (!await renewResearchLease(lease.job,lease.workerId)) throw new ResearchError('forbidden','Lease de extração expirado.');
  const row=await database.prepare(`SELECT v.id,v.material_id,v.published_at,m.judgment_id FROM research_material_version v
    JOIN research_material m ON m.id=v.material_id WHERE v.id=?`).get<{
      id:string;material_id:string;published_at:string|null;judgment_id:string;
    }>(versionId);
  if (!row || row.published_at) return;
  const text=sections.map((section)=>section.text).filter(Boolean).join('\n\n') || null;
  const statements=[
    database.prepare(`UPDATE research_material_version SET text_content=?,published_at=CURRENT_TIMESTAMP
      WHERE id=? AND published_at IS NULL`).bind(text,versionId),
    database.prepare(`UPDATE research_material SET current_version_id=?,status='ready',
      unavailable_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(versionId,text?null:'text_unavailable',row.material_id),
    database.prepare(`DELETE FROM research_fts WHERE material_version_id IN
      (SELECT id FROM research_material_version WHERE material_id=? AND id<>?)`).bind(row.material_id,versionId),
  ];
  let ordinal=0;
  for (const section of sections) {
    if (!section.text) continue;
    for (let offset=0;offset<section.text.length;offset+=1800) {
      const chunk=section.text.slice(offset,offset+1800);
      const digest=sha(`${versionId}:${ordinal}`);
      const id=`${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
      statements.push(database.prepare(`INSERT OR IGNORE INTO research_chunk
        (id,material_version_id,ordinal,text_content,reference,page_number) VALUES(?,?,?,?,?,?)`)
        .bind(id,versionId,ordinal,chunk,`página:${section.page}`,section.page));
      statements.push(database.prepare(`INSERT INTO research_fts(judgment_id,material_version_id,text_content)
        SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM research_fts WHERE material_version_id=? AND text_content=?)`)
        .bind(row.judgment_id,versionId,chunk,versionId,chunk));
      ordinal++;
    }
  }
  await database.batch(statements);
}

export async function processNextResearchExtraction(workerId=extractionWorkerId):Promise<boolean> {
  const job=await claimResearchJob(workerId,['extract_material']);
  if (!job) return false;
  try {
    const request=JSON.parse(job.request_json) as {versionId?:string};
    if (!request.versionId) throw new ResearchError('invalid_input','Job sem versão.');
    const row=await database.prepare(`SELECT v.storage_key,v.mime_type,v.published_at,v.material_id,m.kind,m.status,
      j.installation_id,j.status AS judgment_status
      FROM research_material_version v JOIN research_material m ON m.id=v.material_id
      JOIN research_judgment j ON j.id=m.judgment_id
      WHERE v.id=?`)
      .get<{storage_key:string;mime_type:string;published_at:string|null;material_id:string;
        kind:string;status:string;installation_id:string;judgment_status:string}>(request.versionId);
    if (!row || !row.storage_key || row.mime_type!=='application/pdf') throw new ResearchError('not_found','PDF não encontrado.');
    if (job.material_id!==row.material_id || job.installation_id!==row.installation_id || row.kind!=='full_text' ||
      row.status==='restricted' || row.judgment_status!=='active') throw new ResearchError('forbidden','Alvo do job mudou.');
    const member=await database.prepare('SELECT role FROM office_member WHERE office_id=? AND user_id=?')
      .get<{role:string}>(job.office_id,job.user_id);
    if (member?.role!=='administrator' && member?.role!=='lawyer') throw new ResearchError('forbidden','Solicitante perdeu acesso.');
    const source=await findInstallation(row.installation_id);
    if (!source || !canUseResearchSource(source,'store_document')) {
      throw new ResearchError('source_disabled','Fonte restringiu o material.');
    }
    if (!row.published_at) {
      const bytes=await getResearchOriginal(row.storage_key);
      const extraction=await extractPages(bytes,request.versionId,{job,workerId});
      if (!extraction.complete) {
        await deferResearchJob(job,workerId,'checkpoint',1_000);
        return true;
      }
      await assertResearchLease(job,workerId);
      const currentSource=await findInstallation(source.id);
      const liveMember=await database.prepare('SELECT role FROM office_member WHERE office_id=? AND user_id=?')
        .get<{role:string}>(job.office_id,job.user_id);
      if (!currentSource || !canUseResearchSource(currentSource,'store_document') ||
        (liveMember?.role!=='administrator' && liveMember?.role!=='lawyer')) {
        throw new ResearchError('forbidden','Autorização revogada durante a extração.');
      }
      await publishExtracted(request.versionId,extraction.sections,{job,workerId});
    }
    await completeResearchJob(job,workerId);
    return true;
  } catch(error) {
    if (error instanceof ResearchError && (error.code==='source_disabled' || error.code==='budget_exceeded')) {
      await deferResearchJob(job,workerId,error.code,15*60_000);
      return true;
    }
    await failResearchJob(job,workerId,error instanceof ResearchError?error.code:'extraction_failed',
      !(error instanceof ResearchError));
    return true;
  }
}
