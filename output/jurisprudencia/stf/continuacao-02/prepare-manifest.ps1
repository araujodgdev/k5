$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$previous = Get-Content (Join-Path $root '../publication-result.json') -Raw | ConvertFrom-Json
$oldBundle = Get-Content (Join-Path $root '../bundle.json') -Raw | ConvertFrom-Json
$response = Get-Content (Join-Path $root 'search-response.json') -Raw | ConvertFrom-Json
$oldResponse = Get-Content (Join-Path $root '../search-response-browser.json') -Raw | ConvertFrom-Json
if (($response.result.hits.hits._id -join ',') -ne ($oldResponse.result.hits.hits._id -join ',')) { throw 'A sequência mudou; reavaliar checkpoint antes da importação.' }
$selected = @($response.result.hits.hits | Select-Object -Skip $previous.checkpoint.nextResultIndex -First 5)
$records = @($selected | ForEach-Object {
  $s = $_._source
  [pscustomobject]@{sourceJudgmentId=$s.id;tribunal='STF';courtUnit=$s.orgao_julgador;caseNumber=($s.processo_classe_processual_unificada_classe_sigla+' '+$s.processo_numero);className=$s.processo_classe_processual_unificada_extenso;rapporteur=$s.relator_processo_nome;title=$s.titulo;decisionDate=$s.julgamento_data;sourceUpdatedAt=$s.dg_atualizado_em;sourceUrl=('https://jurisprudencia.stf.jus.br/pages/search/'+$s.id+'/false');ementa=$s.ementa_texto;fullText=$null;fullTextStatus='pending'}
})
$originals = @($selected | ForEach-Object {
  $path = Join-Path $root ($_._id+'-source.json')
  [IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $_._source -Depth 15))
  [pscustomobject]@{sourceJudgmentId=$_._id;path=$path;extension='json';kind='official_metadata';captureMethod='official_download';sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant();sourceUrl='https://jurisprudencia.stf.jus.br/api/search/search';fullTextUrl=$_._source.inteiro_teor_url}
})
$disposition = Join-Path $root 'sjur185881-process-disposition.txt'
$rtf = Join-Path $root 'sjur185881-process-document.rtf'
$originals += [pscustomobject]@{sourceJudgmentId='sjur185881';path=$disposition;extension='txt';kind='official_metadata';captureMethod='rtf_text_extraction';sha256=(Get-FileHash -LiteralPath $disposition -Algorithm SHA256).Hash.ToLowerInvariant();sourceUrl='https://portal.stf.jus.br/processos/downloadTexto.asp?id=2894288&ext=RTF';originalPath=$rtf;originalSha256=(Get-FileHash -LiteralPath $rtf -Algorithm SHA256).Hash.ToLowerInvariant();completeness='dispositivo/ata somente; sem relatório e votos; não é inteiro teor do acórdão'}
$partition = $oldBundle.partition
$partition.checkpoint = [ordered]@{page=1;nextResultIndex=7;lastSourceJudgmentId=$records[-1].sourceJudgmentId;totalReported=$response.result.hits.total.value;catalogLetter='a';nextCatalogLetter='b';catalogComplete=$false;pendingFullText=@($previous.checkpoint.pendingFullText)+@($records.sourceJudgmentId);publicationConfirmed=$false;previousPublicationRunId=$previous.runId;status='partial'}
$manifest = [ordered]@{tribunal='STF';collectedAt=[DateTime]::UtcNow.ToString('o');expectedPreviousRunId=$previous.runId;records=$records;topics=@($oldBundle.topics|Where-Object key -eq $partition.topicKey);relations=@($records|ForEach-Object{[pscustomobject]@{sourceJudgmentId=$_.sourceJudgmentId;topicKey=$partition.topicKey;provenance='official_filter';sourceUrl=$_.sourceUrl}});originals=$originals;partition=$partition;evidence=@{searchResponse='search-response.json';sequenceComparedWithPrevious=$true;firstPageReplayed=$true;newJudgments=5;pendingFullTextRecovered=0;complementaryDispositions=1;downloadFailure='PDF direto permanece HTTP202 vazio. Rota alternativa consulta processual forneceu RTF de dispositivo; conteúdo conferido e não promovido a inteiro teor.';scope='Continuação da consulta em acórdãos, índices2 a6. Base monocrática e outras letras não executadas neste lote.'}}
[IO.File]::WriteAllText((Join-Path $root 'import-manifest.json'),(ConvertTo-Json -InputObject $manifest -Depth 20))
[pscustomobject]@{records=$records.Count;topics=$manifest.topics.Count;originals=$originals.Count;nextIndex=7;pendingFullText=$partition.checkpoint.pendingFullText.Count;ids=$records.sourceJudgmentId}|ConvertTo-Json
