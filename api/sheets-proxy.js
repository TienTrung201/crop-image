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

/**
 * Lưu ý quan trọng:
 * - Project của bạn không có `package.json` nên runtime Node trên Vercel thường mặc định CommonJS.
 * - Nếu dùng `export default` (ESM) có thể làm function crash và Vercel trả 502.
 * => Dùng `module.exports = ...` để chắc chắn chạy ổn định.
 */
module.exports = async function handler(req, res) {
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
    try { data = JSON.parse(text); }
    catch {
      // GAS đôi khi trả HTML (redirect/login/error page). Cắt ngắn để response không quá nặng.
      data = { ok: false, error: String(text).slice(0, 800) };
    }

    // GAS trả 200 nhưng body không đúng format { ok: true, ... } cũng coi là lỗi logic
    if (!gasRes.ok || !data || data.ok !== true) {
      const msg =
        data && data.error ? data.error :
        (!gasRes.ok ? `GAS HTTP ${gasRes.status}` : 'GAS trả 200 nhưng thiếu `ok:true`');

      return res.status(502).json({
        ok: false,
        error: msg,
        gasStatus: gasRes.status,
        // Trả thêm để debug: GAS đang trả gì thật sự?
        gasBody: data
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
};

