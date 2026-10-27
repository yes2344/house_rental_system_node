import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import express from 'express';
import { createApp } from '../src/app.js';
import { errorHandler } from '../src/middleware/errorHandler.js';

let server;
let baseUrl;

function fakePool(queryFailure) {
  return {
    connect: async () => ({
      query: async (sql) => {
        if (sql === 'SELECT 1' && queryFailure) throw queryFailure;
        return { rows: [{ '?column?': 1 }] };
      },
      release() {},
    }),
  };
}

before(async () => {
  const app = createApp({ pool: fakePool() });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

test('health endpoint confirms PostgreSQL connectivity', async () => {
  const response = await fetch(`${baseUrl}/api/v1/health/`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', database: 'ok' });
});

test('health endpoint reports database outages without claiming success', async () => {
  const errors = [];
  const app = createApp({
    pool: fakePool(new Error('connection refused')),
    logger: { error: (...values) => errors.push(values) },
  });
  const outageServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => outageServer.once('listening', resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${outageServer.address().port}/api/v1/health/`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.status_code, 503);
    assert.equal(errors.length, 1);
  } finally {
    await new Promise((resolve, reject) => {
      outageServer.close((error) => error ? reject(error) : resolve());
    });
  }
});

test('unknown API routes return a JSON 404', async () => {
  const response = await fetch(`${baseUrl}/api/v1/unknown/`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.status_code, 404);
});

test('unexpected API errors log method and pathname without query parameters', async () => {
  const errors = [];
  const app = express();
  app.get('/failure', (_request, _response, next) => {
    next(Object.assign(new Error('database failure'), { code: '22P02' }));
  });
  app.use(errorHandler({ logger: { error: (...values) => errors.push(values) } }));
  const errorServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => errorServer.once('listening', resolve));

  try {
    const response = await fetch(`http://127.0.0.1:${errorServer.address().port}/failure?token=private`);
    assert.equal(response.status, 500);
    assert.deepEqual(errors, [[
      'Unhandled API error:',
      { method: 'GET', path: '/failure', code: '22P02' },
    ]]);
  } finally {
    await new Promise((resolve, reject) => {
      errorServer.close((error) => error ? reject(error) : resolve());
    });
  }
});
