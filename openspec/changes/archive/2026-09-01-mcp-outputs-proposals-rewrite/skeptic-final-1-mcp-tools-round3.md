## Skeptic Report — final gate (round 3, skeptic-final-1-mcp-tools-round3.md)

Dimension: MCP tool surface + removals. Cold re-derivation from ground truth at
commit `179aedab`.

### Part A — the assigned `outputDataTypeId` sweep: GENUINELY EXHAUSTED

1. **Real wire shape read directly.** `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala:44-54` —
   `PipelineSummaryResponse` has exactly nine fields: `id, name, sourceDataSourceId,
   sourceDataSourceName, lastRunStatus, lastRunAt, lastRunRowCount, ownerId, tag`.
   Line 215 confirms `jsonFormat9`. No `outputDataTypeId`. Confirmed independently,
   not from any report.
2. **Full-repo grep.** `grep -rn outputDataTypeId helio-mcp/` (excluding
   node_modules/dist) returns 8 hits — **all 8 are comments documenting the removal**
   (context.ts:339, context.test.ts:178, runPipelineTruncation.test.ts:16,
   types.ts:250/370/770, helioApi.ts:94/95). Zero live references. The remaining
   repo-wide hits are all backend, where the name legitimately still exists
   (`WorkspaceContextProtocol.scala:126` is a real field of a different type).
3. **`types.ts` matches Scala exactly.** `PipelineSummaryResponse` (types.ts:252-265)
   lists the same nine fields, no extras.
4. **`helioApi.ts` mapping is clean.** `runPipeline` (helioApi.ts:541+) reads only
   `summary.lastRunStatus` plus real `RunResultResponse` fields; `RunOutcome` has
   7 fields, none dead.
5. **`write.ts` promise matches reality.** `write.ts:314-316`'s Returns enumeration
   `{ pipelineId, status, rowCount, sourceRowCount, truncated, availableRowCount,
   truncationNotice }` is exactly `RunOutcome`. No over-promise.
6. **New fixture is correctly typed, not just typed.** `runPipelineTruncation.test.ts:24-34`
   declares `const fakeSummary: PipelineSummaryResponse` with all nine real fields
   and correct value types. Excess-property checking now makes future drift a
   typecheck failure.
7. **Gates re-run by me:** `npx tsc --noEmit -p tsconfig.json` → exit 0;
   `npm run typecheck` (`tsconfig.typecheck.json`) → exit 0.

On the assigned dimension this is the real thing — the class is exhausted. If the
finding below were not present, this would be a CONFIRM.

### Part B — NEW blocking finding (in-dimension, found during the sweep)

**`helio-mcp/src/server.test.ts` — the change's flagship tool-surface test — will
fail to compile in CI, running ZERO of its 4 tests.**

Probe-confirmed root cause, compiler-level, independent of jest:

```
npx tsc --noEmit --target ES2022 --module commonjs --moduleResolution node \
  --strict --esModuleInterop --skipLibCheck helio-mcp/src/tools/read.ts
  -> 2x TS2589 "Type instantiation is excessively deep and possibly infinite"
     (read.ts:36 list_dashboards, read.ts:65 list_data_sources registerTool calls)

same file with --module nodenext --moduleResolution nodenext  ->  0 errors
```

Why this reaches CI:
- `.github/workflows/ci.yml:34` runs `npm test` at the repo root; root
  `package.json:26` = `jest --passWithNoTests && npm --prefix frontend test`.
- Root `jest.config.cjs` is `preset: ts-jest` with no `tsconfig` override, so
  ts-jest uses the **root** `tsconfig.json` — `module: commonjs`,
  `moduleResolution: node`. That is the failing configuration above.
- On a normal (non-worktree) CI checkout, `helio-mcp/src/**` tests ARE collected:
  verified on the main checkout, `npx jest --listTests | grep -c helio-mcp/src` → **14**.
  They pass today because **no existing test imports `tools/read.ts`**
  (`grep -rln "tools/read|registerReadTools|createServer" helio-mcp/src --include=*.test.ts`
  on main → no matches). `server.test.ts` is new in this change and is the first to
  import `./server.js` → `read.ts`, so it is the first to trip TS2589.

Reproduced and stable (3 independent runs), and I confirmed my measurement was not
the unstable thing:
- Root config, `server.test.ts`: **FAIL, "Test suite failed to run", Tests: 0 total** (3/3 runs).
- Executor's own scoped command (`cd helio-mcp && npx jest --rootDir . --config ...`,
  which picks up helio-mcp's NodeNext `tsconfig.json`): **PASS, 4/4 tests**.
- TypeScript version identical in both trees (5.9.3), so this is config-driven,
  not a version artifact.

This is exactly why every prior round recorded `server.test.ts` as green:
`tasks.md` 5.9 mandates the scoped NodeNext command *because* root `npm test` finds
zero tests **inside a worktree**. That reasoning is correct for the worktree but
does not hold for CI, where the worktree exclusion does not apply and the root
commonjs config is what compiles the file. The result is a third instance of this
ticket's recurring "evidence-shaped non-evidence" pattern: the one test that pins
the entire tool surface (removed-tool absence, replacement presence, no duplicates,
the exact 60-name set) is green only under a config CI never uses, and contributes
zero verification post-merge.

### Verdict: REFUTE

### Change Requests

1. **Make `helio-mcp/src/server.test.ts` compile under the root jest config** (the
   one CI's `npm test` uses). Root cause is `TS2589` from cumulative
   `registerTool` generic-instantiation depth in `helio-mcp/src/tools/read.ts`
   (lines 36 and 65) under `module: commonjs` / `moduleResolution: node`.
   Any of these closes it, but the fix must be verified with the root config,
   not the scoped one:
   - give root `jest.config.cjs` a ts-jest `tsconfig` override for
     `helio-mcp/**` that uses NodeNext resolution (most faithful — it makes the
     tests compile the same way the package actually builds); or
   - annotate/widen the offending `registerTool` call sites in `read.ts` to cut
     the instantiation depth; or
   - add a `helio-mcp`-local jest project/config that CI invokes explicitly, and
     exclude `helio-mcp` from the root run — so the suite runs in CI under a
     config that works.

2. **Prove the fix with the CI-shaped command, and record that output**, e.g.
   from a non-worktree checkout `npx jest --testPathPatterns "helio-mcp/src"`,
   showing `server.test.ts` PASS with **4 tests actually executed** (not
   "1 passed, 0 total"). A suite that runs zero tests must be treated as a
   failure, not a pass.

3. **Replace the `tasks.md` 5.9 scoped command as the sole helio-mcp test
   evidence.** As written it is a worktree workaround that silently diverges
   from CI's compilation settings, which is what let this defect through four
   review rounds. It should either be paired with a CI-shaped run, or the
   underlying config divergence removed so one command is authoritative.

### Non-blocking notes

- `helio-mcp/src/types.ts:372-386` `PipelineAnalyzeResponse` omits
  `sourceSchemaDrift`, which DOES exist on the Scala
  `PipelineAnalyzeResponse` (`PipelineAnalyzeProtocol.scala:183-190`, `jsonFormat6`).
  This is an under-specification, not a dead field (the inverse of the CR class
  just fixed), and `analyze_pipeline` passes server JSON through verbatim, so no
  agent-visible defect. Worth closing for symmetry with the round-2 CR5 comment
  that claims this interface now mirrors the case class.
