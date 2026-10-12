import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as root from '../dist/server.js';
import * as prompts from '../dist/prompts/index.js';
import { createMockApi, createTestClient } from './helpers.mjs';

async function connected() {
  const server = root.createMcpServer(createTestClient(createMockApi().fetch));
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test('prompt names are exported, frozen and do not collide with tool names', () => {
  assert.deepEqual([...root.PROMPT_NAMES], ['request_leave', 'review_pending_approvals']);
  assert.equal(prompts.PROMPT_NAMES, root.PROMPT_NAMES);
  assert.ok(Object.isFrozen(root.PROMPT_NAMES));
  for (const name of root.PROMPT_NAMES) assert.ok(!root.TOOL_NAMES.includes(name), name);
});

test('prompts/list advertises both prompts with their arguments', async () => {
  const { client, close } = await connected();
  try {
    const { prompts: list } = await client.listPrompts();
    assert.deepEqual(list.map(p => p.name), ['request_leave', 'review_pending_approvals']);
    const leave = list.find(p => p.name === 'request_leave');
    assert.deepEqual(leave.arguments.map(a => a.name).sort(), ['end', 'leave_type', 'note', 'start']);
    assert.ok(leave.arguments.every(a => !a.required));
  } finally {
    await close();
  }
});

test('request_leave fills the arguments and keeps the OTP confirmation steps', async () => {
  const { client, close } = await connected();
  try {
    const result = await client.getPrompt({ name: 'request_leave', arguments: { start: 'yarın', note: 'Doktor' } });
    const text = result.messages[0].content.text;
    assert.match(text, /- Start: yarın/);
    assert.match(text, /- End: same day as start/);
    assert.match(text, /annual leave \(Yıllık İzin\)/);
    assert.match(text, /Note for the approver: Doktor/);
    assert.match(text, /request_leave_otp/);
    assert.match(text, /create_leave_request/);
    assert.ok(text.indexOf('Ask me to confirm') < text.indexOf('request_leave_otp'));
  } finally {
    await close();
  }
});

test('review_pending_approvals never decides for the user', async () => {
  const { client, close } = await connected();
  try {
    const result = await client.getPrompt({ name: 'review_pending_approvals', arguments: {} });
    const text = result.messages[0].content.text;
    assert.match(text, /list_pending_approvals/);
    assert.match(text, /Never decide for me/);
  } finally {
    await close();
  }
});
