# HEL-956: Widen check:no-credential-leak beyond the frontend assistant surface (it scans zero files of helio-mcp/**)

## Description

`check:no-credential-leak` runs on every commit via Husky and reports green. On HEL-886 — a change whose *entire premise* is credential containment on the MCP surface — it scanned **zero files of the diff**. Its file set targets the frontend assistant surface only (13 assistant-surface files + 3 fixture files under `backend/src/test/resources` = the `16 files scanned` it prints).

That is worse than no gate. A green tick on a credential-containment change reads as coverage and invites exactly the false confidence the gate exists to prevent. HEL-886's real credential guarantees ended up proven by hand-written unit tests and a cold reviewer probing the live MCP SDK; the gate contributed nothing while appearing to.

`helio-mcp/**` holds a client that talks to production with a PAT, and is currently unscanned.

## What to do

* Widen the scan to `helio-mcp/**` at minimum — that is the surface where an agent-facing credential leak would actually occur, and it is currently unscanned.
* Audit which other paths the gate believes it covers versus what it actually globs. Assume the file set has drifted elsewhere too rather than that this was the only gap.
* Consider failing loudly when the gate matches zero files of a surface it claims to cover, so "scanned nothing" can never again be indistinguishable from "found nothing". This is the substantive half of the ticket — widening one glob fixes one instance; making a vacuous run visible fixes the class.

## Acceptance criteria

- [ ] `check:no-credential-leak` scans `helio-mcp/**`.
- [ ] The gate's actual scan-root set is documented in the script and matches its stated purpose.
- [ ] A run that scans zero files of a surface the gate claims to cover is distinguishable from a run that scanned files and found nothing — the gate fails loudly rather than printing OK.
- [ ] Verified by measurement, in the self-test (`check-no-credential-in-agent-surface.selftest.mjs`): plant a credential-shaped string under `helio-mcp/**`, prove the gate exits non-zero, remove it, prove it exits zero. A widened glob with no self-test case proving the new coverage does not satisfy this criterion.
- [ ] False-positive policy for the newly-covered surface is decided deliberately and stated: individually allowlisted values vs. a convention a future author can follow without editing the gate. Prefer the convention.
- [ ] The scan count before and after (`16 files scanned` -> N) is reported in the PR description.

## Constraints

- Do NOT use Playwright or run e2e specs (HEL-972 holds the browser).
- Do NOT add a database migration (shared dev Postgres).
- Never commit a real credential, including in a self-test fixture — use obviously-synthetic values, as the existing cases do.
- No production database or deploy access.
