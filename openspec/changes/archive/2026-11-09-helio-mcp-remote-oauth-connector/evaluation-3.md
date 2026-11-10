## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: `f04ee19f6568e7b6ef5d8711f474233595bf808b`. The delta since my cycle-2 PASS (`e2bcf6b8c`) is:

- the squash `85a7e045d`;
- the archive `9c528a84e`;
- the gate-chain checklist `443435575`;
- the CredentialSurface allow-list `e55f92652`;
- the fold-in `efcb2d1d5` and `f04ee19f6`.

The diff base was resolved live: `afca73bc8ac9bf039937b2d21fcef459573a3650` (origin/main).

### Fresh gate evidence (evaluator-run in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| `npm run lint` / `npm run format:check` | exit 0 / exit 0 |
| `npm test` (root + frontend jest, 2 workers, `nice -n 19`) | root 65/65 suites, 570/570 tests; frontend 764/764 suites, 9402/9402 tests; exit 0 |
| `npm --prefix frontend run build` | exit 0; the PWA precache has 51 entries, matching the executor's probe figure |
| `cd backend && sbt testFull` (`-Xmx3g`) | 9433 tests succeeded, 0 failed, 5 canceled; 678 suites; "All tests passed". This includes `CredentialSurfaceEnumerationSpec` "should match exactly the nineteen allow-listed files" |
| `sbt "export Runtime/fullClasspath"` | resolves exactly one `guava-33.7.2-android.jar` and one `snappy-java-1.1.10.9.jar` |
| `npx audit-ci --config .audit-ci.jsonc` in root, `frontend/` and `helio-mcp/` | all three: "Passed npm security audit" |
| `check:helio-mcp-types`, helio-mcp build, `check:openspec`, `check:spec-structure`, `check:dependabot`, `check:tokens`, `check:no-credential-leak`, `check:e2e-types`, `check:repo-integrity`, `check:precommit-ci-parity`, `check:ci-complete-needs`, `check:cloud-run-cpu` and its selftest | all exit 0 / OK |
| `test-gate-in-isolation.sh` for `check-cloud-run-cpu.mjs`, `check-cloud-run-cpu.selftest.mjs` and `check-dependabot-groups.mjs` | PASS ×3 |
| `helio-mcp/e2e/oauthConnector.ts` (re-run, zod 4 build) | 25/25 PASS. Cleanup: one PAT 204, the other 404 because the test had already revoked it |
| `helio-mcp/e2e/connectMcpBrowser.ts` (re-run, real browser) | 12/12 PASS. Cleanup: the connector PAT revoked with 204 |

- Every PAT my probes minted was revoked by the scripts. The transcripts have zero `helio_pat_` / `Bearer ` / `v1.` hits.
- The servers were started with `start-servers.sh`, and `assert-phase servers` printed PASS. Both processes' cwd is
  this worktree, and the served `env.ts` carries `VITE_MCP_ORIGIN`. They were stopped with `stop-servers.sh`.

### Verification of the specific asks

**Zod 4 changes to the advertised schemas (acceptable for MCP clients).** I compared the schemas myself rather than
relying on the executor's diff:
- I dumped `listTools()` from the zod-3 tree (`e2bcf6b8c`, `zod@3.25.76`, fresh `npm ci`) and from this branch
  (`zod@4.6.7`), each through its own SDK copy over an in-memory client: 76 tools each.
- I resolved `$ref`s, sorted keys, and dropped only the three documented categories: `additionalProperties:false`,
  `propertyNames`, and the ±9007199254740991 integer bounds.
- The result is **0 residual differences** and **0 changes to any tool's top-level `required` set**.
- Counts match the evidence: `additionalProperties:false` sites go 114 → 7 (only the `strict` ones remain), 41
  `propertyNames` sites were added, and 52 safe-integer bounds were added.

Why each change is acceptable:
- Dropping `additionalProperties:false` from non-strict objects only makes the advertisement match the runtime: zod
  strips unknown keys under both majors. A live probe confirmed it: `list_dashboards` with an extra key reached the
  handler under both zod 3 and zod 4.
- `propertyNames: {type: "string"}` is redundant for JSON object keys.
- The safe-integer bounds only exclude integers that cannot round-trip through JSON anyway.

None of these loosens a required field or changes a type. Evidence discrepancy: the executor reports 121 tools,
while both trees list 76 via `createServer`. The categories and counts otherwise match.

**The overrides are exactly the scoped, approved set.**
- Root `package.json` adds `@jest/reporters`, `jest-config` and `jest-runtime` → `{glob: ^14.0.2}`, and
  `@typescript-eslint/typescript-estree` → `{minimatch: ^11.0.1}`.
- `frontend/package.json` adds the same four plus `workbox-build` → `{glob: ^14.0.2}`.
- The pre-existing overrides are untouched. This matches design D10 word for word.
- `npm ls` shows glob 14.0.4 and minimatch 11.0.5 only under those parents. The unrelated glob@7 and minimatch@3
  consumers are unchanged.

**No CI timeout changed.** Across `.github` the diff touches only the three `runs-on` lines (ci.yml `e2e` and
`e2e-prod-build`, e2e-slow.yml), each commented, plus cycle 1's `cd-frontend.yml` env line. No `timeout` line
changed.

**No advisory allow-listed.** No `.audit-ci.jsonc` or other suppression file changed vs base. The root audit's
"micromatch>braces" note refers to a pre-existing entry.

**PR #1094 is untouched and merges cleanly.** `gh pr view 1094`: head `bac6e757d`, OPEN. A
`git merge-tree --write-tree HEAD bac6e757d` came back clean (exit 0), so the two PRs merge in either order. This
branch touches none of #1094's hunks (`e2e-setup/action.yml`, selftest list, `paths`, root `scripts`).

**CPU guard: proven failable.**
- `checkMcpDeployScript` rejects `--no-cpu-throttling`, whether injected before `--allow-unauthenticated` or after
  the `"$@"` line (my in-memory mutations).
- It passes the real `infra/deploy-mcp.sh`.
- The selftest covers present, absent, comment-only, file missing, no deploy and backend-unchanged.

**Delivery commits are sound.**
- The squash tree equals the cycle-2 tree, apart from one `files-modified.md` line.
- The five new CredentialSurface allow-list entries are accurate. I grepped each file: every match is the CORS
  `credentials` option/header or prose. `grep -rli credential helio-mcp/src` gives 19 files, matching the spec's
  "nineteen", which passed in `sbt testFull`.

**C4 (stdio unchanged) holds.** No pre-existing helio-mcp test file or `index.ts` changed vs base. The zod 4
migration edited no tests.

### Phase 1: Spec Review — PASS
Issues: none blocking.
- The fold-in ACs (ticket "Added scope", D10, tasks section 8) are met as verified above. Task 8.7 (the
  PR/HEL-1700 comments) is correctly left to Delivery.
- C1-C6 are honoured. The `backend/build.sbt` pins are owner-ruled fold-in scope under C6.

### Phase 2: Code Review — PASS
Issues: none blocking.

### Phase 3: UI Review — PASS
- No `frontend/src` file changed since cycle 2. The fold-in's frontend changes are dev/build-dependency overrides
  only, and the frontend build and precache are unchanged.
- The real-browser consent flow re-ran green on this build: password+MFA return-to, Allow and Deny, in both themes.
- The cycle-1 UI checks (error states, console, keyboard, breakpoints) apply to an identical source tree.

### Overall: PASS

### Non-blocking Suggestions
- **Zod 4 error-text change at `helio-mcp/src/tools/restDataSourceSchema.ts:54-58`.** The `required_error` →
  `error` translation is not exactly equivalent:
  - Under zod 4 `error` applies to every issue on that schema, not only a missing value.
  - Live probe: `create_rest_data_source` with `connectorId: 5` now answers "connectorId is required — call
    list_connectors…". Under zod 3 it answered "Expected string, received number at connectorId".
  - Acceptance and the error envelope are unchanged. But this is the repo's own message applied to a new case, not
    zod-owned wording, and it misleads an agent that sent the wrong type.
  - The exact zod-4 equivalent is
    `error: (iss) => (iss.input === undefined ? "<same message>" : undefined)`.
  - The evidence's "required_error->error (fixed)" overstates equivalence.
- **Archive hazard.** The canonical `openspec/specs/mcp-*` specs were already synced by the first archive, and the
  un-archived change dir still holds the same ADDED deltas (equal requirement counts). On re-archive, skip the spec
  sync, or confirm it does not try to re-ADD existing requirements.
- **Tool-count discrepancy.** Correct the 121 tool count in `evidence/zod4-inputschema-diff.txt` to match the 76
  that `createServer` lists, or state what was counted.
