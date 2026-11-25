## Why

A REST source's non-2xx response is read whole (`toStrict`, up to Pekko's 8 MiB `max-to-strict-bytes` default, or 30 s
for a slow body) before HEL-1841's `RemoteErrorText.cap` keeps 500 code points of it. A large or hostile endpoint can
make every fetch, preview, refresh, connection test and proposal dry run hold megabytes and wait 30 s to report an
error that is at most ~500 characters.

## What Changes

- The REST driver reads a non-2xx (including 3xx) body only up to a small fixed byte limit (4 KiB), then stops and
  closes the stream. The capped error text is byte-identical to today for any body that HEL-1841's cap already handled
  (bodies under the old 8 MiB ceiling that arrive within 30 s).
- A non-2xx body over 8 MiB, or one that never ends, now returns the capped `HTTP <code>: <head> … [truncated]` text as
  soon as 4 KiB has arrived, instead of today's generic `Request failed` (an error-path improvement, not a success-path
  change).
- Success path (2xx fetch): unchanged limit (the actor system's `max-to-strict-bytes`, 8 MiB), now passed explicitly;
  over it the result stays `Request failed`.
- Connection test 2xx: the body is counted against the same limit but not held; outcome unchanged.
- `ContentSourceSupport.fetchUrl` (CSV-URL/text/PDF/image sources) stops reading a non-2xx body it already discards; a
  non-2xx body over 100 MiB or slower than 30 s now reports `Upstream returned HTTP <code>` instead of `Request failed`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `fetch-error-envelope`: adds a requirement that the remote error body is read with a byte bound.

## Non-goals

- Streaming JSON parsing bounded by row limits (would change `availableRowCount`/`truncated`; HEL-1013 owns pagination).
- Changing any user-visible success-path limit or message.
- Claude/Resend/OAuth HTTP clients (not remote sources).

## Impact

`RestApiConnectorDriver.scala`, `RemoteErrorText.scala` (or a sibling helper), `ContentSourceSupport.scala`, backend
tests. No API, schema, migration or frontend change.
