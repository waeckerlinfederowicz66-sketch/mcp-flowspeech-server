# FlowSpeech MCP Server

## Unreleased Security Follow-up

Read-only tools and returned job errors reject the configured API key in diagnostic codes. Returned job errors contain only the validated code, not remote messages or extra fields. Recovery IDs and successful result links remain available.

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
| `flowspeech_new_request_id` | None; no API key needed | Fresh UUID generated locally without network access |
| `flowspeech_tts` | Required `text` and `request_id`; optional `voice` (Kore), `output_path` | Local WAV path, job ID, request ID and usage |
| `flowspeech_tts_multi` | Required labelled `text` and `request_id`; optional `voice_a` (Charon), `voice_b` (Kore), `output_path` | Local WAV path and recovery IDs |
| `flowspeech_list_voices` | Optional `gender`: male, female or all | Current authenticated voice catalog |
| `flowspeech_quota` | None | Available, remaining and reserved credits |
| `flowspeech_get_job` | Exactly one UUID: `job_id` or `request_id` | Current job status and result; never creates work |

Call `flowspeech_new_request_id` first and retain its `request_id` before invoking
either generation tool. Never use a fresh UUID merely because a call was interrupted.
All tools reject unknown fields and incorrect argument types at runtime.
Model, source, speed and format options are unsupported. Output paths are validated
and preflighted before paid submission; the final write still uses atomic
no-overwrite protection in case another process creates the file meanwhile.

Two-speaker input uses one label per turn. Continuation lines belong to the preceding speaker:

```text
Speaker1: Welcome.[pause:2s]Let's begin.
Speaker2: Thanks for inviting me.
Speaker1: What should we cover first?
```

Output is 24 kHz, mono, 16-bit PCM WAV. The client validates all result fields
(`url`, `mimeType`, `sampleRate`, `channels`, `bitsPerSample`, `access`),
usage counters, UUID correlation, RIFF length, chunk boundaries and padding,
PCM format, and nonempty sample-aligned data before saving. Existing output files
are never overwritten. Anyone holding a result URL can download it, so keep job
results and recordings private when appropriate.

## Recovery and migration

Version 0.1.0 called the retired synchronous endpoint. Upgrade the npm package and
restart your MCP client. All API tools require a developer key, including voice
listing; only `flowspeech_new_request_id` is entirely local. All five existing
tool names remain available.

**Breaking change in 0.2.0:** both generation tools now require `request_id`;
automatic UUID creation inside a blocking generation call has been removed.
The TypeScript client's `generate(input, requestId, signal?)` likewise requires a
caller-known UUID. UUIDs are normalized to lowercase. The client rejects
responses whose request or job identity does not match the requested operation.

The server submits `{ "input": ... }` with a UUID idempotency key, polls no faster
than five seconds (including status retries), honors a longer `Retry-After`,
and downloads `result.url`. A received cooldown still applies if reading the
response body fails. It does not expect an API Base64 response. Transient API
retries preserve the exact request ID and body, with at most five attempts per
API request. Redirects and size-validation failures are not retried.

Recovery workflow:

1. Call `flowspeech_new_request_id` and retain the returned UUID.
2. Pass that UUID as `request_id` to generation with the intended text and voices.
3. After a timeout or cancellation, call `flowspeech_get_job` with
   `{"request_id":"YOUR_RETAINED_UUID"}`. If a job ID was already returned,
   `{"job_id":"YOUR_JOB_UUID"}` is also supported.
4. While queued, running, merging or settling, wait at least five seconds between
   status calls. On success, use the existing `result.url` for a credential-free
   download. Do not request another recording to retry a download.
5. If lookup returns 404, retry the original generation with the same UUID and
   unchanged text and voices. To retry local saving through MCP, replay that
   same request with an unused output path; idempotency prevents new generation.

Caller cancellation is passed to HTTP requests, response reads and polling waits.
It never sends a server-side cancellation request. MCP clients may time out
earlier than `FLOWSPEECH_TIMEOUT_MS` (the SDK default is 60 seconds); configure
their timeout as appropriate. Cancelled MCP requests may not receive a final
error response, which is why retaining the UUID **before submission** is required.
A deleted success result has no downloadable audio. A terminal failed/cancelled
job requires a new UUID only when intentionally requesting a new attempt.

## Development and tests

```sh
npm ci --ignore-scripts
npm test
npm run test:packed
```

Tests cover mocked v1 contracts, real WAV fixtures and a loopback HTTP server
exercised through the built MCP stdio process. Packed tests rebuild the tarball,
inspect its members and credentials patterns, compare packaged bytes with local
files, and rerun the client and stdio suites against the extracted package.
They never call paid production generation. Node 20 and 22 CI run both suites.
See [CHANGELOG.md](CHANGELOG.md) and the [public API documentation](https://flowspeech.io/docs/public-api).

## License

MIT
