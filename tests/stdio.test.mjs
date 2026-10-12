import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { TOOL_NAMES, VERSION } from '../dist/server.js';
import { HELP_BUNDLE } from './helpers.mjs';

const BIN = fileURLToPath(new URL('../dist/index.js', import.meta.url));

function runBin(env, messages, expectedResponses) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN], {
      env: { PATH: process.env.PATH, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const responses = [];
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out. stderr: ${stderr}`));
    }, 10_000);

    child.stdout.on('data', chunk => {
      stdout += chunk;
      let newline;
      while ((newline = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, newline).trim();
        stdout = stdout.slice(newline + 1);
        if (line) responses.push(JSON.parse(line));
      }
      if (responses.length >= expectedResponses) child.stdin.end();
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, responses, stderr });
    });

    for (const message of messages) child.stdin.write(`${JSON.stringify(message)}\n`);
    if (expectedResponses === 0) child.stdin.end();
  });
}

test('the stdio binary answers initialize and tools/list', async () => {
  const { responses, stderr } = await runBin({ TEAMSO_ACCESS_TOKEN: 'tms_pat_dummy' }, [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1.0.0' } },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ], 2);

  const [initialize, list] = responses;
  assert.equal(initialize.result.serverInfo.name, 'teamso-mcp');
  assert.equal(initialize.result.serverInfo.version, VERSION);
  assert.match(initialize.result.instructions, /request_leave_otp/);
  assert.equal(list.result.tools.length, TOOL_NAMES.length);
  assert.equal(list.result.tools.length, 28);
  assert.match(stderr, /running on stdio \(api: https:\/\/api\.teamso\.com\/v1\)/);
});

test('the stdio binary refuses to start without a valid token', async () => {
  const missing = await runBin({}, [], 0);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /TEAMSO_ACCESS_TOKEN environment variable is required/);
  assert.match(missing.stderr, /teamso\.com\/dashboard\/mcp-access/);

  const wrong = await runBin({ TEAMSO_ACCESS_TOKEN: 'not-a-pat' }, [], 0);
  assert.equal(wrong.code, 1);
  assert.match(wrong.stderr, /personal access token/);
});

test('the stdio binary downloads help from TEAMSO_HELP_BASE_URL and links to TEAMSO_HELP_PUBLIC_URL', async () => {
  const requested = [];
  const mirror = createServer((request, response) => {
    requested.push(request.url);
    if (request.url === '/how-to/bundle.tr.json') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(HELP_BUNDLE));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise(resolve => mirror.listen(0, '127.0.0.1', resolve));
  const { port } = mirror.address();
  try {
    const { responses } = await runBin({
      TEAMSO_ACCESS_TOKEN: 'tms_pat_dummy',
      TEAMSO_HELP_BASE_URL: `http://127.0.0.1:${port}`,
      TEAMSO_HELP_PUBLIC_URL: 'https://public.teamso.test',
    }, [
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1.0.0' } },
      },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_help_article', arguments: { id: 'performance.goal-entry-employee' } },
      },
    ], 2);

    const text = responses[1].result.content.map(block => block.text).join('\n');
    assert.match(text, /\]\(https:\/\/public\.teamso\.test\/how-to\/performance\/goal\.png\)/);
    assert.doesNotMatch(text, /127\.0\.0\.1/);
    assert.deepEqual(requested, ['/how-to/bundle.tr.json']);
  } finally {
    await new Promise(resolve => mirror.close(resolve));
  }
});
