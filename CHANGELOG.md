# Changelog

## 0.2.0

- Migrate generation to public API v1 asynchronous jobs and credential-free WAV downloads.
- Require a developer API key and Node.js 20.3 or newer.
- Retrieve voices from the API; add quota and job-status tools.
- Preserve original tool names and convert labelled dialogue to ordered speaker segments.
- Add bounded retries with stable UUIDs, Retry-After handling, operation deadlines, abort support and recovery IDs.
- Reject credential-bearing URLs, API redirects, malformed jobs, missing/deleted results and oversized or invalid audio.
- Save files privately without overwriting existing recordings; expand home-directory paths.
- Add unit and built-stdio tests without credit-consuming production requests.
