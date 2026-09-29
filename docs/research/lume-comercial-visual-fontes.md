# Fontes e limites da apresentação visual do Lume

Revisão de 28 de setembro de 2026. O arquivo final é `output/pdf/lume-apresentacao-comercial-visual.pdf`. O PDF anterior foi preservado.

## Conteúdo

A apresentação segue o Canvas enviado pelo usuário, a apresentação comercial anterior e os módulos presentes no repositório. O público é formado por advogados individuais e escritórios de 2 a 5 advogados. O contato informado pelo usuário é `(81) 99404-5493`, com link `https://wa.me/5581994045493`.

O usuário confirmou que ainda não existe um resultado de uso do cliente cocriador que possa ser contado. Por isso, todos os exemplos têm identificação de demonstração. Não há depoimentos, clientes apresentados como casos de sucesso, métricas de produtividade ou resultados financeiros reais.

## Capturas

As imagens estão em `output/lume-comercial-assets/`. As capturas mostram os componentes reais do aplicativo. As telas de clientes, tarefas, agenda e documentos recebem dados fictícios por interceptação local das respostas de API durante a captura. Os dados não representam produção. A captura usa uma conta de testes e mantém os arquivos originais sem alterações gráficas. O PDF recorta áreas relevantes sem reconstruir a interface.

- `modulo-clientes.png`: cadastro fictício de Marina Costa.
- `modulo-cofre.png`: listagem demonstrativa de três arquivos em um caso fictício criado no ambiente local.
- `modulo-assistente.png`: painel de seleção das fontes desse caso. A solicitação descrita no slide é um exemplo. Não há uma resposta gerada no PDF.
- `modulo-pesquisa.png`: formulário preenchido. A busca não foi enviada, e nenhum resultado ou julgado foi inventado.
- `cliente-e-atividades.png`: contato fictício e suas três atividades.
- `modulo-tarefas.png`: duas tarefas demonstrativas.
- `modulo-agenda.png`: reunião em 30/09/2026, com o mesmo dia selecionado no calendário.
- `tarefas-mobile.png`: versão móvel da listagem de tarefas.
- `honorarios-parcelas.png`: cópia da evidência `apps/web/playwright-report/honorarios/desktop-parcelas.png`.
- `honorarios-recebimentos.png`: cópia da evidência `apps/web/playwright-report/honorarios/desktop-recebimentos.png`.

As duas telas de honorários vêm do fluxo real de validação com dados sintéticos do módulo. Os valores conferem: três parcelas de R$ 1.000, dois recebimentos de R$ 1.000 e R$ 400, total recebido de R$ 1.400 e saldo de R$ 1.600. O módulo é um controle manual e não movimenta dinheiro. O documento `docs/honorarios.md` descreve seu comportamento e suas limitações.

## Limitações encontradas

Uma tentativa de executar o assistente no ambiente local retornou HTTP 503, com aviso de configuração de IA indisponível. A apresentação usa o painel real de fontes e um exemplo de solicitação, sem alegar uma resposta produzida durante a captura.

A ferramenta integrada de geração de imagens foi acionada para duas cenas de pessoas usando o Lume. As chamadas não concluíram, inclusive após nova tentativa, e foram encerradas. Nenhuma imagem gerada por IA faz parte deste PDF. A abertura usa uma captura real do produto e a seção de equipe mostra o aplicativo no celular.

## Reprodução e verificação

O gerador é `docs/research/build_lume_comercial_visual.py`. Ele usa ReportLab, svglib e as fontes Geist da primeira apresentação. Para executar:

```powershell
uv run --with reportlab --with svglib --with pymupdf --with pillow python docs/research/build_lume_comercial_visual.py
```

A revisão contempla as 17 páginas renderizadas, conferência de textos e valores, ausência de cortes indevidos e links do WhatsApp. Não houve alteração no código do aplicativo.
