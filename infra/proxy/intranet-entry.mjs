const landing = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Onesa Intranet</title>
  <style>
    :root { color-scheme: light dark; font: 16px/1.55 system-ui, sans-serif; }
    body { margin: 0; color: #172b4d; background: #f5f8f7; }
    main { max-width: 66rem; margin: auto; padding: clamp(1.25rem, 5vw, 4rem); }
    h1 { color: #102b29; font-size: clamp(2rem, 5vw, 3.5rem); line-height: 1.1; margin: 0 0 1.5rem; }
    h2 { font-size: 1.25rem; margin: 0; }
    .areas { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr)); gap: 1rem; margin: 0 0 1.25rem; }
    section { padding: 1.4rem; background: #fff; border: 1px solid #d9e6e1; border-radius: 12px; }
    a { color: #0b725e; text-underline-offset: 3px; }
    .open { display: inline-flex; align-items: center; min-height: 44px; padding: 0 .95rem; border-radius: 8px; background: #0b725e; color: #fff; text-decoration: none; }
    a:focus-visible { outline: 3px solid #00a784; outline-offset: 3px; }
    @media (prefers-color-scheme: dark) {
      body { color: #e3efed; background: #111d1b; }
      h1 { color: #eef9f6; }
      section { background: #1a2927; border-color: #39524e; }
      a { color: #8ee2cc; }
      .open { background: #8ee2cc; color: #102b29; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Onesa Intranet</h1>
    <div class="areas">
      <section aria-labelledby="portal-title">
        <h2 id="portal-title">Company Portal</h2>
        <p>Manage company operations and administration.</p>
        <a class="open" href="/admin">Open Portal Admin</a>
      </section>
      <section aria-labelledby="documents-title">
        <h2 id="documents-title">Internal Documents</h2>
        <p>Find company documents and their revision history.</p>
        <a class="open" href="https://docs.internal.onesa.eu/">Open Internal Documents</a>
      </section>
    </div>
    <a href="https://account.onesa.eu/account#product-access">Request or review Intranet access</a>
  </main>
</body>
</html>`;

const responseHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
};

export default {
  fetch(request) {
    const url = new URL(request.url);
    const isRead = request.method === "GET" || request.method === "HEAD";
    const isLanding = url.pathname === "/intranet" || url.pathname === "/intranet/";

    if (!isRead) return fetch(request);
    if (url.hostname === "onesa.eu" && isLanding) {
      return Response.redirect("https://portal.onesa.eu/intranet" + url.search, 307);
    }
    if (url.hostname !== "portal.onesa.eu") return fetch(request);
    if (url.pathname === "/") return Response.redirect("https://portal.onesa.eu/intranet" + url.search, 307);
    if (!isLanding) return fetch(request);
    return new Response(request.method === "HEAD" ? null : landing, { headers: responseHeaders });
  },
};
