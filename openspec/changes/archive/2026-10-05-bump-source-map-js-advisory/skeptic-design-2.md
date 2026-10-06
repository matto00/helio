## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `2c49bdba8ffe0df5df65b2c951c0b9bb73173c2b`. The change dir is still untracked, and there is no implementation yet.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/bump-source-map-js-advisory/HEL-1319`.
- **Core facts, re-derived fresh rather than taken from round 1:**
  - **Lockfile entries (jq).**
    - Root lockfile: no `source-map-js` or `proxy-addr` entry.
    - Frontend: exactly `node_modules/source-map-js` 1.2.1. Its only dependent is `node_modules/postcss` 8.5.26.
    - helio-mcp: exactly `node_modules/proxy-addr` 2.0.7. Its only dependent is `node_modules/express` 5.2.1.
  - **Registry.** `npm view` (scratchpad cache) shows that `source-map-js@1.2.2` and `proxy-addr@2.0.8` both exist.
  - **Red baseline.** I reproduced it with the frontend-installed audit-ci:
    - The frontend `audit-ci --config .audit-ci.jsonc` exits 1.
    - The helio-mcp `--config helio-mcp/.audit-ci.jsonc --directory helio-mcp` exits 1, reporting GHSA-jqcg-44mw-7w3h.

#### Round-1 change requests

1. **CR1, false runtime-path claim: FIXED.**
   - proposal.md Impact now says proxy-addr reaches the tree only transitively, via `@modelcontextprotocol/sdk` → `express`. It says helio-mcp uses `StdioServerTransport` only and that proxy-addr is not on its code path.
   - design.md Risks says "no helio-mcp test exercises it". It frames build, typecheck and jest as a regression or install check only.
   - Ground truth agrees:
     - `helio-mcp/src/index.ts:17,37` uses only `StdioServerTransport`.
     - `helio-mcp/package.json` has no `express` dependency.
     - `grep express helio-mcp/src` matches files, but I spot-checked only that the server entrypoint is stdio. The artifacts make no coverage claim, so this does not matter.
2. **CR2, task 1.3 ambiguity: FIXED.**
   - **Task 1.3** now names `npm ci`, `npm run build` and `npm run typecheck` in `helio-mcp/`.
     - Both scripts exist in `helio-mcp/package.json`.
     - The root `check:helio-mcp-types` is `npm --prefix helio-mcp run typecheck` (root package.json:40), so "mirrors CI" holds. CI's frontend job runs it at ci.yml:31.
     - `helio-mcp/dist/` is gitignored (`helio-mcp/.gitignore:2`), so the build output does not breach C1.
   - **Task 1.4** names the root-jest run explicitly: a root `npm ci` with the scratchpad cache, then `npx jest helio-mcp/src`.
     - The root `jest.config.cjs` collects `helio-mcp/src/**/*.test.ts`. Its worktree ignore is anchored to `<rootDir>` (HEL-880), so running it inside the worktree collects that worktree's own tests.
     - Root `node_modules` is ignored via `.git/info/exclude`.
3. **CR3, e2e AC had no task: FIXED.**
   - Task 3.4 requires citing the PR's CI run id with both the `security` and `e2e` jobs green.
   - ci.yml has no path filter on `pull_request`, and `ci-complete` needs `[frontend, backend, security, e2e]` (ci.yml:447-449). The e2e job will therefore actually run on a lockfile-only PR, so the task is satisfiable.

#### Round-1 non-blocking notes

- **Root audit form:** Decision 4 and task 3.2 now use CI's exact `npx audit-ci --config .audit-ci.jsonc` with no `--directory`.
- **Fallback limitation:** Decision 1 now discloses that the hand-edit fallback would not reproduce proxy-addr's `funding` block.
- **Stale back-reference:** Decision 3 and task 2.3 now drop the "see ticket.md Dependencies" reference. The live `frontend/.audit-ci.jsonc` does contain it, and both files contain the stale "npm audit is 0" text.

#### Fresh adversarial pass

- **Placeholders:** no TODO, TBD or deferred decisions.
- **Contradictions:** none between proposal, design and tasks.
- **AC coverage against ticket.md:**

  | AC | Covered by |
  |---|---|
  | source-map-js ≥ 1.2.2 | 2.1 |
  | No churn, with every changed package listed for both lockfiles | 1.1, 2.1 and 3.3, plus the mechanical key-set diff in Decision 2 |
  | Red-then-green for the frontend and helio-mcp audits | 1.2, 2.2 and 3.3, plus CI in 3.4 |
  | Build, lint, typecheck and Jest | 3.1 |
  | e2e | 3.4 |
  | Comments updated, thresholds unchanged | 2.3, with a parse-equality check |
  | ci.yml, playwright.config.ts and source files untouched | C1 |

- **Scope:** HEL-1320's moderates are excluded, which is correct.

### Verdict: CONFIRM

### Non-blocking notes

- After task 1.4's root `npm ci`, the root-pinned audit-ci becomes available. Tasks 1.2 and 3.2 may use it instead of the frontend binary, which is closer to CI. Either choice is acceptable because the version is the same.
- I sampled `npx jest helio-mcp/src` for existence of the tests only, not for runtime. If the root `npm ci` fails in the worktree, record that and fall back to CI's frontend job. That job runs root `npm ci`, though note that root `npm test` is not a CI step. Do not count a skipped suite as green.
