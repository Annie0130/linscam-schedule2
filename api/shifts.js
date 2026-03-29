const BASE = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;
const KEY = 'schedule';

const headers = { Authorization: `Bearer ${TOKEN}` };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${BASE}/get/${KEY}`, { headers });
      const { result } = await r.json();
      return res.status(200).json(result ? JSON.parse(result) : {});

    } else if (req.method === 'POST') {
      const { staff, shifts } = req.body;
      if (!staff || !shifts) return res.status(400).json({ error: 'Missing params' });

      // 先讀出現有資料
      const r = await fetch(`${BASE}/get/${KEY}`, { headers });
      const { result } = await r.json();
      const data = result ? JSON.parse(result) : {};

      // 更新該員工
      data[staff] = shifts;

      // 用 SET 指令存回去（正確格式）
      await fetch(`${BASE}/set/${KEY}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(JSON.stringify(data))
      });

      return res.status(200).json({ ok: true });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
