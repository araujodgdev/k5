# Flagship para liberar WhatsApp por escritório

Pesquisa em **27/09/2026**, limitada à documentação oficial Cloudflare e ao Wrangler **4.135.0** instalado. Nenhuma configuração de nuvem foi alterada.

## Recomendação

Usar uma flag booleana `whatsapp-integration`, padrão `off`, com lista explícita de `office_id` inicialmente. Avaliar no servidor a partir do escritório autenticado; autorização e isolamento continuam usando sessão, papéis e `office_id`. A flag controla liberação de produto e não substitui essas verificações. No Worker, preferir binding; no Next.js/Node, usar avaliação REST ou SDK servidor. Sem configuração, falha, timeout ou resposta inválida: devolver `false`.

## Configuração e contrato de targeting

Configuração proposta da flag (IDs abaixo são placeholders, não uma seleção real):

```json
{
  "key": "whatsapp-integration",
  "type": "boolean",
  "enabled": true,
  "default_variation": "off",
  "variations": { "off": false, "on": true },
  "rules": [{
    "priority": 1,
    "conditions": [{
      "attribute": "office_id",
      "operator": "in",
      "value": ["OFFICE_ID_A", "OFFICE_ID_B"]
    }],
    "serve_variation": "on"
  }]
}
```

`in` compara o atributo com os membros da lista. Primeira regra correspondente vence; sem correspondência, retorna a variação padrão. Desabilitar a flag ignora regras e retorna a variação padrão. Portanto, `enabled: true` não significa liberar todos. [Operadores](https://developers.cloudflare.com/flagship/targeting/operators/) e [conceitos](https://developers.cloudflare.com/flagship/concepts/).

Depois, manter a regra dos pilotos em prioridade 1 e acrescentar em prioridade 2 uma regra com `rollout: { "percentage": 5, "attribute": "office_id" }`. Toda avaliação precisa de ID estável; isso mantém o escritório inteiro no mesmo grupo, independentemente de usuário/dispositivo. Ausência do atributo pode gerar distribuição aleatória. [Rollouts](https://developers.cloudflare.com/flagship/targeting/percentage-rollouts/).

## Workers e Wrangler 4.135.0

Formato validado no schema instalado e correspondente à documentação atual:

```jsonc
{
  "flagship": [{
    "binding": "FLAGS",
    "app_id": "APP_ID_REAL",
    "remote": true
  }]
}
```

- `flagship` é **array** no schema 4.135.0; não usar a forma objeto sugerida pela referência bundled antiga.
- `remote: true` faz o desenvolvimento Wrangler avaliar o app remoto. O schema e CLI instalados também suportam simulador local; isso diverge do texto da página de configuração, que ainda descreve apenas flags remotas.
- Ambiente nomeado não herda esse binding: declará-lo em cada ambiente necessário. Separar apps de staging e produção é uma escolha recomendada para evitar alteração cruzada.
- Em produção, fornecer `app_id` real. Não colocar placeholder executável em configuração de deployment.
- Gerar tipos com `pnpm exec wrangler types` pelo fluxo do projeto. O binding tem tipo `Flagship` e não precisa de token.

[Configuração oficial](https://developers.cloudflare.com/flagship/configuration/). Evidência local: `node_modules/.pnpm/wrangler@4.135.0_@types+node@26.5.1/node_modules/wrangler/config-schema.json`, propriedade `flagship` (linhas 1472, 3248 e 5199); CLI identifica `flagship` como `local-and-remote`.

Exemplo de avaliação, recebendo `officeId` já derivado de `requireWorkspace()`:

```ts
type FlagBinding = {
  getBooleanValue(
    key: string,
    fallback: boolean,
    context: Record<string, string>,
  ): Promise<boolean>;
};

export async function whatsappInWorker(
  officeId: string,
  flags?: FlagBinding,
): Promise<boolean> {
  if (!officeId || !flags) return false;
  try {
    return (await flags.getBooleanValue("whatsapp-integration", false, {
      office_id: officeId,
      targetingKey: officeId,
    })) === true;
  } catch {
    return false;
  }
}
```

Métodos tipados devolvem fallback em falhas conhecidas; o `catch` adicional cobre outras falhas. Não usar `get()` sem fallback: esse caso pode lançar erro. Para observabilidade, `getBooleanDetails()` também retorna motivo e erro. [Métodos do binding](https://developers.cloudflare.com/flagship/binding/methods/).

## Next.js/Node: REST mínimo, somente no servidor

Endpoint confirmado: `GET https://api.cloudflare.com/client/v4/accounts/{account_id}/flagship/apps/{app_id}/evaluate?flagKey=...&office_id=...&targetingKey=...`. Contexto vai como parâmetros string. A resposta de sucesso é **direta**, sem envelope `result`: `{ flagKey, value, variant, reason }`. [Evaluate API](https://developers.cloudflare.com/api/resources/flagship/subresources/apps/subresources/evaluate/methods/get/).

Exemplo implementável para `pnpm dev` Node, sem acrescentar dependência:

```ts
import "server-only";

export async function whatsappInNode(officeId: string): Promise<boolean> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const app = process.env.FLAGSHIP_APP_ID;
  const token = process.env.FLAGSHIP_EVALUATE_TOKEN;
  if (!officeId || !account || !app || !token) return false;
  try {
    const url = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}` +
      `/flagship/apps/${encodeURIComponent(app)}/evaluate`,
    );
    url.searchParams.set("flagKey", "whatsapp-integration");
    url.searchParams.set("office_id", officeId);
    url.searchParams.set("targetingKey", officeId);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return false;
    return "flagKey" in body && body.flagKey === "whatsapp-integration" &&
      "value" in body && body.value === true;
  } catch {
    return false;
  }
}
```

O timeout de 1.500 ms é uma recomendação de implementação, não um requisito Cloudflare. Manter credenciais fora do cliente e de variáveis `NEXT_PUBLIC_*`. Usar token **Flagship App Evaluate**, restrito ao app de staging/dev; não é necessário conceder administração. Há tokens restritos por app desde 26/08/2026. [Tokens](https://developers.cloudflare.com/flagship/api-tokens/).

Alternativa oficial: instalar `@cloudflare/flagship` + `@openfeature/server-sdk`, importar `FlagshipServerProvider` de **`@cloudflare/flagship/server`**, inicializar com `{ appId, accountId, authToken, timeout: 1500, retries: 0 }`, e chamar `client.getBooleanValue("whatsapp-integration", false, { office_id: officeId, targetingKey: officeId })`. Inicializar uma vez por processo, não trocar contexto global por usuário. O SDK aceita contexto por avaliação; cache servidor é desativado por padrão. [SDK servidor](https://developers.cloudflare.com/flagship/sdk/server-provider/).

## Propagação, disponibilidade e custo

Alterações podem levar **até 30 segundos** para refletir globalmente; um cache adicional pode ampliar esse prazo. Não usar a flag como revogação imediata de acesso. No piloto, evitar cache entre requisições; reutilizar a decisão dentro da mesma requisição. [Propagação](https://developers.cloudflare.com/flagship/concepts/#flag-propagation).

Flagship está em **beta pública desde 26/05/2026**, disponível pelo dashboard. O anúncio oficial diz que detalhes de preço serão publicados perto da disponibilidade geral. Não foi localizada tabela pública de preço nesta consulta; não prometer gratuidade permanente nem considerar preço futuro confirmado. [Changelog de beta](https://developers.cloudflare.com/changelog/post/2026-05-26-public-beta/) e [anúncio oficial](https://blog.cloudflare.com/flagship/).

## Limites desta nota

Schemas, exemplos e links conferidos, mas não houve chamada autenticada ao Flagship, criação de app/flag, deployment ou execução dos exemplos contra nuvem. A lista exata de escritórios e o app ID devem ser definidos ao provisionar. A pesquisa não altera app e dispensa testes de aplicação; a implementação deve verificar escritório liberado, não liberado, falta de configuração, timeout/erro e isolamento entre escritórios.
