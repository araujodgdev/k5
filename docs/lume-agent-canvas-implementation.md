# Implementação do Lume com canvas

## Resultado esperado

O advogado mantém uma conversa privada com o Lume enquanto navega pelos casos, documentos e módulos. Cada caso reúne os materiais compartilhados com seus participantes. A interface segue o protótipo HTML fornecido em 6 de outubro de 2026.

A entrega precisa demonstrar estes comportamentos no produto real.

1. A conversa permanece aberta ao trocar de módulo ou caso. O painel pode ser recolhido e ampliado. No celular, conversa e canvas ocupam a tela alternadamente.
2. O canvas oferece abas de recursos e acesso direto aos módulos existentes. URLs continuam abrindo os recursos correspondentes.
3. Cada novo pedido identifica o contexto visível. Uma execução iniciada mantém o contexto original mesmo quando a pessoa muda de aba.
4. O caso reúne páginas, arquivos, tarefas e os dados do caso que a pessoa pode acessar. Compartilhar o caso não publica conversas, memória ou rascunhos particulares.
5. O Lume pode trabalhar com o conteúdo do caso por operações autenticadas. Alterações concorrentes preservam o trabalho humano. Aprovações continuam vinculadas à ação e aos argumentos apresentados.
6. A interface tem tema claro por padrão, tema escuro opcional, acesso por teclado e comportamento verificado em desktop e em 390 px.

## Limites de implementação

O caso existente continua sendo a unidade de compartilhamento. As permissões de pastas continuam valendo. O servidor deriva pessoa e escritório da sessão e confere acesso a cada operação.

O runtime Mastra, as conversas persistidas, o controle de execuções e as aprovações existentes são a base. Adotar outro runtime ou automação de navegador exige uma necessidade demonstrada durante a implementação.

O HTML é uma referência de experiência e aparência. Seus dados e temporizadores simulados não são funcionalidades de produção.

## Sequência de trabalho

1. Registrar a situação inicial, os testes e as telas. Comparar três propostas de arquitetura e sintetizar os contratos.
2. Implementar o shell persistente, o painel do Lume, as abas do canvas e a navegação móvel sobre os recursos já autorizados. Congelar o contexto por envio e na regeneração.
3. Implementar os contratos de páginas compartilhadas, persistência e permissões. Verificar os limites de acesso e as alterações concorrentes antes de expor os novos recursos.
4. Integrar o caso como espaço de trabalho e o editor ao canvas, com dados reais e destinos explícitos para conteúdo particular e compartilhado.
5. Aplicar a direção visual do protótipo e revisar os fluxos dos módulos afetados.
6. Executar testes, build, revisão independente e verificação em navegador. Corrigir os problemas encontrados antes da entrega.

O escopo inicial tem seis unidades de trabalho e atravessa o shell, o chat, os casos, o editor, os contratos do agente e os testes. A quantidade de arquivos depende da comparação das arquiteturas. Cada unidade termina com uma verificação antes de avançar.

## Evidências

Os resultados e limites da validação estão no [relatório de verificação](lume-agent-canvas-validation.md). Capturas e testes usam uma instância isolada criada pela skill `verify-lume`, sem alterar o banco de desenvolvimento.

Status atual: implementação e validação concluídas em 7 de outubro de 2026. O shell persistente, o contexto por envio, as páginas compartilhadas, o editor, as tarefas do caso, as notificações, o compartilhamento e a composição visual usam os serviços reais da aplicação. Conversas e delegações particulares permanecem privadas. As permissões das fontes e a opção de habilitar o Lume no caso são conferidas no servidor, inclusive em repetições de operações já aprovadas.

A verificação visual cobriu desktop e celular de 390 px, temas claro e escuro, navegação com rascunho preservado, páginas e arquivos na aba Tudo e o diálogo de compartilhamento. Testes de provedores usam respostas controladas; qualidade de respostas de modelos reais e entrega por integrações externas não foram verificadas nesta rodada. A atividade do Início mostra um recorte dos casos recentes. A consulta de tarefas ainda percorre os casos acessíveis e não foi submetida a teste de carga.

Build, lint e tipos passaram após a última correção. A rodada ampla de testes registrou falhas, corrigidas e revalidadas em execuções direcionadas; a suíte inteira não foi repetida a cada ajuste. O [relatório final](lume-agent-canvas-validation.md) registra os números, as tentativas e os caminhos das evidências. A instância descartável foi encerrada. A publicação em produção depende do CI e da aprovação do ambiente de deploy.
