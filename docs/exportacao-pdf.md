# Exportação PDF

No editor, **Exportar → Exportar PDF** salva a edição atual e baixa o PDF. **Exportar DOCX** continua disponível no mesmo menu. Um conflito de edição impede a exportação até a pessoa resolver a versão atual. O endpoint aceita `format=pdf|docx` e uma versão esperada; o padrão permanece DOCX para os consumidores existentes.

O servidor monta o DOCX com o modelo escolhido para o documento, pessoal ou do escritório, nessa ordem. LibreOffice Writer converte esse arquivo para preservar timbrado, tabelas, margens, cabeçalhos e rodapés. Fontes ausentes no servidor usam as substituições do LibreOffice; instale as fontes licenciadas do escritório se for necessária correspondência exata. A prévia do navegador usa docx-preview e pode apresentar diferenças de paginação.

Em Windows, a instalação padrão é `C:/Program Files/LibreOffice/program/soffice.exe`. Em Linux, o padrão é `soffice` no PATH. `LIBREOFFICE_PATH` permite configurar outro executável. As imagens Docker web e processadores incluem Writer e fontes Liberation/DejaVu. Não é necessário um serviço externo de conversão.

No runtime Cloudflare, o servidor autoriza a leitura e chama o processador privado por RPC. O endpoint `/convert/pdf` existe somente no container, sem rota pública no Worker. O processador limita concorrência e tamanho, usa uma pasta temporária e um perfil de conversão exclusivo, bloqueia relacionamentos externos e macros do arquivo e apaga os temporários após a operação. A sessão e o vínculo com o escritório são revalidados antes do download.

O limite de entrada é 16 MB, com timeout de 90 segundos por conversão e duas conversões simultâneas por processo. Falhas deixam o documento editável e permitem tentar novamente ou exportar DOCX.

`apps/web/tests/document-pdf.test.ts` faz conversão real e verifica texto em português, tabela, timbrado, rodapé, múltiplas páginas e descarte do conteúdo anterior do modelo. Requer LibreOffice no ambiente de testes.
