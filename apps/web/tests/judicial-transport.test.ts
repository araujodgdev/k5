import assert from 'node:assert/strict';
import https from 'node:https';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { installationRefSchema } from '../src/lib/judicial/contracts';
import { liveTransport } from '../src/lib/judicial/connectors/transport';

test('judicial transport sends a JSON content type so the source applies the thematic query', async t => {
  let receivedBody = '';
  t.mock.method(https, 'request', (options: https.RequestOptions) => {
    const request = new PassThrough();
    request.on('data', chunk => { receivedBody += chunk.toString(); });
    request.on('finish', () => {
      const headers = options.headers as Record<string, string>;
      // Emulate a source that ignores an undeclared JSON body and returns its default feed.
      const query = headers['content-type']?.includes('application/json')
        ? JSON.parse(receivedBody).query : null;
      const response = Object.assign(Readable.from([Buffer.from(JSON.stringify({ query }))]), {
        statusCode: 200, headers: { 'content-type': 'application/json' },
      });
      request.emit('response', response);
    });
    return request;
  });
  const installation = installationRefSchema.parse({
    id:'transport-test',kind:'jurisprudence_api',courtCode:'TJDFT',courtName:'TJDFT',
    degree:'second',system:'proprietary',purpose:'jurisprudence',authKind:'none',
    discoveryStatus:'pilot',baseUrl:'https://8.8.8.8/',allowedHosts:['8.8.8.8'],
    enabled:true,liveTransportEnabled:true,
    contractVersion:null,rateLimitPerMinute:5,dailyRequestBudget:100,coverage:{from:null,to:null},
    permissions:{query:'permitido',cache:'permitido',documents:'permitido',redistribution:'permitido',ai:'nao_esclarecido'},
  });
  const body = { query: 'guarda de criança por avós', pagina: 0, tamanho: 20 };
  const response = await liveTransport.request(installation, '/api/v1/pesquisa', { method:'POST', body });
  assert.deepEqual(JSON.parse(receivedBody), body);
  assert.equal(JSON.parse(response.body).query, body.query);
});
