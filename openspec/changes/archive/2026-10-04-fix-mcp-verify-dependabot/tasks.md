## Standing Constraints

- [C1] No backend change and no migration; a backend bug revealed by verify is escalated, never fixed in this run.
- [C2] Never build into, write to, or install through the main checkout (its helio-mcp/dist and the linked helio-mcp/node_modules); build in this worktree only.
- [C3] Shared dev DB and tokens: every fixture and minted PAT removed by exact id; scratch files removed by exact path; nothing written under ~ outside the repo; no global installs.
- [C4] Live proof only counts against a backend whose process cwd (readlink /proc/<pid>/cwd) is this worktree's backend dir, on this worktree's ports.

## 1. Harness (helio-mcp/scripts)

- [x] 1.1 Create `scripts/verifyPayloads.ts` with one pure builder per verify write call (create_pipeline on `roots[]`, the three add_outputs_from_shape calls); verify `npm run typecheck` (helio-mcp) passes
- [x] 1.2 Rewire `verify.ts` to the builders; re-check each payload against the tool's zod inputSchema in `src/tools/`
- [x] 1.3 Add PAT mint (POST /api/tokens, shape from backend `CreateApiTokenRequest`) and spawn the server with the minted token; revoke by exact id in `finally`, then confirm 401
- [x] 1.4 Add the exact-id fixture ledger + `finally` teardown (pipeline, then sources, PAT last), each confirmed by 404; teardown failure exits non-zero
- [x] 1.5 Update `helio-mcp/README.md` Verifying + layout sections (D6)

## 2. Dependabot

- [x] 2.1 Add the `/helio-mcp` npm entry with `mcp-sdk` group before `dev-dependencies` in `.github/dependabot.yml`
- [x] 2.2 In `scripts/check-dependabot-groups.mjs`: declare the `mcp-sdk` family; derive `main()`'s manifest directories from the config's npm entries (not the `["/", "/frontend"]` literal); verify `check:dependabot` + `check:dependabot:selftest` pass

### Tests

- [x] 3.1 Add `helio-mcp/scripts/verifyPayloads.test.ts` drift guard (D2); verify it is collected and green via the root jest config
- [x] 3.2 Mutation proof: `roots`→`source` in the builder turns the guard red with the zod message; drop a builder from the tool-name set check turns it red; record both transcripts
- [x] 3.3 Dependabot guard mutations, transcripts recorded, both reverted: (a) drop `zod` from `mcp-sdk` → red; (b) scratch prod dep in helio-mcp/package.json in no family/independent → red naming it
- [x] 3.4 Build in the worktree (`npm run build` in helio-mcp, never touching the main checkout's dist); start the backend from THIS worktree on its own port, confirm `readlink /proc/<pid>/cwd`
- [x] 3.5 RED: run verify with the pre-fix payload against that backend, record `roots: Required`; GREEN: run fixed verify end-to-end, record VERIFY OK + teardown confirmations + revoked token id
- [x] 3.6 Residue check: query the DB for the run's tagged names / minted token id and record zero remaining
