const URL = process.env.KV_REST_API_URL;
const TOKEN = process.env.KV_REST_API_TOKEN;
const KEY = 'schedule_v2';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const auth = { headers: { Authorization: `Bearer ${TOKEN}` } };

  try {
    if (req.method === 'GET') {
      // 直接用 Upstash REST GET
      const r = await fetch(`${URL}/get/${KEY}`, auth);
      const json = await r.json();
      const data = json.result ? JSON.parse(json.result) : {};
      return res.status(200).json(data);

    } else if (req.method === 'POST') {
      const { staff, shifts } = req.body;
      if (!staff || shifts === undefined) {
        return res.status(400).json({ error: 'Missing params' });
      }

      // 讀現有資料
      const r = await fetch(`${URL}/get/${KEY}`, auth);
      const json = await r.json();
      const data = json.result ? JSON.parse(json.result) : {};

      // 更新員工資料
      data[staff] = shifts;

      // 用正確的 Upstash SET 格式存回去
      const setRes = await fetch(`${URL}/set/${KEY}/${encodeURIComponent(JSON.stringify(data))}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${TOKEN}` }
      });
      const setJson = await setRes.json();
      return res.status(200).json({ ok: true, result: setJson.result });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
