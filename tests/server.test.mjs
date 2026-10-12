import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import * as root from '../dist/server.js';
import * as tools from '../dist/tools/index.js';
import { createMockApi, createTestClient, assertMatchesOutputSchema } from './helpers.mjs';

test('the package root exports the documented API', () => {
  for (const name of ['createMcpServer', 'TeamsoClient', 'TeamsoApiError', 'registerTools', 'withJsonSchema2020_12',
    'signProxyRequest', 'isFailureMessageCode']) {
    assert.equal(typeof root[name], 'function', name);
  }
  assert.match(root.VERSION, /^\d+\.\d+\.\d+/);
  assert.ok(Object.isFrozen(root.TOOL_NAMES));
  assert.equal(tools.TOOL_NAMES, root.TOOL_NAMES);
  assert.equal(new Set(root.TOOL_NAMES).size, root.TOOL_NAMES.length);
});

test('createMcpServer accepts a name, version and instructions', async () => {
  const server = root.createMcpServer(createTestClient(createMockApi().fetch), {
    name: 'teamso-hosted',
    version: '9.9.9',
    instructions: 'Hosted instructions.',
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    assert.deepEqual(client.getServerVersion(), { name: 'teamso-hosted', version: '9.9.9' });
    assert.equal(client.getInstructions(), 'Hosted instructions.');
  } finally {
    await client.close();
    await server.close();
  }
});

test('output schema validation rejects unknown keys', async () => {
  const server = root.createMcpServer(createTestClient(createMockApi().fetch));
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const { tools: listed } = await client.listTools();
    const tool = listed.find(item => item.name === 'request_leave_otp');
    const valid = {
      sent: true,
      validForSeconds: 180,
      message: 'ok',
      nextAction: { tool: 'create_leave_request', arguments: {}, reason: 'r' },
    };
    assertMatchesOutputSchema(tool, valid);
    assert.throws(() => assertMatchesOutputSchema(tool, { ...valid, extra: 1 }), /additional properties/);
  } finally {
    await client.close();
    await server.close();
  }
});
