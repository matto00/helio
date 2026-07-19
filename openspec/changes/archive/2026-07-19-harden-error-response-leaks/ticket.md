# HEL-311 — OAuthRoutes leaks exception message in error response (OAuthRoutes.scala:134)

## Context

Found by the HEL-299 skeptic (pre-existing, unrelated to that ticket).
`backend/.../OAuthRoutes.scala:134` returns `ex.getMessage` in the error response
body — the same information-leak class HEL-299 just fixed in
`PipelineRunStreamRoutes.scala` (log the full exception + stack trace server-side,
return a generic body to the client).

## What

Replace the leaked `ex.getMessage` in the OAuth error path with server-side logging
(full exception + stack trace) and a generic client-facing 500/error body. While
there, grep the backend routes for other `ex.getMessage`/`getLocalizedMessage` in
response bodies — this is a recurring class worth sweeping once.

## Acceptance criteria

- [ ] `OAuthRoutes.scala:134` no longer includes exception details in the client
  response; the detail is logged server-side
- [ ] Audit note listing every route that put an exception message in a response
  body, each fixed or confirmed safe
- [ ] Test asserting the OAuth error path returns a generic body (no raw exception
  text) and logs the detail

## Reference

- HEL-299 fixed the same class in `PipelineRunStreamRoutes.scala` — follow that
  pattern (log full exception + stack trace server-side, generic client body).
