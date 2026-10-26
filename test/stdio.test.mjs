import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once, EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { id, requestId, wav, job, packageRoot } from './fixtures.mjs';

const workspace = fileURLToPath(new URL('..', import.meta.url));
async function setup(t, { queued = false, noKey = false, audio = wav, onCreate } = {}) {
  const scratch = path.join(workspace, '.test-tmp');
  await mkdir(scratch, { recursive: true });
  const directory = await mkdtemp(path.join(scratch, 'stdio-'));
  const requests = [], jobs = new Map(), events = new EventEmitter();
  let baseUrl;
  const server = createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      requests.push({ path: req.url, method: req.method, auth: req.headers.authorization, key: req.headers['idempotency-key'], body });
      if (req.url === '/audio.wav') { res.end(audio); return; }
      assert.equal(req.headers.authorization, 'Bearer fake-test-key');
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/v1/voices') {
        res.end(JSON.stringify({ voices: [{ name: 'Kore', gender: 'female', description: 'Firm' }] })); return;
      }
      if (req.url === '/api/v1/quota') {
        res.end(JSON.stringify({ quota: { total: 20, remaining: 20, reserved: 0, available: 20 }, subscription: null, limits: {} })); return;
      }
      if (req.url === '/api/v1/tts/jobs' && req.method === 'POST') {
        const key = req.headers['idempotency-key'];
        assert.match(key, /^[0-9a-f-]{36}$/);
        const response = job(queued ? 'queued' : 'success', {
          requestId: key,
          ...(queued ? {} : { result: { ...job().result, url: baseUrl + '/audio.wav' } }),
        });
        jobs.set(key, response);
        await onCreate?.(JSON.parse(body), directory);
        res.writeHead(202).end(JSON.stringify(response));
        events.emit('accepted');
        return;
      }
      if (req.url.startsWith('/api/v1/tts/jobs?requestId=')) {
        const response = jobs.get(new URL(req.url, baseUrl).searchParams.get('requestId'));
        res.writeHead(response ? 200 : 404).end(JSON.stringify(response || { error: { code: 'job_not_found', retryable: false } }));
        return;
      }
      if (req.url === '/api/v1/tts/jobs/' + id) {
        const response = [...jobs.values()][0] || job();
        res.end(JSON.stringify(response)); return;
      }
      res.writeHead(404).end(JSON.stringify({ error: { code: 'unexpected_route', retryable: false } }));
    } catch (error) {
      res.writeHead(500).end(JSON.stringify({ error: { code: 'fixture_error', retryable: false } }));
      events.emit('fixtureError', error);
    }
  });
  const fixtureErrors = [];
  events.on('fixtureError', error => fixtureErrors.push(error));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  const client = new Client({ name: 'test', version: '1.0.0' });
  t.after(async () => {
    await client.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
    assert.deepEqual(fixtureErrors, []);
  });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [path.join(packageRoot, 'dist/index.js')],
    env: { FLOWSPEECH_API_KEY: noKey ? '' : 'fake-test-key', FLOWSPEECH_BASE_URL: baseUrl, FLOWSPEECH_OUTPUT_DIR: directory },
  }));
  return { client, directory, requests, jobs, events, baseUrl };
}
const call = (client, name, args = {}, options) => client.callTool({ name, arguments: args }, undefined, options);
const content = response => response.content[0].text;

test('six strict tool schemas retain the existing names and require generation UUIDs', async t => {
  const { client } = await setup(t);
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(tool => tool.name), [
    'flowspeech_tts', 'flowspeech_tts_multi', 'flowspeech_list_voices', 'flowspeech_quota', 'flowspeech_get_job', 'flowspeech_new_request_id',
  ]);
  for (const tool of tools) assert.equal(tool.inputSchema.additionalProperties, false);
  for (const name of ['flowspeech_tts', 'flowspeech_tts_multi']) {
    assert.deepEqual(tools.find(tool => tool.name === name).inputSchema.required, ['text', 'request_id']);
  }
});
test('fresh caller UUIDs are local and require no API key', async t => {
  const { client, requests } = await setup(t, { noKey: true });
  const first = await call(client, 'flowspeech_new_request_id');
  const second = await call(client, 'flowspeech_new_request_id');
  assert.ok(!first.isError && !second.isError);
  const a = JSON.parse(content(first)).request_id, b = JSON.parse(content(second)).request_id;
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
  assert.deepEqual(requests, []);
});
test('single stdio generation saves a valid private WAV and preserves recovery identity', async t => {
  const { client, directory, requests } = await setup(t);
  const generated = JSON.parse(content(await call(client, 'flowspeech_new_request_id'))).request_id;
  const response = await call(client, 'flowspeech_tts', { text: 'Hello', request_id: generated.toUpperCase() });
  assert.ok(!response.isError, content(response));
  assert.match(content(response), new RegExp('Request ID: ' + generated));
  const filename = path.join(directory, 'flowspeech-' + id + '.wav');
  assert.deepEqual(await readFile(filename), wav);
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  const created = requests.find(request => request.method === 'POST');
  assert.equal(created.key, generated);
  assert.deepEqual(JSON.parse(created.body), { input: { mode: 'single', text: 'Hello', voiceName: 'Kore' } });
  assert.ok(requests.filter(request => request.path === '/audio.wav').every(request => request.auth === undefined));
  const byRequest = await call(client, 'flowspeech_get_job', { request_id: generated.toUpperCase() });
  const byJob = await call(client, 'flowspeech_get_job', { job_id: id.toUpperCase() });
  assert.equal(JSON.parse(content(byRequest)).id, id);
  assert.equal(JSON.parse(content(byJob)).requestId, generated);
  assert.equal(requests.filter(request => request.method === 'POST').length, 1);
});
test('multi stdio generation maps labelled speaker turns', async t => {
  const { client, requests } = await setup(t);
  const response = await call(client, 'flowspeech_tts_multi', { text: 'Speaker1: Hello\nSpeaker2: Hi', request_id: requestId });
  assert.ok(!response.isError, content(response));
  assert.deepEqual(JSON.parse(requests.find(request => request.method === 'POST').body), { input: { mode: 'multi', segments: [
    { speaker: 'Speaker1', text: 'Hello', voiceName: 'Charon' }, { speaker: 'Speaker2', text: 'Hi', voiceName: 'Kore' },
  ] } });
});
test('all invalid generation argument types and unsupported fields fail before network', async t => {
  const { client, directory, requests } = await setup(t);
  const invalid = [
    { text: 'Hello' }, { text: 'Hello', request_id: null }, { text: 'Hello', request_id: 42 },
    { text: 42, request_id: requestId }, { text: ' ', request_id: requestId },
    { text: 'Hello', request_id: requestId, voice: null }, { text: 'Hello', request_id: requestId, voice: 42 },
    ...[42, null, [], {}, '', ' ', 'bad\0file.wav', directory + path.sep].map(output_path => ({ text: 'Hello', request_id: requestId, output_path })),
    ...['model', 'source', 'speed', 'format', 'originalText', 'speakers', 'voice_a'].map(key => ({ text: 'Hello', request_id: requestId, [key]: 'unsupported' })),
  ];
  for (const args of invalid) {
    const response = await call(client, 'flowspeech_tts', args);
    assert.equal(response.isError, true, JSON.stringify(args));
  }
  for (const args of [
    { text: 'Speaker1: Hi' }, { text: 'Speaker1: Hi', request_id: requestId, voice_a: null },
    { text: 'Speaker1: Hi', request_id: requestId, voice_b: [] },
    { text: 'Speaker1: Hi', request_id: requestId, output_path: 42 },
    { text: 'Speaker1: Hi', request_id: requestId, speed: 2 },
  ]) assert.equal((await call(client, 'flowspeech_tts_multi', args)).isError, true);
  assert.deepEqual(requests, []);
  assert.deepEqual(await readdir(directory), []);
});
test('existing file and non-directory parent fail before submission', async t => {
  const { client, directory, requests } = await setup(t);
  const existing = path.join(directory, 'existing.wav');
  await writeFile(existing, 'preserve');
  for (const output_path of [existing, path.join(existing, 'nested.wav')]) {
    assert.equal((await call(client, 'flowspeech_tts', { text: 'Hello', request_id: requestId, output_path })).isError, true);
  }
  assert.deepEqual(requests, []);
  assert.equal(await readFile(existing, 'utf8'), 'preserve');
});
test('atomic no-overwrite failure after submission retains both IDs', async t => {
  const { client, directory, requests } = await setup(t, { onCreate: async (_, dir) => {
    await writeFile(path.join(dir, 'race.wav'), 'preserve');
  } });
  const response = await call(client, 'flowspeech_tts', { text: 'Hello', request_id: requestId, output_path: path.join(directory, 'race.wav') });
  assert.equal(response.isError, true);
  assert.match(content(response), /without overwriting/);
  assert.match(content(response), new RegExp('jobId=' + id));
  assert.match(content(response), new RegExp('requestId=' + requestId));
  assert.equal(await readFile(path.join(directory, 'race.wav'), 'utf8'), 'preserve');
  assert.equal(requests.filter(request => request.method === 'POST').length, 1);
});
test('header-only WAV is not saved by stdio', async t => {
  const { client, directory, requests } = await setup(t, { audio: Buffer.from('RIFF\x04\0\0\0WAVE') });
  const response = await call(client, 'flowspeech_tts', { text: 'Hello', request_id: requestId });
  assert.equal(response.isError, true);
  assert.match(content(response), /PCM WAV/);
  assert.deepEqual(await readdir(directory), []);
  assert.equal(requests.filter(request => request.method === 'POST').length, 1);
});
test('read-only tools and UUID tool reject unknown arguments before network', async t => {
  const { client, requests } = await setup(t);
  for (const [name, args] of [
    ['flowspeech_new_request_id', { text: 'no' }], ['flowspeech_quota', { request_id: requestId }],
    ['flowspeech_list_voices', { gender: null }], ['flowspeech_list_voices', { gender: 'other' }],
    ['flowspeech_list_voices', { unknown: true }], ['flowspeech_get_job', {}],
    ['flowspeech_get_job', { job_id: id, request_id: requestId }], ['flowspeech_get_job', { job_id: 42 }],
    ['flowspeech_get_job', { request_id: null }], ['flowspeech_get_job', { job_id: id, extra: 1 }],
  ]) assert.equal((await call(client, name, args)).isError, true, name);
  assert.deepEqual(requests, []);
});
test('quota and voices remain available over stdio', async t => {
  const { client } = await setup(t);
  assert.equal(JSON.parse(content(await call(client, 'flowspeech_quota'))).quota.available, 20);
  assert.equal(JSON.parse(content(await call(client, 'flowspeech_list_voices', { gender: 'female' })))[0].name, 'Kore');
});
for (const cancellation of ['signal', 'caller timeout']) test(cancellation + ' preserves caller-known recovery without submitting again', { timeout: 5000 }, async t => {
  const { client, directory, requests, events } = await setup(t, { queued: true });
  const knownId = JSON.parse(content(await call(client, 'flowspeech_new_request_id'))).request_id;
  const accepted = once(events, 'accepted');
  const controller = new AbortController();
  const pending = call(client, 'flowspeech_tts', { text: 'Hello', request_id: knownId }, {
    signal: controller.signal, timeout: cancellation === 'caller timeout' ? 300 : 2000,
  }).then(value => ({ value }), error => ({ error }));
  await accepted;
  if (cancellation === 'signal') controller.abort();
  assert.ok((await pending).error);
  await delay(20);
  const recovered = await call(client, 'flowspeech_get_job', { request_id: knownId });
  assert.ok(!recovered.isError, content(recovered));
  assert.equal(JSON.parse(content(recovered)).requestId, knownId);
  assert.equal(JSON.parse(content(recovered)).status, 'queued');
  assert.equal(requests.filter(request => request.method === 'POST').length, 1);
  assert.ok(requests.every(request => !request.path.endsWith('/cancel')));
  assert.deepEqual(await readdir(directory), []);
});
