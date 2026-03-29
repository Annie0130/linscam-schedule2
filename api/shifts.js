const API_URL = process.env.KV_REST_API_URL;
const API_TOKEN = process.env.KV_REST_API_TOKEN;
const KV_KEY = 'linxiang_schedule_v1';

async function kvGet() {
  const res = await fetch(`${API_URL}/get/${KV_KEY}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` }
  });
  const data = await res.json();
  if (!data.result) return {};
  try {
    return JSON.parse(data.result);
  } catch(e) { return {}; }
}

async function kvSet(value) {
  const body = `["${KV_KEY}","${JSON.stringify(value).replace(/"/g, '\\"')}"]`;
  await fetch(`${API_URL}/mset`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: body
  });
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
