#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { access, lstat, mkdir, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FlowSpeechClient, dialogueInput, validateId } from './client.js';

const VERSION = '0.2.0';
function expandHome(value: string): string {
  return value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : path.resolve(value);
}
function stringArg(args: Record<string, unknown>, key: string, fallback?: string): string {
  const value = args[key] === undefined ? fallback : args[key];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a nonempty string`);
  return value;
}
function allowedFields(args: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error('Unsupported tool argument');
}
function outputPath(value: string): string {
  if (/[\x00-\x1f\x7f]/.test(value) || value.endsWith(path.sep)) throw new Error('output_path must name a file without control characters');
  const file = expandHome(value);
  if (path.parse(file).root === file) throw new Error('output_path must name a file');
  return file;
}
async function checkDirectory(directory: string): Promise<void> {
  let current = directory;
  for (;;) {
    try {
      const info = await stat(current);
      if (!info.isDirectory()) throw new Error('Output parent must be a directory');
      await access(current, constants.W_OK);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Output parent is not a writable directory');
      const parent = path.dirname(current);
      if (parent === current) throw new Error('Output parent is unavailable');
      current = parent;
    }
  }
}
async function checkFile(file: string): Promise<void> {
  let exists = true;
  try { await lstat(file); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot inspect output_path');
    exists = false;
  }
  if (exists) throw new Error('Cannot save audio without overwriting an existing file');
  await checkDirectory(path.dirname(file));
}
function client(): FlowSpeechClient {
  return new FlowSpeechClient({
    apiKey: process.env.FLOWSPEECH_API_KEY || '', baseUrl: process.env.FLOWSPEECH_BASE_URL,
    timeoutMs: process.env.FLOWSPEECH_TIMEOUT_MS ? Number(process.env.FLOWSPEECH_TIMEOUT_MS) : undefined,
  });
}
const outputProperties = {
  output_path: { type: 'string', description: 'Optional output WAV file path. An existing file is not overwritten.' },
  request_id: { type: 'string', format: 'uuid', description: 'Required caller-known UUID. Get one with flowspeech_new_request_id; reuse only for unchanged text and voices.' },
};
const tools: Tool[] = [
  { name: 'flowspeech_tts', description: 'Generate a WAV recording with FlowSpeech. Requires a caller-known request UUID, an API key and paid API access; consumes account credits.', inputSchema: {
    type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, voice: { type: 'string', default: 'Kore' }, ...outputProperties }, required: ['text', 'request_id'],
  } },
  { name: 'flowspeech_tts_multi', description: 'Generate a two-speaker WAV recording with a caller-known request UUID. Each turn starts with Speaker1: or Speaker2:. Consumes account credits.', inputSchema: {
    type: 'object', additionalProperties: false, properties: { text: { type: 'string' }, voice_a: { type: 'string', default: 'Charon' }, voice_b: { type: 'string', default: 'Kore' }, ...outputProperties }, required: ['text', 'request_id'],
  } },
  { name: 'flowspeech_list_voices', description: 'Retrieve the current voice catalog from FlowSpeech.', inputSchema: {
    type: 'object', additionalProperties: false, properties: { gender: { type: 'string', enum: ['male', 'female', 'all'], default: 'all' } },
  } },
  { name: 'flowspeech_quota', description: 'Read available, remaining and reserved API credits.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
  { name: 'flowspeech_get_job', description: 'Read an existing job by job UUID or caller-known request UUID without creating a recording. Supply exactly one ID.', inputSchema: {
    type: 'object', additionalProperties: false, properties: { job_id: { type: 'string', format: 'uuid' }, request_id: { type: 'string', format: 'uuid' } },
    oneOf: [{ required: ['job_id'] }, { required: ['request_id'] }],
  } },
  { name: 'flowspeech_new_request_id', description: 'Generate a fresh request UUID locally, without network access or an API key. Keep it before starting one recording.', inputSchema: {
    type: 'object', additionalProperties: false, properties: {},
  } },
];
const server = new Server({ name: 'flowspeech', version: VERSION }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args = {} } = request.params;
  try {
    let text: string;
    if (name === 'flowspeech_new_request_id') {
      allowedFields(args, []);
      text = JSON.stringify({ request_id: randomUUID() });
    } else if (name === 'flowspeech_list_voices') {
      allowedFields(args, ['gender']);
      const gender = stringArg(args, 'gender', 'all');
      if (!['male', 'female', 'all'].includes(gender)) throw new Error('Invalid gender filter');
      text = JSON.stringify((await client().voices(extra.signal)).filter(v => gender === 'all' || v.gender === gender), null, 2);
    } else if (name === 'flowspeech_quota') {
      allowedFields(args, []);
      text = JSON.stringify(await client().quota(extra.signal), null, 2);
    } else if (name === 'flowspeech_get_job') {
      allowedFields(args, ['job_id', 'request_id']);
      if (Number(args.job_id !== undefined) + Number(args.request_id !== undefined) !== 1) throw new Error('Supply exactly one of job_id or request_id');
      const byJob = args.job_id !== undefined;
      const id = validateId(stringArg(args, byJob ? 'job_id' : 'request_id'));
      const api = client();
      text = JSON.stringify(await (byJob ? api.getJob(id, extra.signal) : api.findJob(id, extra.signal)), null, 2);
    } else if (name === 'flowspeech_tts' || name === 'flowspeech_tts_multi') {
      allowedFields(args, name === 'flowspeech_tts'
        ? ['text', 'voice', 'output_path', 'request_id']
        : ['text', 'voice_a', 'voice_b', 'output_path', 'request_id']);
      const requestId = validateId(stringArg(args, 'request_id'));
      const script = stringArg(args, 'text');
      const input = name === 'flowspeech_tts'
        ? { mode: 'single' as const, text: script, voiceName: stringArg(args, 'voice', 'Kore') }
        : dialogueInput(script, stringArg(args, 'voice_a', 'Charon'), stringArg(args, 'voice_b', 'Kore'));
      const customFile = args.output_path === undefined ? undefined : outputPath(stringArg(args, 'output_path'));
      const directoryValue = process.env.FLOWSPEECH_OUTPUT_DIR || '~/.flowspeech-mcp/audio';
      if (/[\x00-\x1f\x7f]/.test(directoryValue)) throw new Error('Invalid output directory');
      const outputDirectory = expandHome(directoryValue);
      if (customFile) await checkFile(customFile);
      else await checkDirectory(outputDirectory);
      const result = await client().generate(input, requestId, extra.signal);
      const file = customFile ?? path.join(outputDirectory, `flowspeech-${result.job.id}.wav`);
      try {
        extra.signal.throwIfAborted();
        await mkdir(path.dirname(file), { recursive: true });
        extra.signal.throwIfAborted();
        await writeFile(file, result.audio, { flag: 'wx', mode: 0o600, signal: extra.signal });
      } catch {
        throw new Error(`Cannot save audio without overwriting an existing file, or operation stopped. Retrieve jobId=${result.job.id}; requestId=${result.requestId}. Do not create another recording.`);
      }
      text = `Audio saved to: ${file}\nFormat: audio/wav\nJob ID: ${result.job.id}\nRequest ID: ${result.requestId}\nUsage: ${JSON.stringify(result.job.usage)}`;
    } else throw new Error('Unknown tool');
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'FlowSpeech operation failed' }] };
  }
});
await server.connect(new StdioServerTransport());
