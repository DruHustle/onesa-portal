import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const compose = JSON.parse(readFileSync(new URL('../compose.oracle-backend.yaml', import.meta.url), 'utf8'));

test('Oracle staging and production API health requires a live database', () => {
  for (const environment of ['staging', 'production']) {
    const service = compose.services[environment];
    assert.ok(service, `Missing ${environment} API service`);
    assert.equal(service.platform, 'linux/arm64');
    assert.equal(service.pull_policy, 'never');
    assert.deepEqual(service.healthcheck?.test?.slice(0, 1), ['CMD-SHELL']);
    const script = service.healthcheck.test[1];
    assert.match(script, /\/api\/v1\/ready/);
    assert.doesNotMatch(script, /\/api\/v1\/health/);
    assert.match(script, /process\.exit\(r\.ok\s*\?\s*0\s*:\s*1\)/);
    assert.match(script, /\.catch\(\(\)\s*=>\s*process\.exit\(1\)\)/);
    assert.ok(/^[1-9]\d*s$/.test(service.healthcheck.interval));
    assert.ok(/^[1-9]\d*s$/.test(service.healthcheck.timeout));
    assert.ok(service.healthcheck.retries >= 2);
  }
});

test('Production health classification must not turn a 503 liveness response into readiness', () => {
  assert.equal(compose.services.production.ports[0], '127.0.0.1:18300:8300');
  assert.notEqual(compose.services.production.ports[0], compose.services.staging.ports[0]);
  assert.equal(compose.services.production.environment.PORT, '8300');
  assert.ok(compose.services.production.env_file.some(x=>x.path.endsWith('/portal-production.env')));
  assert.ok(compose.services.staging.env_file.some(x=>x.path.endsWith('/portal-staging.env')));
});
