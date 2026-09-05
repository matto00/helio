## Why

`check:no-credential-leak` runs on every commit and prints
`OK (16 files scanned: 13 assistant-surface, 3 fixture, 0 violations)`. Those 16 files are
`frontend/src/features/assistant/**` plus `backend/src/test/resources/**`. Nothing else in the repo is scanned —
including `helio-mcp/**`, which holds the MCP client that talks to production with a PAT.

On HEL-886 — a change whose entire premise was credential containment on the MCP surface — the gate scanned zero
files of the diff and reported green. A gate that reports success over code it never examined is worse than no gate:
it manufactures the belief that the code was checked.

## What Changes

- The script's scan roots become an explicit, documented **surface table**: each surface declares its id, its root
  directory, and which of the gate's checks apply to it. The table is the documentation the acceptance criteria ask
  for; there is no second place where coverage is described.
- A new `mcp` surface covers `helio-mcp/**` (excluding `node_modules/` and the build output `dist/`).
- A new **secret-literal check** runs on the `mcp` surface: hardcoded PAT/API-key-shaped strings and
  `*_KEY`/`*_SECRET`/`*_TOKEN`/`*_PASSWORD` literal assignments. The existing bcrypt/email checks also run there.
- **Vacuity becomes a failure.** A declared surface that resolves to zero files fails the gate loudly instead of
  contributing 0 to a green total, so "scanned nothing" is never again indistinguishable from "found nothing".
- **Coverage drift becomes a failure.** Every top-level repo directory must be either inside a declared surface root
  or on an explicit acknowledged-unscanned list with a stated reason. A newly-added top-level directory fails the
  gate until someone decides, deliberately, which it is.
- False positives are handled **by convention, not per-value allowlists**: reserved placeholder domains (adding
  `.test`, RFC 2606, alongside the existing `example.*`/`.invalid`) and a synthetic-secret marker convention a
  future author can follow without editing the gate.
- The self-test gains cases for every new behavior: a planted secret under `helio-mcp/**` (red, then green once
  removed), a zero-file surface (red), and an unacknowledged top-level directory (red).

## Capabilities

### New Capabilities

- `agent-surface-credential-gate`: the commit-time gate's declared scan surfaces, per-surface checks,
  vacuous-run and coverage-drift failure behavior, and its false-positive conventions.

### Modified Capabilities

None.

## Non-goals

- A repo-wide secret scanner. Scanning everything minus exclusions was considered and rejected (see design.md
  Decision 1); the drift guard gives the same "nothing is silently missed" property without the false-positive tax.
- Applying the assistant surface's `credential`-property ban to `helio-mcp`. That surface deliberately declares
  fields named `credential` in order to *reject* them; banning the name there would punish the code doing the right
  thing (design.md Decision 3).
- Any runtime, backend, database, or deployment change. This ticket touches build tooling only.

## Impact

- `scripts/check-no-credential-in-agent-surface.mjs`, `scripts/check-no-credential-in-agent-surface.selftest.mjs`.
- Possible small edits to existing files under the newly-covered surface if the widened scan finds legitimate
  fixtures that the stated conventions require be reworded.
- No production code, API, schema, or migration changes. Pre-commit runtime grows by one small directory walk.
