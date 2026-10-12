import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  TeamsoApiError,
  TeamsoClient,
  isFailureMessageCode,
  signProxyRequest,
} from '../dist/client.js';
import {
  API_BASE,
  HELP_BUNDLE,
  TOKEN,
  createMockApi,
  createTestClient,
  envelope,
  json,
  softFailure,
} from './helpers.mjs';

const SECRET = `${'s'.repeat(16)}${'e'.repeat(16)}`;
const NOW = 1_760_000_000_000;

function independentSignature({ timestamp, clientIp, method, pathname }) {
  const tokenHash = crypto.createHash('sha256').update(TOKEN).digest('hex');
  return crypto
    .createHmac('sha256', SECRET)
    .update(`${timestamp}\n${clientIp}\n${method}\n${pathname}\n${tokenHash}`)
    .digest('hex');
}

test('constructor validates the token and the trusted proxy context', () => {
  assert.throws(() => new TeamsoClient(''), /TEAMSO_ACCESS_TOKEN is required/);
  assert.throws(() => new TeamsoClient('eyJhbGciOi.jwt'), /personal access token \(tms_pat_/);
  assert.throws(
    () => new TeamsoClient(TOKEN, API_BASE, { trustedProxy: { clientIp: 'example.com', sharedSecret: SECRET } }),
    /valid IPv4 or IPv6/,
  );
  assert.throws(
    () => new TeamsoClient(TOKEN, API_BASE, { trustedProxy: { clientIp: '203.0.113.7', sharedSecret: 'short' } }),
    /at least 32 characters/,
  );
  const client = new TeamsoClient(TOKEN, 'https://api.teamso.test/v1///', { helpBaseUrl: 'https://teamso.test/' });
  assert.equal(client.baseUrl, 'https://api.teamso.test/v1');
  assert.equal(client.helpBaseUrl, 'https://teamso.test');
  assert.equal(new TeamsoClient(TOKEN).baseUrl, 'https://api.teamso.com/v1');
});

test('requests carry the bearer token, JSON headers and no proxy headers by default', async () => {
  const api = createMockApi();
  const client = createTestClient(api.fetch);
  await client.checkLeaveRequest({
    leaveTypeId: 'lt-1',
    addedDay: 1.5,
    startDate: '2026-11-02 09:00',
    endDate: '2026-11-02 13:00',
    leavePolicyUserId: 'lpu-1',
    userId: 'u-1',
  });
  const [request] = api.calls;
  assert.equal(request.headers.get('authorization'), `Bearer ${TOKEN}`);
  assert.equal(request.headers.get('content-type'), 'application/json');
  assert.equal(request.headers.get('x-teamso-proxy-signature'), null);
  assert.equal(request.url.search, '?leaveTypeId=lt-1&addedDay=1.5&startDate=2026-11-02+09%3A00'
    + '&endDate=2026-11-02+13%3A00&leavePolicyUserId=lpu-1');
  assert.deepEqual(request.body, ['u-1']);
});

test('trusted proxy requests are signed over timestamp, IP, method, path and token hash', async () => {
  const api = createMockApi();
  const client = createTestClient(api.fetch, {
    trustedProxy: { clientIp: '203.0.113.7', sharedSecret: SECRET },
    now: () => NOW,
  });
  await client.getMe();
  const [request] = api.calls;
  assert.equal(request.headers.get('x-teamso-proxy-client-ip'), '203.0.113.7');
  assert.equal(request.headers.get('x-teamso-proxy-timestamp'), String(NOW));
  const expected = independentSignature({
    timestamp: String(NOW),
    clientIp: '203.0.113.7',
    method: 'GET',
    pathname: '/v1/user',
  });
  assert.equal(request.headers.get('x-teamso-proxy-signature'), expected);
  // Pinned vector shared with the API's verifier tests.
  assert.equal(expected, 'df305163e45118713f272df45325e8fbef2fab01e2bde6e47c63bdcc7c26bf5d');
});

test('the signed path excludes the query string and keeps the context path', async () => {
  const api = createMockApi();
  const client = createTestClient(api.fetch, {
    trustedProxy: { clientIp: '2001:db8::1', sharedSecret: SECRET },
    now: () => NOW,
  });
  await client.checkLeaveRequest({
    leaveTypeId: 'lt-1',
    addedDay: 1,
    startDate: '2026-11-02 09:00',
    endDate: '2026-11-02 18:00',
    leavePolicyUserId: 'lpu-1',
    userId: 'u-1',
  });
  const signature = api.calls[0].headers.get('x-teamso-proxy-signature');
  assert.equal(signature, 'ae7a2886ec8db4db7a6fc1a2d344d8e3e3e1e3381351f0a7fa4d6d6df11a42d3');
  assert.equal(signature, signProxyRequest({
    sharedSecret: SECRET,
    timestamp: String(NOW),
    clientIp: '2001:db8::1',
    method: 'post',
    pathname: '/v1/leave/controlToAddLeave',
    accessToken: TOKEN,
  }));
});

test('a failure envelope with HTTP 200 and code 1 throws TeamsoApiError', async () => {
  const api = createMockApi([['GET /user', () => softFailure('USER_NOT_FOUND', 'Get failed')]]);
  const client = createTestClient(api.fetch);
  await assert.rejects(client.getMe(), error => {
    assert.ok(error instanceof TeamsoApiError);
    assert.equal(error.status, 200);
    assert.equal(error.messageCode, 'USER_NOT_FOUND');
    assert.equal(error.apiMessage, 'Get failed');
    assert.equal(error.body.code, 1);
    return true;
  });
});

test('envelope, security and exception-handler errors are normalised', async () => {
  const cases = [
    [json({ code: 0, message: 'GOAL_NOT_APPROVABLE', message_code: 'INVALID_DATA' }, 400), 400, 'INVALID_DATA', 'GOAL_NOT_APPROVABLE'],
    [json({ status: 403, error: 'ACCESS_DENIED', message_code: 'ACCESS_DENIED', path: '/v1/user' }, 403), 403, 'ACCESS_DENIED', undefined],
    [json({ apierror: { status: 'BAD_REQUEST', message: 'Malformed JSON request' } }, 400), 400, undefined, 'Malformed JSON request'],
    [new Response('<html>Bad gateway</html>', { status: 502 }), 502, undefined, '<html>Bad gateway</html>'],
    [new Response('not json', { status: 200 }), 200, undefined, 'The API returned a response that is not JSON'],
  ];
  for (const [response, status, messageCode, apiMessage] of cases) {
    const client = createTestClient(async () => response);
    await assert.rejects(client.getMe(), error => {
      assert.ok(error instanceof TeamsoApiError);
      assert.equal(error.status, status);
      assert.equal(error.messageCode, messageCode);
      assert.equal(error.apiMessage, apiMessage);
      return true;
    });
  }
});

test('the GET_ERROR result reason stays available on the error', async () => {
  const client = createTestClient(async () => json(envelope('least_day_count', 'GET_ERROR')));
  await assert.rejects(
    client.calculateLeaveDays({
      workingDaysId: 'wd',
      publicHolidayId: 'ph',
      leaveTypeId: 'lt',
      startDate: '2026-11-02 09:00',
      endDate: '2026-11-02 18:00',
    }),
    error => error instanceof TeamsoApiError && error.result === 'least_day_count',
  );
});

test('isFailureMessageCode separates failures from successes', () => {
  for (const code of ['OTP_NOT_DONE', 'CREDIT_INSUFFICIENT', 'ITEM_NOT_FOUND', 'INSERT_ERROR', 'GET_ERROR',
    'NOT_FOUND', 'USER_NOT_FOUND', 'INVALID_INPUT_PARAMETERS', 'ITEM_EXIST', 'PERMISSION_DENIED']) {
    assert.equal(isFailureMessageCode(code), true, code);
  }
  for (const code of ['GET_SUCCESS', 'INSERT_SUCCESS', 'UPDATE_SUCCESS', 'DELETE_SUCCESS', 'ANSWER_SUCCESS',
    'SUITABLE_FOR_ADD', 'INSERT_SUCCESS_SOME_NO_ADDED', undefined]) {
    assert.equal(isFailureMessageCode(code), false, String(code));
  }
});

test('path segments are encoded the way the web app sends them', async () => {
  const api = createMockApi();
  const client = createTestClient(api.fetch);
  await client.calculateLeaveDays({
    workingDaysId: 'wd-1',
    publicHolidayId: 'ph-1',
    leaveTypeId: 'lt-annual',
    startDate: '2026-11-02 09:00',
    endDate: '2026-11-04 18:00',
  });
  assert.equal(api.calls[0].url.pathname,
    '/v1/leave/dayCalculator/wd-1/ph-1/lt-annual/2026-11-02%2009:00/2026-11-04%2018:00');
});

test('downloadPayslip returns bytes and the file name', async () => {
  const bytes = new Uint8Array([37, 80, 68, 70]);
  const client = createTestClient(async () => new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf;charset=UTF-8',
      'Content-Disposition': "inline; filename*=UTF-8''Bordro%20Eyl%C3%BCl.pdf",
    },
  }));
  const file = await client.downloadPayslip('pay-1');
  assert.deepEqual([...file.data], [...bytes]);
  assert.equal(file.contentType, 'application/pdf');
  assert.equal(file.fileName, 'Bordro Eylül.pdf');

  const missing = createTestClient(async () => new Response(null, { status: 404 }));
  await assert.rejects(missing.downloadPayslip('pay-x'), error => error instanceof TeamsoApiError && error.status === 404);
});

test('the help bundle is cached, refreshed after the TTL and served stale on failure', async () => {
  let now = NOW;
  let healthy = true;
  let downloads = 0;
  const client = createTestClient(async input => {
    downloads++;
    assert.equal(String(input), 'https://help.teamso.test/how-to/bundle.tr.json');
    return healthy ? json(HELP_BUNDLE) : new Response('down', { status: 503 });
  }, { now: () => now, helpCacheTtlMs: 1_000 });

  assert.equal((await client.getHelpBundle('tr')).articles.length, 3);
  await client.getHelpBundle('tr');
  assert.equal(downloads, 1, 'served from cache inside the TTL');

  now += 1_001;
  healthy = false;
  assert.equal((await client.getHelpBundle('tr')).articles.length, 3, 'stale copy on failure');
  assert.equal(downloads, 2);
  await client.getHelpBundle('tr');
  assert.equal(downloads, 2, 'failed refresh is retried only after a minute');

  now += 60_001;
  healthy = true;
  await client.getHelpBundle('tr');
  assert.equal(downloads, 3);
});

test('the help bundle download fails cleanly without a cached copy', async () => {
  const client = createTestClient(async () => json({ lang: 'tr', articles: 'nope' }));
  await assert.rejects(client.getHelpBundle('tr'), /not in the expected format/);
});

test('concurrent help requests share one download', async () => {
  let downloads = 0;
  const client = createTestClient(async () => {
    downloads++;
    await new Promise(resolve => setTimeout(resolve, 10));
    return json(HELP_BUNDLE);
  });
  await Promise.all([client.getHelpBundle('tr'), client.getHelpBundle('tr'), client.getHelpBundle('tr')]);
  assert.equal(downloads, 1);
});

test('the client never exposes the token or the proxy secret through inspection', async () => {
  const { inspect } = await import('node:util');
  const client = createTestClient(createMockApi().fetch, {
    trustedProxy: { clientIp: '203.0.113.7', sharedSecret: SECRET },
  });
  for (const rendered of [inspect(client, { depth: 5, showHidden: true }), JSON.stringify(client)]) {
    assert.doesNotMatch(rendered, new RegExp(TOKEN));
    assert.doesNotMatch(rendered, new RegExp(SECRET));
  }
});

test('IPv4-mapped IPv6 caller addresses are signed as plain IPv4', async () => {
  const api = createMockApi();
  const client = createTestClient(api.fetch, {
    trustedProxy: { clientIp: '::ffff:203.0.113.7', sharedSecret: SECRET },
    now: () => NOW,
  });
  await client.getMe();
  const [request] = api.calls;
  assert.equal(request.headers.get('x-teamso-proxy-client-ip'), '203.0.113.7');
  assert.equal(request.headers.get('x-teamso-proxy-signature'),
    'df305163e45118713f272df45325e8fbef2fab01e2bde6e47c63bdcc7c26bf5d');
});

test('connection failures name the API base URL, not the request or the token', async () => {
  const client = createTestClient(async () => {
    throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:1460') });
  });
  await assert.rejects(client.searchUsers({ query: 'private search' }), error => {
    assert.match(error.message, /Could not reach the Teamso API at https:\/\/api\.teamso\.test\/v1 \(connect ECONNREFUSED/);
    assert.doesNotMatch(error.message, /private search|tms_pat_/);
    return true;
  });
  const timeout = createTestClient(async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  });
  await assert.rejects(timeout.getMe(), error => error.name === 'TimeoutError');
});
