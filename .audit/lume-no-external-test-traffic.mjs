const downstream = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol === 'data:') return downstream(input, init);
  const memoryFixture = process.env.HONCHO_ENVIRONMENT === 'test'
    && process.env.HONCHO_API_KEY === 'honcho-test-key'
    && /^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.HONCHO_URL ?? '')
    && url.origin === process.env.HONCHO_URL && url.pathname.startsWith('/v3/');
  if (memoryFixture) return downstream(input, init);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '62541') {
    throw new Error(`External test transport blocked for ${url.hostname}. Install a synthetic transport fixture.`);
  }
  return downstream(input, init);
};
