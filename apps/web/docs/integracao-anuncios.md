# Anúncios no ChatGPT

## Etapa implementada

`/app/ads` oferece a validação e conexão da conta OpenAI Ads do escritório.
O administrador informa uma chave da **Advertiser API**, gerada no OpenAI Ads.
O servidor consulta `GET https://api.ads.openai.com/v1/ad_account` antes de salvar.
Chaves da API de modelos não substituem a chave da Ads API.

A tela mostra conta, moeda, fuso, situação, revisões retornadas e última verificação.
Revisões ausentes ou desconhecidas aparecem como **Não confirmada**.
Acesso à API não significa autorização para veicular anúncios ou disponibilidade no Brasil.
Confira os mercados e condições da conta no OpenAI Ads.

Criação, publicação, pausa, orçamentos e relatórios de campanhas fazem parte da
próxima etapa, depois de homologar uma conta real. Esta entrega não publica anúncios.

## Acesso pelo Flagship

Flag booleana: `chatgpt-ads`. O aplicativo usa `false` como fallback, inclusive em
erros, respostas inválidas e timeout de 1,5 segundo. Não existe override público.
A flag é independente de `whatsapp-integration`; ambas usam o avaliador compartilhado.

O servidor obtém o contexto da sessão e do escritório ativo:

| Atributo | Valor |
| --- | --- |
| `office_id` | ID do escritório ativo |
| `user_id` | ID do usuário autenticado |
| `role` | Papel atual no escritório |
| `targetingKey` | `office_id:user_id` para distribuição estável |

No app Flagship de staging `lume-staging`, ID `2563a30d-9bc9-45e2-a06b-fafec09b879a`,
a flag foi criada desativada, com variantes `disabled=false`, `enabled=true`,
`default_variation=disabled` e nenhuma regra. A criação da flag não publica o aplicativo.

Para liberar o piloto, mantenha o padrão `disabled` e adicione uma regra que sirva
`enabled` quando `office_id` e/ou `user_id` corresponderem ao público escolhido.
Depois ative a avaliação da flag. Apenas mudar `enabled` para `true`, sem regras,
continua retornando o padrão `false`. Não mude o padrão para `true` para um piloto restrito.

Workers usam o binding `FLAGS` já configurado no web Worker. Processos Node usam
`CLOUDFLARE_ACCOUNT_ID`, `FLAGSHIP_APP_ID` e `FLAGSHIP_EVALUATE_TOKEN`, com permissão
de avaliação. São as mesmas variáveis já usadas pelo piloto do WhatsApp.

Menu desktop, tooltip do menu recolhido, menu Mais e cabeçalho móvel identificam
o módulo com **BETA**. Sem acesso, o menu não aparece e página/API recusam acesso.
Uma aba já aberta pode manter a navegação até a próxima atualização, mas cada
operação da API reavalia a flag e a sessão.

## Credenciais e permissões

- Apenas administradores habilitados podem conectar, atualizar, verificar e desconectar.
- Advogados e revisores habilitados podem consultar os dados da conexão.
- A conta é compartilhada no escritório; a mesma conta externa não pode ser vinculada a outro escritório.
- O cliente nunca escolhe o `office_id`. Sessão e vínculo são revalidados no servidor.
- Chaves usam AES-256-GCM e o keyring existente `K5_CREDENTIALS_KEY`, incluindo rotação por `K5_CREDENTIALS_NEXT_KEY` e `K5_CREDENTIALS_PREVIOUS_KEYS`.
- A chave não é retornada pela API. Corpos de erro da OpenAI não são expostos.
- Verificação malsucedida preserva a conexão anterior. Alterações concorrentes exigem recarregar a conexão.
- Desconectar remove a credencial local; não revoga a chave externa nem pausa campanhas existentes.

Migração aditiva: `db/postgres/0041_ads_connection.sql`. Histórico técnico sem chaves
em `ads_connection_audit`. Execute `pnpm db:setup` antes de usar o módulo.

## Homologação

1. Publique a versão com a migração aplicada e o binding `FLAGS` disponível.
2. Libere `chatgpt-ads` para o escritório e usuário de teste pelo Flagship.
3. Abra **Anúncios BETA** com um administrador e informe a chave pela tela, nunca pelo chat ou Git.
4. Confira o ID, moeda, fuso e revisões com a conta no OpenAI Ads.
5. Teste verificar novamente, acesso de revisor, acesso negado para outro usuário e desligamento da flag.
6. Confirme os países e recursos habilitados antes de avançar para a criação de campanhas.

Os testes locais usam PostgreSQL real, sessões persistidas e respostas controladas
na fronteira OpenAI/Flagship. Não comprovam acesso de uma conta real nem veiculação.

## Referências

- [OpenAI Advertiser API](https://developers.openai.com/ads/api-overview)
- [Autenticação e escopo da chave](https://developers.openai.com/ads/api-reference/authentication)
- [Dados da conta](https://developers.openai.com/ads/api-reference/ad-account)
- [Flagship](https://developers.cloudflare.com/flagship/)
- [Métodos do binding](https://developers.cloudflare.com/flagship/binding/methods/)
