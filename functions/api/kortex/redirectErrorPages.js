/**
 * Branded Error Page Template
 * Split from redirectHandler.js — Kaayko dark-theme error pages.
 *
 * @module api/kortex/redirectErrorPages
 */

/**
 * Generate branded error page with Kaayko dark theme styling
 * @param {number} code - HTTP status code
 * @param {string} title - Error title
 * @param {string} message - User-friendly error message
 * @param {boolean} showAppButton - Whether to show "Go to Kaayko" button
 * @returns {string} HTML error page
 */
function errorPage(code, title, message, showAppButton = true) {
  const appButton = showAppButton
    ? '<a href="https://kaayko.com" class="btn">Go to Kaayko</a>' : '';
  const icon = code === 404 ? '🔍' : code === 410 ? '⏰' : '⚠️';

  return `<!DOCTYPE html>
<html>
<head>
  <title>${title} | Kaayko</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" type="image/png" sizes="32x32" href="https://kaayko.com/favicon-32x32.png">
  <link href="https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Josefin Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#fff;padding:20px}
    .container{max-width:420px;width:100%;text-align:center}
    .logo{width:60px;height:60px;margin:0 auto 24px;background:linear-gradient(135deg,#D4A84B 0%,#C4983B 100%);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:#0a0a0a;box-shadow:0 4px 20px rgba(212,168,75,.3)}
    .card{background:#141414;border:1px solid #2a2a2a;border-radius:16px;padding:40px 32px}
    .icon{font-size:48px;margin-bottom:16px}
    h1{font-size:24px;font-weight:700;color:#fff;margin-bottom:8px}
    p{font-size:15px;color:#888;line-height:1.5;margin-bottom:24px}
    .btn{display:inline-block;background:linear-gradient(135deg,#D4A84B 0%,#C4983B 100%);color:#0a0a0a;font-family:inherit;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;text-decoration:none;transition:all .2s ease;box-shadow:0 2px 12px rgba(212,168,75,.25)}
    .btn:hover{transform:translateY(-2px);box-shadow:0 4px 20px rgba(212,168,75,.4)}
    .footer{margin-top:32px;font-size:13px;color:#555}
    .footer a{color:#D4A84B;text-decoration:none}
    .footer a:hover{text-decoration:underline}
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">K</div>
    <div class="card">
      <div class="icon">${icon}</div>
      <h1>${title}</h1>
      <p>${message}</p>
      ${appButton}
    </div>
    <div class="footer">
      <a href="https://kaayko.com">kaayko.com</a> · Know Before You Go
    </div>
  </div>
</body>
</html>`;
}

module.exports = { errorPage };
