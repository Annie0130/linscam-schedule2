import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;
const SCHEDULE_KEY = 'schedule_v3';
const NOTICE_KEY = 'notice_v1';
const COOKIE = 'linxiang_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const headers = { Authorization: `Bearer ${TOKEN}` };

// Fixed pause so a wrong password cannot be brute-forced by timing or speed.
export const LOGIN_FAIL_DELAY_MS = 600;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function configuredPassword() {
  const value = process.env.SCHEDULE_PASSWORD;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

// Hash both sides to a fixed length so timingSafeEqual never leaks the length
// and never throws when the guess and the real password differ in size.
export function passwordsMatch(input, expected) {
  const pepper = Buffer.from('linxiang-schedule-login-v1');
  const actual = createHmac('sha256', pepper).update(String(input ?? ''), 'utf8').digest();
  const wanted = createHmac('sha256', pepper).update(String(expected ?? ''), 'utf8').digest();
  return timingSafeEqual(actual, wanted);
}

function cookieKey() {
  return createHmac('sha256', 'linxiang-schedule-cookie-v1')
    .update(configuredPassword() || '')
    .digest();
}

export function createSessionToken(exp = Date.now() + SESSION_TTL_MS) {
  const body = Buffer.from(JSON.stringify({ v: 1, exp })).toString('base64url');
  const sig = createHmac('sha256', cookieKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifySessionToken(token) {
  if (!configuredPassword()) return false;
  if (typeof token !== 'string' || token.length < 10 || token.length > 512) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', cookieKey()).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length) {
    timingSafeEqual(expected, expected);
    return false;
  }
  if (!timingSafeEqual(given, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || payload.v !== 1 || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return false;
    return payload.exp > Date.now();
  } catch {
    return false;
  }
}

function requestHosts(req) {
  const hosts = [];
  for (const raw of [req.headers?.['x-forwarded-host'], req.headers?.host]) {
    if (!raw) continue;
    for (const part of String(raw).split(',')) {
      const host = part.trim().toLowerCase();
      if (host) hosts.push(host);
    }
  }
  return hosts;
}

// Only the site that is actually serving this request. Never "*".
function allowedOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin || origin === 'null') return null;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const proto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  if (proto && url.protocol !== `${proto}:`) return null;
  if (!requestHosts(req).includes(url.host.toLowerCase())) return null;
  return url.origin;
}

function applyCors(req, res) {
  const origin = allowedOrigin(req);
  if (!origin) return;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function isHttps(req) {
  const proto = String(req.headers?.['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

function sessionCookie(value, req, maxAge) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(value)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${maxAge}`,
  ];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

function readCookie(req, name) {
  const raw = req.headers?.cookie;
  if (!raw) return '';
  for (const part of String(raw).split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      return '';
    }
  }
  return '';
}

function queryOf(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    const host = req.headers?.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    return Object.fromEntries(url.searchParams.entries());
  } catch {
    return {};
  }
}

function requestType(req) {
  const type = queryOf(req).type;
  if (Array.isArray(type)) return String(type[0] || '');
  return type ? String(type) : '';
}

function requestBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return {}; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  return body;
}

function isAuthed(req) {
  return verifySessionToken(readCookie(req, COOKIE));
}

async function handleLogin(req, res, body) {
  const expected = configuredPassword();
  const given = typeof body.password === 'string' ? body.password : '';
  const match = expected !== null && given.length <= 256 && passwordsMatch(given, expected);
  if (!match) {
    await delay(LOGIN_FAIL_DELAY_MS);
    if (!expected) {
      return res.status(503).json({ error: 'SCHEDULE_PASSWORD is not configured' });
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = createSessionToken(Date.now() + SESSION_TTL_MS);
  res.setHeader('Set-Cookie', sessionCookie(token, req, Math.floor(SESSION_TTL_MS / 1000)));
  return res.status(200).json({ ok: true });
}

async function kvGet(key) {
  const r = await fetch(`${BASE}/get/${key}`, { headers });
  const { result } = await r.json();
  if (!result) return {};
  let val = result;
  while (typeof val === 'string') {
    try { val = JSON.parse(val); } catch (e) { break; }
  }
  return typeof val === 'object' ? val : {};
}

async function kvSet(key, value) {
  await fetch(`${BASE}/set/${key}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(value))
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const type = requestType(req);

  try {
    if (req.method === 'POST' && type === 'logout') {
      res.setHeader('Set-Cookie', sessionCookie('', req, 0));
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'POST' && type === 'login') {
      return await handleLogin(req, res, requestBody(req));
    }

    if (!configuredPassword()) {
      return res.status(503).json({ error: 'SCHEDULE_PASSWORD is not configured' });
    }

    if (!isAuthed(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (req.method === 'GET' && type === 'session') {
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      const data = await kvGet(type === 'notice' ? NOTICE_KEY : SCHEDULE_KEY);
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      if (type === 'notice') {
        const { year_month, content } = requestBody(req);
        if (!year_month) return res.status(400).json({ error: 'Missing year_month' });
        const existing = await kvGet(NOTICE_KEY);
        existing[year_month] = content || '';
        await kvSet(NOTICE_KEY, existing);
      } else {
        const { staff, shifts } = requestBody(req);
        if (!staff || shifts === undefined) return res.status(400).json({ error: 'Missing params' });
        const existing = await kvGet(SCHEDULE_KEY);
        existing[staff] = shifts;
        await kvSet(SCHEDULE_KEY, existing);
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
}
