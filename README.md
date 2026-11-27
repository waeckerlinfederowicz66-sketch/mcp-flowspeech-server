# FlowSpeech MCP Server

[![FlowSpeech MCP server](https://glama.ai/mcp/servers/waeckerlinfederowicz66-sketch/mcp-flowspeech-server/badges/score.svg)](https://glama.ai/mcp/servers/waeckerlinfederowicz66-sketch/mcp-flowspeech-server)

Generate expressive narration and multi-speaker dialogue with [FlowSpeech](https://flowspeech.io/) directly from Claude Code, Cursor, or Claude Desktop. A single tool call saves a local WAV and returns the job ID and request ID.

- **Inline emotion & timed pauses**: Steer delivery with bracketed cues such as `[excited]`, `[calmly]`, `[whisper]`, and `[pause:1.0s]`.
- **Multi-speaker dialogue & podcasts**: Assign distinct voices to 2 or more named speakers (`Host`, `Guest`, `Narrator`) in one request, or use structured `segments`.
- **30+ natural voices & long-form scripts**: Multilingual narration and dialogue saved as 24 kHz mono 16-bit PCM WAV, up to 100,000 characters per request.
- **Commercial-ready API plans**: Paid [Basic ($19/month or $156/year, 200,000 credits), Pro, and Scale plans](https://flowspeech.io/pricing) include REST API/MCP access and commercial rights.

## Quick start

Use Node.js 20.3 or newer and a developer API key from [FlowSpeech API settings](https://flowspeech.io/settings/apikeys). Generation requires active paid API access on Basic, Pro, or Scale and consumes account credits.

### Claude Code

Set `FLOWSPEECH_API_KEY` privately in your shell, then register the stdio server (this stores the expanded value in your local `~/.claude.json`, so keep that file private):

```sh
claude mcp add --scope user --env "FLOWSPEECH_API_KEY=$FLOWSPEECH_API_KEY" \
  --transport stdio flowspeech -- npx -y mcp-flowspeech-server@0.3.0
claude mcp list
```

### Cursor

Add this entry to `~/.cursor/mcp.json` for local desktop use, or to `.cursor/mcp.json` for the current project. Set `FLOWSPEECH_API_KEY` in the environment Cursor inherits.

```json
{
  "mcpServers": {
    "flowspeech": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-flowspeech-server@0.3.0"],
      "env": {
        "FLOWSPEECH_API_KEY": "${env:FLOWSPEECH_API_KEY}"
      }
    }
  }
}
```

### Claude Desktop

Add this entry to `claude_desktop_config.json`, replace the placeholder with your key, then quit and reopen Claude Desktop. On macOS the file is under `~/Library/Application Support/Claude/`. On Windows it is under `%APPDATA%\Claude\`. Keep this file private. If the desktop app cannot find `npx`, use its absolute path.

```json
{
  "mcpServers": {
    "flowspeech": {
      "command": "npx",
      "args": ["-y", "mcp-flowspeech-server@0.3.0"],
      "env": {
        "FLOWSPEECH_API_KEY": "YOUR_DEVELOPER_API_KEY"
      }
    }
  }
}
```

## Generate audio

Call `flowspeech_tts` with text. Place an emotion cue such as `[excited]`, `[calmly]`, or `[whisper]` before the words it should guide. Put `[pause:1.0s]` between phrases for a one-second pause.

```json
{
  "text": "[excited] Welcome back! [pause:1.0s] [calmly] Today we’ll start with a short story.",
  "voice": "Kore"
}
```

For a two-person podcast, call `flowspeech_tts_multi` with a labelled script and a map from speaker labels to voice names. Add more labels for more speakers. Only a label in the map starts a new turn. Other lines, including standalone pause cues, continue the preceding turn.

```json
{
  "text": "Host: [excited] Welcome to the show! [pause:1.0s] How did you get started?\nGuest: [calmly] It began with a very small experiment.",
  "speakers": { "Host": "Charon", "Guest": "Kore" }
}
```

You can supply ordered turns directly with `segments`, with one consistent `voiceName` per speaker:

```json
{
  "segments": [
    { "speaker": "Host", "text": "[excited] Welcome!", "voiceName": "Charon" },
    { "speaker": "Guest", "text": "[calmly] Thanks for inviting me.", "voiceName": "Kore" },
    { "speaker": "Producer", "text": "[pause:1.0s] We’re recording.", "voiceName": "Puck" }
  ]
}
```

Existing scripts with `Speaker1:` and `Speaker2:` still work without a `speakers` map. Their voice overrides are `voice_a` (default `Charon`) and `voice_b` (default `Kore`).

## Example prompts

Once configured in Claude Code, Cursor, or Claude Desktop, you can ask your assistant directly:

- `"List available female FlowSpeech voices, then read this product changelog aloud with a calm narrator and a 1-second pause before the breaking change."`
- `"Turn these release notes into a 2-minute two-host podcast WAV using Charon as Host and Kore as Guest, and save it to ./audio/release-podcast.wav."`
- `"Generate a dramatic game-trailer voiceover with [whisper] and [excited] cues, then tell me how many FlowSpeech credits remain."`
- `"Regenerate ./audio/intro.wav with a warmer voice and overwrite the previous file."`

## Tools

| Tool | Arguments and result |
| --- | --- |
| `flowspeech_tts` | Required `text`, optional `voice` (`Kore`). Returns the WAV path, job ID, request ID, and usage. |
| `flowspeech_tts_multi` | `segments`, `text` with `speakers`, or legacy `text` with optional `voice_a` and `voice_b`. Returns the WAV path, job ID, request ID, and usage. |
| `flowspeech_new_request_id` | No arguments. Returns a local UUID without a key or network access. |
| `flowspeech_list_voices` | Optional `gender` (`male`, `female`, or `all`). Returns the authenticated voice catalog. |
| `flowspeech_quota` | No arguments. Returns available, remaining, and reserved credits. |
| `flowspeech_get_job` | One of `job_id` or `request_id`. Returns the existing job and any audio result. |
| `flowspeech_cancel_job` | Required `job_id`. Stops a pending job. If you only know the request ID, look up the job first. Completed jobs cannot be cancelled or refunded. |

Both generation tools accept optional `request_id`, `output_path`, and `overwrite`. Output defaults to a job-specific file under `~/.flowspeech-mcp/audio`. To replace an existing regular file, set `overwrite: true`. The server validates and stages the complete WAV before saving. The default preserves existing files, including files created during generation. On filesystems without hard links, the server uses an exclusive copy. The output format is 24 kHz, mono, 16-bit PCM WAV.

## Recovery

When `request_id` is omitted, repeating the same speech input with the same API key and base URL reuses the same job even after a client restart. Local output options can change without starting a new job. If the same WAV is already at the requested path, the tool can return that path. An unrelated existing file is preserved. The lower-level TypeScript `generate(input, requestId, signal?)` method still requires an explicit UUID.

1. After an interruption, repeat the same speech input with the original `request_id`, or leave it omitted if the first call omitted it. If you already have the request ID or job ID, you can use `flowspeech_get_job` to check the job directly.
2. While it is pending, follow the API’s polling guidance. The MCP generator uses 1, 2, 3, and then 5 seconds when the API does not ask for a longer wait. The FlowSpeech API currently sends `Retry-After: 5` for pending jobs. HTTP retries also honor `Retry-After`.
3. If the job succeeded, download its existing `result.url` without API credentials. Treat the result URL as private when appropriate, since anyone with the link can download it.
4. If lookup returns 404 or you need to retry the local save, reuse the same UUID with unchanged text and voices. Choose an unused output path or explicitly enable `overwrite` for a regular file you want to replace.
5. To start a new recording with the same speech input, including after a terminal failure or cancellation, call `flowspeech_new_request_id` and pass its fresh UUID explicitly. Retain that ID for any retries.

Closing or timing out an MCP call stops the local wait. Use `flowspeech_cancel_job` to request server-side cancellation. For long scripts the MCP client may need a longer timeout than its default.

## Configuration

| Variable | Default and behavior |
| --- | --- |
| `FLOWSPEECH_API_KEY` | Required for API tools. Use the client’s private environment or secret manager. |
| `FLOWSPEECH_OUTPUT_DIR` | `~/.flowspeech-mcp/audio`. A leading `~/` is expanded. |
| `FLOWSPEECH_TIMEOUT_MS` | `120000`. Total operation deadline, up to `7200000` ms. |
| `FLOWSPEECH_BASE_URL` | `https://flowspeech.io`. Set only to a trusted API origin. HTTP is available for loopback test servers. |

The server uses [FlowSpeech public API v1](https://flowspeech.io/docs/public-api). API and audio requests reject redirects. Audio downloads omit the API key, are limited to 100 MiB, and are validated before saving.

## Development

```sh
npm ci --ignore-scripts
npm test
npm run test:packed
```

To run a local build, configure `node` as the MCP command and use the absolute path to this checkout’s `dist/index.js` as its only argument. The tests exercise the built MCP over stdio with a loopback REST fixture. Packed tests verify the tarball contents and rerun the same runtime checks against the extracted package. See [CHANGELOG.md](CHANGELOG.md).

## Links

- Website: [https://flowspeech.io](https://flowspeech.io/)
- Pricing & Commercial License: [https://flowspeech.io/pricing](https://flowspeech.io/pricing)
- Public API Documentation: [https://flowspeech.io/docs/public-api](https://flowspeech.io/docs/public-api)
- OpenAPI Specification: [https://flowspeech.io/openapi.json](https://flowspeech.io/openapi.json)
- npm Package: [https://www.npmjs.com/package/mcp-flowspeech-server](https://www.npmjs.com/package/mcp-flowspeech-server)
- Glama Directory: [https://glama.ai/mcp/servers/waeckerlinfederowicz66-sketch/mcp-flowspeech-server](https://glama.ai/mcp/servers/waeckerlinfederowicz66-sketch/mcp-flowspeech-server)
- Support: `support@flowspeech.io`

## License

MIT
