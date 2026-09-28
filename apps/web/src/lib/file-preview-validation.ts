import 'server-only';
import { inflateRawSync } from 'node:zlib';
import { CapabilityError } from '@/lib/capabilities/errors';

const invalid = () => new CapabilityError('INVALID', 'Este documento Office não permite uma prévia segura.');

function inspectOfficeZip(bytes: Buffer, extension: string) {
  if (!['.docx', '.xlsx', '.pptx'].includes(extension)) throw invalid();
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset--) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw invalid();
  const count = bytes.readUInt16LE(end + 10), start = bytes.readUInt32LE(end + 16);
  if (!count || count > 2000 || start >= end) throw invalid();
  const names = new Set<string>();
  let offset = start, expanded = 0;
  for (let entry = 0; entry < count; entry++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw invalid();
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28), extraLength = bytes.readUInt16LE(offset + 30), commentLength = bytes.readUInt16LE(offset + 32);
    const local = bytes.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    expanded += size;
    if (flags & 1 || ![0, 8].includes(method) || next > end || size > 16_000_000 || expanded > 50_000_000 || local + 30 > start) throw invalid();
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (names.has(name) || name.startsWith('/') || name.includes('..') || name.includes('\\') || /vbaProject|\.exe$/i.test(name)) throw invalid();
    names.add(name);
    if (bytes.readUInt32LE(local) !== 0x04034b50 || bytes.readUInt16LE(local + 8) !== method) throw invalid();
    const dataStart = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (dataStart + compressed > start) throw invalid();
    const data = bytes.subarray(dataStart, dataStart + compressed);
    const decoded = method === 0 ? data : inflateRawSync(data, { maxOutputLength: Math.max(1, size) });
    if (decoded.length !== size) throw invalid();
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      if (name.endsWith('.rels') && size > 1_000_000) throw invalid();
      const xml = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
      if (xml.includes('\0') || /<!DOCTYPE|<!ENTITY|macroEnabled/i.test(xml)) throw invalid();
    }
    offset = next;
  }
  const main = extension === '.docx' ? 'word/document.xml' : extension === '.xlsx' ? 'xl/workbook.xml' : 'ppt/presentation.xml';
  if (!names.has(main) || !names.has('[Content_Types].xml')) throw invalid();
}

export function validateOfficeZip(bytes: Buffer, extension: string) {
  try { inspectOfficeZip(bytes, extension); }
  catch { throw invalid(); }
}
