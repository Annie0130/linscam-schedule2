const BASE = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;
const SCHEDULE_KEY = 'schedule_v3';
const NOTICE_KEY = 'notice_v1';
const headers = { Authorization: `Bearer ${TOKEN}` };

async function kvGet(key) {
  const r = await fetch(`${BASE}/get/${key}`, { headers });
  const { result } = await r.json();
  if (!result) return {};
  let val = result;
  while (typeof val === 'string') {
    try { val = JSON.parse(val); } catch(e) { break; }
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { type } = req.query;

  try {
    if (req.method === 'GET') {
      const data = await kvGet(type === 'notice' ? NOTICE_KEY : SCHEDULE_KEY);
      return res.status(200).json(data);

    } else if (req.method === 'POST') {
      if (type === 'notice') {
        const { year_month, content } = req.body;
        if (!year_month) return res.status(400).json({ error: 'Missing year_month' });
        const existing = await kvGet(NOTICE_KEY);
        existing[year_month] = content || '';
        await kvSet(NOTICE_KEY, existing);
      } else {
        const { staff, shifts } = req.body;
        if (!staff || shifts === undefined) return res.status(400).json({ error: 'Missing params' });
        const existing = await kvGet(SCHEDULE_KEY);
        existing[staff] = shifts;
        await kvSet(SCHEDULE_KEY, existing);
      }
      return res.status(200).json({ ok: true });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
