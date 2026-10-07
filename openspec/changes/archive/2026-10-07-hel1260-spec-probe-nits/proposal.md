## Why

Two diagnosability nits left by HEL-1289. The hel1260 e2e asserts the repair URL via `.endsWith(...)` wrapped in
`toBe(true)`, so a failure prints only `expected true, received false`. The archived trace probe classifies tests by a
substring (`'survives'`) of Playwright's truncated output-folder slug, which silently misclassifies if a title or the slug
truncation changes.

## What Changes

- `e2e/hel1260-orphan-owner-repair.spec.ts`: replace the `.endsWith(...)`/`toBe(true)` assertion with
  `expect(repairPosts[0].url).toMatch(<end-anchored regex>)`. Same accepted set, diagnosable failure. Nothing else.
- `openspec/changes/archive/2026-10-05-isolate-orphan-repair-e2e-seeding/probe-check-isolation.py`: classify each trace
  by the test title recorded in the trace itself; fail loudly when the title is missing; header comment states the probe
  is archival and what it keys on.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — test-assertion wording and an archival probe script; no product behavior changes (`skip_specs: true`).

## Impact

One e2e spec line, one archived Python probe. No product code, schemas, or CI wiring.

## Non-goals

- Changing what the hel1260 spec tests or how it seeds/waits.
- The second `endsWith("/layout/repair")` on the UI-create test's request filter (a listener predicate, not an
  assertion; its failure output is already the array of URLs via `toHaveLength(0)`).
- Wiring the probe into CI or any gate.
