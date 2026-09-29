# Tutorial do Lume

Vídeo único em pt-BR, com narração, textos, legendas incorporadas, arquivos SRT/VTT e cursor com indicação de clique. A composição visual foi criada no Remotion; a montagem final usa FFmpeg com as gravações reais do navegador.

## Conteúdo

Início e tour, clientes, Cofre e participantes, tarefas e Kanban, agenda, honorários e recebimentos, Lume, revisão e exportação de documentos, pesquisa e histórico, Gmail, mensagens, equipe e convites, integrações, plano, perfil e administração. Veja os tempos em [capitulos.md](capitulos.md).

Os cadastros são fictícios em uma conta demo local. IA, pesquisa e Google foram demonstrados no ambiente publicado com a conta autorizada. A caixa de e-mails está desfocada; o e-mail demonstrativo foi fechado sem envio. A mensagem interna foi enviada para outra conta fictícia local.

WhatsApp aparece no estado real de conexão pendente. Anúncios BETA é explicado, mas não foi aberto porque não está habilitado nessa conta. Não há demonstração de envio WhatsApp nem de criação de campanhas.

## Onboarding

O primeiro acesso no navegador oferece o tour. Os cartões têm Próximo, Voltar, sair e retomar, destaque da área atual, navegação por teclado e adaptação para celular. O progresso é separado por pessoa e escritório. O botão Tutorial permite reabrir o tour ou assistir ao vídeo em `/app/tutorial`.

## Validação

- `pnpm lint`: passou, com um aviso preexistente de variável não utilizada em `judicial/connectors/transport.ts`.
- `pnpm typecheck`: passou.
- `pnpm test`: 634 testes passaram.
- `pnpm db:setup` e `pnpm build`: passaram.
- Tour em desktop e celular: conclusão, pausa, retomada, voltar, foco por teclado e limites da tela verificados.
- ESLint dos arquivos novos e typecheck do projeto Remotion passaram após a atualização da exportação.

A implementação está no workspace local; esta entrega não publicou uma nova versão do aplicativo.

## Arquivo final

- Duração: 293,388 segundos (4min53s); 1920×1080, 30 fps; H.264 e AAC 48 kHz; 13,38 MB.
- Decodificação completa por FFmpeg: sem erros. Áudio presente, pico de -3,9 dB.
- Reprodução em `/app/tutorial`: passou em desktop e celular, incluindo entrada pelo botão do tour, carregamento de metadados e avanço da reprodução.
- Capa, MP4 e VTT copiados para `apps/web/public/tutorial/`.
- Amostras visuais revisadas em [revisao.jpg](revisao.jpg).
