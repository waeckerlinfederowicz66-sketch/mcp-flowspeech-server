#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const FLOWSPEECH_API = 'https://flowspeech.io/api/ai/text-to-speech';
const DEFAULT_OUTPUT_DIR = process.env.FLOWSPEECH_OUTPUT_DIR
  || path.join(os.homedir(), '.flowspeech-mcp', 'audio');

const VOICES = [
  // Bright & Energetic
  { name: 'Puck',        description: 'Upbeat and playful',          gender: 'male'   },
  { name: 'Fenrir',      description: 'Excitable and energetic',      gender: 'male'   },
  { name: 'Zephyr',      description: 'Bright and cheerful',          gender: 'female' },
  { name: 'Autonoe',     description: 'Bright and welcoming',         gender: 'female' },
  { name: 'Laomedeia',   description: 'Upbeat and lively',            gender: 'female' },
  { name: 'Sadachbia',   description: 'Lively and colorful',          gender: 'male'   },
  { name: 'Leda',        description: 'Youthful and casual',          gender: 'female' },
  { name: 'Aoede',       description: 'Breezy and light',             gender: 'female' },
  // Clear & Informative
  { name: 'Charon',      description: 'Informative and narrative',    gender: 'male'   },
  { name: 'Rasalgethi',  description: 'Informative and educational',  gender: 'male'   },
  { name: 'Kore',        description: 'Firm and focused',             gender: 'female' },
  { name: 'Orus',        description: 'Firm and decisive',            gender: 'male'   },
  { name: 'Alnilam',     description: 'Firm and authoritative',       gender: 'male'   },
  { name: 'Erinome',     description: 'Clear and precise',            gender: 'female' },
  { name: 'Iapetus',     description: 'Clear and professional',       gender: 'male'   },
  { name: 'Schedar',     description: 'Even and steady',              gender: 'male'   },
  { name: 'Pulcherrima', description: 'Forward and direct',           gender: 'male'   },
  { name: 'Sadaltager',  description: 'Knowledgeable and informative',gender: 'male'   },
  // Calm & Relaxed
  { name: 'Umbriel',       description: 'Easy-going and relaxed',    gender: 'male'   },
  { name: 'Callirrhoe',    description: 'Easy-going and soothing',   gender: 'female' },
  { name: 'Achird',        description: 'Friendly and helpful',      gender: 'male'   },
  { name: 'Zubenelgenubi', description: 'Casual and laid-back',      gender: 'male'   },
  { name: 'Algieba',       description: 'Smooth and mellow',         gender: 'male'   },
  { name: 'Despina',       description: 'Smooth and reassuring',     gender: 'female' },
  // Warm & Distinctive
  { name: 'Enceladus',   description: 'Breathy and magnetic',        gender: 'male'   },
  { name: 'Algenib',     description: 'Gravelly and textured',       gender: 'male'   },
  { name: 'Sulafat',     description: 'Warm and inviting',           gender: 'female' },
  { name: 'Vindemiatrix',description: 'Gentle and caring',           gender: 'female' },
  { name: 'Achernar',    description: 'Soft and tender',             gender: 'female' },
  { name: 'Gacrux',      description: 'Mature and experienced',      gender: 'female' },
];

function ensureOutputDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

interface TtsApiResponse {
  code: number;
  message?: string;
  data?: {
    mimeType: string;
    audioBase64: string;
    sampleRate: number;
    numChannels: number;
    bitsPerSample: number;
    quota?: unknown;
  };
}

async function callFlowSpeechTts(
  text: string,
  voiceName: string = 'Kore',
  speakerB?: string,
): Promise<TtsApiResponse> {
  let speakers: Array<{ voiceName: string; speaker?: string }>;

  if (speakerB) {
    // Multi-speaker mode: mark text with Speaker1/Speaker2
    speakers = [
      { speaker: 'Speaker1', voiceName },
      { speaker: 'Speaker2', voiceName: speakerB },
    ];
  } else {
    speakers = [{ voiceName }];
  }

  const response = await fetch(FLOWSPEECH_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, speakers }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FlowSpeech API error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<TtsApiResponse>;
}

function base64ToBuffer(base64: string): Buffer {
  return Buffer.from(base64, 'base64');
}

function getMimeExtension(mimeType: string): string {
  if (mimeType.includes('wav') || mimeType.includes('L16') || mimeType.includes('l16')) return 'wav';
  if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('flac')) return 'flac';
  return 'wav';
}

const TOOLS: Tool[] = [
  {
    name: 'flowspeech_tts',
    description:
      'Convert text to speech using FlowSpeech — a context-aware TTS engine with emotion control and 30+ voices. Returns the file path of the generated audio.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Text to convert to speech. Supports emotion stage directions inside ***(say <style>: text)***: e.g. "***(say cheerfully: Hello!)***"',
        },
        voice: {
          type: 'string',
          description: `Voice name to use. Default: "Kore". Available: ${VOICES.map((v) => v.name).join(', ')}`,
          default: 'Kore',
        },
        output_path: {
          type: 'string',
          description: `File path to save audio. Defaults to a timestamped file in ${DEFAULT_OUTPUT_DIR}`,
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'flowspeech_tts_multi',
    description:
      'Convert a two-speaker dialogue to speech using FlowSpeech. Assign **Speaker1:** and **Speaker2:** prefixes in the text.',
    inputSchema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description:
            'Dialogue text with speaker labels. Example:\n"Speaker1: Good morning!\nSpeaker2: Good morning! How are you?"',
        },
        voice_a: {
          type: 'string',
          description: 'Voice for Speaker1. Default: "Charon"',
          default: 'Charon',
        },
        voice_b: {
          type: 'string',
          description: 'Voice for Speaker2. Default: "Kore"',
          default: 'Kore',
        },
        output_path: {
          type: 'string',
          description: `File path to save audio. Defaults to a timestamped file in ${DEFAULT_OUTPUT_DIR}`,
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'flowspeech_list_voices',
    description: 'List all available FlowSpeech voices with their descriptions and gender.',
    inputSchema: {
      type: 'object',
      properties: {
        gender: {
          type: 'string',
          enum: ['male', 'female', 'all'],
          description: 'Filter by gender. Default: "all"',
          default: 'all',
        },
      },
    },
  },
];

const server = new Server(
  { name: 'flowspeech', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  if (name === 'flowspeech_list_voices') {
    const gender = (args.gender as string) || 'all';
    const filtered = gender === 'all'
      ? VOICES
      : VOICES.filter((v) => v.gender === gender);

    const rows = filtered.map(
      (v) => `• **${v.name}** (${v.gender}) — ${v.description}`,
    );
    return {
      content: [
        {
          type: 'text',
          text: `FlowSpeech has ${filtered.length} voice(s):\n\n${rows.join('\n')}\n\nLearn more: https://flowspeech.io`,
        },
      ],
    };
  }

  if (name === 'flowspeech_tts') {
    const text = args.text as string;
    const voice = (args.voice as string) || 'Kore';
    const outputPath = (args.output_path as string) || null;

    if (!text) throw new Error('text is required');

    const result = await callFlowSpeechTts(text, voice);
    if (result.code !== 0 || !result.data?.audioBase64) {
      throw new Error(result.message || 'FlowSpeech TTS failed');
    }

    const ext = getMimeExtension(result.data.mimeType);
    const outDir = outputPath
      ? path.dirname(outputPath)
      : DEFAULT_OUTPUT_DIR;
    ensureOutputDir(outDir);

    const filePath = outputPath || path.join(DEFAULT_OUTPUT_DIR, `flowspeech-${Date.now()}.${ext}`);
    fs.writeFileSync(filePath, base64ToBuffer(result.data.audioBase64));

    return {
      content: [
        {
          type: 'text',
          text: `Audio saved to: ${filePath}\nVoice: ${voice}\nFormat: ${result.data.mimeType}\nPowered by FlowSpeech (https://flowspeech.io)`,
        },
      ],
    };
  }

  if (name === 'flowspeech_tts_multi') {
    const text = args.text as string;
    const voiceA = (args.voice_a as string) || 'Charon';
    const voiceB = (args.voice_b as string) || 'Kore';
    const outputPath = (args.output_path as string) || null;

    if (!text) throw new Error('text is required');

    const result = await callFlowSpeechTts(text, voiceA, voiceB);
    if (result.code !== 0 || !result.data?.audioBase64) {
      throw new Error(result.message || 'FlowSpeech multi-speaker TTS failed');
    }

    const ext = getMimeExtension(result.data.mimeType);
    const outDir = outputPath ? path.dirname(outputPath) : DEFAULT_OUTPUT_DIR;
    ensureOutputDir(outDir);

    const filePath = outputPath || path.join(DEFAULT_OUTPUT_DIR, `flowspeech-multi-${Date.now()}.${ext}`);
    fs.writeFileSync(filePath, base64ToBuffer(result.data.audioBase64));

    return {
      content: [
        {
          type: 'text',
          text: `Audio saved to: ${filePath}\nSpeaker1: ${voiceA} | Speaker2: ${voiceB}\nFormat: ${result.data.mimeType}\nPowered by FlowSpeech (https://flowspeech.io)`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
