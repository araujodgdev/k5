$ErrorActionPreference = 'Stop'
$stfRoot = $PSScriptRoot
$stfData = Get-Content (Join-Path $stfRoot 'search-response-browser.json') -Raw | ConvertFrom-Json
$stfTerms = Get-Content (Join-Path $stfRoot 'topics.json') -Raw | ConvertFrom-Json
$stfTopics = @($stfTerms | Group-Object label | ForEach-Object {
  [pscustomobject]@{ key=('tesauro:'+$_.Name); label=$_.Name; sourceUrl='https://portal.stf.jus.br/jurisprudencia/tesauro/tesauro-service.asp?letra=a'; metadata=@{relations=@($_.Group | ForEach-Object {$_.relations});sourceEntries=@($_.Group);enumerationLetter='a'} }
})
$stfRecords = @($stfData.result.hits.hits | Select-Object -First 2 | ForEach-Object {
  $s = $_._source
  [pscustomobject]@{ sourceJudgmentId=$s.id; tribunal='STF'; courtUnit=$s.orgao_julgador; caseNumber=($s.processo_classe_processual_unificada_classe_sigla+' '+$s.processo_numero); className=$s.processo_classe_processual_unificada_extenso; rapporteur=$s.relator_processo_nome; title=$s.titulo; decisionDate=$s.julgamento_data; sourceUpdatedAt=$s.dg_atualizado_em; sourceUrl=('https://jurisprudencia.stf.jus.br/pages/search/'+$s.id+'/false'); ementa=$s.ementa_texto; fullText=$null; fullTextStatus='pending' }
})
$stfOriginals = @($stfData.result.hits.hits | Select-Object -First 2 | ForEach-Object {
  $file = Join-Path $stfRoot ($_._id+'-source.json')
  [IO.File]::WriteAllText($file, (ConvertTo-Json -InputObject $_._source -Depth 15))
  [pscustomobject]@{sourceJudgmentId=$_._id;path=$file;extension='json';kind='official_metadata';sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant();fullTextUrl=$_._source.inteiro_teor_url}
})
$stfRelations = @($stfRecords | ForEach-Object {[pscustomobject]@{sourceJudgmentId=$_.sourceJudgmentId;topicKey='tesauro:A VOZ DO BRASIL';provenance='official_filter'}})
$stfBundle = [ordered]@{
  tribunal='STF'; collectedAt=[DateTime]::UtcNow.ToString('o'); records=$stfRecords; topics=$stfTopics; relations=$stfRelations; originals=$stfOriginals
  partition=@{key='acordaos:tesauro:A VOZ DO BRASIL:all:date-asc';topicKey='tesauro:A VOZ DO BRASIL';status='partial';query=@{base='acordaos';ementaAtaIndexacao='"A VOZ DO BRASIL"';sinonimo=$true;plural=$true;radicais=$false;buscaExata=$true;sort='date';sortBy='asc';pageSize=10};checkpoint=@{page=1;nextResultIndex=2;totalReported=20;lastSourceJudgmentId='sjur187947';catalogLetter='a';nextCatalogLetter='b';catalogComplete=$false;pendingFullText=@('sjur185881','sjur187947');publicationConfirmed=$false}}
  evidence=@{searchResponse='search-response-browser.json';tesauroRaw='tesauro-a.xml';tesauroTerms=1638;xmlParseNote='The official XML has invalid control characters. Parsing removed only XML-illegal control characters; original response retained.';selectionRule='First descriptor without USE relation in official alphabetic enumeration; labels are discovered, not fixed.';coverage='2 of 20 search results prepared; letter A only enumerated; monocratic base not executed in this initial batch.';downloadStatus='pending';downloadFailure='Direct HTTP received 202 and empty body. IAB received application/pdf 200 but child PDF viewer blocked by client; retrieved body was viewer HTML, not PDF. Chrome automation blocked by another extension UI.';permissions='No explicit reproduction license verified in this collection.'}
}
[IO.File]::WriteAllText((Join-Path $stfRoot 'bundle.json'), (ConvertTo-Json -InputObject $stfBundle -Depth 20))
[pscustomobject]@{tribunal=$stfBundle.tribunal;collectedAt=$stfBundle.collectedAt;records=$stfRecords.Count;topics=$stfTopics.Count} | ConvertTo-Json
