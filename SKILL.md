---
name: flowspeech-tts
description: Use FlowSpeech to convert text, narration scripts, and two-speaker dialogue into human-like speech with emotion control, pause control, and 30+ voices through the FlowSpeech MCP server.
---

# FlowSpeech TTS

Use this skill when a user wants to create audio from text with FlowSpeech, including narration, educational audio, product demos, creator scripts, short voiceovers, or two-speaker dialogue.

FlowSpeech is a context-aware text-to-speech tool for human-like audio with emotion control, pause control, and 30+ voices. Learn more at https://flowspeech.io/.

## When To Use

- The user asks for text-to-speech, AI voice, narration, voiceover, spoken audio, or dialogue audio.
- The user wants expressive delivery with emotion stage directions.
- The user needs a local audio file generated from plain text or a two-speaker script.
- The user wants to explore available FlowSpeech voices before generating audio.

## Setup

Install or run the FlowSpeech MCP server:

```bash
npx -y mcp-flowspeech-server@0.2.0
```

For MCP clients, configure the server with stdio transport:

```json
{
  "mcpServers": {
    "flowspeech": {
      "command": "npx",
      "args": ["-y", "mcp-flowspeech-server@0.2.0"],
      "env": {
        "FLOWSPEECH_OUTPUT_DIR": "~/flowspeech-audio"
      }
    }
  }
}
```

Node.js 20.3 or newer and a FlowSpeech developer API key are required. Set FLOWSPEECH_API_KEY in the private environment passed to the MCP process. Generation requires active paid API access and consumes account credits. Do not ask the user to paste secrets, account credentials, or private tokens into chat; use the MCP client's environment or secret manager.

## Workflow

1. Clarify the target format: single voice, two-speaker dialogue, or voice exploration.
2. If the user has not chosen a voice, use `flowspeech_list_voices` or pick a sensible default.
3. For single-speaker audio, call `flowspeech_tts` with the text and selected voice.
4. For two-speaker audio, call `flowspeech_tts_multi` with `Speaker1:` and `Speaker2:` labels.
5. Return the generated audio file path and briefly describe the voice choices used.

The server uses API v1 job creation, polling and separate WAV download. It does not send credentials to the audio host. Use flowspeech_quota for available credits and flowspeech_get_job for an existing UUID job. On timeout, recover using the reported request/job ID instead of creating duplicate work. A request_id UUID can be supplied and reused only with identical text and voices. Local cancellation does not cancel the server job, and existing output files are not overwritten.

## Emotion And Pause Control

FlowSpeech supports inline emotion cues with stage directions:

```text
***(say cheerfully: Welcome back!)***
Today we are walking through the new release.
***(say thoughtfully: This part matters.)***
```

Use emotion cues sparingly. Keep them tied to the content instead of decorating every sentence.

## Example Requests

- "Turn this lesson into a warm narration."
- "Create a two-host podcast intro from this script."
- "Read this product update in a calm professional voice."
- "List the available female voices before generating audio."

## Output

The MCP server saves generated audio locally and returns the file path. If the user needs a different location, pass a custom `output_path`.
