import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { closeInputObjects } from '../dist/utils/json-schema-dialect.js';
import { withMcp } from './helpers.mjs';

/**
 * The published tool contract must not move when a dependency does. Zod 4 lists a plain z.object() input as open
 * (no additionalProperties), Zod 3 listed it as closed; the server keeps it closed (TMS-4860).
 */

/** Every object schema with properties, with its JSON path. */
function objectsWithProperties(node, path = '$', out = []) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => objectsWithProperties(item, `${path}[${index}]`, out));
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'object' && node.properties && Object.keys(node.properties).length > 0) {
    out.push({ path, node });
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'enum' || key === 'const' || key === 'default' || key === 'examples' || key === 'required') continue;
    objectsWithProperties(value, `${path}.${key}`, out);
  }
  return out;
}

test('every input object that lists properties is closed, at every level', async () => {
  await withMcp([], async ({ tools }) => {
    let closedRoots = 0;
    for (const tool of tools) {
      const objects = objectsWithProperties(tool.inputSchema);
      for (const { path, node } of objects) {
        assert.equal(node.additionalProperties, false, `${tool.name} ${path} is closed`);
      }
      if (Object.keys(tool.inputSchema.properties ?? {}).length > 0) closedRoots += 1;
    }
    // 33 tools take parameters; the 7 without parameters stay an empty object (as with Zod 3)
    assert.equal(closedRoots, 33);
    for (const name of ['get_me', 'list_leave_types', 'get_my_leave_balance', 'request_leave_otp',
      'list_pending_approvals', 'list_performance_periods', 'request_sms_code']) {
      const tool = tools.find(item => item.name === name);
      assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}), [], `${name} has no parameters`);
      assert.equal('additionalProperties' in tool.inputSchema, false, `${name} keeps the SDK's empty object`);
    }
  });
});

test('records keep their value schema and key rule', async () => {
  await withMcp([], async ({ tools }) => {
    const read = tools.find(tool => tool.name === 'call_api_read');
    const { path_params: pathParams, query } = read.inputSchema.properties;
    assert.equal(pathParams.type, 'object');
    assert.equal(typeof pathParams.additionalProperties, 'object');
    assert.deepEqual(pathParams.propertyNames, { type: 'string', minLength: 1, maxLength: 100 });
    assert.equal(typeof query.additionalProperties, 'object');
    assert.ok(Array.isArray(query.additionalProperties.anyOf));
  });
});

test('outputs stay closed objects and carry no internal $ref', async () => {
  await withMcp([], async ({ tools }) => {
    for (const tool of tools) {
      assert.doesNotMatch(JSON.stringify(tool.outputSchema), /"\$ref":"#\/properties/, `${tool.name} output`);
      assert.doesNotMatch(JSON.stringify(tool.inputSchema), /"\$ref":"#\/properties/, `${tool.name} input`);
      for (const { path, node } of objectsWithProperties(tool.outputSchema)) {
        assert.ok('additionalProperties' in node, `${tool.name} ${path} states additionalProperties`);
      }
    }
  });
});

test('an unknown argument is still dropped, not refused (runtime unchanged)', async () => {
  await withMcp([], async ({ call }) => {
    const result = await call('list_help_modules', { lang: 'tr', notAParameter: true });
    assert.notEqual(result.isError, true);
    assert.deepEqual(result.structuredContent.modules.map(module => module.dir), ['performance']);
  });
});

test('closeInputObjects closes only objects that do not say otherwise', () => {
  const closed = closeInputObjects({
    type: 'object',
    properties: {
      plain: { type: 'object', properties: { a: { type: 'string' } } },
      loose: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: {} },
      record: { type: 'object', additionalProperties: { type: 'number' } },
      empty: { type: 'object', properties: {} },
      list: { type: 'array', items: { type: 'object', properties: { b: { type: 'number' } } } },
      either: { anyOf: [{ type: 'object', properties: { c: { type: 'boolean' } } }, { type: 'string' }] },
      choice: { type: 'string', enum: ['object'] },
    },
    required: ['plain'],
  });
  assert.equal(closed.additionalProperties, false);
  assert.equal(closed.properties.plain.additionalProperties, false);
  assert.deepEqual(closed.properties.loose.additionalProperties, {});
  assert.deepEqual(closed.properties.record.additionalProperties, { type: 'number' });
  assert.equal('additionalProperties' in closed.properties.empty, false);
  assert.equal(closed.properties.list.items.additionalProperties, false);
  assert.equal(closed.properties.either.anyOf[0].additionalProperties, false);
  assert.deepEqual(closed.properties.choice.enum, ['object']);
  assert.deepEqual(closed.required, ['plain']);
});

test('dependencies stay on releases without the known advisories', () => {
  const version = name => JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url))).version;
  const atLeast = (actual, minimum) => {
    const a = actual.split('.').map(Number);
    const m = minimum.split('.').map(Number);
    for (let i = 0; i < 3; i += 1) {
      if (a[i] !== m[i]) return a[i] > m[i];
    }
    return true;
  };
  for (const [name, minimum] of [['zod', '4.6.6'], ['body-parser', '2.4.0'], ['qs', '6.16.1'], ['fast-uri', '3.1.9']]) {
    assert.ok(atLeast(version(name), minimum), `${name} ${version(name)} >= ${minimum}`);
  }
});
