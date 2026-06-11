# Project Memory

## Feedback: API Error Surfacing

**Rule:** When surfacing API errors in bot commands, always include both the full request (method, URL, body) and the full response (status, body) formatted as separate JSON code blocks. Never surface just the status code, axios message, or response body alone.

**Why:** Partial error info (e.g. "status 500" or just the response body) is not enough to diagnose API failures. Having the request alongside the response makes it immediately clear what was sent and what the server returned, without having to reproduce the call manually.

**How to apply:** In any catch block wrapping an API call, capture `err.response?.config` (request details) and `err.response?.data` (response body), and format them as JSON code blocks in the error message shown to the user.
