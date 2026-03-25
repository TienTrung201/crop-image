/**
 * Vercel Serverless Function - Proxy gọi Google Apps Script Web App.
 *
 * Vì sao cần proxy?
 * - Google Apps Script Web App (script.google.com) KHÔNG trả CORS headers cho preflight OPTIONS
 *   => gọi trực tiếp từ browser sẽ bị chặn (dù đã deploy "Anyone").
 * - Proxy chạy server-side nên không bị CORS, và có thể trả JSON + CORS headers về cho FE.
 *
 * Bảo mật:
 * - Nên dùng biến môi trường `GAS_WEBAPP_URL` trên Vercel, tránh hardcode URL.
 */

const GAS_WEBAPP_URL = process.env.GAS_WEBAPP_URL;

function setCors(res, origin) {
  // Cho phép đúng origin của site bạn. Với project đơn giản có thể dùng '*'
  // nhưng nếu gửi dữ liệu nhạy cảm, nên khóa theo domain cố định.
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  setCors(res, origin);

  // Trả lời preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!GAS_WEBAPP_URL) {
    return res.status(500).json({
      ok: false,
      error: 'Thiếu cấu hình GAS_WEBAPP_URL trên Vercel Environment Variables'
    });
  }

  try {
    // Vercel tự parse JSON nếu content-type application/json
    const body = req.body;

    const gasRes = await fetch(GAS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'follow'
    });

    const text = await gasRes.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { ok: false, error: text }; }

    if (!gasRes.ok || !data.ok) {
      const msg = data && data.error ? data.error : `GAS HTTP ${gasRes.status}`;
      return res.status(502).json({ ok: false, error: msg });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

