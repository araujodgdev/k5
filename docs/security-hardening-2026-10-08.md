# Segurança do Lume — 8 de outubro de 2026

Escopo: `araujodgdev/k5` e `https://lume.software`. Esta alteração prepara controles no
repositório; não representa implantação ou resolução comprovada do incidente em produção.
O relato do incidente não inclui a resposta, conta ou chave exposta. A investigação partiu
dos controles existentes e de testes locais, conforme solicitado.

## Situação dos controles solicitados

| Controle | Situação e evidência |
| --- | --- |
| Chaves em variáveis de ambiente | Os segredos dos serviços já são lidos do ambiente. Não foi identificada uma chave privada hardcoded a mover. Conexões cadastradas pela administração e pelos escritórios continuam cifradas no PostgreSQL, somente no servidor; movê-las ou substituí-las em produção exige acesso ao ambiente e ao banco. Chaves públicas do Picker, Turnstile e Web Push e o DSN do Sentry não são credenciais privadas. |
| Rotacionar chaves expostas no GitHub | **Pendente de acesso aos provedores.** Nenhuma chave foi revogada ou substituída nesta sessão. Remover uma chave do código não invalida cópias. O scanner não identificou credencial revogável nos commits locais alcançáveis. |
| Ignorar `.env` | Já implementado nas regras da raiz e de `apps/web`, com exceção de `.env.example`. Dados locais e arquivos de ambiente não entram no build publicado. |
| RLS do Supabase | **Não aplicado.** O aplicativo usa PostgreSQL/Better Auth, sem cliente ou configuração Supabase. Os controles atuais derivam escritório e pessoa da sessão e aplicam ACLs no servidor. Não se deve adicionar uma política genérica de `office_id`: a colaboração entre escritórios tem permissões explícitas. Um futuro projeto Supabase precisa de identificação do projeto, papel de runtime sem bypass e políticas por operação; ligar RLS com um papel proprietário ou superusuário não comprova isolamento. |
| Validação no servidor | Zod, capabilities e serviços validam no servidor. O adaptador de capabilities agora preserva erros de limite/parsing, em vez de transformá-los em um objeto vazio; JSON com array ou primitivo é recusado. O navegador não escolhe o escritório autorizado, a chave de armazenamento ou os papéis. |
| Autenticar APIs | Revisadas as entradas das 189 rotas: sessão do escritório/pessoa/portal, papel de plataforma ou adaptador de capability. Login, cadastro e convites possuem seus próprios controles; webhooks usam assinatura/token e não dependem de cookie do navegador. Há testes reais de isolamento entre pessoas/escritórios e regressões HTTP para APIs privadas. |
| Limitar login/cadastro | Better Auth persiste limites no PostgreSQL: 10 tentativas por minuto por endpoint. Cabeçalhos de IP são confiáveis somente quando sobrescritos pelo proxy; sem um cabeçalho confiável, há um limite compartilhado. Cobertura de login e cadastro recusado. |
| Hash de senhas | Better Auth mantém hashing scrypt e verificação de senha atual; não foi substituído por hashing próprio. Testes conferem hash distinto da senha, redefinição de uso único e revogação de sessões. |
| HTTPS | Origem pública de produção exige HTTPS; HSTS cobre Next.js, Worker e assets. Builds locais podem usar loopback HTTP. **TLS e redirecionamento HTTP na borda ainda precisam de verificação com acesso à Cloudflare.** |
| CORS restrito | APIs permanecem de mesma origem, sem liberar CORS para terceiros. Produção aceita somente `BETTER_AUTH_URL`; domínios adicionais e curingas de túneis são recusados. Configure `https://lume.software` e remova `BETTER_AUTH_TRUSTED_ORIGINS` em produção. |
| Injeção SQL | SQL usa parâmetros vinculados e validação de domínio. Não há uma limpeza genérica que remova apóstrofos ou altere conteúdo jurídico legítimo. Nomes de recursos e escritório não concedem autorização. |
| XSS | React escapa texto; Markdown cria elementos React e imprime HTML cru como texto, aceitando somente links HTTP(S), mailto e relativos. Prévias de conteúdo usam seus controles próprios de sandbox; a alteração mantém essas políticas. |
| CSRF | Operações mutáveis validam Origin no servidor; Better Auth mantém sua proteção própria e cookies SameSite=Lax. Regressão HTTP prova que uma sessão válida de outro domínio não altera o perfil. |
| Uploads | Limites de bytes antes do parsing e durante streaming; allowlist de extensões; novos checks de assinatura binária para PDF, DOCX, XLSX, PNG, JPEG e WebP antes de armazenar. EML/CSV/TXT são texto. Assinatura inicial não substitui parser, sandbox ou varredura antimalware. |
| Ocultar erros internos | Erros tipados 5xx das APIs, Cofre e plataforma passam a responder texto genérico, sem mensagem privada ou stack. Telemetria preserva apenas diagnósticos seguros. |
| Cookies seguros | Better Auth usa HttpOnly, SameSite=Lax e Secure explicitamente para origem HTTPS. Revogação imediata e logout global preservados. |
| Dependências | Atualizados pacotes diretos e lockfile, inclusive Next.js, React, Better Auth, SDKs de IA e Sentry. Overrides corrigem uuid, basic-ftp, fflate e sharp. TypeScript passou de 5.9 para 6.0.3; 7.0.2 foi testado e é incompatível com o compilador JS usado pelo typescript-eslint e pelos testes de AST. ESLint 10 executa, embora três plugins ainda declarem peer até 9. |
| Registrar login recusado | Novo evento JSON `auth.login_failed` para respostas recusadas, inclusive CSRF e rate limit: horário, status, ID do evento e HMAC do IP confiável. Sem corpo, e-mail, senha, cookie, token ou IP cru. Logs precisam da retenção/observação do provedor em produção. |
| Backup diário | Workflow preparado para 03:00 de São Paulo, dump custom PostgreSQL cifrado por age e retenção de 30 dias. **Ainda não ativo/verificado no GitHub:** é preciso publicar a alteração e configurar o destinatário público. O teste restaura uma cópia e verifica limpeza após falha. |
| Limite financeiro de IA | Excluído do escopo a pedido do usuário. |

APIs também recebem `private, no-store` e `CDN-Cache-Control: no-store` em ambos os
runtimes, inclusive erros e redirecionamentos. Isso evita depender de cada rota para
impedir armazenamento de respostas privadas em caches compartilhados.

## Chaves e incidente

Gitleaks 8.30.1 verificou 216 commits locais alcançáveis (`--all`), cerca de 62,7 MB.
Os 17 candidatos foram revisados: fixtures públicas de criptografia do CI, identificadores
de importação judicial, uma frase sobre OAuth, o nome de uma chave de localStorage e a
constante **pública** de assinatura da AbacatePay. `.gitleaksignore` contém fingerprints
por commit/arquivo/regra/linha, não permissões amplas por diretório. Novas credenciais
nesses arquivos continuam sujeitas à verificação. Não foram verificados forks ou
branches que não estejam no clone local.

Para chaves efetivamente expostas, o operador deve revogar a credencial no provedor,
criar uma substituta com permissões mínimas, atualizar o secret em todos os runtimes e
testar a conexão sem imprimir a chave. No caso das conexões cifradas, atualizar a
conexão autenticada na plataforma ou integração correspondente. Rotação da chave mestra
de criptografia tem um procedimento separado em [rotação de credenciais](rotacao-credenciais.md);
não a substitua às cegas, pois as credenciais já armazenadas ficariam ilegíveis.
Se o segredo de sessão tiver sido exposto, inclua revogação das sessões e troca do
`BETTER_AUTH_SECRET` na resposta ao incidente.

## Ativar backups

1. Em uma máquina segura, executar `age-keygen -o lume-backup-identity.age` e guardar a
   identidade privada fora do repositório/GitHub. Manter uma cópia offline recuperável.
2. Configurar a variável do repositório `K5_BACKUP_AGE_RECIPIENT` com **somente** o
   destinatário público `age1…` produzido pelo comando.
3. Configurar/verificar o secret `DATABASE_URL_UNPOOLED`, com acesso direto ao banco
   alvo e `sslmode=verify-full`, com CA disponível quando exigida pelo provedor. O script
   exige verificação de certificado e hostname fora de loopback. O backup não utiliza
   o Hyperdrive ou um endpoint de pool.
4. Executar manualmente **Encrypted daily database backup** e conferir o artifact
   cifrado e seu checksum. O agendamento só funciona após a publicação na branch padrão.
5. Restaurar em um banco isolado antes de considerar o backup operacionalmente válido.
   Conferir o resultado e os alertas dos próximos jobs diários. GitHub pode atrasar cron.

Restauração: verificar o `.sha256` no diretório do artifact, decifrar com
`age --decrypt --identity /caminho/seguro/lume-backup-identity.age --output restore.dump backup.dump.age`
e usar `pg_restore --exit-on-error --no-owner --no-acl --dbname nome_do_banco restore.dump`
com credenciais passadas pelas variáveis `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` e TLS.
Não restaurar por cima de produção para ensaiar. Dumps não incluem os objetos do R2,
credenciais de infraestrutura ou as identidades privadas necessárias para decifrar.

## Vulnerabilidades sem versão corrigida

Depois dos updates/overrides, a auditoria ainda informa três avisos altos e um moderado:

| Pacote | Avisos | Situação |
| --- | --- | --- |
| extract-zip 2.0.1 | GHSA-jmr9-qjv8-65gv; GHSA-7pqw-9j4j-h8q3 | Dependência transitiva do tooling de `@cloudflare/puppeteer`; extração de symlinks. Nenhuma versão corrigida publicada na consulta. |
| braces 3.0.3 | GHSA-vfj7-8cjw-p6xm | Dependência transitiva de ferramentas; padrões profundamente aninhados. Nenhuma versão corrigida publicada. |
| sprintf-js | GHSA-hp3w-g68c-fv3c | Dependência transitiva de argparse/Mammoth; precisão ilimitada. Nenhuma versão corrigida publicada. |

Os avisos não foram suprimidos. O novo job `dependencies` falha para avisos altos até
que haja correção upstream ou substituição validada. A classificação transitiva não
comprova que o código vulnerável seja alcançável por um usuário; também não o declara seguro.

## Validação

- `pnpm lint`: passou, com um aviso preexistente de `_bytes` não utilizado em
  `src/lib/judicial/connectors/transport.ts`. Os arquivos de backup também passaram
  por lint após a exigência de TLS verificado.
- `pnpm typecheck`: passou nos dois aplicativos.
- `pnpm test`: 1.010 testes passaram, zero falhas. O teste adicional de backup foi
  pulado nesse comando por falta dos binários no PATH e executado separadamente com
  age/PostgreSQL 18: passou sem skips, incluindo restauração exata, limpeza após
  falha e recusa de uma conexão remota com TLS desativado.
- Build de produção Next.js e build vinext/Cloudflare: passaram. O proxy e sua CA
  foram preservados pelo Turbo; a verificação TLS permaneceu habilitada.
- E2E no build de produção: sete testes passaram, incluindo autenticação pelo
  formulário, navegação autenticada, recusa de APIs anônimas, CSRF, limites de
  corpo/formato e uploads no limite de 100 MB e um byte acima.
- Gitleaks: histórico local revisado sem credenciais confirmadas; snapshot das
  alterações sem novos candidatos. Workflows YAML, sintaxe dos scripts e
  `git diff --check` passaram.
- `pnpm audit`: zero avisos críticos, três altos e um moderado sem versão corrigida
  publicada, conforme detalhado acima. O check de dependências continua bloqueado.

As solicitações HTTP a `lume.software` retornaram 403 neste ambiente; não houve
verificação conclusiva do runtime publicado, configuração de conta, backups ativos
ou causa original do vazamento. Esta alteração propõe controles no repositório e não
implanta mudanças em produção.
