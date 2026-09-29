# Validação da pesquisa Zima Jud

Data: 28/09/2026.

- PDF final: `output/pdf/zima-jud-pesquisa-negocio.pdf`, 24 páginas, 166.455 bytes.
- Verificados extração de texto, caracteres esperados, limites físicos das páginas e 89 links no PDF. Nenhum problema detectado pelo verificador.
- As 24 páginas foram renderizadas e inspecionadas em três folhas de contato; as páginas de cenários e Business Model Canvas também foram inspecionadas em tamanho ampliado. Sem sobreposição ou corte identificado.
- O Canvas está em página horizontal. Texto e tabelas permanecem selecionáveis; fontes incorporadas, marcadores de navegação e referências clicáveis.
- Revisões de conteúdo conferiram preços/condições da concorrência e cálculos de TAM/SAM, retenção, CAC/LTV, receita anual e trajetória de 36 meses.
- Ajustes da revisão: ARPA de R$249 baseado apenas nos planos iniciais, e 20 a 32 demonstrações para sustentar a meta de 5 a 8 vendas a 25% de conversão.
- As fontes municipais insuficientes, a inexistência de métricas próprias e os limites da leitura estática do MVP estão declarados no relatório.
- Nenhum código da aplicação foi alterado. Lint, typecheck, testes e build da aplicação não se aplicam à entrega documental. Não houve homologação funcional, auditoria jurídica ou de segurança.
- Todos os caminhos locais referenciados foram conferidos. A política automática bloqueou a tentativa de remover os intermediários de renderização; eles foram preservados em `tmp/pdfs/zima-jud`.

## Reprodução

Da raiz do repositório, com Python disponível via uv:

```powershell
uv run --with reportlab --with pymupdf --with pypdf python docs/research/build_zima_report.py
uv run --with reportlab --with pymupdf --with pypdf python docs/research/verify_zima_pdf.py
```

O gerador usa fontes Arial do Windows. A versão Markdown fica em `docs/research/zima-jud-relatorio-negocio.md`; as premissas calculadas ficam em `output/pdf/zima-jud-premissas.json`. O verificador recria as imagens temporárias em `tmp/pdfs/zima-jud`.
