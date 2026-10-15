## Why

Frontend unit tests make real HTTP requests. jsdom opens a socket, gets `ECONNREFUSED`, and logs an XHR
`AggregateError`. A baseline run of the full suite on main 519f06d5f (console captured with the default reporter)
logged **342** of them across **22** files -- not just the two in `PanelCard.crossFilter.test.tsx` the ticket names.
They are noise in every CI failure log, and each one is a test whose real behaviour depends on a failed network call.
Nothing stops new ones: HEL-1353 fixed one file the same way and the class kept growing.

## What Changes

- Mock the unmocked service calls in `PanelCard.crossFilter.test.tsx` (the ticket) and in every other file in the
  baseline inventory that no parked lane owns, at the service-module seam.
- Add a global network guard to the frontend jest setup: an unmocked XHR (or `fetch`) never reaches the network, and
  the test that issued it fails with the method and URL.
- Files owned by parked or concurrent lanes (HEL-1575, HEL-1576, HEL-1578, HEL-1579, plus HEL-1572/1583/1599/1606 which flagged none) are not edited; they sit on an explicit, expiring
  allowlist in the guard. A follow-up ticket drains it once those lanes land.
- Add a `MISTAKES.md` entry: under an AI-agent environment a multi-file jest 30 run hides passing suites' console, so
  "no AggregateError in the log" proves nothing unless the run uses the default reporter.

## Non-goals

- No production code change.
- No change to `httpClient`/axios configuration, and no console filtering or `console.error` suppression.
- No edits to files owned by parked or concurrent lanes beyond the ticket's own file (`PanelCard.crossFilter.test.tsx`,
  which HEL-1599 also edits in a different region).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none -- test-only tooling; `skip_specs: true`)

## Impact

- `frontend/src/test/` (new guard module, `jest.setup.ts` wiring, guard self-test)
- The editable frontend test files the guard flags (14 in the baseline; jest.mock blocks only)
- `MISTAKES.md`
