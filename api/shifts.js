const BASE = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;
const KEY = 'schedule_v3';

const auth = () => ({ Authorization: `Bearer ${TOKEN}` });

async function kvGet() {
  const r = await fetch(`${BASE}/get/${KEY}`, { headers: auth() });
  const json = await r.json();
  if (!json.result) return {};
  // 處理單層或多層字串
  let val = json.result;
  while (typeof val === 'string') {
    try { val = JSON.parse(val); } catch(e) { break; }
  }
  return typeof val === 'object' ? val : {};
}

async function kvSet(data) {
  // 用 Upstash REST SET 正確格式
  const r = await fetch(`${BASE}/set/${KEY}`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(data))
  });
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const data = await kvGet();
      return res.status(200).json(data);

    } else if (req.method === 'POST') {
      const { staff, shifts } = req.body;
      if (!staff || shifts === undefined) {
        return res.status(400).json({ error: 'Missing params' });
      }
      const existing = await kvGet();
      existing[staff] = shifts;
      await kvSet(existing);
      return res.status(200).json({ ok: true });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
