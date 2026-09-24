# Rotação da chave mestra

`K5_CREDENTIALS_NEXT_KEY` permite preparar uma nova chave sem recuperar ou exportar a
chave antiga: enquanto estiver definida, as escritas usam NEXT e a leitura aceita
NEXT, KEY e PREVIOUS_KEYS. Sem NEXT, o comportamento anterior é preservado.

## Deploy e credenciais do PostgreSQL

A chave mestra cifra os dados da aplicação; ela não autentica no PlanetScale.
O PR 16 não adicionou migrações de esquema. `deploy:vinext` verifica primeiro os
nomes e checksums das migrações em uma transação somente de leitura, usando
`PROCESSOR_DATABASE_URL` do arquivo privado `.env.postgres.local` (ou `K5_ENV_FILE`).
Se essa URL não estiver configurada, usa `DATABASE_URL_UNPOOLED` para a conferência.
Com o esquema atualizado, a publicação não depende da credencial administrativa
temporária. Havendo migrações pendentes, somente `DATABASE_URL_UNPOOLED` pode aplicá-las;
falhas de autenticação, conexão ou checksums continuam bloqueando a publicação.

Para conferir o banco sem aplicar migrações, compilar ou publicar:

```sh
pnpm --filter @k5/web deploy:vinext --check
```

O erro `28P01` significa autenticação recusada. Emita ou renove o papel administrativo
no PlanetScale e atualize `DATABASE_URL_UNPOOLED` no ambiente ou arquivo privado;
variáveis já exportadas no processo têm precedência sobre o arquivo. O papel de
execução e o administrativo devem apontar para o mesmo endpoint direto e banco do
Hyperdrive publicado. Não use `.env.local` de desenvolvimento para esse deploy.

O deploy [preserva os secrets remotos do Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/workers/), incluindo KEY, NEXT e PREVIOUS;
não envia o chaveiro local, não promove chaves e não executa a recifragem. A preparação
de todos os runtimes e a confirmação pela interface continuam sendo etapas abaixo.
Não existe opção para publicar ignorando migrações pendentes.

## Preparar os runtimes

1. Gere 32 bytes aleatórios em base64 e guarde a nova chave em um cofre ou arquivo
   com acesso restrito, fora do repositório. Preserve também um backup cifrado do banco.
2. Publique primeiro o código compatível em web, processadores, notificações e
   integrações. Configure a mesma NEXT em cada runtime que já possui a chave antiga.
   Um Worker novo pode receber a nova chave como KEY somente depois da migração dos
   dados que ele lê; não presuma que consiga ler dados antigos com ela.
3. Aguarde a propagação e a substituição dos Containers. Um processo antigo conserva
   seu ambiente inicial; confirme que nenhum escritor usa apenas o chaveiro anterior.
   Faça a operação em uma janela sem edições de conexões nem operações Google em curso.
4. Em **Administração → Credenciais**, confira o identificador da chave ativa e a
   ausência de credenciais ilegíveis. Confirme o preparo dos runtimes e execute
   **Atualizar proteção das credenciais**. A API exige sessão de administrador da
   plataforma, mesma origem e o identificador de chave exibido na conferência.

A recifragem e sua auditoria usam uma única transação PostgreSQL, com bloqueios de
linha e serialização das rotações. Uma credencial ilegível aborta todas as alterações.
Ela cobre IA, TypeSafe, inscrições push, referências temporárias, tokens e estados
OAuth Google, argumentos/resultados/checkpoints de operações. Referências consumidas
vazias e campos nulos permanecem como estão. Não altera documentos nem índices.

O comando `pnpm platform:admin rotate-key --email <administrador>` usa a mesma
transação completa quando o operador dispõe do chaveiro local. Nunca passe chaves
nos argumentos do comando, nos logs ou nas requisições da interface.

## Concluir

Confira novamente até que todas as credenciais estejam legíveis e a contagem de
pendentes seja zero. Verifique uma conexão e os runtimes publicados. Mantenha a chave
antiga disponível para backups anteriores e processos em propagação.

Promova NEXT para KEY somente com a antiga preservada em PREVIOUS_KEYS. No Cloudflare,
`inherit` com `old_name` **renomeia**, não duplica o binding. Se o operador usar esse
recurso do plano de controle, faça duas etapas: KEY → PREVIOUS_KEYS enquanto NEXT
continua ativa, depois NEXT → KEY. Não sobrescreva um PREVIOUS_KEYS já existente:
nesse caso mantenha KEY + NEXT até preparar um plano que preserve todo o chaveiro.
Durante a primeira etapa o parser aceita NEXT com PREVIOUS_KEYS mesmo sem KEY.
Atualize/reinicie os processadores após cada mudança de configuração relevante.

Remova NEXT apenas após a promoção e uma nova conferência. Não remova chaves antigas
necessárias a backups. Não volte para uma versão que ignore NEXT depois que houver
escritas com a nova chave, a menos que seu chaveiro também a aceite.
