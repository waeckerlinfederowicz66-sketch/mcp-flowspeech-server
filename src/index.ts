#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FlowSpeechClient, dialogueInput } from './client.js';

const VERSION = '0.2.0';
const outputDirectory = expandHome(process.env.FLOWSPEECH_OUTPUT_DIR || '~/.flowspeech-mcp/audio');
function expandHome(value: string): string {
  return value === '~' ? os.homedir() : value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : path.resolve(value);
}
function stringArg(args: Record<string, unknown>, key: string, fallback?: string): string {
  const value = args[key] ?? fallback;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a nonempty string`);
  return value;
}
function client(): FlowSpeechClient {
  return new FlowSpeechClient({
    apiKey: process.env.FLOWSPEECH_API_KEY || '', baseUrl: process.env.FLOWSPEECH_BASE_URL,
    timeoutMs: process.env.FLOWSPEECH_TIMEOUT_MS ? Number(process.env.FLOWSPEECH_TIMEOUT_MS) : undefined,
  });
}
const outputProperties = {
  output_path: { type: 'string', description: 'Optional output WAV file path. An existing file is not overwritten.' },
  request_id: { type: 'string', description: 'Optional UUID for retrying the same text and voice without creating duplicate work.' },
};
const tools: Tool[] = [
  { name: 'flowspeech_tts', description: 'Generate a WAV recording with FlowSpeech. Requires an API key and paid API access; consumes account credits.', inputSchema: {
    type: 'object', properties: { text: { type: 'string' }, voice: { type: 'string', default: 'Kore' }, ...outputProperties }, required: ['text'],
  } },
  { name: 'flowspeech_tts_multi', description: 'Generate a two-speaker WAV recording. Each turn starts with Speaker1: or Speaker2:. Consumes account credits.', inputSchema: {
    type: 'object', properties: { text: { type: 'string' }, voice_a: { type: 'string', default: 'Charon' }, voice_b: { type: 'string', default: 'Kore' }, ...outputProperties }, required: ['text'],
  } },
  { name: 'flowspeech_list_voices', description: 'Retrieve the current voice catalog from FlowSpeech.', inputSchema: {
    type: 'object', properties: { gender: { type: 'string', enum: ['male', 'female', 'all'], default: 'all' } },
  } },
  { name: 'flowspeech_quota', description: 'Read available, remaining and reserved API credits.', inputSchema: { type: 'object', properties: {} } },
  { name: 'flowspeech_get_job', description: 'Read an existing job by UUID without creating a new recording.', inputSchema: {
    type: 'object', properties: { job_id: { type: 'string' } }, required: ['job_id'],
  } },
];
const server = new Server({ name: 'flowspeech', version: VERSION }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args = {} } = request.params;
  try {
    const api = client();
    let text: string;
    if (name === 'flowspeech_list_voices') {
      const gender = stringArg(args, 'gender', 'all');
      if (!['male', 'female', 'all'].includes(gender)) throw new Error('Invalid gender filter');
      text = JSON.stringify((await api.voices(extra.signal)).filter(v => gender === 'all' || v.gender === gender), null, 2);
    } else if (name === 'flowspeech_quota') {
      text = JSON.stringify(await api.quota(extra.signal), null, 2);
    } else if (name === 'flowspeech_get_job') {
      text = JSON.stringify(await api.getJob(stringArg(args, 'job_id'), extra.signal), null, 2);
    } else if (name === 'flowspeech_tts' || name === 'flowspeech_tts_multi') {
      const script = stringArg(args, 'text');
      const input = name === 'flowspeech_tts'
        ? { mode: 'single' as const, text: script, voiceName: stringArg(args, 'voice', 'Kore') }
        : dialogueInput(script, stringArg(args, 'voice_a', 'Charon'), stringArg(args, 'voice_b', 'Kore'));
      const requestId = args.request_id === undefined ? undefined : stringArg(args, 'request_id');
      const result = await api.generate(input, requestId, extra.signal);
      const file = args.output_path === undefined
        ? path.join(outputDirectory, `flowspeech-${result.job.id}.wav`)
        : expandHome(stringArg(args, 'output_path'));
      try {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, result.audio, { flag: 'wx', mode: 0o600 });
      } catch {
        throw new Error(`Cannot save audio without overwriting an existing file. Retrieve jobId=${result.job.id}; requestId=${result.requestId}. Do not create another recording.`);
      }
      text = `Audio saved to: ${file}\nFormat: audio/wav\nJob ID: ${result.job.id}\nRequest ID: ${result.requestId}\nUsage: ${JSON.stringify(result.job.usage ?? {})}`;
    } else throw new Error(`Unknown tool: ${name}`);
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : 'FlowSpeech operation failed' }] };
  }
});
await server.connect(new StdioServerTransport());
