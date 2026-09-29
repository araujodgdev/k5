# Continuação da coleta STJ

Lote preparado a partir do checkpoint confirmado no PostgreSQL e da publicação anterior `2e0cc266-618c-4b18-a4b4-7ef99a44206f`.

- 10 íntegras seguintes do ZIP oficial de 22/09/2026, índices 5 a 14.
- 5 ementas seguintes do arquivo de espelhos de 31/08/2026, índices 3 a 7.
- 44 assuntos oficiais presentes no lote e 52 relações documento-assunto.
- Fila dinâmica com 129 assuntos encontrados nas 65 íntegras disponíveis no ZIP. Um documento pode integrar mais de um assunto; a fila preserva todos os vínculos.
- Espelhos sem classificação oficial suficiente permanecem pendentes de classificação. Não foi aplicada classificação inventada ou por palavras-chave fixas.

Os 15 identificadores foram consultados no banco antes da publicação. Nenhum existia na instalação STJ. Todas as relações referem documentos e assuntos presentes no manifesto. Os hashes SHA-256 dos 10 arquivos originais foram recalculados e conferidos.

Os bytes dos arquivos oferecidos como TXT pelo STJ contêm marcação HTML e foram preservados em arquivos HTML. O texto para pesquisa foi salvo separadamente. Nenhuma ementa foi tratada como inteiro teor, e nenhuma identidade de espelho foi unida a uma identidade DJE apenas pelo processo.

Após publicar este lote, o próximo índice será 15 de 65 no ZIP e 8 de 1.100 nos espelhos. A partição permanece parcial. Os metadados contêm 2.752 registros, mas apenas 65 arquivos correspondentes estão presentes neste ZIP; não se afirma cobertura dos demais 2.687.

O agente STJ preparou o lote e não fez gravações no banco ou R2. A publicação é coordenada pelo agente principal. O manifesto e os originais foram congelados antes do início da publicação.
