import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export type SpeechInput =
  | { mode: 'single'; text: string; voiceName: string }
  | { mode: 'multi'; segments: { speaker: string; text: string; voiceName: string }[] };
export interface Job {
  id: string;
  requestId?: string;
  status: string;
  result?: { url: string; mimeType: string } | null;
  resultDeleted?: boolean;
  usage?: unknown;
  error?: { code?: string };
}
export interface Voice { name: string; description: string; gender: string }
interface Context { deadline: number; requestId?: string; jobId?: string; signal?: AbortSignal }
interface Options {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxAudioBytes?: number;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PENDING = new Set(['queued', 'running', 'merging', 'settling']);
const TERMINAL = new Set(['success', 'failed', 'cancelled']);
const TRANSIENT = new Set([429, 500, 502, 503, 504]);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid API response');
  return value as Record<string, unknown>;
}
export function validateId(id: string): string {
  if (!UUID.test(id)) throw new Error('Expected a UUID request or job ID');
  return id;
}
function safeUrl(value: string, allowLocal: boolean): URL {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.hash || (url.protocol !== 'https:' && !(allowLocal && local && url.protocol === 'http:'))) throw new Error('Expected an HTTPS URL without embedded credentials');
  return url;
}
function retryDelay(headers: Headers, fallback: number): number {
  const value = headers.get('retry-after');
  if (!value) return fallback;
  const seconds = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.max(fallback, seconds * 1000) : fallback;
}
async function boundedBody(response: Response, maximum: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel();
    throw new Error('Response exceeds configured size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > maximum) throw new Error('Response exceeds configured size limit');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks, length);
}
export function dialogueInput(text: string, voiceA: string, voiceB: string): SpeechInput {
  const segments: { speaker: string; text: string; voiceName: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^(Speaker[12]):\s*(.*)$/.exec(line.trim());
    if (match) segments.push({ speaker: match[1], text: match[2], voiceName: match[1] === 'Speaker1' ? voiceA : voiceB });
    else if (line.trim() && segments.length) segments[segments.length - 1].text += '\n' + line;
    else if (line.trim()) throw new Error('Dialogue must start with Speaker1: or Speaker2:');
  }
  if (!segments.length || segments.some(segment => !segment.text.trim())) throw new Error('Every speaker turn needs spoken text');
  return { mode: 'multi', segments };
}

export class FlowSpeechClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAudioBytes: number;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  constructor(private readonly options: Options) {
    if (!options.apiKey?.trim() || /[\r\n]/.test(options.apiKey)) throw new Error('Set FLOWSPEECH_API_KEY to a developer API key');
    const base = safeUrl(options.baseUrl ?? 'https://flowspeech.io', true);
    if (base.pathname !== '/' || base.search) throw new Error('API base URL must be an origin without a path or query');
    this.baseUrl = base.origin;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.maxAudioBytes = options.maxAudioBytes ?? 100 * 1024 * 1024;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 7_200_000) throw new Error('Timeout must be between 1 and 7200000 milliseconds');
    if (!Number.isSafeInteger(this.maxAudioBytes) || this.maxAudioBytes < 1) throw new Error('Invalid audio size limit');
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? (() => performance.now());
    this.sleep = options.sleep ?? (async (ms, signal) => { await delay(ms, undefined, { signal }); });
  }
  private context(signal?: AbortSignal, requestId?: string): Context {
    return { deadline: this.now() + this.timeoutMs, signal, requestId };
  }
  private remaining(context: Context): number {
    if (context.signal?.aborted) throw new Error('Operation stopped; this does not cancel the server job');
    const remaining = context.deadline - this.now();
    if (remaining <= 0) throw new Error('Operation timed out; this does not cancel the server job');
    return remaining;
  }
  private async pause(ms: number, context: Context): Promise<void> {
    if (ms >= this.remaining(context)) throw new Error('Required wait exceeds the timeout; resume the existing request or job later');
    await this.sleep(ms, context.signal);
    this.remaining(context);
  }
  private async api(path: string, context: Context, body?: unknown): Promise<{ data: Record<string, unknown>; headers: Headers }> {
    const encoded = body === undefined ? undefined : JSON.stringify(body);
    for (let attempt = 0; attempt < 5; attempt++) {
      this.remaining(context);
      let response: Response;
      let raw: Uint8Array;
      try {
        const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(30_000, this.remaining(context)))));
        response = await this.fetcher(this.baseUrl + path, {
          method: body === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit',
          signal: context.signal ? AbortSignal.any([timeout, context.signal]) : timeout,
          headers: {
            Authorization: `Bearer ${this.options.apiKey}`,
            ...(encoded === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': context.requestId! }),
          }, body: encoded,
        });
        raw = await boundedBody(response, 1024 * 1024);
      } catch {
        this.remaining(context);
        if (attempt === 4) throw new Error('API transport failed after bounded retries');
        await this.pause(1000 * 2 ** attempt, context);
        continue;
      }
      let data: Record<string, unknown> | undefined;
      try { data = object(JSON.parse(new TextDecoder().decode(raw))); } catch { /* Error responses may not be JSON. */ }
      if (response.ok) {
        if (!data) throw new Error('API returned invalid JSON');
        return { data, headers: response.headers };
      }
      const error = data?.error && typeof data.error === 'object' ? data.error as Record<string, unknown> : {};
      if (TRANSIENT.has(response.status) && error.retryable !== false && attempt < 4) {
        await this.pause(retryDelay(response.headers, 1000 * 2 ** attempt), context);
        continue;
      }
      const code = typeof error.code === 'string' && /^[a-zA-Z0-9_]{1,100}$/.test(error.code) ? error.code : 'api_error';
      throw new Error(`FlowSpeech HTTP ${response.status}: ${code}`);
    }
    throw new Error('API retry budget exhausted');
  }
  private job(data: Record<string, unknown>): Job {
    if (typeof data.id !== 'string' || !UUID.test(data.id) || typeof data.status !== 'string' || (!PENDING.has(data.status) && !TERMINAL.has(data.status))) throw new Error('API returned an invalid job ID or status');
    return data as unknown as Job;
  }
  async quota(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.api('/api/v1/quota', this.context(signal))).data;
  }
  async voices(signal?: AbortSignal): Promise<Voice[]> {
    const data = (await this.api('/api/v1/voices', this.context(signal))).data;
    if (!Array.isArray(data.voices) || data.voices.some(v => !v || typeof v.name !== 'string' || typeof v.description !== 'string' || typeof v.gender !== 'string')) throw new Error('Invalid voices response');
    return data.voices as Voice[];
  }
  async getJob(id: string, signal?: AbortSignal): Promise<Job> {
    return this.job((await this.api(`/api/v1/tts/jobs/${validateId(id)}`, this.context(signal))).data);
  }
  async generate(input: SpeechInput, requestId: string = randomUUID(), signal?: AbortSignal): Promise<{ job: Job; audio: Uint8Array; requestId: string }> {
    validateId(requestId);
    const context = this.context(signal, requestId);
    try {
      const turns = input.mode === 'single' ? [input] : input.segments;
      if (!turns?.length || turns.length > 1000 || turns.some(t => !t.text?.trim() || !t.voiceName?.trim()) || turns.reduce((n, t) => n + t.text.length, 0) > 100_000) throw new Error('Invalid speech text, voice or input limits');
      if (Buffer.byteLength(JSON.stringify({ input })) > 1024 * 1024) throw new Error('Input exceeds the JSON body limit');
      let result = await this.api('/api/v1/tts/jobs', context, { input });
      let job = this.job(result.data);
      context.jobId = job.id;
      while (PENDING.has(job.status)) {
        await this.pause(retryDelay(result.headers, 5000), context);
        result = await this.api(`/api/v1/tts/jobs/${job.id}`, context);
        job = this.job(result.data);
        if (job.id !== context.jobId) throw new Error('Status response changed the job ID');
      }
      if (job.status !== 'success') throw new Error(`Generation ${job.status}`);
      if (!job.result || typeof job.result.url !== 'string') throw new Error(job.resultDeleted ? 'Audio result was deleted' : 'Completed job has no audio result');
      if (job.result.mimeType !== 'audio/wav') throw new Error('Unexpected audio format; expected audio/wav');
      const url = safeUrl(job.result.url, new URL(this.baseUrl).protocol === 'http:');
      // Download independently, without API credentials or automatic redirects.
      const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(120_000, this.remaining(context)))));
      const audioResponse = await this.fetcher(url.toString(), { redirect: 'error', credentials: 'omit', signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
      if (!audioResponse.ok) throw new Error(`Audio download HTTP ${audioResponse.status}; retry this download, not generation`);
      const audio = await boundedBody(audioResponse, this.maxAudioBytes);
      if (audio.length < 12 || Buffer.from(audio.subarray(0, 4)).toString() !== 'RIFF' || Buffer.from(audio.subarray(8, 12)).toString() !== 'WAVE') throw new Error('Downloaded result is not a WAV file');
      return { job, audio, requestId };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Operation failed';
      throw new Error(`${message.split(this.options.apiKey).join('[redacted]')}; requestId=${requestId}${context.jobId ? `; jobId=${context.jobId}` : ''}`);
    }
  }
}
