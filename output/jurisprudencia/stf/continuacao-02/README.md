# Continuação 02 do STF

Retomada da execução `73e15cce-7694-4706-b683-40aa76cd84a9`, confirmada pelo resultado anterior de publicação e pela verificação compartilhada.

A mesma consulta por descritor descoberto no tesauro foi reaberta no portal oficial. A API retornou novamente 20 resultados e os mesmos dez IDs na primeira página, na mesma ordem. Foram preparados cinco novos registros, dos índices 2 a 6: `sjur193784`, `sjur199933`, `sjur217158`, `sjur217867` e `sjur217440`. A publicação deve avançar o próximo índice para 7, somente após persistência confirmada.

## Íntegras pendentes

O PDF do primeiro acórdão continuou retornando HTTP 202 com corpo vazio pelo cliente HTTP. Na rota alternativa de consulta processual, o link oficial forneceu o arquivo `texto_2894288.RTF`, com 10.496 bytes. O arquivo é RTF válido. A extração com Pandoc revelou apenas o dispositivo da decisão de 09/11/2010, sem relatório ou votos. Por isso, não foi classificado como inteiro teor.

O RTF permanece local; sua extração fiel em TXT está incluída como documento complementar `official_metadata`, com método `rtf_text_extraction`, origem e hash do original. As duas íntegras anteriores e as cinco novas continuam pendentes. O lote não afirma indisponibilidade definitiva dos documentos.

## Publicação

`import-manifest.json` contém cinco registros, um assunto já conhecido, cinco relações, seis documentos complementares/metadados e o checkpoint parcial. A chave da partição é a mesma da execução anterior e `expectedPreviousRunId` impede avançar sobre uma execução concorrente.

Os cinco registros novos têm ementa, mas `fullText=null` e `fullTextStatus=pending`. Nenhuma ementa, ata ou dispositivo foi convertido em inteiro teor. Não houve gravação direta no PlanetScale/R2 por este subagente nem criação de agendamentos.

O script de preparação converte a resposta oficial salva para o manifesto. Ele não é um coletor autônomo completo. A publicação é coordenada pelo agente principal.
