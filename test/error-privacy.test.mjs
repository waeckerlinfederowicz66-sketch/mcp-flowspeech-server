import test from 'node:test';
import assert from 'node:assert/strict';
import { FlowSpeechClient, id, requestId, job, json } from './fixtures.mjs';
const key = 'review_secret_canary';
for (const method of ['quota', 'voices', 'getJob', 'findJob']) {
  test(method + ' never reflects an API key in an HTTP error code', async () => {
    let calls = 0;
    const client = new FlowSpeechClient({ apiKey: key, fetch: async () => {
      calls++;
      return json({ error: { code: key, message: key, retryable: false } }, 403);
    } });
    await assert.rejects(client[method](method === 'findJob' ? requestId : method === 'getJob' ? id : undefined), error =>
      error.message === 'FlowSpeech HTTP 403: api_error' && !String(error).includes(key));
    assert.equal(calls, 1);
  });
}
test('returned job errors include only a safe code and preserve recovery IDs', async () => {
  const privateUrl = 'https://storage.example.test/private.wav?signature=review-only';
  const client = new FlowSpeechClient({ apiKey: key, fetch: async () =>
    json(job('failed', { error: { code: key, message: privateUrl }, traceId: privateUrl })) });
  const value = await client.getJob(id);
  assert.deepEqual(value.error, { code: 'api_error' });
  assert.equal(value.id, id);
  assert.equal(value.requestId, requestId);
  assert.deepEqual(value.progress, job('failed').progress);
  assert.equal(value.createdAt, job('failed').createdAt);
  assert.ok(!JSON.stringify(value).includes(key) && !JSON.stringify(value).includes(privateUrl));
});
