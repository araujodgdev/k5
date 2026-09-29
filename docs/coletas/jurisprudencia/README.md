# Arquivos das coletas assistidas

Em 29/09/2026, os 616 arquivos de trabalho de `output/jurisprudencia` foram retirados da árvore versionada. A pasta misturava downloads oficiais, textos extraídos, respostas de consultas, cópias de verificação, scripts e registros de execução.

Os nove comprovantes de publicação e verificação continuam neste diretório, organizados por tribunal e rodada. Os relatórios das execuções permanecem em [coleta inicial](../../coleta-tribunais-2026-09-28.md) e [continuação](../../coleta-tribunais-continuacao-02.md).

## Arquivo local

A coleta completa, incluindo arquivos que ainda não estavam no Git, foi preservada em dois formatos locais, ignorados pelo Git:

- `.data/jurisprudencia/coleta-original/`: árvore original, com scripts, entradas, relatórios auxiliares e resultados.
- `.data/jurisprudencia/coleta-20260929-090827.zip`: cópia compactada da mesma árvore. Os 616 arquivos foram comparados com o ZIP por SHA-256 antes da movimentação.

Esses arquivos existem somente nesta máquina. Não acompanham um clone do repositório. O arquivamento organiza a árvore de trabalho; não libera o espaço ocupado pelo material original. Nenhum dado do PostgreSQL ou do R2 foi alterado nesta limpeza.

## Restaurar os scripts e suas entradas

Os scripts históricos dependem da estrutura original e, em alguns casos, de caminhos fixos. Para inspecioná-los ou reutilizá-los, restaure a árvore completa. Execute da raiz somente quando `output/jurisprudencia` não existir, evitando sobrepor uma coleta nova:

```powershell
if (Test-Path -LiteralPath 'output/jurisprudencia') {
    throw 'A pasta de destino já existe. Preserve a coleta atual antes de restaurar.'
}
Expand-Archive -LiteralPath '.data/jurisprudencia/coleta-20260929-090827.zip' -DestinationPath 'output/jurisprudencia'
```

A restauração não executa os scripts nem publica lotes. Para republicação, confira os checkpoints atuais e siga os relatórios da execução correspondente.

## Próximas coletas

`output/jurisprudencia/` está ignorado no Git. Downloads, respostas brutas e cópias de transferência devem permanecer ali. Preserve em `docs` apenas os relatórios e comprovantes necessários para registrar o resultado. Scripts que passarem a fazer parte da operação regular devem receber um local próprio fora de `output`, com entradas e caminhos documentados.
