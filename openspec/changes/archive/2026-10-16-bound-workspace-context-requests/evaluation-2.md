## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `6979861a0d9ced5fdf8f7d11c0efe124d31a7fb6`. Diff base, resolved live: `db91c840ea729c1b3f662ae1eb01643ac1739e2d`. Cycle-2 delta against 210bed286 touches only `helio-mcp/scripts/contextDetailsLiveProbe.ts`, `helio-mcp/src/types.ts`, measurements.md, files-modified.md and evaluation-1.md.

### Phase 1: Spec Review — PASS
Issues: none.

- Cycle 1's Phase 1 findings stand. The delta changes no runtime behavior.
- C1-C6 are still honored:
  - The new code is untouched since cycle 1, so the cycle-1 golden regeneration still applies.
  - Backend and schema are unchanged.
- **C5:** this cycle's probe-related work stayed in the isolated DB. See the shared-DB verification below.

### Phase 2: Code Review — PASS
Gates I re-ran for the delta, in WORKTREE_PATH. All `helio-mcp` files fall under the root jest and lint scope.
- `npm run lint`: exit 0. Targeted `eslint --max-warnings=0` on both changed source files: exit 0.
- `npm run format:check`: clean.
- `helio-mcp` `npm run typecheck`: exit 0. `tsconfig.typecheck.json` includes `scripts/**`, so the probe is type-checked.
- Root jest (`nice -n 19`, `--maxWorkers=2`): 61 suites, 524 tests passed.
- `check:no-credential-leak`: 0 violations. measurements.md cites only the PAT id (a UUID), not the token.
- `sbt testFull` was not re-run: no `backend/**` change in the delta. Cycle 1's run (8156 passed, 0 failed) covers the unchanged backend.

Cycle-1 change requests:
1. **Resolved.** `helio-mcp/src/types.ts:515-525`: the "Per-run pass/fail-by-severity assertion summary" JSDoc again sits directly above `export interface AssertionSummaryResponse`. The two context-details interfaces follow it with their own doc. This was a pure move with no field changes.
2. **Resolved.** `helio-mcp/scripts/contextDetailsLiveProbe.ts:36-173`:
   - Everything after `mintBootstrapPat` runs in `try { ... } finally { revokePat(...) }`.
   - The existing `isolatedAuth.revokePat` DELETEs the token, then confirms it answers 401.
   - A non-null failure sets `process.exitCode = 1`.
   - The executor's recorded fresh run shows `PAT ... revoked and no longer authenticates (HTTP 401)`.

Shared-DB verification (orchestrator request). I ran read-only queries with `PGOPTIONS='-c default_transaction_read_only=on'`:

| query | `helio` (shared) | `helio_hel1619` (isolated) |
| --- | --- | --- |
| users `email like 'hel1619-probe-%'` | 0 | 6 |
| users `email ilike '%hel1619%'` | 0 | 6 |
| `api_tokens` named `%hel1619%` | 0 | 0 |
| `api_tokens` total | 265 (unrelated) | 0 |
| pipelines `name like 'probe pipeline %'` | 0 | 66 |
| data_sources `name = 'probe source'` | 0 | 6 |

- 66 = 4 x 12 + 6 + 12. That is six probe runs (five in cycle 1, one in cycle 2), one user each, which matches the 6 users.
- No probe residue exists in the shared `helio` DB. The claim that no probe run touched it is consistent with the evidence.
- I did not verify the executor's deletion of the old PAT rows independently (I cannot observe the past). The end state matches it: no probe token remains in either DB.

Non-blocking:
- In the probe, `process.stderr.write` is replaced inside the `try` and restored only on the success path. If a build throws mid-probe, stderr stays captured until the process exits. The `finally` should restore it before revoking, so a revocation error written to stderr would not be swallowed. Today that error goes to `console.log` (stdout), so it is still visible. Cosmetic only.
- Cycle 1's non-blocking notes still stand: there is no tie-break key for runs with equal `started_at` or for assertion order (pre-existing, on both paths), and the section divider in `context.ts`.

### Phase 3: UI Review — PASS
- The delta contains no `frontend/**`, `schemas/**`, routes or spec files, so Phase 3 has no trigger this cycle.
- Cycle 1's Phase 3 result (live 401 parity of the new route, app loads without console errors) applies unchanged to the unchanged backend.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `helio-mcp/scripts/contextDetailsLiveProbe.ts`: restore `process.stderr.write` in the `finally`, before revoking.
- A follow-up could add an `id` tie-break to both the per-pipeline and batched latest-run reads, together, and an explicit ORDER BY to both assertion reads.
