# HEL-1877: REST driver: bound the remote response read before materialising the body (toStrict reads it all)

## Description

origin_kind: followup
origin_ticket: HEL-1841

HEL-1841 (PR #1265, merged as fe07492b6) caps the `HTTP <code>: <body>` error text at 500 code points in both
`RestApiConnectorDriver` builders (`issueAndParse`, `issueTest`) through `RemoteErrorText.cap`. Both its skeptics noted
that the driver still reads the whole remote response into memory (`toStrict`) before capping. A huge or hostile remote
body therefore still costs memory and time, even though only 500 code points are kept. The owner chose to file this.

## Do

* Find every place the REST driver materialises a remote body (error and success paths), and how the success path
  already limits size, if it does.
* Read error bodies with a byte limit (stream and stop), so no more than the cap needs is held. Bound success bodies by
  the existing row and size limits rather than reading everything first.
* Keep `RemoteErrorText.cap`'s output byte-identical for bodies under the limit.

## Acceptance criteria

- [ ] A stub server sending a very large error body never makes the driver hold more than a small bounded amount,
  measured with a test.
- [ ] The capped error text is unchanged for ordinary bodies.
- [ ] The success-path behaviour is unchanged, or its new limit is stated and tested.

## Driver context (owner brief, 2026-11-25)

- Red-first test with a stub server sending a very large (and a slow, never-ending) error body, proving the driver holds
  only a small bounded amount (measure bytes read / allocated, not wall time alone).
- Capped error text unchanged for ordinary bodies (GUARD, failable by mutation).
- Success-path behaviour unchanged, or its new limit stated, tested, and escalated in Planning if it changes what a
  user sees.
- HEL-1013 (REST pagination) is queued after this ticket on the same driver; do not start it here.
