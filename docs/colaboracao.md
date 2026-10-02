# Colaboração em escritórios e casos

## Usar na interface

- **Escritório → Equipe:** administradores convidam pessoas pelo e-mail, alteram papéis e
  removem membros. O último administrador não pode ser removido nem perder o papel.
- **Escritório → Associados:** administradores e advogados mantêm uma lista de parceiros
  que aceitaram a associação. A lista sugere destinatários ao convidar para um caso.
- **Cofre → Caso → Participantes:** convide alguém para consultar ou colaborar naquele caso.
  Não é necessário fazer parte da equipe nem aceitar uma associação antes.
- **Escritório → Convites:** a pessoa aceita ou recusa os convites recebidos. Convites para
  casos abrem o caso após o aceite. Ao integrar outra equipe, o seletor **Escritório ativo**
  permite alternar os escritórios sem perder o original.

Os convites expiram em sete dias e podem ser cancelados antes do aceite. Contas existentes
recebem o convite dentro do Lume. O criador também recebe um link que pode copiar e
compartilhar. **Não há envio automático por e-mail.** Para um endereço ainda sem conta,
o destinatário precisa do link secreto e deve entrar ou cadastrar-se com aquele e-mail.
O banco guarda apenas o hash do token; o link completo é apresentado quando criado.

## O que cada vínculo permite

| Vínculo | Acesso |
| --- | --- |
| Administrador da equipe | Dados compartilhados do escritório, gestão da equipe e permissões administrativas existentes. |
| Advogado da equipe | Consulta e edição dos dados compartilhados, associados e participantes de casos. |
| Revisor da equipe | Consulta dos dados compartilhados; sem edição ou gestão de pessoas. |
| Associado | Nenhum conteúdo por si só. A participação em um caso exige outro convite. |
| Participante com consulta | Arquivos, pastas, fontes de conhecimento e referências do caso, incluindo downloads. |
| Participante com colaboração | Também envia, organiza, edita e remove arquivos, edita dados do caso, referências e gera anexos. |

A equipe tem acesso a todos os casos do escritório conforme seu papel. Um participante
externo acessa somente o caso aceito. Ele não pode mover arquivos para fora dele, excluir
o caso, acessar a biblioteca geral, os clientes ou as atividades do escritório.
A permissão **Pode convidar** é independente da edição. Quando delegada, permite convidar
para o mesmo caso, com acesso igual ou menor, sem delegar essa permissão a terceiros.
Somente a equipe responsável gerencia as permissões e remove participantes.

**Conversar sobre o caso** seleciona o caso no Lume e usa suas fontes autorizadas.
Conversas, memória pessoal, rascunhos de documentos e conexões Google continuam pessoais;
aceitar um convite não compartilha esses dados. Processos judiciais e tarefas de Pesquisa
executadas pelo escritório permanecem disponíveis à equipe. As referências já vinculadas
ao caso podem ser consultadas pelos participantes externos.

Remover um associado mantém suas participações nos casos. Remover um participante revoga
aquele caso. Remover alguém da equipe revoga também participações antigas e convites
pendentes ligados à pessoa naquele escritório. Arquivos e alterações já feitos permanecem.
O servidor verifica novamente o acesso nas operações seguintes, inclusive downloads,
fontes e ferramentas do agente. Conteúdo já baixado não pode ser recolhido.

## Implementação e validação

A migração `apps/web/db/postgres/0031_collaboration.sql` remove a restrição de um escritório
por usuário e cria `office_associate`, `case_participant`, `collaboration_invitation` e
`collaboration_audit`. Não execute SQL manualmente: use `pnpm db:setup`, que aplica somente
as migrações pendentes. O escritório ativo é uma preferência validada contra a sessão;
nenhum ID fornecido pelo cliente concede acesso.

O módulo `apps/web/src/lib/collaboration/` concentra convites, gestão e resolução de acesso.
As operações compartilháveis usam uma lista explícita e um contexto limitado a um caso.
Recursos secundários (documentos, pastas e referências) também precisam pertencer ao caso.
Aceites e mudanças de acesso usam transações com o mesmo bloqueio por escritório para
evitar aceite duplo, conflitos com revogação e perda do último administrador.

`pnpm test` inclui cenários reais de PostgreSQL em `tests/collaboration.test.ts` e
`tests/auth.test.ts`: isolamento, consulta/edição, revogação, associação, múltiplos
escritórios, aceite concorrente, tokens, expiração e delegação.

A validação de interface é `apps/web/e2e/collaboration.e2e.ts`, parte da
[suíte e2e](../apps/web/README.md#testes-end-to-end) que roda no CI. Para repeti-la na raiz:

```sh
pnpm --filter @k5/web exec e2e run e2e/collaboration.e2e.ts
```

O teste cria duas contas descartáveis (dona e parceira), um caso de teste e um documento de
teste; concede e revoga acesso ao caso, associação e equipe, e confere troca de escritório,
CSRF e recuperação de erro no celular. Não usa contas reais nem envia mensagens.
