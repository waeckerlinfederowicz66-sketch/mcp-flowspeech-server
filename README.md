# FlowSpeech MCP Server

Use [FlowSpeech](https://flowspeech.io) speech generation from an MCP client. Version 0.2.0 uses the public API v1: create a job, wait for completion, download the WAV, and save it locally.

## Requirements

- Node.js 20.3 or newer.
- A FlowSpeech developer API key from [API settings](https://flowspeech.io/settings/apikeys).
- Active paid Basic, Pro or Scale API access for generation. Trials do not include API access; generated speech consumes account credits.

Keep keys in your MCP client's local environment or secret manager, not in prompts or public configuration files.

## Configuration

Set `FLOWSPEECH_API_KEY` in the environment used to launch your MCP client. A stdio configuration is:

```json
{
  "mcpServers": {
    "flowspeech": {
      "command": "npx",
      "args": ["-y", "mcp-flowspeech-server@0.2.0"]
    }
  }
}
```

The MCP client must pass the key to its child process. Clients which do not inherit environment variables need a private `env` entry or their own secret configuration.

| Variable | Meaning | Default |
| --- | --- | --- |
| `FLOWSPEECH_API_KEY` | Required developer key | None |
| `FLOWSPEECH_OUTPUT_DIR` | Local output directory; `~/` is expanded | `~/.flowspeech-mcp/audio` |
| `FLOWSPEECH_TIMEOUT_MS` | Total operation deadline, at most 7200000 ms | `120000` |
| `FLOWSPEECH_BASE_URL` | Trusted API origin; never use an untrusted key recipient | `https://flowspeech.io` |

HTTP is allowed only for loopback test servers. Audio downloads never include the API key. Redirects are rejected, and audio downloads are limited to 100 MiB.

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| `flowspeech_tts` | Required `text`; optional `voice` (Kore), `output_path`, `request_id` | Local WAV path, job ID, request ID and usage |
| `flowspeech_tts_multi` | Required labelled `text`; optional `voice_a` (Charon), `voice_b` (Kore), `output_path`, `request_id` | Local WAV path and recovery IDs |
| `flowspeech_list_voices` | Optional `gender`: male, female or all | Current authenticated voice catalog |
| `flowspeech_quota` | None | Available, remaining and reserved credits |
| `flowspeech_get_job` | Required UUID `job_id` | Current job status and result |

Two-speaker input uses one label per turn. Continuation lines belong to the preceding speaker:

```text
Speaker1: Welcome.[pause:2s]Let's begin.
Speaker2: Thanks for inviting me.
Speaker1: What should we cover first?
```

Output is 24 kHz, mono, 16-bit WAV. Existing output files are never overwritten. Anyone holding a result URL can download it, so keep job results and recordings private when appropriate.

## Recovery and migration

Version 0.1.0 called the retired synchronous endpoint. Upgrade the npm package and restart your MCP client. All tools now require a developer key, including voice listing. The three original tool names remain available, and two read-only tools have been added.

The server submits `{ "input": ... }` with a UUID idempotency key, polls no faster than five seconds, honors a longer `Retry-After`, and downloads `result.url`. It does not expect an API Base64 response. Transient API retries preserve the exact request ID and body, with at most five attempts per API request.

For deliberate recovery, supply a UUID `request_id` and reuse it with unchanged text and voices. Errors include available recovery IDs. A timeout or client cancellation stops local waiting; it does not cancel a server-side job. Use `flowspeech_get_job` to inspect it. A failed download or local save should be retried from the existing result rather than starting another recording. A terminal failed/cancelled job requires a new UUID only when intentionally requesting a new attempt.

## Development and tests

```sh
npm ci --ignore-scripts
npm test
npm pack --dry-run
```

Tests cover mocked v1 contracts and a loopback HTTP server exercised through the built MCP stdio process. They do not call paid production generation. See [CHANGELOG.md](CHANGELOG.md) and the [public API documentation](https://flowspeech.io/docs/public-api).

## License

MIT
