import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, X509Certificate} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import https from 'node:https';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
import worker from '../../infra/monitoring/it-infrastructure-worker.mjs';

const fixture = await mkdtemp(join(tmpdir(), 'onesa-infrastructure-logout-'));
let server, browser;
try {
  const keyPath = join(fixture, 'leaf.key'), certPath = join(fixture, 'leaf.pem');
  execFileSync('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-x509',
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    '-keyout', keyPath, '-out', certPath], {stdio: 'ignore'});
  const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)]);
  const fingerprint = createHash('sha256').update(
    new X509Certificate(cert).publicKey.export({type: 'spki', format: 'der'}),
  ).digest('base64');
  const audience = 'isolated-infrastructure-audience', clientId = 'isolated-infrastructure-client';
  const approved = {access: {aud: audience, getIdentity: async () => ({
    email: 'operator@example.invalid', oidc_fields: {'https://onesa.eu/claims/infrastructure_admin': 'approved'},
  })}};
  const stages = [];
  const cookie = (name, value, lifetime) =>
    `${name}=${value}; Path=/; Max-Age=${lifetime}; Secure; HttpOnly; SameSite=Lax`;
  let dashboardOrigin, issuerOrigin;
  async function route(incoming, outgoing) {
    const url = new URL(incoming.url, 'https://' + incoming.headers.host);
    const marker = url.origin === issuerOrigin ? 'fixture_provider' : 'fixture_access';
    const cookies = (incoming.headers.cookie || '').split('; ').filter(Boolean);
    if (url.pathname === '/fixture/sign-in' && [dashboardOrigin, issuerOrigin].includes(url.origin)) {
      return outgoing.writeHead(200, {'Set-Cookie': cookie(marker, 'active', 120)}).end();
    }
    if (url.origin === issuerOrigin && url.pathname === '/oidc/logout') {
      assert.equal(incoming.method, 'GET');
      assert.equal(url.searchParams.get('client_id'), clientId);
      assert.equal(url.searchParams.get('post_logout_redirect_uri'), dashboardOrigin + '/');
      assert.ok(cookies.includes('fixture_provider=active'));
      stages.push('provider');
      return outgoing.writeHead(302, {Location: dashboardOrigin + '/',
        'Set-Cookie': cookie('fixture_provider', '', 0)}).end();
    }
    if (url.origin !== dashboardOrigin) return outgoing.writeHead(404).end();
    if (url.pathname === '/cdn-cgi/access/logout') {
      const returnTo = new URL(url.searchParams.get('returnTo'));
      assert.equal(returnTo.origin, dashboardOrigin);
      assert.equal(returnTo.pathname, '/');
      assert.ok(cookies.includes('fixture_access=active'));
      stages.push('access');
      return outgoing.writeHead(302, {Location: returnTo.href,
        'Set-Cookie': cookie('fixture_access', '', 0)}).end();
    }
    // Skip the live service health probes while exercising the actual dashboard form.
    if (['/dashboard/api/status', '/api/status'].includes(url.pathname)) return outgoing.writeHead(503).end();
    const response = await worker.fetch(new Request(url, {method: incoming.method, headers: incoming.headers}), {
      INFRASTRUCTURE_ORIGIN: dashboardOrigin,
      INFRASTRUCTURE_ACCESS_AUD: audience,
      INFRASTRUCTURE_AUTH0_LOGOUT_CLIENT_ID: clientId,
      INFRASTRUCTURE_AUTH0_LOGOUT_ISSUER: issuerOrigin,
    }, cookies.includes('fixture_access=active') ? approved : {});
    for (const [name, value] of response.headers) outgoing.setHeader(name, value);
    outgoing.writeHead(response.status).end(Buffer.from(await response.arrayBuffer()));
  }
  const errors = [];
  server = https.createServer({key, cert}, (request, response) => {
    route(request, response).catch(error => {
      errors.push(error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  dashboardOrigin = 'https://localhost:' + server.address().port;
  issuerOrigin = 'https://127.0.0.1:' + server.address().port;

  // Trust only this short-lived, generated loopback fixture certificate.
  browser = await chromium.launch({args: ['--ignore-certificate-errors-spki-list=' + fingerprint]});
  const page = await browser.newPage();
  await page.route('**/*', route => [dashboardOrigin, issuerOrigin].includes(new URL(route.request().url()).origin)
    ? route.continue() : route.abort());
  await page.goto(issuerOrigin + '/fixture/sign-in');
  await page.goto(dashboardOrigin + '/fixture/sign-in');
  await page.goto(dashboardOrigin + '/dashboard');
  await Promise.all([
    page.waitForURL(dashboardOrigin + '/', {timeout: 15000}),
    page.getByRole('button', {name: 'Sign out', exact: true}).click(),
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(stages, ['access', 'provider']);
  assert.deepEqual(await page.context().cookies([dashboardOrigin, issuerOrigin]), []);
  assert.equal((await page.goto(dashboardOrigin + '/dashboard')).status(), 403);
  console.log('Chromium signed out of both isolated sessions, returned to Infrastructure, and refused the old dashboard session.');
} finally {
  try {
    await browser?.close();
  } finally {
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(fixture, {recursive: true, force: true});
  }
}
