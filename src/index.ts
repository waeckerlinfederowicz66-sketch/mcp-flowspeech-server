#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { access, copyFile, link, lstat, mkdir, mkdtemp, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { FlowSpeechClient, dialogueInput, validateId, validateSpeechInput, type SpeechInput } from './client.js';

const VERSION = '0.3.0';
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
async function checkFile(file: string, allowExisting: boolean): Promise<boolean> {
  const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw new Error('Cannot inspect output_path');
  });
  if (info && !allowExisting) throw new Error('Cannot save audio without overwriting an existing file');
  if (info && !info.isFile()) throw new Error('output_path must refer to a regular file');
  await checkDirectory(path.dirname(file));
  return info !== undefined;
}
async function saveAudio(file: string, audio: Uint8Array, overwrite: boolean, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const parent = path.dirname(file);
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, '.flowspeech-'));
  const temporary = path.join(directory, 'audio.wav');
  try {
    await writeFile(temporary, audio, { flag: 'wx', mode: 0o600, signal });
    if (overwrite) await checkFile(file, true);
    signal.throwIfAborted();
    if (overwrite) await rename(temporary, file);
    else {
      try {
        await link(temporary, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error;
        // Some writable filesystems cannot link files. The copy still fails if the destination exists.
        signal.throwIfAborted();
        await copyFile(temporary, file, constants.COPYFILE_EXCL);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
async function matchesAudio(file: string, audio: Uint8Array, signal: AbortSignal): Promise<boolean> {
  try {
    if (!(await lstat(file)).isFile()) return false;
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size !== audio.byteLength) return false;
      const expected = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
      const bytes = Buffer.allocUnsafe(Math.min(expected.length, 64 * 1024));
      for (let offset = 0; offset < expected.length;) {
        signal.throwIfAborted();
        const { bytesRead } = await handle.read(bytes, 0, Math.min(bytes.length, expected.length - offset), offset);
        if (!bytesRead || !bytes.subarray(0, bytesRead).equals(expected.subarray(offset, offset + bytesRead))) return false;
        offset += bytesRead;
      }
      signal.throwIfAborted();
      return (await handle.stat()).size === expected.length;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}
function multiInput(args: Record<string, unknown>): SpeechInput {
  if (args.segments !== undefined) {
    if (['text', 'speakers', 'voice_a', 'voice_b'].some(key => args[key] !== undefined)) {
      throw new Error('Supply segments by itself or labelled text with voice assignments');
    }
    return validateSpeechInput({ mode: 'multi', segments: args.segments });
  }
  if (args.speakers !== undefined && (args.voice_a !== undefined || args.voice_b !== undefined)) {
    throw new Error('Use speakers or voice_a and voice_b for a labelled script');
  }
  return dialogueInput(stringArg(args, 'text'), stringArg(args, 'voice_a', 'Charon'), stringArg(args, 'voice_b', 'Kore'), args.speakers);
}
function client(): FlowSpeechClient {
  return new FlowSpeechClient({
    apiKey: process.env.FLOWSPEECH_API_KEY || '', baseUrl: process.env.FLOWSPEECH_BASE_URL,
    timeoutMs: process.env.FLOWSPEECH_TIMEOUT_MS ? Number(process.env.FLOWSPEECH_TIMEOUT_MS) : undefined,
  });
}
const outputProperties = {
  output_path: { type: 'string', description: 'Optional local output WAV path.' },
  overwrite: { type: 'boolean', default: false, description: 'Set true to replace an existing regular file after audio is ready.' },
  request_id: { type: 'string', format: 'uuid', description: 'Optional UUID. Omit to generate in one call and reuse the same job when retrying unchanged speech with the same API key. For a deliberately new recording of the same speech, pass a fresh UUID from flowspeech_new_request_id.' },
};
const speechText = { type: 'string', description: 'Use bracketed emotion cues before speech and pause tags between phrases, e.g. [excited] Welcome! [pause:1.0s] Let’s begin.' };
const jobIdProperty = { type: 'string', format: 'uuid' };
const tools: Tool[] = [
  { name: 'flowspeech_tts', description: 'Generate a single-voice WAV from text in one call. Use [excited] or [calmly] for emotion and [pause:1.0s] for a one-second pause. Requires a FlowSpeech API key and consumes paid API credits.', inputSchema: {
    type: 'object', additionalProperties: false, properties: { text: speechText, voice: { type: 'string', default: 'Kore' }, ...outputProperties }, required: ['text'],
  } },
  { name: 'flowspeech_tts_multi', description: 'Generate a multi-speaker WAV for a podcast or dialogue. Pass ordered segments, labelled text with a speakers map, or Speaker1:/Speaker2: text. Add cues like [excited] and [pause:1.0s] inside each turn. Requires a FlowSpeech API key and consumes paid API credits.', inputSchema: {
    type: 'object', additionalProperties: false, properties: {
      text: { ...speechText, description: `Start each turn with a label, e.g. Host: [excited] Welcome! [pause:1.0s] Let's begin. Supply speakers for custom labels, or use Speaker1:/Speaker2:.` },
      speakers: { type: 'object', minProperties: 1, maxProperties: 1000, additionalProperties: { type: 'string', minLength: 1, maxLength: 100 }, description: 'Map script labels to FlowSpeech voice names, e.g. {"Host":"Charon","Guest":"Kore"}.' },
      segments: { type: 'array', minItems: 1, maxItems: 1000, description: 'Ordered speaker turns. Use one consistent voice per speaker.', items: {
        type: 'object', additionalProperties: false, required: ['speaker', 'text', 'voiceName'],
        properties: { speaker: { type: 'string', minLength: 1, maxLength: 100 }, text: speechText, voiceName: { type: 'string', minLength: 1, maxLength: 100 } },
      } },
      voice_a: { type: 'string', description: 'Voice for the legacy Speaker1 label. Defaults to Charon.' },
      voice_b: { type: 'string', description: 'Voice for the legacy Speaker2 label. Defaults to Kore.' },
      ...outputProperties,
    }, oneOf: [
      { required: ['segments'], not: { anyOf: ['text', 'speakers', 'voice_a', 'voice_b'].map(key => ({ required: [key] })) } },
      { required: ['text', 'speakers'], not: { anyOf: ['segments', 'voice_a', 'voice_b'].map(key => ({ required: [key] })) } },
      { required: ['text'], not: { anyOf: ['segments', 'speakers'].map(key => ({ required: [key] })) } },
    ],
  } },
  { name: 'flowspeech_list_voices', description: 'Retrieve the current voice catalog from FlowSpeech.', inputSchema: {
    type: 'object', additionalProperties: false, properties: { gender: { type: 'string', enum: ['male', 'female', 'all'], default: 'all' } },
  } },
  { name: 'flowspeech_quota', description: 'Read available, remaining and reserved API credits.', inputSchema: { type: 'object', additionalProperties: false, properties: {} } },
  { name: 'flowspeech_get_job', description: 'Read an existing job by job UUID or caller-known request UUID without creating a recording. Supply exactly one ID.', inputSchema: {
    type: 'object', additionalProperties: false, properties: { job_id: jobIdProperty, request_id: { type: 'string', format: 'uuid' } },
    oneOf: [{ required: ['job_id'] }, { required: ['request_id'] }],
  } },
  { name: 'flowspeech_cancel_job', description: 'Explicitly cancel an existing FlowSpeech job by job UUID. A completed job cannot be cancelled or refunded.', inputSchema: {
    type: 'object', additionalProperties: false, properties: { job_id: jobIdProperty }, required: ['job_id'],
  } },
  { name: 'flowspeech_new_request_id', description: 'Generate a fresh request UUID locally, without network access or an API key. Keep it before starting one recording.', inputSchema: {
    type: 'object', additionalProperties: false, properties: {},
  } },
];
const server = new Server({ name: 'flowspeech', version: VERSION }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
  const { name, arguments: args = {} } = request.params;
  let preflightRequestId: string | undefined;
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
    } else if (name === 'flowspeech_cancel_job') {
      allowedFields(args, ['job_id']);
      const jobId = validateId(stringArg(args, 'job_id'));
      text = JSON.stringify(await client().cancelJob(jobId, extra.signal), null, 2);
    } else if (name === 'flowspeech_tts' || name === 'flowspeech_tts_multi') {
      const automatic = args.request_id === undefined;
      let requestId = automatic ? undefined : validateId(args.request_id);
      preflightRequestId = requestId;
      allowedFields(args, name === 'flowspeech_tts'
        ? ['text', 'voice', 'output_path', 'request_id', 'overwrite']
        : ['text', 'voice_a', 'voice_b', 'segments', 'speakers', 'output_path', 'request_id', 'overwrite']);
      const input = name === 'flowspeech_tts'
        ? { mode: 'single' as const, text: stringArg(args, 'text'), voiceName: stringArg(args, 'voice', 'Kore') }
        : multiInput(args);
      if (args.overwrite !== undefined && typeof args.overwrite !== 'boolean') throw new Error('overwrite must be a boolean');
      const overwrite = args.overwrite === true;
      const customFile = args.output_path === undefined ? undefined : outputPath(stringArg(args, 'output_path'));
      const directoryValue = process.env.FLOWSPEECH_OUTPUT_DIR || '~/.flowspeech-mcp/audio';
      if (/[\x00-\x1f\x7f]/.test(directoryValue)) throw new Error('Invalid output directory');
      const outputDirectory = expandHome(directoryValue);
      const api = client();
      requestId ??= api.requestIdFor(input);
      preflightRequestId = requestId;
      const existing = customFile ? await checkFile(customFile, overwrite || automatic) : false;
      if (!customFile) await checkDirectory(outputDirectory);
      preflightRequestId = undefined; // The client includes recovery IDs on generation errors.
      const result = existing && !overwrite
        ? await api.resumeGeneration(requestId, extra.signal)
        : await api.generate(input, requestId, extra.signal);
      const file = customFile ?? path.join(outputDirectory, `flowspeech-${result.job.id}.wav`);
      try {
        await saveAudio(file, result.audio, overwrite, extra.signal);
      } catch (error) {
        const identical = automatic && !overwrite && (error as NodeJS.ErrnoException).code === 'EEXIST'
          && await matchesAudio(file, result.audio, extra.signal);
        if (!identical) {
          const reason = overwrite ? 'Cannot replace output file, or operation stopped' : 'Cannot save audio without overwriting an existing file, or operation stopped';
          throw new Error(`${reason}. Retrieve jobId=${result.job.id}; requestId=${result.requestId}. Reuse the existing recording.`);
        }
      }
      text = `Audio saved to: ${file}\nFormat: audio/wav\nJob ID: ${result.job.id}\nRequest ID: ${result.requestId}\nUsage: ${JSON.stringify(result.job.usage)}`;
    } else throw new Error('Unknown tool');
    return { content: [{ type: 'text', text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'FlowSpeech operation failed';
    return { isError: true, content: [{ type: 'text', text: preflightRequestId ? `${message}; requestId=${preflightRequestId}` : message }] };
  }
});
await server.connect(new StdioServerTransport());
