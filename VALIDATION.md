# 0.2.0 hardening handoff (2026-10-26)

Base: `7a40afe` on `codex/public-api-v1`. No commits, pushes, publishes,
production requests, real credentials, or Raycast edits were made.

## Changes

All six release-gate findings are addressed:

1. Strict runtime allowed-field/type validation and output-path preflight run
   before paid submission; atomic no-overwrite saves preserve recovery IDs.
2. Generation requires a caller-known UUID. The local
   `flowspeech_new_request_id` tool needs neither network nor API key.
   MCP cancellation reaches the HTTP client without cancelling the paid job.
3. Unsupported options are rejected rather than ignored.
4. Result metadata and usage are validated. WAV parsing checks RIFF bounds,
   complete padded chunks, PCM format, and nonempty aligned audio data.
5. Normalized UUIDs are correlated on create, poll, lookup, and recovery.
6. Retry-After survives body-read failures. Status retries and polling wait
   at least five seconds, bounded by one total deadline.

Existing tool names remain available. Breaking 0.2.0 change: both generation
tools require `request_id`. The shared TypeScript client now requires
`generate(input, requestId, signal?)`; callers must retain the UUID before
calling it. `findJob(requestId, signal?)` supports recovery without submission.
The coordinator must adapt Raycast callers when copying the hardened client.

## Verification

Local runtimes: Node 20.19.5 and Node 22.14.0, npm 10.8.2 and 10.9.2.

- `npm test`: 121 passed, 0 failed (109 client, 12 stdio), on each runtime.
- `npm run test:packed`: rebuilt TypeScript and tarball; the same 121 tests
  passed against extracted packaged JavaScript, 0 failed, on each runtime.
- `git diff --check`: passed.
- Tarball: `mcp-flowspeech-server-0.2.0.tgz`, 14,097 bytes, nine allowlisted
  members; each member matches its local source/build counterpart.
- SHA-256: `16961d6e2502e9ff3225d530ad366db1840cf8518f8fa13af0692e2dfd32af3e`.
- Packaged secret-pattern scan passed; no tests, caches, or credentials shipped.

The fake HTTP tests bind loopback only and use fake credentials. The sandbox
initially blocked that bind; reruns with approved loopback access passed.
Packed tests reuse installed workspace dependencies, but import and launch only
the extracted implementation. Node 20/22 CI now runs both suites; these new
changes have not been pushed or run in remote CI.

## Changed files

`.github/workflows/test.yml`, `.gitignore`, `CHANGELOG.md`, `README.md`,
`SKILL.md`, `package.json`, `src/client.ts`, `src/index.ts`,
`test/client.test.mjs`, `test/stdio.test.mjs`, new `test/fixtures.mjs`,
new `scripts/test-packed.mjs`, and this report. Ignored `dist/` was rebuilt;
the existing untracked 0.2.0 tarball was replaced. Package version and lockfile
remain 0.2.0; dependencies were not changed.

## Coordinator release steps

Review the diff, run Node 20/22 CI, then commit/push from the coordinator.
Verify npm 0.2.0 is still unpublished before publishing this exact tarball with
the coordinator's authorized 2FA flow. Do not overwrite an existing release.
No implementation blocker remains from the six findings; publication and the
new remote CI run remain coordinator actions.
