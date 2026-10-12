import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { TOOL_NAMES, VERSION } from '../dist/server.js';

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
