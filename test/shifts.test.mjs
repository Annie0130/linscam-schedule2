import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PASSWORD = 'correct horse battery';
process.env.SCHEDULE_PASSWORD = PASSWORD;
process.env.KV_REST_API_URL = 'https://kv.example.test';
process.env.KV_REST_API_TOKEN = 'kv-token';

const kvCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const target = String(url);
  if (target.startsWith('http://127.0.0.1:') || target.startsWith('http://localhost:')) {
    return realFetch(url, opts);
  }
  kvCalls.push({ url: target, method: opts.method || 'GET' });
  if (String(url).includes('/get/schedule')) {
    return { ok: true, json: async () => ({ result: JSON.stringify({ '孟庭': { '2026-11-1': '9-18' } }) }) };
  }
  if (String(url).includes('/get/notice')) {
    return { ok: true, json: async () => ({ result: JSON.stringify({ '2026-11': '本月勿遲到' }) }) };
  }
  if (String(url).includes('/set/')) {
    return { ok: true, json: async () => ({ result: 'OK' }) };
  }
  throw new Error('unexpected fetch ' + url);
};

const { default: handler, passwordsMatch, createSessionToken, LOGIN_FAIL_DELAY_MS } = await import('../api/shifts.js');

function mockRes() {
  return {
    statusCode: 0,
    body: undefined,
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() { return this; },
  };
}

function makeReq({ method = 'GET', type = '', body, cookie = '', origin, host = 'schedule.example', proto = 'https' } = {}) {
  const headers = {
    host,
    'x-forwarded-host': host,
    'x-forwarded-proto': proto,
  };
  if (origin) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  return { method, headers, query: type ? { type } : {}, body };
}

function cookiePair(res) {
  const raw = res.headers['set-cookie'];
  assert.equal(typeof raw, 'string');
  assert.match(raw, /HttpOnly/);
  assert.match(raw, /SameSite=Lax/);
  assert.match(raw, /Path=\//);
  assert.doesNotMatch(raw, /SCHEDULE_PASSWORD|correct horse/);
  const match = raw.match(/linxiang_session=([^;]*)/);
  assert.ok(match);
  return { raw, token: decodeURIComponent(match[1]) };
}

describe('schedule password', { concurrency: 1 }, () => {

test('schedule API requires the staff password and same-origin CORS', async () => {
  const src = readFileSync(new URL('../api/shifts.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(src.includes("'*'"), false);
  assert.match(src, /timingSafeEqual/);
  assert.match(src, /SCHEDULE_PASSWORD/);
  assert.match(src, /HttpOnly/);
  assert.match(html, /id="login-screen"/);
  assert.match(html, /id="v0" style="display:none"/);
  assert.match(html, /staffLogin/);
  assert.doesNotMatch(html, /SCHEDULE_PASSWORD\s*=\s*['"][^'"]+['"]/);

  assert.equal(passwordsMatch(PASSWORD, PASSWORD), true);
  assert.equal(passwordsMatch('a', PASSWORD), false);
  assert.equal(passwordsMatch(PASSWORD + ' ', PASSWORD), false);
  assert.equal(passwordsMatch('', PASSWORD), false);
  assert.equal(passwordsMatch('x'.repeat(80), 'y'.repeat(3)), false);

  kvCalls.length = 0;
  let res = mockRes();
  await handler(makeReq({ origin: 'https://evil.test' }), res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Unauthorized' });
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.equal(kvCalls.length, 0);

  res = mockRes();
  await handler(makeReq({
    method: 'POST',
    body: { staff: '孟庭', shifts: { '2026-11-2': '12-21' } },
    origin: 'https://evil.test',
  }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(kvCalls.length, 0);

  res = mockRes();
  await handler(makeReq({ method: 'GET', type: 'notice', origin: 'https://evil.test' }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(kvCalls.length, 0);

  res = mockRes();
  await handler(makeReq({
    method: 'POST',
    type: 'notice',
    body: { year_month: '2026-11', content: '入侵' },
    origin: 'https://not-us.test',
  }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(kvCalls.length, 0);

  res = mockRes();
  await handler(makeReq({ method: 'OPTIONS', origin: 'https://evil.test' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['access-control-allow-origin'], undefined);

  res = mockRes();
  await handler(makeReq({ method: 'OPTIONS', origin: 'https://schedule.example' }), res);
  assert.equal(res.headers['access-control-allow-origin'], 'https://schedule.example');
  assert.equal(res.headers['access-control-allow-credentials'], 'true');
  assert.notEqual(res.headers['access-control-allow-origin'], '*');

  res = mockRes();
  await handler(makeReq({ origin: 'http://schedule.example', proto: 'https' }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['access-control-allow-origin'], undefined);

  const started = Date.now();
  res = mockRes();
  await handler(makeReq({
    method: 'POST',
    type: 'login',
    body: { password: 'nope' },
    origin: 'https://schedule.example',
  }), res);
  const elapsed = Date.now() - started;
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['set-cookie'], undefined);
  assert.ok(elapsed >= LOGIN_FAIL_DELAY_MS - 40, `failure returned too fast (${elapsed}ms)`);
  assert.equal(kvCalls.length, 0);

  res = mockRes();
  await handler(makeReq({
    method: 'POST',
    type: 'login',
    body: { password: 1234, staff: '孟庭', shifts: {} },
    origin: 'https://schedule.example',
  }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(kvCalls.length, 0);

  const okStart = Date.now();
  res = mockRes();
  await handler(makeReq({
    method: 'POST',
    type: 'login',
    body: { password: PASSWORD },
    origin: 'https://schedule.example',
  }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.ok(Date.now() - okStart < LOGIN_FAIL_DELAY_MS - 50);
  const { raw, token } = cookiePair(res);
  assert.match(raw, /Secure/);
  assert.equal(res.headers['access-control-allow-origin'], 'https://schedule.example');
  assert.equal(kvCalls.length, 0);

  const authed = `other=1; linxiang_session=${encodeURIComponent(token)}`;

  res = mockRes();
  await handler(makeReq({
    method: 'GET',
    type: 'session',
    cookie: authed,
    origin: 'https://evil.test',
  }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(res.headers['access-control-allow-origin'], undefined);
  assert.equal(kvCalls.length, 0);

  res = mockRes();
  await handler(makeReq({ method: 'GET', cookie: authed, origin: 'https://schedule.example' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body['孟庭']['2026-11-1'], '9-18');
  assert.equal(res.headers['cache-control'], 'private, no-store');

  kvCalls.length = 0;
  res = mockRes();
  await handler(makeReq({
    method: 'POST',
    cookie: authed,
    body: { staff: '琳', shifts: { '2026-11-3': '14-21' } },
    origin: 'https://schedule.example',
  }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.ok(kvCalls.some((call) => call.url.includes('/set/schedule_v3') && call.method === 'POST'));

  kvCalls.length = 0;
  res = mockRes();
  await handler(makeReq({ method: 'GET', type: 'notice', cookie: authed }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body['2026-11'], '本月勿遲到');

  res = mockRes();
  await handler(makeReq({ method: 'GET', cookie: `linxiang_session=${encodeURIComponent(token + 'x')}` }), res);
  assert.equal(res.statusCode, 401);

  const expired = createSessionToken(Date.now() - 1000);
  res = mockRes();
  await handler(makeReq({ method: 'GET', cookie: `linxiang_session=${encodeURIComponent(expired)}` }), res);
  assert.equal(res.statusCode, 401);

  res = mockRes();
  await handler(makeReq({ method: 'POST', type: 'logout', proto: 'http', host: '127.0.0.1:3000' }), res);
  const loggedOut = cookiePair(res);
  assert.equal(loggedOut.token, '');
  assert.match(loggedOut.raw, /Max-Age=0/);
  assert.doesNotMatch(loggedOut.raw, /Secure/);

  const saved = process.env.SCHEDULE_PASSWORD;
  delete process.env.SCHEDULE_PASSWORD;
  kvCalls.length = 0;
  const lockedAt = Date.now();
  res = mockRes();
  await handler(makeReq({ method: 'POST', type: 'login', body: { password: saved } }), res);
  assert.equal(res.statusCode, 503);
  assert.ok(Date.now() - lockedAt >= LOGIN_FAIL_DELAY_MS - 40);
  res = mockRes();
  await handler(makeReq({ method: 'GET', cookie: authed }), res);
  assert.equal(res.statusCode, 503);
  assert.equal(kvCalls.length, 0);
  assert.equal(JSON.stringify(res.body).includes('孟庭'), false);
  process.env.SCHEDULE_PASSWORD = saved;
});

test('http login cookie can read and write, and a stranger cannot', async () => {
  process.env.SCHEDULE_PASSWORD = PASSWORD;
  const server = createServer(async (req, nodeRes) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    let body;
    if (raw) {
      try { body = JSON.parse(raw); } catch { body = {}; }
    }
    const url = new URL(req.url, 'http://127.0.0.1');
    let settled = false;
    const vercelRes = {
      statusCode: 200,
      setHeader(name, value) { nodeRes.setHeader(name, value); },
      status(code) { this.statusCode = code; return this; },
      json(obj) {
        settled = true;
        nodeRes.statusCode = this.statusCode;
        nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
        nodeRes.end(JSON.stringify(obj));
        return this;
      },
      end() {
        settled = true;
        nodeRes.statusCode = this.statusCode;
        nodeRes.end();
        return this;
      },
    };
    await handler({
      method: req.method,
      headers: req.headers,
      url: req.url,
      query: Object.fromEntries(url.searchParams.entries()),
      body,
    }, vercelRes);
    if (!settled) nodeRes.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const stranger = await fetch(`${base}/api/shifts`);
    assert.equal(stranger.status, 401);
    const strangerBody = await stranger.json();
    assert.equal(JSON.stringify(strangerBody).includes('孟庭'), false);

    const origin = `http://127.0.0.1:${port}`;
    const bad = await fetch(`${base}/api/shifts?type=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    assert.equal(bad.status, 401);
    assert.equal(bad.headers.get('access-control-allow-origin'), null);

    const logged = await fetch(`${base}/api/shifts?type=login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ password: PASSWORD }),
    });
    assert.equal(logged.status, 200);
    assert.equal(logged.headers.get('access-control-allow-origin'), origin);
    const setCookie = logged.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /linxiang_session=/);
    const schedule = await fetch(`${base}/api/shifts`, { headers: { Cookie: setCookie.split(';')[0] } });
    assert.equal(schedule.status, 200);
    const data = await schedule.json();
    assert.equal(data['孟庭']['2026-11-1'], '9-18');

    const saved = await fetch(`${base}/api/shifts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: setCookie.split(';')[0] },
      body: JSON.stringify({ staff: '琳', shifts: { '2026-11-4': '9-18' } }),
    });
    assert.equal(saved.status, 200);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});

});
