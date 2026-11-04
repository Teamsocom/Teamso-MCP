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

test('every tool lists its title in annotations.title and no parameter is untyped (MCP directory checks)', async () => {
  const server = root.createMcpServer(new root.TeamsoClient(`tms_pat_${'A'.repeat(43)}`, 'http://127.0.0.1:9/v1'));
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'directory-check', version: '1' });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  for (const tool of tools) {
    assert.equal(tool.annotations?.title, tool.title, `${tool.name} annotations.title`);
    for (const [name, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
      assert.ok(schema.type || schema.anyOf || schema.enum, `${tool.name}.${name} has no type`);
    }
  }
  await client.close();
});

test('tool texts only describe the tool: no other tool names, no instructions to the model, no hidden text', async () => {
  const server = root.createMcpServer(new root.TeamsoClient(`tms_pat_${'A'.repeat(43)}`, 'http://127.0.0.1:9/v1'));
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'directory-check', version: '1' });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  const toolName = new RegExp(`\\b(${tools.map((tool) => tool.name).join('|')})\\b`);
  const instruction = /\b(only after|ask the user|confirm (it|them|the)|show (it|them|the)|call (it|this|again)|use (it|this)|you|your)\b/i;
  const hidden = /[​-‏‪-‮⁠-⁤﻿]/;
  const texts = (value, path, out) => {
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (key === 'description' && typeof child === 'string') out.push([path, child]);
        else texts(child, `${path}.${key}`, out);
      }
    }
    return out;
  };
  for (const tool of tools) {
    for (const [path, text] of texts({ description: tool.description, input: tool.inputSchema }, tool.name, [])) {
      assert.doesNotMatch(text, toolName, `${path} names another tool`);
      assert.doesNotMatch(text, instruction, `${path} instructs the model`);
      assert.doesNotMatch(text, hidden, `${path} has hidden characters`);
    }
  }
  await client.close();
});
