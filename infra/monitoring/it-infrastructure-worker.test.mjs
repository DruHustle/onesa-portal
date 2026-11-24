import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker from './it-infrastructure-worker.mjs';

const base = 'https://it-infrastructure.onesa.eu';
const audience = {INFRASTRUCTURE_ACCESS_AUD: 'example-dashboard-audience'};
const claim = 'https://onesa.eu/claims/infrastructure_admin';
const approvedIdentity = {email: 'admin@example.test', oidc_fields: {[claim]: 'approved'}};
const accessContext = {
  access: {aud: audience.INFRASTRUCTURE_ACCESS_AUD, getIdentity: async () => approvedIdentity},
};

function dashboardFetch(request) {
  return worker.fetch(request, audience, accessContext);
}

test('the public entry goes to dashboard sign-in or scoped registration without a private payload', async () => {
  for (const path of ['/', '/index.html']) {
    const response = await worker.fetch(new Request(base + path + '?returnTo=https://example.test'));
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
    assert.match(html, /href="\/dashboard">Sign in</);
    const signup = html.match(/href="([^"]+)">Sign up</)[1].replaceAll('&amp;', '&');
    assert.equal(signup, 'https://account.onesa.eu/register?product=portal&audience=admin&platform=web&entry=infrastructure');
    assert.doesNotMatch(html, /example\.test|dashboard\.js|\/api\/status|portainer\.onesa\.eu|Cloudflare diagnostics/);
  }
});

test('returning from registration can display review instructions without creating a session', async () => {
  const response = await worker.fetch(new Request(base + '/access-requested'));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /reviews your request after you verify your email/);
  assert.equal(response.headers.has('set-cookie'), false);
  assert.equal((await worker.fetch(new Request(base + '/dashboard'), audience)).status, 403);
});

test('staging signup uses its separately configured Account origin', async () => {
  const stage = 'https://infrastructure-staging.example.test';
  const request = new Request(stage);
  const env = {INFRASTRUCTURE_ORIGIN: stage};
  for (const origin of [
    undefined,
    'https://account.onesa.eu',
    stage,
    'http://account-staging.example.test',
    'https://account-staging.example.test/path',
    'https://auth.onesa.eu',
    'https://onesa.eu.auth0.com',
  ]) {
    const response = await worker.fetch(request, {...env, INFRASTRUCTURE_ACCOUNT_ORIGIN: origin});
    assert.equal((await response.text()).includes('>Sign up<'), false, String(origin));
  }
  const response = await worker.fetch(request, {...env, INFRASTRUCTURE_ACCOUNT_ORIGIN: 'https://account-staging.example.test'});
  assert.match(await response.text(), /https:\/\/account-staging\.example\.test\/register\?product=portal&amp;audience=admin/);
});

test('all dashboard endpoints reject unapproved identities before reaching monitored services', async () => {
  const original = globalThis.fetch;
  let probeCount = 0;
  globalThis.fetch = async () => { probeCount++; throw new Error('unexpected monitor request'); };
  const denied = [
    [audience, undefined],
    [{}, accessContext],
    [audience, {access: {...accessContext.access, aud: 'another-app'}}],
    [audience, {access: {aud: audience.INFRASTRUCTURE_ACCESS_AUD}}],
    ...[
      null,
      {email: 'member@example.test'},
      {email: 'pending@example.test', oidc_fields: {[claim]: 'pending'}},
      {email: 'member@example.test', oidc_fields: {[claim]: ['approved']}},
      {oidc_fields: {[claim]: 'approved'}},
    ].map(identity => [audience, {access: {...accessContext.access, getIdentity: async () => identity}}]),
    [audience, {access: {...accessContext.access, getIdentity: async () => { throw new Error('identity unavailable'); }}}],
  ];
  try {
    for (const path of ['/dashboard', '/dashboard/', '/dashboard/dashboard.js', '/dashboard/api/status', '/dashboard.js', '/api/status']) {
      for (const [env, context] of denied) {
        const request = new Request(base + path, {headers: {
          'Cf-Access-Jwt-Assertion': 'untrusted-user-header',
          'Cf-Access-Authenticated-User-Email': approvedIdentity.email,
        }});
        const response = await worker.fetch(request, env, context);
        assert.equal(response.status, 403, path);
        assert.equal(await response.text(), 'Approved infrastructure access required');
      }
    }
    assert.equal(probeCount, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('an authorized request cannot expose the dashboard through another hostname', async () => {
  for (const origin of ['https://preview.workers.dev', 'http://it-infrastructure.onesa.eu']) {
    assert.equal((await dashboardFetch(new Request(origin + '/dashboard'))).status, 404);
  }
  const stage = 'https://infrastructure-staging.example.test';
  const response = await worker.fetch(new Request(stage + '/dashboard'), {...audience, INFRASTRUCTURE_ORIGIN: stage}, accessContext);
  assert.equal(response.status, 200);
});

test('authenticated HEAD on status preserves metadata without running probes', async () => {
  const request = new Request(base + '/dashboard/api/status', {method: 'HEAD'});
  const denied = await worker.fetch(request, audience);
  const approved = await dashboardFetch(request);
  assert.equal(denied.status, 403);
  assert.equal(approved.status, 200);
  assert.match(approved.headers.get('content-type'), /^application\/json/);
  assert.equal(await approved.text(), '');
});

async function sampleStatus(status) {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {status});
  try {
    const response = await dashboardFetch(new Request(base + '/dashboard/api/status'));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
    return response.json();
  } finally {
    globalThis.fetch = previous;
  }
}

test('a homepage HTTP 200 is not a passed application health check', async () => {
  const result = await sampleStatus(200);
  assert.equal(result.scope, 'edge_http_identity_portal_and_pasofi_preflight');
  assert.ok(Array.isArray(result.services) && result.services.length > 0);
  assert.ok(result.services.filter(x => !['Onesa Account','Company Portal'].includes(x.name)).every(x => x.state === 'unknown' && x.status === 200));
  const identity = result.services.find(x => x.name === 'Onesa Account');
  assert.equal(identity.state, 'bad', 'A contentless HTTP 200 cannot verify /readyz');
  assert.equal(result.services.find(x=>x.name==='Company Portal').state,'bad','A contentless HTTP 200 cannot verify Portal DB readiness');
  assert.ok(result.services.every(x => !/operational|healthy/i.test(x.label)));
});


test('the verified Identity readiness endpoint alone may display healthy', async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (url === 'https://account.onesa.eu/readyz')
      return Response.json({service:'onesa-identity',ready:true});
    return new Response('Home page', {status:200,headers:{'content-type':'text/html'}});
  };
  try {
    const response = await dashboardFetch(new Request(base + '/dashboard/api/status'));
    const result = await response.json();
    const identity = result.services.find(x=>x.name==='Onesa Account');
    assert.equal(identity.state,'ok');
    assert.equal(identity.label,'Identity ready');
    assert.equal(result.services.find(x=>x.name==='Company Portal').state,'bad');
    assert.ok(result.services.filter(x=>!['Onesa Account','Company Portal'].includes(x.name)).every(x=>x.state==='unknown'));
    assert.equal(calls.filter(url=>url.endsWith('/readyz')).length,1);
  } finally {globalThis.fetch=previous;}
});

test('malformed, misleading and oversized Identity responses never pass readiness', async () => {
  const fixtures = [
    Response.json({service:'onesa-identity',ready:false}),
    Response.json({service:'other',ready:true}),
    Response.json({service:'onesa-identity',ready:'true'}),
    new Response('<html>sign in</html>', {status:200,headers:{'content-type':'text/html'}}),
    new Response('x'.repeat(5000), {status:200,headers:{'content-type':'application/json'}}),
    new Response(null, {status:200,headers:{'content-type':'application/json'}}),
  ];
  for (const fixture of fixtures) {
    const previous=globalThis.fetch;
    globalThis.fetch=async url=> url==='https://account.onesa.eu/readyz' ? fixture : Response.json({service:'other',ready:true});
    try{
      const response=await dashboardFetch(new Request(base+'/dashboard/api/status'));
      const result=await response.json();
      assert.equal(result.services.find(x=>x.name==='Onesa Account').state,'bad');
      assert.equal(result.services.find(x=>x.name==='Company Portal').state,'bad');
      assert.ok(result.services.filter(x=>!['Onesa Account','Company Portal'].includes(x.name)).every(x=>x.state==='unknown'));
    }finally{globalThis.fetch=previous;}
  }
});

test('a Cloudflare Access redirect never counts as verified origin health', async () => {
  const result = await sampleStatus(302);
  assert.ok(result.services.every(x => x.state === 'unknown' && x.status === 302));
});

test('401 and 403 require independent origin checks', async () => {
  for (const status of [401, 403]) {
    const result = await sampleStatus(status);
    assert.ok(result.services.every(x => x.state === 'unknown'));
  }
});

test('unavailable backend and missing routes are failures', async () => {
  for (const status of [503, 404]) {
    const result = await sampleStatus(status);
    assert.ok(result.services.every(x => x.state === 'bad'));
  }
});

test('network failure does not produce green health', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('origin unavailable'); };
  try {
    const response = await dashboardFetch(new Request(base + '/dashboard/api/status'));
    const result = await response.json();
    assert.ok(result.services.every(x => x.state === 'bad'));
  } finally {
    globalThis.fetch = previous;
  }
});

test('static directory is restricted and excludes inactive Render production hosting', async () => {
  const response = await dashboardFetch(new Request(base + '/dashboard'));
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.match(html, /HTTP reachability only/);
  assert.match(html, /src="\/dashboard\/dashboard\.js"/);
  assert.match(html, /href="\/cdn-cgi\/access\/logout">Sign out</);
  assert.doesNotMatch(html, /dashboard\.render\.com/);
  assert.doesNotMatch(html, /Render<\/h3>/);
});

test('control methods cannot mutate the directory', async () => {
  const response = await dashboardFetch(new Request(base + '/dashboard/api/status', {method:'POST'}));
  assert.equal(response.status, 405);
});

test('Portal DB-backed readiness checks an exact bounded JSON response, not the homepage', async () => {
  const original=globalThis.fetch, calls=[];
  globalThis.fetch=async url=>{
    calls.push(String(url));
    if(String(url)==='https://portal.onesa.eu/api/v1/ready') return Response.json({status:'ready'});
    if(String(url)==='https://account.onesa.eu/readyz') return Response.json({service:'onesa-identity',ready:true});
    return new Response('<html>homepage only</html>',{status:200,headers:{'content-type':'text/html'}});
  };
  try{
    const status=await (await dashboardFetch(new Request(base+'/dashboard/api/status'))).json();
    const portal=status.services.find(x=>x.name==='Company Portal');
    assert.equal(portal.state,'ok');
    assert.equal(portal.label,'Portal DB ready');
    assert.match(portal.detail,/customer\/admin flows unverified/);
    assert.equal(calls.filter(x=>x==='https://portal.onesa.eu/api/v1/ready').length,1);
    assert.equal(calls.filter(x=>x==='https://portal.onesa.eu').length,0);
    assert.equal(status.services.find(x=>x.name==='Onesa Account').state,'ok');
    assert.ok(status.services.filter(x=>!['Onesa Account','Company Portal'].includes(x.name))
      .every(x=>x.state==='unknown'));
  }finally{globalThis.fetch=original;}
});

test('Portal liveness, misleading JSON, HTML and malformed or oversized responses never pass readiness', async () => {
  const examples=[
    () => Response.json({status:'ok'}),
    () => Response.json({status:true}),
    () => Response.json({ready:true}),
    () => new Response('<html>Service available</html>',{status:200,headers:{'content-type':'text/html'}}),
    () => new Response('invalid JSON',{status:200,headers:{'content-type':'application/json'}}),
    () => new Response('x'.repeat(5000),{status:200,headers:{'content-type':'application/json'}}),
    () => new Response(null,{status:200,headers:{'content-type':'application/json'}}),
  ];
  for(const fixture of examples){
    const original=globalThis.fetch;
    globalThis.fetch=async url=>String(url)==='https://portal.onesa.eu/api/v1/ready'
      ? fixture():new Response('home',{status:200,headers:{'content-type':'text/html'}});
    try{
      const result=await (await dashboardFetch(new Request(base+'/dashboard/api/status'))).json();
      const portal=result.services.find(x=>x.name==='Company Portal');
      assert.equal(portal.state,'bad');
      assert.equal(portal.label,'Invalid Portal readiness');
      assert.ok(!JSON.stringify(result).includes('invalid JSON'));
    }finally{globalThis.fetch=original;}
  }
});

test('live 503 DATABASE_CONNECTION is explicitly classified as Portal API unavailable', async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async url=>String(url)==='https://portal.onesa.eu/api/v1/ready'
    ? Response.json({error:{code:'DATABASE_CONNECTION',message:'private-db-error'}},{status:503})
    : new Response('Home page',{status:200,headers:{'content-type':'text/html'}});
  try{
    const result=await (await dashboardFetch(new Request(base+'/dashboard/api/status'))).json();
    const portal=result.services.find(x=>x.name==='Company Portal');
    assert.equal(portal.status,503);
    assert.equal(portal.state,'bad');
    assert.equal(portal.label,'Portal API not ready');
    assert.match(portal.detail,/database-backed readiness failed/);
    assert.ok(!JSON.stringify(result).includes('private-db-error'));
  }finally{globalThis.fetch=original;}
});

test('live disabled PasoFi checkout and network are a critical operational failure, not a healthy homepage', async () => {
  const original = globalThis.fetch;
  const observed = [];
  globalThis.fetch = async url => {
    observed.push(String(url));
    if (String(url) === 'https://pasofi.mobile.onesa.eu/api/capabilities') {
      return Response.json({demo:false,paymentMode:'disabled',paymentCheckout:false,
        vouchers:false,networkAccess:false});
    }
    return new Response('static homepage', {status:200,headers:{'content-type':'text/html'}});
  };
  try {
    const response = await dashboardFetch(new Request(base+'/dashboard/api/status'));
    assert.equal(response.status,200);
    const body=await response.json();
    const pasofi=body.services.find(service=>service.name==='PasoFi');
    assert.equal(pasofi.state,'bad');
    assert.equal(pasofi.label,'Customer service disabled');
    assert.match(pasofi.detail,/cannot serve paying customers/);
    assert.equal(observed.filter(url=>url.endsWith('/api/capabilities')).length,1);
    assert.equal(observed.filter(url=>url==='https://pasofi.mobile.onesa.eu').length,0);
    assert.ok(body.services.filter(s=>!['PasoFi','Onesa Account','Company Portal'].includes(s.name)).every(s=>s.state==='unknown'));
  } finally {globalThis.fetch=original;}
});

test('payment and RADIUS capability flags never by themselves constitute commercial acceptance', async () => {
  const original=globalThis.fetch;
  globalThis.fetch=async url => String(url).endsWith('/api/capabilities')
    ? Response.json({demo:false,paymentMode:'production',paymentCheckout:true,
        vouchers:true,networkAccess:true})
    : new Response('home', {status:200,headers:{'content-type':'text/html'}});
  try {
    const result=await (await dashboardFetch(new Request(base+'/dashboard/api/status'))).json();
    const pasofi=result.services.find(s=>s.name==='PasoFi');
    assert.equal(pasofi.state,'unknown');
    assert.equal(pasofi.label,'Commercial readiness unverified');
    assert.match(pasofi.detail,/RADIUS and guest internet acceptance still required/);
  } finally {globalThis.fetch=original;}
});

test('invalid, oversized, redirected and unknown PasoFi capacity responses fail closed without leaking content', async () => {
  const examples=[
    () => Response.json({demo:false,paymentMode:'production',paymentCheckout:true,
       networkAccess:true}),
    () => Response.json({demo:false,paymentMode:'production',paymentCheckout:'true',
       vouchers:true,networkAccess:true}),
    () => new Response('x'.repeat(5000),{status:200,headers:{'content-type':'application/json'}}),
    () => new Response('<html>Access portal</html>',{status:200,headers:{'content-type':'text/html'}}),
    () => new Response(null,{status:302,headers:{'Location':'https://auth.onesa.eu/authorize'}}),
    () => new Response('bad JSON',{status:200,headers:{'content-type':'application/json'}}),
  ];
  for(const makeResponse of examples){
    const original=globalThis.fetch;
    globalThis.fetch=async url=>String(url).endsWith('/api/capabilities')?makeResponse():
      new Response('static site',{status:200,headers:{'content-type':'text/html'}});
    try{
      const result=await (await dashboardFetch(new Request(base+'/dashboard/api/status'))).json();
      const pasofi=result.services.find(s=>s.name==='PasoFi');
      assert.equal(pasofi.state,'unknown','Unverified flags must remain UNKNOWN');
      assert.ok(!/healthy|ready|operational/i.test(pasofi.label));
      assert.ok(!JSON.stringify(result).includes('bad JSON'));
    }finally{globalThis.fetch=original;}
  }
});

// Regression: the served browser script once contained `…length,const unknown=…`,
// a SyntaxError that left the live status panel on "Loading service checks…"
// forever. Node tests of the Worker module alone never parsed that string.
async function runDashboardScript(statusPayload, {fail = false} = {}) {
  const {Script, createContext} = await import('node:vm');
  const response = await dashboardFetch(new Request(base + '/dashboard/dashboard.js'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/javascript/);
  const source = await response.text();
  const script = new Script(source, {filename: 'dashboard.js'});
  const element = () => ({innerHTML: '', textContent: '', disabled: false, listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; }});
  const nodes = {'#status-grid': element(), '#status-summary': element(), '#refresh-status': element()};
  const timers = [];
  const context = createContext({
    document: {querySelector: selector => nodes[selector] ?? null},
    fetch: async url => {
      assert.equal(url, '/dashboard/api/status');
      return fail ? new Response('nope', {status: 502}) : Response.json(statusPayload);
    },
    setInterval: (fn, ms) => { timers.push(ms); return timers.length; },
    Date, String, Error, JSON, Promise,
  });
  script.runInContext(context);
  for (let i = 0; i < 20 && nodes['#refresh-status'].textContent !== 'Refresh'; i++)
    await new Promise(resolve => setImmediate(resolve));
  return {nodes, timers};
}

test('served dashboard script parses and renders the status summary', async () => {
  const payload = {checkedAt: '2026-11-22T00:00:00.000Z', services: [
    {name: 'Onesa Account', state: 'ok', label: 'Identity ready', detail: 'ok', url: 'https://account.onesa.eu', recovery: 'https://account.onesa.eu'},
    {name: 'Smart Factory', state: 'unknown', label: 'HTTP reachable', detail: 'unverified', url: 'https://factory.onesa.eu', recovery: 'https://factory.onesa.eu'},
    {name: '<img src=x onerror=alert(1)>', state: 'bad', label: 'HTTP 503', detail: 'down', url: 'https://portal.onesa.eu', recovery: 'https://portal.onesa.eu'},
  ]};
  const {nodes, timers} = await runDashboardScript(payload);
  assert.match(nodes['#status-summary'].textContent, /^1 verified ready · 1 reachability-only \/ unknown · 1 HTTP failures · /);
  assert.equal((nodes['#status-grid'].innerHTML.match(/class="status-card"/g) || []).length, 3);
  assert.doesNotMatch(nodes['#status-grid'].innerHTML, /<img/, 'service fields must be HTML-escaped');
  assert.equal(nodes['#refresh-status'].disabled, false);
  assert.deepEqual(timers, [60000]);
});

test('served dashboard script reports an unavailable status endpoint instead of loading forever', async () => {
  const {nodes} = await runDashboardScript(null, {fail: true});
  assert.equal(nodes['#status-summary'].textContent, 'Status check unavailable');
  assert.doesNotMatch(nodes['#status-grid'].innerHTML, /Loading service checks/);
});
