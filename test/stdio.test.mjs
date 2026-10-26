import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('built stdio server submits v1, saves WAV and refuses overwrites', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'flowspeech-mcp-test-'));
  const id = 'b698824b-de05-486d-8833-05d5c4522a39';
  const requestId = '51382b81-9d36-49a5-994e-9b67686c6bd1';
  const wav = Buffer.from('RIFF\x24\0\0\0WAVEfmt ');
  const requests = [];
  const server = createServer(async (req, res) => {
    requests.push({ path: req.url, auth: req.headers.authorization });
    if (req.url === '/audio.wav') { res.end(wav); return; }
    assert.equal(req.headers.authorization, 'Bearer fake-test-key');
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/v1/voices') { res.end(JSON.stringify({ voices: [{ name: 'Kore', gender: 'female', description: 'Firm' }] })); return; }
    if (req.url !== '/api/v1/tts/jobs') { res.writeHead(404).end('{}'); return; }
    assert.equal(req.headers['idempotency-key'], requestId);
    let body = ''; for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), { input: { mode: 'single', text: 'Hello', voiceName: 'Kore' } });
    res.writeHead(202).end(JSON.stringify({ id, status: 'success', result: { url: `http://127.0.0.1:${server.address().port}/audio.wav`, mimeType: 'audio/wav' } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const client = new Client({ name: 'test', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], env: {
      ...process.env, FLOWSPEECH_API_KEY: 'fake-test-key', FLOWSPEECH_BASE_URL: `http://127.0.0.1:${server.address().port}`, FLOWSPEECH_OUTPUT_DIR: directory,
    } }));
    assert.equal((await client.listTools()).tools.length, 5);
    const voices = await client.callTool({ name: 'flowspeech_list_voices', arguments: { gender: 'female' } });
    assert.match(voices.content[0].text, /Kore/);
    const args = { name: 'flowspeech_tts', arguments: { text: 'Hello', request_id: requestId } };
    const result = await client.callTool(args);
    assert.ok(!result.isError, JSON.stringify(result));
    assert.deepEqual(await readFile(path.join(directory, `flowspeech-${id}.wav`)), wav);
    const repeat = await client.callTool(args);
    assert.equal(repeat.isError, true);
    assert.match(repeat.content[0].text, /without overwriting/);
    assert.ok(requests.filter(r => r.path === '/audio.wav').every(r => r.auth === undefined));
    assert.ok(requests.every(r => !r.path.includes('/api/ai/')));
  } finally {
    await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
