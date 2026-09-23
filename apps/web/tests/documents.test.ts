import assert from "node:assert/strict";
import test from "node:test";
import { CommentRangeEnd, CommentRangeStart, CommentReference, Document, FootnoteReferenceRun, Header, Packer, Paragraph, TextRun } from "docx";
import PizZip from "pizzip";
import { citationCandidates, legalMentionsWithoutSource, quoteIsPresent, unauthorizedLegalPassages, type SourceChunk } from "../src/lib/ai-policy";
import {
  assembleDraftSection, chronologyEvents, composeChronology, composeDraft, dateInfo, readableLabel, similarDescriptions, validateDivergences, type Extraction,
} from "../src/lib/document-composition";
import { exportDocument, markdownBlocks, templateTypography } from "../src/lib/document-export";

const hex = (n: number) => n.toString(16).padStart(64, "0");
const contract: SourceChunk = { id: hex(1), documentId: "doc-a", sourceLabel: "contrato.pdf — página:3", text: "O contrato foi assinado em 10/05/2023 pelas partes Ana e Bruno. Nos termos do art. 186 do Código Civil, há dever de indenizar." };
const email: SourceChunk = { id: hex(2), documentId: "doc-b", sourceLabel: "email.eml — mensagem:1", text: "Conforme combinado, o contrato foi assinado em 10/06/2023 pelas partes Ana e Bruno. Pagamento pendente." };
const notes: SourceChunk = { id: hex(3), documentId: "doc-c", sourceLabel: "notas.docx — parágrafo:2", text: "Houve reunião entre as partes em maio de 2023 para tratar da entrega." };

test("policy: legal citation candidates, literal quotes and invented authorities", () => {
  const candidates = citationCandidates([contract, email]);
  assert.equal(candidates.length, 1);
  assert.match(candidates[0].text, /art\. 186/);
  assert.equal(candidates[0].documentId, "doc-a");
  assert.equal(citationCandidates([contract])[0].id, candidates[0].id, "ids are stable");

  assert.equal(quoteIsPresent("contrato  foi ASSINADO em 10/05/2023", contract.text), true);
  assert.equal(quoteIsPresent("assinado em", contract.text), false, "quotes shorter than 12 chars are rejected");
  assert.equal(quoteIsPresent("o contrato foi rescindido em 2024", contract.text), false);

  assert.deepEqual(unauthorizedLegalPassages("A parte autora pagou a parcela.", []), []);
  assert.equal(unauthorizedLegalPassages("Conforme Súmula 999 do STJ, o pedido procede.", []).length, 1, "invented citation is blocked");
  assert.equal(unauthorizedLegalPassages("Aplica-se o art. 927 do CPC.", candidates).length, 1, "authority outside the approved set is blocked");
  assert.deepEqual(unauthorizedLegalPassages(`> ${candidates[0].text}`, candidates), [], "verbatim approved passage is allowed");

  assert.deepEqual(legalMentionsWithoutSource("Com base no art. 186 do Código Civil.", contract.text), []);
  assert.deepEqual(legalMentionsWithoutSource("Com base na Lei n. 8.078/90.", contract.text), ["Lei n. 8.078/90"]);
});

test("composition: readable labels, dates and similarity helpers", () => {
  assert.equal(readableLabel("contrato.pdf — página:3"), "contrato.pdf — página 3");
  assert.equal(readableLabel("planilha.xlsx — aba:Pagamentos!A1:C9"), "planilha.xlsx — aba Pagamentos!A1:C9");
  assert.deepEqual(dateInfo("2023-05-10"), { kind: "full", key: "2023-05-10", label: "10/05/2023" });
  assert.equal(dateInfo("2023-02-30").kind, "unknown", "invalid calendar dates are not trusted");
  assert.equal(dateInfo("2023-05").label, "05/2023");
  assert.equal(dateInfo(null).label, "Data a confirmar");
  assert.equal(similarDescriptions("Contrato assinado pelas partes Ana e Bruno", "Contrato assinado pelas partes, Ana e Bruno."), true);
  assert.equal(similarDescriptions("Pagamento da parcela 1 realizado", "Pagamento da parcela 2 realizado"), false);
});

const extraction = (source: SourceChunk, events: Extraction["events"], gaps: string[] = []): Extraction => ({ sourceId: source.id, sourceLabel: source.sourceLabel, events, gaps });

test("composition: chronology orders events, exposes divergences and gaps with readable sources", () => {
  const extracted = [
    extraction(email, [
      { date: "2023-06-10", description: "Contrato assinado pelas partes Ana e Bruno", quote: "o contrato foi assinado em 10/06/2023" },
      { date: null, description: "Pagamento pendente", quote: "10/06/2023 pelas partes Ana e Bruno. Pagamento pendente" },
    ]),
    extraction(contract, [
      { date: "2023-05-10", description: "Contrato assinado pelas partes Ana e Bruno.", quote: "O contrato foi assinado em 10/05/2023" },
      { date: "2023-05-10", description: "Contrato assinado pelas partes Ana e Bruno.", quote: "O contrato foi assinado em 10/05/2023" },
    ], ["Página sem assinatura legível."]),
    extraction(notes, [{ date: "2023-05", description: "Reunião entre as partes sobre a entrega", quote: "Houve reunião entre as partes em maio de 2023" }]),
  ];
  assert.equal(chronologyEvents(extracted).length, 4, "duplicate events from the same source collapse");
  const result = composeChronology(extracted, [contract, email, notes]);

  assert.doesNotMatch(result.content, /[0-9a-f]{64}/, "no raw chunk ids in content");
  assert.match(result.content, /Fonte: contrato\.pdf — página 3/);
  const order = ["## 05/2023 (data parcial)", "## 10/05/2023", "## 10/06/2023", "## Data a confirmar", "## Divergências", "## Lacunas e revisão"].map(h => result.content.indexOf(h));
  assert.ok(order.every((index, i) => index >= 0 && (i === 0 || index > order[i - 1])), `sections out of order: ${order}`);

  assert.equal(result.divergences.length, 1);
  const divergences = result.content.slice(result.content.indexOf("## Divergências"), result.content.indexOf("## Lacunas"));
  assert.match(divergences, /Datas divergentes/);
  assert.match(divergences, /10\/05\/2023 em contrato\.pdf — página 3/);
  assert.match(divergences, /10\/06\/2023 em email\.eml — mensagem 1/);

  const gaps = result.content.slice(result.content.indexOf("## Lacunas"));
  assert.match(gaps, /Trechos analisados: 3 de 3/);
  assert.match(gaps, /Página sem assinatura legível/);
  assert.match(gaps, /Sem data documentada: Pagamento pendente/);
  assert.match(gaps, /Data parcial \(05\/2023\)/);
  assert.ok(result.issues.some(i => /divergência/.test(i)));

  assert.deepEqual(result.refs.map(r => r.id).sort(), [contract.id, email.id, notes.id].sort());
  assert.equal(result.refs.find(r => r.id === contract.id)?.excerpt, "O contrato foi assinado em 10/05/2023");
  assert.equal(result.refs.find(r => r.id === contract.id)?.sourceLabel, "contrato.pdf — página 3");
  assert.equal(result.refs.find(r => r.id === contract.id)?.documentId, "doc-a");
});

test("composition: compatible dates consolidate, uncited sources stay out, model review is index-only", () => {
  const extracted = [
    extraction(contract, [{ date: "2023-05-10", description: "Contrato assinado pelas partes", quote: "O contrato foi assinado em 10/05/2023" }]),
    extraction(notes, [{ date: null, description: "Contrato assinado pelas partes", quote: "Houve reunião entre as partes em maio de 2023" }]),
    extraction(email, []),
  ];
  const result = composeChronology(extracted, [contract, email, notes], [{ kind: "valor", events: [0, 1], origin: "revisão" }]);
  assert.equal(result.content.match(/## 10\/05\/2023/g)?.length, 1);
  assert.doesNotMatch(result.content.slice(0, result.content.indexOf("## Divergências")), /Data a confirmar/, "undated duplicate consolidated into dated event");
  assert.match(result.content, /sem data em notas.docx — parágrafo 2/);
  assert.equal(result.refs.some(r => r.id === email.id), false, "sources without cited events are not referenced");
  assert.match(result.content, /Valores divergentes \(apontada na revisão automática\)/);

  assert.deepEqual(validateDivergences([
    { kind: "data", events: [0, 1] }, { kind: "data", events: [1, 0] }, { kind: "data", events: [0, 9] }, { kind: "data", events: [1, 1] },
    { kind: "inventado", events: [0, 1] }, { kind: "valor", events: [0.5, 1] },
  ], 2), [{ kind: "data", events: [0, 1], origin: "revisão" }]);
});

test("composition: chronology blocks invented legal mentions and markdown injection", () => {
  const result = composeChronology([extraction(contract, [
    { date: "2023-05-10", description: "**Assinatura** conforme Súmula 7 do STJ", quote: "O contrato foi assinado em 10/05/2023" },
    { date: "2023-05-11", description: "1. Dever de indenizar pelo art. 186 do Código Civil", quote: "Nos termos do art. 186 do Código Civil" },
  ])], [contract]);
  assert.doesNotMatch(result.content, /Súmula 7/);
  assert.match(result.content, /Descrição omitida/);
  assert.match(result.content, /^1\\\. Dever de indenizar/m, "leading list markers are escaped");
  assert.ok(result.issues.some(i => /referência jurídica/.test(i)));
});

test("composition: draft paragraphs require verifiable evidence; missing references become pending", () => {
  const section = assembleDraftSection("Dos fatos", 0, {
    paragraphs: [
      { text: "As partes assinaram o contrato.", evidence: [{ sourceId: contract.id, quote: "O contrato foi assinado em 10/05/2023" }, { sourceId: email.id, quote: "Pagamento pendente." }] },
      { text: "O réu confessou a dívida.", evidence: [{ sourceId: contract.id, quote: "o réu confessou a dívida integral" }] },
      { text: "Houve dano moral.", evidence: [] },
      { text: "Nos termos do art. 186 do Código Civil, cabe indenização.", evidence: [{ sourceId: contract.id, quote: "Nos termos do art. 186 do Código Civil" }] },
      { text: "[PENDENTE DE INFORMAÇÃO] valor do dano.", evidence: [] },
      { text: "Evidência de outro processo.", evidence: [{ sourceId: hex(99), quote: "trecho qualquer de outro caso" }] },
    ],
    gaps: ["Falta comprovante de pagamento."],
  }, [contract, email]);
  assert.match(section.markdown, /^## Dos fatos/);
  assert.match(section.markdown, /As partes assinaram o contrato\.\n\nFontes: contrato\.pdf — página 3; email\.eml — mensagem 1/);
  assert.equal(section.markdown.match(/\[PENDENTE DE INFORMAÇÃO: parágrafo sem evidência verificável\]/g)?.length, 3);
  assert.match(section.markdown, /\[FUNDAMENTAÇÃO PENDENTE DE SELEÇÃO\]/);
  assert.match(section.markdown, /\[PENDENTE DE INFORMAÇÃO\] valor do dano\./);
  assert.doesNotMatch(section.markdown, /[0-9a-f]{64}/);
  assert.deepEqual(section.refs.map(r => r.id), [contract.id, email.id]);
  assert.ok(section.issues.includes("Falta comprovante de pagamento."));

  const legalHeading = assembleDraftSection("Do art. 186 do Código Civil", 1, { paragraphs: [], gaps: [] }, [contract]);
  assert.match(legalHeading.markdown, /^## Seção 2/);

  const approved = citationCandidates([contract]);
  const draft = composeDraft("Petição inicial", [section], approved);
  assert.match(draft.content, /^# Petição inicial/);
  assert.match(draft.content, /Fonte fornecida: contrato\.pdf — página 3\. Sem verificação externa\./);
  assert.ok(draft.refs.some(r => r.id === approved[0].id && r.excerpt.includes("art. 186")));
  assert.match(composeDraft("Súmula 7 do STJ", [section], []).content, /^# Minuta documental[\s\S]*\[FUNDAMENTAÇÃO JURÍDICA PENDENTE DE SELEÇÃO\]$/);
});

const markdown = "# Petição\n\nTexto com **negrito** e _itálico_ & <tag> \"aspas\" R$&1.\nSegunda linha\n\n## Dos fatos\n\n- primeiro **item**\n- segundo\n\n3. terceiro\n4. quarto\n\n> citação literal";

function documentXml(buffer: Buffer) { return new PizZip(buffer).file("word/document.xml")!.asText(); }

test("export: markdown tokens become Word-neutral blocks", () => {
  const blocks = markdownBlocks(markdown);
  assert.deepEqual(blocks.map(b => b.kind), ["heading", "paragraph", "heading", "item", "item", "item", "item", "paragraph"]);
  const paragraph = blocks[1];
  assert.ok(paragraph.kind === "paragraph" && paragraph.runs.some(r => r.bold && r.text === "negrito") && paragraph.runs.some(r => r.italic && r.text === "itálico") && paragraph.runs.some(r => r.break));
  assert.deepEqual(blocks.flatMap(b => b.kind === "item" ? [b.marker] : []), ["•", "•", "3.", "4."]);
  const quote = blocks.at(-1);
  assert.ok(quote?.kind === "paragraph" && quote.quote);
});

test("export: docx library path renders bold runs and lists without literal markdown", async () => {
  const xml = documentXml(await exportDocument(markdown));
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /<w:i\/>/);
  assert.match(xml, /<w:numPr>/);
  assert.match(xml, /Heading1|Heading2/);
  assert.doesNotMatch(xml, /\*\*|^- |## /m);
  assert.match(xml, /&amp; <\/w:t>[\s\S]*?&lt;tag&gt;/);
  assert.match(xml, /R\$&amp;1\./);
});

test("export: template path keeps header and separators, drops prior body, comments, notes and metadata", async () => {
  const template = await Packer.toBuffer(new Document({
    creator: "Advogado Antigo", title: "Processo Antigo 123",
    comments: { children: [{ id: 0, author: "Revisor", date: new Date(0), children: [new Paragraph("Comentário sigiloso do caso anterior")] }] },
    footnotes: { 1: { children: [new Paragraph("Nota do caso anterior")] } },
    sections: [{
      headers: { default: new Header({ children: [new Paragraph("TIMBRADO ESCRITÓRIO ALFA")] }) },
      children: [new Paragraph({ children: [new CommentRangeStart(0), new TextRun({ text: "Fato do caso anterior", font: "Garamond", size: 24 }), new CommentRangeEnd(0), new TextRun({ children: [new CommentReference(0)] }), new FootnoteReferenceRun(1)] })],
    }],
  }));
  const zip = new PizZip(await exportDocument(markdown, template));
  const xml = zip.file("word/document.xml")!.asText();
  assert.ok(Object.keys(zip.files).some(name => /^word\/header\d*\.xml$/.test(name) && zip.file(name)!.asText().includes("TIMBRADO ESCRITÓRIO ALFA")));
  assert.match(xml, /<w:headerReference\b/);
  assert.match(xml, /<w:sectPr\b[\s\S]*<\/w:sectPr><\/w:body>/);
  assert.doesNotMatch(xml, /Fato do caso anterior|commentReference|footnoteReference/);
  assert.match(xml, /<w:b\/>/);
  assert.match(xml, /<w:t xml:space="preserve">•<\/w:t><w:tab\/>/);
  assert.match(xml, /<w:t xml:space="preserve">3\.<\/w:t>/);
  assert.match(xml, /w:ascii="Garamond"/, "body run fonts follow the template");
  assert.doesNotMatch(xml, /\*\*|&lt;w:/);
  assert.match(xml, /&lt;tag&gt;<\/w:t><\/w:r><w:r>[\s\S]*?&quot;aspas&quot; R\$&amp;1\./);
  assert.match(xml, /<w:pStyle w:val="Heading1"\/><w:keepNext\/><\/w:pPr><w:r><w:rPr><\/w:rPr>/, "styled headings keep template heading font");
  assert.doesNotMatch(zip.file("word/comments.xml")!.asText(), /Comentário sigiloso/);
  const footnotes = zip.file("word/footnotes.xml")!.asText();
  assert.doesNotMatch(footnotes, /Nota do caso anterior/);
  assert.match(footnotes, /w:type="separator"/, "Word-required separator footnotes remain");
  assert.doesNotMatch(zip.file("docProps/core.xml")!.asText(), /Advogado Antigo|Processo Antigo/);
  assert.throws(() => new PizZip(Buffer.from("not a zip")));
  await assert.rejects(exportDocument("x", Buffer.from(new PizZip().file("word/document.xml", "<w:document/>").generate({ type: "nodebuffer" }))), /Modelo Word inválido/);
});

test("export: editor typography comes from the template's body paragraphs and page", () => {
  const paragraph = '<w:p><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="1134"/><w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr><w:t>Texto do corpo.</w:t></w:r></w:p>';
  const xml = `<w:document><w:body>${paragraph}${paragraph}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1134" w:bottom="1134" w:left="1701"/></w:sectPr></w:body></w:document>`;
  assert.deepEqual(templateTypography(xml), {
    fontFamily: "Times New Roman", fontSizePt: 12, textAlign: "justify", lineHeight: 1.5, firstLineIndentCm: 2,
    pageWidthCm: 21, marginLeftCm: 3, marginRightCm: 2,
  });
  const exact = templateTypography('<w:document><w:body><w:p><w:pPr><w:spacing w:line="360" w:lineRule="exact"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>x</w:t></w:r></w:p></w:body></w:document>');
  assert.equal(exact.lineHeight, 1.5);
  assert.equal(exact.textAlign, "center");
  assert.equal(exact.fontFamily, null);
});
