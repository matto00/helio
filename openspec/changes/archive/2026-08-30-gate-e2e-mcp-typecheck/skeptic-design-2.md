## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **CR1 (helio-mcp/scripts/*.ts coverage) — ADDRESSED.** `git ls-files helio-mcp`
  confirms the three tracked files (`scripts/verify.ts`, `scripts/compose.ts`,
  `scripts/verify-bound-panel.ts`, 647 lines total). design.md now carries an
  explicit **D1b** decision: a typecheck-only `helio-mcp/tsconfig.typecheck.json`
  that `extends: "./tsconfig.json"`, overrides `rootDir: "."` and
  `include: ["src/**/*.ts", "scripts/**/*.ts"]`, with `noEmit: true`, leaving the
  build config untouched. I verified the rejected alternative is correctly
  reasoned: `cat helio-mcp/tsconfig.json` shows `rootDir: "src"` / `outDir: "dist"`
  and `package.json` shows `bin: {"helio-mcp": "dist/index.js"}` — widening
  `rootDir` in the build config really would move the bin entry to
  `dist/src/index.js`. D1b's rationale is factually correct, not hand-waved.
  Tasks 2.1 (create config + repoint the `typecheck` script), 2.2 (run it, fix
  real errors) and 4.2 (mutation proof *specifically in `scripts/`* to confirm the
  broadened include actually gates) all exist and are concrete. proposal.md's
  formerly-false "last two surfaces" framing is corrected to name `src/` and
  `scripts/` explicitly.
  - Scope sanity check on the new coverage: the three scripts import only
    `@modelcontextprotocol/sdk/client/*.js` and `node:` builtins — no relative
    imports into `src/`, so the usual NodeNext extension-rewrite landmine does not
    apply. Task 2.2's "fix any real errors" is a small, bounded surface.

- **CR2 (CI npm cache key) — ADDRESSED.** `.github/workflows/ci.yml` `frontend`
  job's `setup-node` still lists only `package-lock.json` / `frontend/package-lock.json`
  under `cache-dependency-path` (lines 17-22), and `helio-mcp/package-lock.json`
  is tracked. **D3** now explicitly requires adding it, and task 3.3 names it in
  the same task as the new `npm --prefix helio-mcp ci` step. Correctly wired.

- **Re-verified round-1 conclusions independently (not carried over on trust):**
  `.husky/pre-commit` is the flat `check:*`-plus-`typecheck` list D2/D4 claim it is
  (and the `selftest:concertino-git-env` naming carve-out at the bottom is
  respected by using the `check:` prefix for both new scripts); root `package.json`
  lines 13-22 confirm the `check:*` naming convention D4 follows; the `frontend`
  CI job has no Java/DB/server provisioning, so D3's placement there rather than
  the `e2e` job is the cheap and correct choice.

- **Acceptance criteria traced:** AC1 → tasks 2.1/2.2 + 3.1/3.2/3.3; AC2 → tasks
  1.1/1.2 + 3.1/3.2/3.3; AC3 (red-before-green for *each* gate) → tasks 4.1/4.2
  with an explicit mutate/observe/revert/observe procedure each. No AC uncovered.

- **Scope discipline:** root-`tsconfig.json` repair remains a stated non-goal in
  both proposal and design, matching the ticket; no product surface touched;
  `skip_specs: true` is justified (pure tooling wiring, zero spec behavior).

- **Placeholder/contradiction sweep:** no `TODO`/`TBD`/deferred decisions in any
  of the three artifacts; design D1b/D3 and tasks 2.1/3.3 agree with each other
  and with proposal.md's "What Changes" list.

### Verdict: CONFIRM

Both round-1 change requests are genuinely closed against ground truth, not merely
asserted. The plan is specific enough to implement without further decisions.

### Non-blocking notes

- D1 still leaves `module`/`moduleResolution` unpinned for `e2e/tsconfig.json`
  (carried from round 1). Root `package.json` is `"type": "commonjs"` while the
  specs and `playwright.config.ts` use ESM syntax, so the executor should expect to
  settle on explicit values rather than defaults. It iterates to green; low risk.
- `CLAUDE.md`'s "Pre-commit hooks" paragraph enumerates what Husky runs. Adding two
  checks makes that list stale, and `check:helio-mcp-types` introduces a new local
  setup precondition (`npm --prefix helio-mcp install`) that is currently documented
  nowhere. A one-line doc touch would be cheap; not blocking.
- Task 4.3 ("run the full pre-commit chain") will be the first thing to hit a
  missing `helio-mcp/node_modules` — absent in this worktree right now. design.md's
  Gate-Chain checklist predicts this fail-loud behavior correctly and declines to
  auto-install in the hook, which is the right call.
