import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).parent
previous = json.loads((root.parent / 'import-manifest.json').read_text(encoding='utf-8-sig'))
published = json.loads((root.parent / 'publication-result.json').read_text(encoding='utf-8-sig'))
known = {r['sourceJudgmentId'] for r in published['records']}
now = datetime.now(timezone.utc).isoformat()
specs = [
    ('da57a953452406e93c358b716e125f33', 'RR', '712-41.2017.5.05.0030', '00007124120175050030', '2026-02-25', '2026-03-02', '1ª Turma', 'Amaury Rodrigues Pinto Junior', 'I – DIREITO CONSTITUCIONAL E DO TRABALHO.'),
    ('3502afe3039a14ecebdc8d081e4271ec', 'Ag-Ag-RR', '2757700-82.1996.5.09.0013', '27577008219965090013', '2025-11-25', '2025-12-11', 'Órgão Especial', 'Mauricio Godinho Delgado', 'AGRAVO. RECURSO EXTRAORDINÁRIO DENEGADO.'),
    ('1dc64a55e3564942822e26f90ead0e44', 'AIRR', '0010907-52.2023.5.03.0185', '00109075220235030185', '2025-09-12', '2025-09-22', '4ª Turma', 'Ives Gandra da Silva Martins Filho', 'AGRAVO DE INSTRUMENTO EM RECURSO DE REVISTA'),
    ('c99aa92e7d12a7c5801d2c921b8595b3', 'EDCiv-RO', '2800-22.2008.5.10.0000', '00028002220085100000', '2025-09-16', '2025-09-19', 'Subseção II Especializada em Dissídios Individuais', 'Maria Helena Mallmann', 'EMBARGOS DE DECLARAÇÃO.'),
    ('e14c64cc815059699ffb7cc7297e6a4e', 'RO', '2800-22.2008.5.10.0000', '00028002220085100000', '2025-06-24', '2025-07-04', 'Subseção II Especializada em Dissídios Individuais', 'Maria Helena Mallmann', 'RECURSO ORDINÁRIO EM MANDADO DE SEGURANÇA.'),
]
records, originals, relations = [], [], []
for identity, cls, case, digits, decision, publication, unit, rapporteur, marker in specs:
    assert identity not in known
    data = (root / f'{identity}.html').read_bytes()
    text = (root / f'{identity}.txt').read_text(encoding='utf-8')
    assert 'ACORDAM' in text and 'Vistos, relatados' in text and case in text
    assert '\ufffd' not in text, 'Unexpected encoding loss'
    start = text.index(marker)
    end = text.index('Vistos, relatados')
    assert end > start
    ementa = text[start:end].strip()
    assert 'ACORDAM' not in ementa
    url = f'https://jurisprudencia-backend.tst.jus.br/rest/documentos/{digits}/' + datetime.fromisoformat(decision).strftime('%d-%m-%Y') + '/' + datetime.fromisoformat(publication).strftime('%d-%m-%Y')
    first, rest = case.split('-', 1)
    records.append(dict(sourceJudgmentId=identity, tribunal='TST', courtUnit=unit, caseNumber=first.zfill(7)+'-'+rest, className=cls, rapporteur=rapporteur, title=f'{cls} - {case}', decisionDate=decision, sourceUpdatedAt=None, sourceUrl=url, ementa=ementa, fullText=text, fullTextStatus='ready'))
    originals.append(dict(sourceJudgmentId=identity, path=f'{identity}.html', sourceUrl=url, mimeType='text/html', byteSize=len(data), sha256=hashlib.sha256(data).hexdigest(), publicationDate=publication, collectedAt=now, extension='html', kind='full_text', captureMethod='official_download'))
    relations.append(dict(sourceJudgmentId=identity, topicKey='6191', provenance='official_filter', sourceUrl='https://jurisprudencia.tst.jus.br/'))

checkpoint = dict(published['checkpoint'])
checkpoint.update(collectedWithinPage=7, resumeAtWithinPage=8, nextPendingProcess='EDCiv-Ag-AIRR - 1180-10.2014.5.02.0445', nextPendingSourceJudgmentId='270ea1ec0e8f4614ac19a800a311b93c', totalReported=74, collectedAt=now, remotePersistence='pending_parent_publication', publicationConfirmed=False, status='partial', localDownloadComplete=True, partitionComplete=False, taxonomyComplete=False, confirmedPreviouslyCollected=2, newCollected=5, queryReplayed=True, deduplicatedSourceJudgmentIds=sorted(known))
checkpoint.pop('publicationRunId', None)
partition = dict(previous['partition'])
partition.update(checkpoint=checkpoint, status='partial')
manifest = dict(expectedPreviousRunId=published['runId'], collectedAt=now, records=records, topics=[t for t in previous['topics'] if t['key']=='6191'], relations=relations, originals=originals, partition=partition)
(root / 'import-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'records':len(records),'ids':[r['sourceJudgmentId'] for r in records],'htmlBytes':sum(o['byteSize'] for o in originals),'textChars':[len(r['fullText']) for r in records],'ementaChars':[len(r['ementa']) for r in records],'nextPosition':8,'coverage':'partial','expectedPreviousRunId':published['runId']}))
