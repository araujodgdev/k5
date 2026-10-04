import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export type Call = { method: string; url: URL; key: string | null; body: unknown };
type Account = { wallet: string; host: string };

/** Account reads only: one account per key, answering on its environment's host. */
export function fakeAsaas(accounts: Record<string, Account>, calls: Call[] = []) {
  return async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = new Headers(init?.headers).get('access_token');
    calls.push({ method: init?.method ?? 'GET', url, key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    assert.equal(init?.redirect, 'manual');
    assert.match(new Headers(init?.headers).get('user-agent') ?? '', /^Lume\//);
    const account = key ? accounts[key] : undefined;
    if (!account || account.host !== url.host) return Response.json({ errors: [{ code: 'invalid_access_token', description: 'Chave inválida' }] }, { status: 401 });
    if (url.pathname === '/v3/myAccount/commercialInfo/') return Response.json({ name: 'Ana Advogada', companyName: 'Ana Advocacia', email: 'ana@example.com', cpfCnpj: '12345678000190', personType: 'JURIDICA', status: 'APPROVED', incomeValue: 10_000 });
    if (url.pathname === '/v3/wallets/') return Response.json({ object: 'list', data: [{ object: 'wallet', id: account.wallet }] });
    return Response.json({ errors: [{ description: 'Rota não simulada' }] }, { status: 404 });
  };
}

export type RemotePayment = { id: string; customer: string; value: number; dueDate: string; status: string; externalReference: string; invoiceUrl: string; billingType: string; description?: string };
export type RemoteWebhook = { id: string; url: string; authToken: string; events: string[]; enabled: boolean; interrupted: boolean; email: string; sendType: string };

/** Asaas never returns a webhook's token after creating it. */
const visible = (hook: RemoteWebhook) => Object.fromEntries(Object.entries(hook).filter(([key]) => key !== 'authToken'));

/**
 * A production Asaas account with customers, payments and webhooks. `next` scripts the answer to
 * the next payment creation: `lost` creates it and fails the answer, `unanswered` fails without creating.
 */
export function fakeAccount(apiKey: string, wallet = randomUUID()) {
  const state = {
    customers: [] as { id: string; cpfCnpj: string; externalReference: string; name: string }[],
    payments: [] as RemotePayment[], webhooks: [] as RemoteWebhook[],
    calls: [] as Call[], next: 'ok' as 'ok' | 'lost' | 'unanswered' | 'reject',
  };
  const account = fakeAsaas({ [apiKey]: { wallet, host: 'api.asaas.com' } }, state.calls);
  const handler = async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (new Headers(init?.headers).get('access_token') !== apiKey || url.host !== 'api.asaas.com') return account(input, init);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const record = () => state.calls.push({ method, url, key: apiKey, body });
    const path = url.pathname;
    if (path === '/v3/customers' && method === 'GET') {
      record();
      return Response.json({ object: 'list', data: state.customers.filter(customer => customer.externalReference === url.searchParams.get('externalReference')) });
    }
    if (path === '/v3/customers' && method === 'POST') {
      record();
      const customer = { id: `cus_${randomUUID()}`, ...body };
      state.customers.push(customer);
      return Response.json(customer);
    }
    if (path === '/v3/payments' && method === 'GET') {
      record();
      return Response.json({ object: 'list', data: state.payments.filter(payment => payment.externalReference === url.searchParams.get('externalReference')) });
    }
    if (path === '/v3/payments' && method === 'POST') {
      record();
      const outcome = state.next; state.next = 'ok';
      if (outcome === 'reject') return Response.json({ errors: [{ code: 'invalid_value', description: 'O valor mínimo da cobrança é R$ 5,00.' }] }, { status: 400 });
      if (outcome === 'unanswered') return new Response('upstream', { status: 503 });
      const id = `pay_${randomUUID()}`;
      const payment = { id, status: 'PENDING', invoiceUrl: `https://www.asaas.com/i/${id}`, ...body };
      state.payments.push(payment);
      return outcome === 'lost' ? new Response('upstream', { status: 502 }) : Response.json(payment);
    }
    const payment = /^\/v3\/payments\/([^/]+)$/.exec(path);
    if (payment && method === 'DELETE') {
      record();
      state.payments = state.payments.filter(row => row.id !== payment[1]);
      return Response.json({ deleted: true, id: payment[1] });
    }
    if (path === '/v3/webhooks' && method === 'GET') { record(); return Response.json({ object: 'list', data: state.webhooks.map(visible) }); }
    if (path === '/v3/webhooks' && method === 'POST') {
      record();
      const hook = { id: randomUUID(), ...body };
      state.webhooks.push(hook);
      return Response.json(visible(hook));
    }
    const hook = /^\/v3\/webhooks\/([^/]+)$/.exec(path);
    if (hook) {
      record();
      const index = state.webhooks.findIndex(row => row.id === hook[1]);
      if (index < 0) return Response.json({ errors: [{ description: 'Webhook não encontrado.' }] }, { status: 404 });
      if (method === 'DELETE') { state.webhooks.splice(index, 1); return Response.json({ deleted: true, id: hook[1] }); }
      if (method === 'PUT') state.webhooks[index] = { ...state.webhooks[index], ...body };
      return Response.json(visible(state.webhooks[index]));
    }
    return account(input, init);
  };
  return { state, handler, wallet };
}
