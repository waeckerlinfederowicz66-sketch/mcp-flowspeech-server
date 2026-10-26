import test from 'node:test';
import assert from 'node:assert/strict';
import { FlowSpeechClient, dialogueInput } from '../dist/client.js';

const id = 'b698824b-de05-486d-8833-05d5c4522a39';
const requestId = '51382b81-9d36-49a5-994e-9b67686c6bd1';
const input = { mode: 'single', text: 'Hello', voiceName: 'Kore' };
const wav = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ');
const done = { id, status: 'success', result: { url: 'https://audio.example.test/result.wav', mimeType: 'audio/wav' } };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function harness(steps, options = {}) {
  const calls = [], sleeps = [];
  let now = 0;
  const client = new FlowSpeechClient({ apiKey: 'test-key', now: () => now,
    sleep: async ms => { sleeps.push(ms); now += ms; },
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      const next = steps.shift();
      if (next instanceof Error) throw next;
      assert.ok(next, 'unexpected request');
      return next;
    }, ...options });
  return { client, calls, sleeps };
}

test('single create, queued polling, Retry-After and credential-free WAV download', async () => {
  const h = harness([json({ id, status: 'queued' }, 202, { 'Retry-After': '8' }), json(done), new Response(wav)]);
  const result = await h.client.generate(input, requestId);
  assert.deepEqual(result.audio, wav);
  assert.equal(result.requestId, requestId);
  assert.deepEqual(h.sleeps, [8000]);
  assert.equal(h.calls[0].url, 'https://flowspeech.io/api/v1/tts/jobs');
  assert.deepEqual(JSON.parse(h.calls[0].init.body), { input });
  assert.equal(h.calls[0].init.headers.Authorization, 'Bearer test-key');
  assert.equal(h.calls[0].init.headers['Idempotency-Key'], requestId);
  assert.equal(h.calls[1].url, `https://flowspeech.io/api/v1/tts/jobs/${id}`);
  assert.equal(h.calls[2].init.headers, undefined);
  assert.ok(h.calls.every(c => c.init.redirect === 'error' && c.init.credentials === 'omit'));
});
test('network retry preserves body and UUID', async () => {
  const h = harness([new Error('network'), json(done), new Response(wav)]);
  await h.client.generate(input, requestId);
  assert.equal(h.calls[0].init.body, h.calls[1].init.body);
  assert.equal(h.calls[0].init.headers['Idempotency-Key'], h.calls[1].init.headers['Idempotency-Key']);
  assert.deepEqual(h.sleeps, [1000]);
});
test('429 respects Retry-After and reuses request ID', async () => {
  const h = harness([json({ error: { code: 'rate_limited', retryable: true } }, 429, { 'Retry-After': '9' }), json(done), new Response(wav)]);
  await h.client.generate(input, requestId);
  assert.deepEqual(h.sleeps, [9000]);
  assert.equal(h.calls[0].init.body, h.calls[1].init.body);
});
test('HTTP-date Retry-After never polls earlier than five seconds', async () => {
  const h = harness([json({ id, status: 'queued' }, 202, { 'Retry-After': new Date(Date.now() + 15000).toUTCString() }), json(done), new Response(wav)]);
  await h.client.generate(input, requestId);
  assert.ok(h.sleeps[0] >= 13000);
});
test('multi input preserves turn order and continuation lines', async () => {
  const multi = dialogueInput('Speaker1: Hello\nMore text\nSpeaker2: Hi\nSpeaker1: Bye', 'Charon', 'Kore');
  assert.deepEqual(multi.segments.map(s => s.voiceName), ['Charon', 'Kore', 'Charon']);
  assert.equal(multi.segments[0].text, 'Hello\nMore text');
  const h = harness([json(done), new Response(wav)]);
  await h.client.generate(multi, requestId);
  assert.deepEqual(JSON.parse(h.calls[0].init.body), { input: multi });
  assert.throws(() => dialogueInput('unlabelled', 'Kore', 'Charon'));
  assert.throws(() => dialogueInput('Speaker1:', 'Kore', 'Charon'));
});
for (const status of ['failed', 'cancelled']) test(`${status} is not successful even with HTTP 200`, async () => {
  const h = harness([json({ id, status })]);
  await assert.rejects(h.client.generate(input, requestId), new RegExp(`Generation ${status}.*jobId=${id}`));
  assert.equal(h.calls.length, 1);
});
for (const [name, body] of [
  ['deleted', { ...done, result: null, resultDeleted: true }],
  ['missing', { ...done, result: null }],
  ['unknown status', { id, status: 'complete' }],
  ['missing ID', { status: 'success' }],
]) test(`rejects ${name} result`, async () => {
  const h = harness([json(body)]);
  await assert.rejects(h.client.generate(input, requestId));
  assert.equal(h.calls.length, 1);
});
test('deadline stops before a required wait and retains recovery IDs', async () => {
  const h = harness([json({ id, status: 'queued' }, 202)], { timeoutMs: 4000 });
  await assert.rejects(h.client.generate(input, requestId), new RegExp(`timeout.*requestId=${requestId}.*jobId=${id}`));
  assert.equal(h.calls.length, 1);
});
test('nonretryable errors never resubmit, hide raw server messages and secrets', async () => {
  const h = harness([json({ error: { code: 'subscription_required', retryable: false, message: 'test-key private script' } }, 503)]);
  await assert.rejects(h.client.generate(input, requestId), error => {
    assert.match(error.message, /HTTP 503: subscription_required/);
    assert.ok(!error.message.includes('test-key') && !error.message.includes('private script'));
    return true;
  });
  assert.equal(h.calls.length, 1);
});
test('download failures do not create another job', async () => {
  const h = harness([json(done), new Response('unavailable', { status: 503 })]);
  await assert.rejects(h.client.generate(input, requestId), /retry this download, not generation/);
  assert.equal(h.calls.length, 2);
});
test('bounded download rejects oversized and non-WAV payloads', async () => {
  const h = harness([json(done), new Response(wav)], { maxAudioBytes: 8 });
  await assert.rejects(h.client.generate(input, requestId), /size limit/);
  const bad = harness([json(done), new Response('not an audio file')]);
  await assert.rejects(bad.client.generate(input, requestId), /not a WAV/);
});
test('rejects insecure or credential-bearing result URLs before sending a request', async () => {
  for (const url of ['http://example.com/a.wav', 'https://user:password@example.com/a.wav', 'file:///tmp/audio.wav']) {
    const h = harness([json({ ...done, result: { ...done.result, url } })]);
    await assert.rejects(h.client.generate(input, requestId));
    assert.equal(h.calls.length, 1);
  }
});
test('quota, voices and job lookup use authenticated v1 reads', async () => {
  const h = harness([json({ quota: { available: 15 } }), json({ voices: [{ name: 'Kore', gender: 'female', description: 'Firm' }] }), json(done)]);
  assert.equal((await h.client.quota()).quota.available, 15);
  assert.equal((await h.client.voices())[0].name, 'Kore');
  assert.equal((await h.client.getJob(id)).id, id);
  assert.deepEqual(h.calls.map(c => new URL(c.url).pathname), ['/api/v1/quota', '/api/v1/voices', `/api/v1/tts/jobs/${id}`]);
  assert.ok(h.calls.every(c => c.init.method === 'GET' && c.init.headers.Authorization === 'Bearer test-key'));
});
test('invalid configuration, UUID and input fail without requests', async () => {
  assert.throws(() => new FlowSpeechClient({ apiKey: '' }));
  assert.throws(() => new FlowSpeechClient({ apiKey: 'key', baseUrl: 'https://user:pass@example.com' }));
  const h = harness([]);
  await assert.rejects(h.client.getJob('../quota'));
  await assert.rejects(h.client.generate(input, 'bad-id'));
  await assert.rejects(h.client.generate({ ...input, text: ' ' }, requestId));
  assert.equal(h.calls.length, 0);
});
test('aborted operations never start generation', async () => {
  const h = harness([]);
  await assert.rejects(h.client.generate(input, requestId, AbortSignal.abort()), /stopped/);
  assert.equal(h.calls.length, 0);
});
test('retry exhaustion is bounded', async () => {
  const h = harness(Array.from({ length: 5 }, () => new Error('network')));
  await assert.rejects(h.client.generate(input, requestId), /bounded retries/);
  assert.equal(h.calls.length, 5);
});
test('invalid JSON and changed job IDs are rejected', async () => {
  const h = harness([new Response('not JSON')]);
  await assert.rejects(h.client.generate(input, requestId), /invalid JSON/);
  const changed = harness([json({ id, status: 'queued' }, 202), json({ ...done, id: requestId })]);
  await assert.rejects(changed.client.generate(input, requestId), /changed the job ID/);
});
