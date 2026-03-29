const API_URL = process.env.KV_REST_API_URL;
const API_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_KEY = 'linxiang_schedule_v1';

async function kvGet() {
  const res = await fetch(`${API_URL}/get/${KV_KEY}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` }
  });
  const data = await res.json();
  if (!data.result) return {};
  // 處理可能的雙重編碼
  try {
    const parsed = JSON.parse(data.result);
    if (typeof parsed === 'string') return JSON.parse(parsed);
    return parsed;
  } catch(e) {
    return {};
  }
}

async function kvSet(value) {
  // 直接存 JSON 字串，不要雙重編碼
  await fetch(`${API_URL}/set/${KV_KEY}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([KV_KEY, JSON.stringify(value)])
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET' && req.query.debug === '1') {
    return res.status(200).json({
      hasApiUrl: !!API_URL,
      hasApiToken: !!API_TOKEN,
      urlPrefix: API_URL ? API_URL.substring(0, 35) + '...' : 'NOT FOUND'
    });
  }

  try {
    if (req.method === 'GET') {
      const data = await kvGet();
      return res.status(200).json(data);

    } else if (req.method === 'POST') {
      const { staff, shifts } = req.body;
      if (!staff || !shifts) return res.status(400).json({ error: 'Missing staff or shifts' });
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
