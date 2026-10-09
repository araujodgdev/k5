import './server-only-fixture';
import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from '../src/instrumentation';

test('Node production refuses to boot without a trusted client IP header', async () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.K5_RUNTIME;
    for (const value of [undefined, '', '   ']) {
      if (value === undefined) delete process.env.K5_CLIENT_IP_HEADER;
      else process.env.K5_CLIENT_IP_HEADER = value;
      await assert.rejects(register(), /K5_CLIENT_IP_HEADER/);
    }
  } finally { process.env = previous; }
});

test('Cloudflare and development still boot without a Node proxy header', async () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.K5_RUNTIME = 'cloudflare';
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.K5_CLIENT_IP_HEADER;
    await register();
    Object.assign(process.env, { NODE_ENV: 'development' });
    delete process.env.K5_RUNTIME;
    delete process.env.NEXT_RUNTIME;
    await register();
  } finally { process.env = previous; }
});

test('Node production boots with a proxy header explicitly configured', async () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: 'production' });
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.K5_RUNTIME;
    process.env.K5_CLIENT_IP_HEADER = 'x-real-ip';
    await register();
  } finally { process.env = previous; }
});
