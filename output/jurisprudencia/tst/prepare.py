import hashlib
import json
import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

root = Path(__file__).parent


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.ignore = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'head'):
            self.ignore += 1
        if tag in ('p', 'div', 'br', 'tr') and not self.ignore:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'head'):
            self.ignore -= 1
        if tag in ('p', 'div', 'tr') and not self.ignore:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.ignore:
            self.parts.append(data)


def write(name, value):
    (root / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


now = datetime.now(timezone.utc).isoformat()
specs = [
    ('5d11866c6c34293fb9c7c76ab5c8cd53', '11436681', 'EDCiv-RR', '2026-06-17', '2026-06-22'),
    ('77d8a9b116896cb142217c0dfefbc36a', '11381469', 'RR', '2026-03-11', '2026-03-16'),
]
records = []
originals = []
for identity, nia, cls, decision, publication in specs:
    name = f'00009548220135090303-{decision}.html'
    content = (root / name).read_bytes()
    parser = Text()
    parser.feed(content.decode('utf-8'))
    text = '\n\n'.join(re.sub(r'\s+', ' ', line).strip() for line in ''.join(parser.parts).split('\n') if line.strip())
    assert 'ACORDAM' in text and 'Vistos, relatados' in text
    start = text.index('EMBARGOS DE DECLARAÇÃO.' if cls == 'EDCiv-RR' else 'RECURSO DE REVISTA.')
    end = text.index('Vistos, relatados')
    ementa = text[start:end].strip()
    url = 'https://jurisprudencia-backend.tst.jus.br/rest/documentos/00009548220135090303/' + datetime.fromisoformat(decision).strftime('%d-%m-%Y') + '/' + datetime.fromisoformat(publication).strftime('%d-%m-%Y')
    (root / name.replace('.html', '.txt')).write_text(text, encoding='utf-8')
    records.append(dict(sourceJudgmentId=identity, tribunal='TST', courtUnit='5ª Turma', caseNumber='0000954-82.2013.5.09.0303', className=cls, rapporteur='Morgana de Almeida', title=f'{cls} - 954-82.2013.5.09.0303', decisionDate=decision, sourceUpdatedAt=None, sourceUrl=url, ementa=ementa, fullText=text, fullTextStatus='ready'))
    originals.append(dict(sourceJudgmentId=identity, nia=nia, path=name, sourceUrl=url, mimeType='text/html', byteSize=len(content), sha256=hashlib.sha256(content).hexdigest(), publicationDate=publication, themeEvidence={'id': '6191', 'label': 'DIREITO INTERNACIONAL', 'basis': 'official_search_filter'}, collectedAt=now))

pdf = root / '11436681-download.bin'
if pdf.exists():
    data = pdf.read_bytes()
    assert data.startswith(b'%PDF-'), 'Official PDF link did not return PDF'
    pdf.rename(root / '11436681.pdf')
pdf = root / '11436681.pdf'
data = pdf.read_bytes()
originals.append(dict(sourceJudgmentId=specs[0][0], nia=specs[0][1], path=pdf.name, mimeType='application/pdf', byteSize=len(data), sha256=hashlib.sha256(data).hexdigest(), sourceUrl='https://consultadocumento.tst.jus.br/consultaDocumento/acordao.do?anoProcInt=2015&numProcInt=77235&dtaPublicacaoStr=22/06/2026%2007:00:00&nia=11436681', collectedAt=now))
write('source-judgments.json', records)
write('originals.json', originals)
topics = [(6191, 'DIREITO INTERNACIONAL', None), (6197, 'Estrangeiro', 6191), (6202, 'Proteção Internacional a Direitos Humanos', 6191), (6215, 'Sucessão de Bens Estrangeiro', 6191), (6213, 'Normas do Mercosul', 6191), (6212, 'Tratado Internacional', 6191), (9565, 'Laudo Arbitral Internacional', 6191), (6218, 'Pessoa Jurídica Estrangeira', 6191), (55643, 'QUESTÕES DE ALTA COMPLEXIDADE, GRANDE IMPACTO E REPERCUSSÃO', None), (8826, 'DIREITO PROCESSUAL CIVIL E DO TRABALHO', None), (864, 'DIREITO DO TRABALHO', None), (899, 'DIREITO CIVIL', None), (9985, 'DIREITO ADMINISTRATIVO E OUTRAS MATÉRIAS DE DIREITO PÚBLICO', None)]
write('topics.json', {'sourceUrl': 'https://jurisprudencia.tst.jus.br/', 'discoveredAt': now, 'complete': False, 'topics': [{'id': str(code), 'label': label, 'parentId': str(parent) if parent else None} for code, label, parent in topics]})
write('checkpoint.json', dict(tribunal='TST', source='https://jurisprudencia.tst.jus.br/', topicId='6191', origin='TST', documentType='Acórdãos', freeText='', dateRange=None, totalReported=74, pageSize=20, page=1, collectedWithinPage=2, resumeAtWithinPage=3, nextPendingProcess='RR - 712-41.2017.5.05.0030', localDownloadComplete=True, remotePersistence='pending_parent_publication', partitionComplete=False, taxonomyComplete=False, collectedAt=now, warning='Replay the first page and deduplicate by sourceJudgmentId on resume; no stable snapshot was guaranteed.'))
print(json.dumps({'records': len(records), 'originals': len(originals), 'topicsDiscovered': len(topics), 'files': [x['path'] for x in originals]}))
