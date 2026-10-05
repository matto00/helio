## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `26b5888a58f9d31cc868c005839500922b261ee0`. The base was resolved live with
`resolve-review-base.sh` and came back as `0090b1341cce9200b822ad6b393c5646399f6efd`. The diff
touches `.github/workflows/ci.yml`, `MISTAKES.md`, `helio-mcp/.audit-ci.jsonc`,
`helio-mcp/package-lock.json` and openspec artifacts. It has no UI changes, so I skipped design
review (step 4).

### What I verified (with evidence)

**The CI step goes red on a vulnerable lockfile in CI's actual environment.** I ran this myself
in a fresh `git archive HEAD` extraction under my scratchpad, not in the worktree. I ran only a
root `npm ci` there and confirmed that `helio-mcp/node_modules` did not exist. Then I ran the
exact CI command from the repo root,
`npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp`:
- With the HEAD lockfile (sha256 `ba3e736f…`) it exits **0**. The dependency counts are
  prod 94, dev 32 and total 125, which is helio-mcp's tree, not the root's 623 packages. So
  `--directory` really does point the audit at helio-mcp.
- With the base lockfile swapped in (`git show 0090b134:helio-mcp/package-lock.json`) it exits
  **1**. It lists 9 advisories: 4 hono, 4 ip-address and 1 fast-uri, with the message
  "Failed security audit due to moderate vulnerabilities."
- Config-read control: the same base lockfile with a copy of the config set to `"high": true`
  exits **0**. So the `--config helio-mcp/.audit-ci.jsonc` path is actually loaded, and the
  `moderate` level is what makes the gate go red.
- I made all of these changes to the scratch copy and restored it afterwards. The worktree
  lockfile still matches `git show HEAD:` byte-for-byte (sha256 `ba3e736f…`), and `git status`
  shows only the two untracked evaluation-*.md files.

**AC1, red-first then green:** met. This is my own reproduction above, and it agrees with
audit-evidence.md sections 3, 8 and 9.

**AC2, Dependabot shows 0 alerts after merge:** honestly scoped as a post-merge check (C3), and
strongly predicted. `gh api repos/matto00/helio/dependabot/alerts?state=open` returns 9 open
alerts, numbers 115–123. All 9 are in `helio-mcp/package-lock.json`, and the ticket's 8 plus
#123 hono GHSA-hxh3 account for all of them. The patched versions required are: hono 4.13.7
(highest), ip-address 10.7.1 and fast-uri 3.1.8. The lockfile now has hono 4.13.13, ip-address
10.7.3 and fast-uri 3.1.8, so every alert's first patched version is satisfied.

**AC3, helio-mcp tests pass unchanged:** met. No test files are in the diff. In the scratch
copy, after running `npm ci` in helio-mcp (which installed hono 4.13.13), I ran
`npx jest helio-mcp/src --maxWorkers=2` and got 36/36 suites and 353/353 tests passing.
`npm run typecheck` exits 0 and `tsc` build exits 0.

**The change is lockfile-only and the tree is valid:** `helio-mcp/package.json` has no diff. The
lockfile diff touches exactly 3 packages. `npm ls --all` exits 0, so nothing is invalid or
unmet. Parents: hono comes from `@modelcontextprotocol/sdk` directly and via
`@hono/node-server`, ip-address comes via `express-rate-limit`, and fast-uri comes via `ajv`
(overridden).

**The evaluator's "roots: Required" ruling holds.** I verified it from source, and it does not
depend on any timing evidence:
- `helio-mcp/scripts/verify.ts:217-220` calls `create_pipeline` with a `source:` argument. That
  file was last changed in e8bb4396 (HEL-907).
- `helio-mcp/src/tools/pipelines.ts:101` declares `roots: z.array(createPipelineRootSchema).min(1)`,
  which has been required since HEL-913.
- "roots: Required" is zod's missing-key message. zod is not part of this lockfile diff, and
  neither file is touched by it.

So the failure is deterministic source drift that predates this change, and it is not caused by
the dependency bump.

**Driver additions are met:**
- A fresh `npm audit` was taken.
- Every advisory now resolves to a real patched version, and the allowlist is empty with that
  justified.
- The red-gate was proven by reintroducing a vulnerable version, which I reproduced
  independently.
- The full test suite was run.
- The `verify` failure is documented as pre-existing.

**The documentation claims are true:**
- MISTAKES.md says the root allowlist carries the HEL-1246 path-scoped braces entry. It does
  (`.audit-ci.jsonc`).
- The ci.yml comment says the root-pinned audit-ci is used via `--directory`. That is confirmed
  by the behaviour above.

**Hygiene:** `prettier --check` passes on the changed files, and `npm run check:openspec`
reports "openspec/ is clean".

### Verdict: CONFIRM

### Non-blocking notes
- The pre-existing `verify.ts` drift (it sends `source` while `create_pipeline` now requires
  `roots[]`) should be filed as a follow-up ticket, not just recorded as a spinoff candidate.
  Until then, `npm run verify` cannot be used as a smoke gate for helio-mcp.
- The CI step relies on `npx` resolving `audit-ci` from the root `node_modules`. That works
  because root `npm ci` runs first in the same job. Reordering those steps would break the
  audit step loudly, not silently.
