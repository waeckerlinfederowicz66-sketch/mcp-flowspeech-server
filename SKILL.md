---
name: flowspeech-tts
description: Use FlowSpeech MCP to create narration, voiceovers, or multi-speaker dialogue with emotion cues and timed pauses, or to explore available voices.
---

# FlowSpeech TTS

Use FlowSpeech when the user wants speech audio from text, including lessons, voiceovers, podcast scripts, and scenes with multiple voices.

## Setup

Use `npx -y mcp-flowspeech-server@0.3.0` as a stdio server. Configure `FLOWSPEECH_API_KEY` in the MCP client's private environment or secret manager. See [README.md](README.md) for Claude Code, Cursor, and Claude Desktop configurations. Node.js 20.3 or newer is required. Generation requires paid API access and consumes account credits. `flowspeech_new_request_id` runs locally without a key.

## Generate speech

1. Choose the voice or voices requested by the user. Use `flowspeech_list_voices` for the current voice catalog or `flowspeech_quota` to check available credits if needed.
2. Call `flowspeech_tts` with `text` and an optional `voice` for narration. Use `flowspeech_tts_multi` for dialogue. Supply `segments` with ordered `{speaker, text, voiceName}` turns, or supply labelled `text` and a `speakers` map. Legacy `Speaker1:` and `Speaker2:` labels use `voice_a` and `voice_b`.
3. Place bracketed cues like `[excited]` or `[calmly]` before the speech they guide, and put `[pause:1.0s]` where a one-second pause belongs. For example, `Host: [excited] Welcome! [pause:1.0s] Let’s begin.`
4. Return the local WAV path and the job or request ID when useful. Use `output_path` for a requested location. Set `overwrite: true` only when the user wants to replace an existing file.

## Recover or cancel an existing job

Omit `request_id` for one-call generation. After a timeout or disconnect, repeat the same speech input with the same API key and base URL. Leave `request_id` omitted if the first call omitted it, or pass the same UUID if it was explicit. Use `flowspeech_get_job` when the request ID or job ID is already available. A completed result can be downloaded from its existing URL without API credentials. To deliberately generate a new recording of the same speech, first call `flowspeech_new_request_id` and retain its UUID for retries.

Use `flowspeech_cancel_job` with a job ID if the user explicitly wants to stop a pending job. A timeout or MCP disconnect ends the local wait and the remote job can continue. The received server `Retry-After` controls the minimum wait between automatic polls when present.
