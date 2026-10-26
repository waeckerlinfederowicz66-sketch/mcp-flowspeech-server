# Changelog

## 0.2.0

- Breaking: require a caller-known request_id on both generation tools and the client generate method.
- Add the local, credential-free flowspeech_new_request_id tool; allow flowspeech_get_job lookup by request UUID.
- Validate allowed fields, types and output paths before paid submission; preserve atomic no-overwrite and recovery IDs on save failures.
- Preserve caller-known recovery across MCP timeout/cancellation without cancelling paid server jobs.
- Validate all result metadata, usage, normalized request/job correlation and complete PCM WAV chunk structure.
- Honor received Retry-After after interrupted bodies and enforce at least five seconds on status retries.
- Run source and stdio regressions again against the inspected packed artifact before publishing.

- Migrate generation to public API v1 asynchronous jobs and credential-free WAV downloads.
- Require a developer API key and Node.js 20.3 or newer.
- Retrieve voices from the API; add quota and job-status tools.
- Preserve original tool names and convert labelled dialogue to ordered speaker segments.
- Add bounded retries with stable UUIDs, Retry-After handling, operation deadlines, abort support and recovery IDs.
- Reject credential-bearing URLs, API redirects, malformed jobs, missing/deleted results and oversized or invalid audio.
- Save files privately without overwriting existing recordings; expand home-directory paths.
- Add unit and built-stdio tests without credit-consuming production requests.
