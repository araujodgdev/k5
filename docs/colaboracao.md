# Associados e acesso aos casos

Cada advogado tem um único escritório pessoal. Administração da plataforma é um acesso separado. Não existem equipe, papéis de escritório ou troca de escritório ativo.

## Convidar e trabalhar juntos

Em **Escritório → Associados**, convide outro advogado pelo e-mail. Ele aceita ou recusa em **Escritório → Convites**. O aceite torna ambos associados, mas não libera arquivos. O dono do caso escolhe seus associados em **Cofre → Caso → Participantes → Incluir associado**. Cada advogado pode incluir o outro nos próprios casos.

Os convites expiram em sete dias e podem ser cancelados antes do aceite. Contas existentes recebem o convite no Lume. O criador também recebe um link para compartilhar. Não há envio automático por e-mail. Para um endereço ainda sem conta, o destinatário precisa do link secreto e deve entrar ou cadastrar-se com aquele e-mail. O banco guarda apenas o hash do token.

## Quem vê o conteúdo

| Recurso | Acesso |
| --- | --- |
| Associação | Nenhum arquivo por si só. |
| Caso e pasta raiz | Dono e participantes consultam e colaboram. Só o dono gerencia participantes e exclui o caso. |
| Pasta pública | Todos do caso, desde que tenham acesso às pastas acima. |
| Pasta privada | Somente quem criou, inclusive quando outra pessoa é dona do caso. |
| Pasta restrita | Criador e pessoas do caso escolhidas por ele, respeitando as pastas acima. |
| Biblioteca, clientes, agenda e integrações | Continuam pessoais; participar de um caso não os libera. |

Ao criar uma subpasta, escolha **Quem vê a pasta**. Somente o criador altera a escolha em **Acesso à pasta**. Uma subpasta pública dentro de uma privada continua invisível aos demais. Nomes podem se repetir entre criadores, evitando revelar pastas privadas por conflito de nome.

Arquivos herdam o acesso da pasta. A regra vale nas listas, busca, downloads, fontes do Lume, conhecimento, modelos e avaliações de Pesquisa. Revogar acesso impede as próximas leituras; conteúdo já baixado não pode ser recolhido. Compartilhar uma versão individual por Mensagens concede acesso explícito àquela versão.

Mover arquivos para fora de uma pasta reservada de outra pessoa é recusado. Excluir uma pasta reservada com conteúdo exige mover esse conteúdo ou ajustar o acesso antes. Excluir um caso com transferência de arquivos também é recusado enquanto houver pastas reservadas, para impedir exposição acidental.

**Conversar sobre o caso** seleciona fontes autorizadas. Conversas, memória, rascunhos, pesquisas pessoais e conexões Google continuam pessoais. Participantes consultam referências e avaliações cujas fontes estejam autorizadas para eles.

Remover um participante revoga o acesso àquele caso. Ele também pode **Sair do caso**. Encerrar uma associação remove o vínculo nos dois sentidos e retira cada advogado dos casos do outro. Arquivos e alterações permanecem, incluindo pastas privadas fora do alcance dos demais.

## Migração e operação

`0059_associate_access.sql` retira papéis e níveis de participação, torna associações mútuas, converte participantes existentes em associados e cancela convites pendentes de equipe/caso. Ela exige um advogado por escritório e um escritório por advogado. Use `pnpm db:setup` para aplicar migrações pendentes, sem alterar migrações já aplicadas.

`0060_folder_access_fail_closed.sql` impede leitura por caminhos de pastas removidos, inexistentes, cíclicos ou que atravessem outro caso ou escritório.

Antes de migrar um ambiente existente, execute a verificação somente de leitura:

```sh
pnpm --filter @k5/web db:migrate --check-associates
```

O comando usa o destino de `K5_ENV_FILE`, com padrão `.env.postgres.local`. Usuários em vários escritórios ou escritórios com vários membros impedem a migração sem alterar dados. Resolva os vínculos e a propriedade dos registros antes de migrar. Nenhum dado é dividido ou removido automaticamente.

`requireWorkspace()` deriva o escritório do usuário autenticado. Cada operação revalida sessão e acesso ao recurso. IDs enviados pelo navegador não concedem acesso. Aceites e revogações usam transações com bloqueios dos escritórios em ordem.

## Validar

`pnpm test` cobre associação mútua, isolamento, participantes, pastas, fontes e revogação em PostgreSQL real. Na raiz:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @k5/web exec e2e run e2e/collaboration.e2e.ts
```

O e2e cria contas descartáveis e confere colaboração, acesso às pastas, revogação e recuperação de erro em desktop e celular. Não usa contas reais nem envia mensagens.
