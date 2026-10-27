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
npx -y mcp-flowspeech-server@0.2.1
```

For MCP clients, configure the server with stdio transport:

```json
{
  "mcpServers": {
    "flowspeech": {
      "command": "npx",
      "args": ["-y", "mcp-flowspeech-server@0.2.1"],
      "env": {
        "FLOWSPEECH_OUTPUT_DIR": "~/flowspeech-audio"
      }
    }
  }
}
```

Node.js 20.3 or newer and a FlowSpeech developer API key are required for API
operations. The local flowspeech_new_request_id tool needs no key or network.
Set FLOWSPEECH_API_KEY in the private environment passed to the MCP process.
Generation requires active paid API access and consumes account credits.
Do not ask the user to paste secrets, account credentials, or private tokens into
chat; use the MCP client's environment or secret manager.

## Workflow

1. Clarify the target format: single voice, two-speaker dialogue, or voice exploration.
2. If the user has not chosen a voice, use `flowspeech_list_voices` or pick a sensible default.
3. Call `flowspeech_new_request_id` and retain the returned `request_id` before submitting any text.
4. For single-speaker audio, call `flowspeech_tts` with that required `request_id`, text and selected voice.
5. For two-speaker audio, call `flowspeech_tts_multi` with that required `request_id` and `Speaker1:` / `Speaker2:` labels.
6. Return the generated audio file path and briefly describe the voice choices used.

Version 0.2.0 requires a caller-known UUID on both generation tools; calls without
request_id are rejected before submission. Unknown fields, invalid argument
types and invalid output paths are rejected before paid work. Do not supply
unsupported model, source, speed or format options.

The server uses API v1 job creation, polling and separate validated PCM WAV
download. It does not send credentials to the audio host. Use flowspeech_quota
for available credits. After timeout or cancellation, call flowspeech_get_job
with exactly one of request_id (the UUID retained before submission) or job_id.
Wait at least five seconds between status queries. If lookup returns 404, retry
the original generation with the same UUID and unchanged text/voices. If the job
succeeded, download its existing result URL without API credentials. To retry
saving through MCP, replay that unchanged request with an unused output path.
Never create a new UUID merely to retry an interrupted request or download.

MCP cancellation can suppress the final error message, so do not rely on that
message to recover an automatically generated ID. Caller cancellation stops local
HTTP/poll/download work but never cancels the paid server job. Existing output
files are not overwritten. Deliberate new recordings require fresh UUIDs.

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
