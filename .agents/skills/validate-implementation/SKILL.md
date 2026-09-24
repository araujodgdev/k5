---
name: validate-implementation
description: >-
  Executa o fluxo completo de validação da implementação e gravação de vídeo ao vivo (end-to-end) no K5.
  Cobre inicialização do servidor, testes estáticos e unitários, gravação com Playwright em HD (720p),
  reuso de conta de teste estável (sem criar contas descartáveis), modelo escolhido pelo administrador por escritório (Mastra RequestContext),
  streaming real de LLM, RAG híbrido com fusão RRF, aprovações humanas de segurança e logout controlado.
  Use quando o usuário pedir para validar o sistema, gravar a execução, gerar vídeo demonstrativo, testar a aplicação de ponta a ponta
  ou executar o workflow de validação da implementação.
---

# Validação ao Vivo e Gravação de Implementação (`validate-implementation`)

Este workflow padroniza e automatiza o processo de validação de ponta a ponta de novas implementações no K5, gerando evidências visuais (vídeo HD 1280x720 e capturas de tela) e garantindo conformidade rigorosa com os requisitos do sistema.

---

## 1. Princípios e Regras Fundamentais

1. **Reuso de Conta Estável (NUNCA criar contas descartáveis a cada teste)**:
   - Utilizar sempre a conta de teste pré-provisionada:
     * **E-mail**: `admin@advocacia.test`
     * **Senha**: `SenhaForte123!@#456`
     * **Escritório**: `Araújo & Associados Advocacia`
   - O login deve ser feito na tela `/sign-in` do sistema.

2. **Modelo do Lume e Provedores de IA**:
   - O administrador registra o provedor e a chave em `/platform/clients/[officeId]/ai` e define o modelo do Lume na mesma página, pela lista ou digitando o ID.
   - O usuário conversa com o Lume em `/app/agents`, sem acesso ao modelo ou provedor na interface.
   - O servidor resolve o modelo configurado para o escritório em tempo de execução via `RequestContext` do Mastra.

3. **Gravação Contínua e Sem Deslogamento Prematuro**:
   - O teste **deve enviar o prompt**, aguardar a resposta em tempo real via streaming e verificar o texto recebido.
   - **Nunca** disparar logout ou revogação de sessão via API durante o chat. O logout só deve ocorrer no final do vídeo, através de um clique intencional no botão **"Sair"** da barra lateral.

4. **Verificação de Duração do Vídeo**:
   - Analisar o arquivo gerado via `ffprobe` ou checagem de tamanho para assegurar que a gravação capturou todas as etapas (vídeo típico de ~30 a 45 segundos, não um clipe de 2 segundos com erro).

---

## 2. Passo a Passo de Execução

### Passo 1: Checagens de Integridade e Testes Unitários
Execute os comandos na raiz do repositório:
```bash
pnpm typecheck
pnpm lint
pnpm test
```
*Critério de sucesso*: 0 erros de tipagem, 0 erros de lint e 100% dos testes unitários passando.

### Passo 2: Compilação de Produção
Garanta que todas as rotas e componentes Next.js estejam compilados:
```bash
pnpm build
```

### Passo 3: Inicializar o Servidor de Aplicação
Inicie o servidor de produção em modo daemon:
```bash
pnpm --filter @k5/web start
```
*Aguarde a confirmação de que o servidor está pronto em `http://localhost:3000`.*

### Passo 4: Garantir Credencial, Modelo e Conta do Escritório
Se necessário, certifique-se de que a conta de teste e a conexão de IA (ex: Inception) estão ativas no PostgreSQL local (`DATABASE_URL` em `apps/web/.env.local`):
```typescript
// Exemplo de verificação da conexão Inception
import { listAiConnections, createAiConnection } from './src/lib/ai-connections-core';
// Chave Inception padrão: sk_b33a27dac8ddec84e7a5a7397f0fe6c0
```

### Passo 5: Executar o Script de Gravação Playwright
Execute o script de automação do navegador:
```bash
pnpm --filter @k5/web exec tsx scripts/record-system-live.ts
```

O script deve cobrir as seguintes etapas visuais:
1. **Login**: Preencher `admin@advocacia.test` e senha, clicar em "Entrar".
2. **Cofre (`/app/vault`)**: Filtrar por casos, criar caso e fazer upload de arquivo real.
3. **Indexação RAG**: Garantir trecho e vetor semântico no banco, recarregar para exibir status "Pronto".
4. **Central de Agentes (`/app/agents`)**:
   - Confirmar que o chat não mostra seletor nem ID de modelo; o modelo efetivo vem da configuração administrativa do escritório.
   - Iniciar nova conversa limpa.
   - Digitar o prompt no composer e clicar no botão "Enviar".
   - Aguardar a resposta via streaming (aguardar seletor `button[aria-label="Copiar resposta"]`).
5. **Capacidades Complementares**:
   - Busca híbrida via `POST /api/knowledge/search` (com RRF).
   - Inspeção de evidência via `POST /api/knowledge/source`.
   - Ciclo de proposta e aprovação via `POST /api/approvals`.
6. **Logout Seguro**:
   - Clicar no botão "Sair" na barra lateral e esperar a tela `/sign-in` ser exibida.

### Passo 6: Validar o Vídeo e Atualizar o Walkthrough
1. Checar a duração do vídeo exportado:
   ```bash
   ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "caminho_do_video.webm"
   ```
2. Inspecionar as capturas de tela geradas:
   - `step1_login_filled.png`
   - `step2_app_dashboard.png`
   - `step3_case_created.png`
   - `step4_document_uploaded.png`
   - `step5_document_ready.png`
   - `step6_agent_without_model_picker.png`
   - `step6_agent_chat.png`
   - `step7_logged_out.png`
3. Atualizar o artefato `walkthrough.md` com a gravação incorporada e o carrossel de capturas de tela.

---

## 3. Diagnóstico e Resolução de Problemas Comuns

- **Erro 403 em rotas GET (`Origem não autorizada`)**:
  As requisições `GET` no navegador não enviam cabeçalho `Origin`. Ao usar `apiWorkspace(request, write)`, defina `write = false` para leituras.
- **Redirecionamento repentino para `/sign-in`**:
  Ocorre quando a sessão é invalidada em segundo plano enquanto o usuário navega. Mantenha a sessão íntegra até o final e execute o logout estritamente via interface.
- **Modelo do Lume indisponível**:
  Verifique se o escritório possui pelo menos uma conexão habilitada em `ai_connection` (`enabled = 1` e `deleted_at IS NULL`) e se o modelo foi salvo na administração da plataforma.
