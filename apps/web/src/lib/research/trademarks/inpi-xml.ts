import { SaxesParser } from 'saxes';

import { inpiRecord, type InpiRecord } from './inpi-contracts';

type XmlNode = { name: string; attributes: Record<string, string>; text: string; children: XmlNode[] };
const child = (node: XmlNode, name: string) => node.children.find(value => value.name === name);
const children = (node: XmlNode | undefined, name: string) => node?.children.filter(value => value.name === name) ?? [];
const nodeText = (node: XmlNode | undefined): string => node ? [node.text, ...node.children.map(nodeText)].join('').trim() : '';
const optional = (value: string | undefined) => value?.trim() || null;

function record(node: XmlNode): InpiRecord {
  const mark = child(node, 'marca');
  const nice = child(node, 'lista-classe-nice');
  const vienna = child(node, 'classes-vienna');
  const holders = child(node, 'titulares');
  const fields: Record<string, string> = {};
  for (const [key, label] of [['data-deposito','Data do depósito'],['data-concessao','Data da concessão'],['data-vigencia','Vigência']] as const) {
    if (node.attributes[key]) fields[label] = node.attributes[key];
  }
  if (mark?.attributes.apresentacao) fields['Apresentação'] = mark.attributes.apresentacao;
  if (mark?.attributes.natureza) fields['Natureza'] = mark.attributes.natureza;
  for (const [tag, label] of [['procurador','Procurador'],['apostila','Apostila']] as const) {
    const value = nodeText(child(node, tag)); if (value) fields[label] = value;
  }
  const specifications = children(nice, 'classe-nice').map(value => `${value.attributes.codigo}: ${nodeText(child(value,'especificacao'))}`).filter(value => !value.endsWith(': '));
  if (specifications.length) fields['Produtos e serviços'] = specifications.join('\n');
  return inpiRecord.parse({ processNumber: node.attributes.numero, name: optional(nodeText(mark && child(mark,'nome'))),
    owners: holders ? children(holders,'titular').map(value => value.attributes['nome-razao-social']).filter(Boolean) : null,
    niceClasses: nice ? [...new Set(children(nice,'classe-nice').map(value => Number(value.attributes.codigo)))] : null,
    viennaCodes: vienna ? [...new Set(children(vienna,'classe-vienna').map(value => value.attributes.codigo))] : null,
    fields, events: children(child(node,'despachos'),'despacho').map(value => ({ code: value.attributes.codigo, description: value.attributes.nome, complement: optional(nodeText(child(value,'texto-complementar'))) })) });
}

/** Only one process is retained. XML entities, invalid editions and truncated files fail the import. */
export async function parseInpiXml(input: AsyncIterable<string | Uint8Array>, expected: { edition: number; publishedOn: string }, consume: (records: InpiRecord[]) => Promise<void>) {
  const parser = new SaxesParser({ xmlns: false });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const stack: XmlNode[] = [];
  let batch: InpiRecord[] = [], count = 0, root = false, processSize = 0;
  parser.on('doctype', () => { throw new Error('DOCTYPE não permitido no XML do INPI.'); });
  parser.on('opentag', tag => {
    if (!root) {
      const [day, month, year] = String(tag.attributes.data ?? '').split('/');
      if (tag.name !== 'revista' || Number(tag.attributes.numero) !== expected.edition || `${year}-${month}-${day}` !== expected.publishedOn) throw new Error('A identificação da RPI não corresponde à edição solicitada.');
      root = true;
    }
    if (tag.name !== 'processo' && !stack.length) return;
    const attributes: Record<string,string> = {};
    for (const [key,value] of Object.entries(tag.attributes)) { if (typeof value !== 'string') throw new Error('Atributo XML inválido.'); attributes[key] = value; }
    const node: XmlNode = { name: tag.name, attributes, text: '', children: [] };
    stack.at(-1)?.children.push(node); stack.push(node);
    if (stack.length > 30) throw new Error('XML com profundidade excessiva.');
  });
  const addText = (text: string) => {
    const node = stack.at(-1); if (!node) return;
    processSize += text.length; if (processSize > 2_000_000) throw new Error('Processo XML excede o limite de leitura.');
    node.text += text;
  };
  parser.on('text', addText); parser.on('cdata', addText);
  parser.on('closetag', () => {
    const node = stack.pop(); if (!node || node.name !== 'processo') return;
    batch.push(record(node)); count++; processSize = 0;
  });
  for await (const chunk of input) {
    parser.write(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
    if (batch.length >= 500) { await consume(batch); batch = []; }
  }
  parser.write(decoder.decode()).close();
  if (!root || !count) throw new Error('A RPI não contém processos de marcas.');
  if (batch.length) await consume(batch);
  return count;
}
