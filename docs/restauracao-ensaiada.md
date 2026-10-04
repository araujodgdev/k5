# Restauração ensaiada

Runbook do ensaio de recuperação do Lume (frente 5 do [plano dos P0](plano-p0-lancamento-mvp.md)). O ensaio restaura uma cópia isolada e confere quatro coisas:

- o banco PostgreSQL;
- os originais do Cofre no R2;
- a chave das credenciais;
- o índice dos documentos.

Ele também mede o RPO e o RTO. Nada aqui altera produção: a cópia é restaurada ao lado, e a conferência só lê.

## O que cada parte guarda

| Parte | Onde fica | Como volta |
| --- | --- | --- |
| Dados do escritório, conversas, memória de trabalho, texto extraído e trechos indexados | PostgreSQL na PlanetScale | Backup da PlanetScale restaurado num branch novo |
| Originais do Cofre, anexos do chat, PDFs gerados | R2 `k5-vault-staging` (chave `office/documento.ext`) | Os objetos não são apagados na hora: a exclusão passa por `vault_deletion_queue`. Uma cópia restaurada aponta para objetos que continuam no bucket |
| Credenciais de integrações (Google, IA, push) | Colunas `encrypted_*`, cifradas com AES-256-GCM | Só abrem com `K5_CREDENTIALS_KEY` (e `K5_CREDENTIALS_PREVIOUS_KEYS`), guardadas fora do Cloudflare |
| Vetores da busca semântica | Vectorize (`k5-knowledge-staging`) | Reconstruídos a partir dos trechos do banco por `k5_knowledge_reindex`; não precisam de backup próprio |
| Memória Honcho | Honcho (serviço externo) | Não é restaurada: é derivada da memória de trabalho, que está no banco |

## Antes do ensaio

- Guarde `K5_CREDENTIALS_KEY` e `K5_CREDENTIALS_PREVIOUS_KEYS` num cofre de senhas fora da conta Cloudflare. Sem elas, nenhuma credencial cifrada volta, mesmo com o banco restaurado.
- Crie um token R2 **somente leitura** para o bucket `k5-vault-staging`.

## Passo a passo

Anote a hora de cada passo na tabela do fim.

1. **Escolher o ponto.** Na PlanetScale, escolha o backup mais recente do banco de produção. Anote a data e a hora do backup.
2. **Restaurar o banco.** Restaure esse backup num branch novo, por exemplo `restauracao-AAAAMMDD`. Gere uma senha só para ele e copie a URL de conexão direta, sem pooler.
3. **Montar o ambiente.** Crie `apps/web/.env.restore`. Ele fica fora do Git pela regra `.env*`. Preencha:

   ```
   DATABASE_URL=<URL do branch restaurado>
   R2_ACCOUNT_ID=<conta Cloudflare>
   R2_BUCKET=k5-vault-staging
   R2_ACCESS_KEY_ID=<token somente leitura>
   R2_SECRET_ACCESS_KEY=<token somente leitura>
   K5_CREDENTIALS_KEY=<do cofre de senhas>
   K5_CREDENTIALS_PREVIOUS_KEYS=<do cofre de senhas, se houver>
   ```

4. **Conferir.** Na raiz do repositório, rode `pnpm --filter @k5/web restore:check --sample all`. Sem `--sample`, ele lê 200 originais sorteados.
5. **Ler o relatório.** A saída é um JSON e o comando termina com código 1 se algo falhar:
   - `migrations`: `pending` aponta migrações do código que a cópia não tem; `changed`, migrações alteradas; `unknown`, uma cópia mais nova que o código.
   - `originals`: `missing` lista objetos que não existem mais no R2; `mismatched`, objetos cujo SHA-256 difere do registrado.
   - `credentials`: as falhas de descriptografia por coluna. Falha em tudo indica chave errada.
   - `index.withoutChunks`: documentos prontos sem trechos, que precisam de `k5_knowledge_reindex`.
   - `lastWrite`: a escrita mais recente da cópia, que serve para medir o RPO.
6. **Medir.**
   - RPO = hora do incidente simulado (início do ensaio) − `lastWrite`.
   - RTO = do passo 1 até o `ok: true`.
7. **Limpar.** Apague o branch restaurado na PlanetScale, revogue o token R2 e apague `apps/web/.env.restore`.

## Registro dos ensaios

| Data | Backup usado | `lastWrite` | RPO | RTO | Originais conferidos | Falhas | Responsável |
| --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | — | — | — | — |

## Ensaio da ferramenta

Em 03/10/2026, `restore:check` rodou contra uma instância isolada (verify-k5) com as 70 migrações aplicadas:

- `ok: true` em 274 ms;
- nenhuma migração pendente, alterada ou desconhecida.

O teste `tests/restore-check.test.ts` cobre uma cópia fiel e cada tipo de falha:

- original trocado;
- original ausente;
- credencial com a chave errada;
- documento pronto sem trechos;
- migração desconhecida.

O ensaio com o backup de produção ainda não foi feito; ele segue o passo a passo acima.
