## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `4f84bcfb1c4da61b77734a21757ede63d46bd4e4` (commits 5fb79639, 4f84bcfb) against the live-resolved base
`0090b1341cce9200b822ad6b393c5646399f6efd` (origin/main).

### Phase 1: Spec Review — FAIL

Verified:
- AC "red-first": I reproduced it with the exact CI command, run from the worktree root:
  `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp`.
  - On main's lockfile (`git show 0090b134:helio-mcp/package-lock.json`, sha256 `a9e0fe21…c4a`) it exits **1**.
    It lists all 9 advisory paths: hono x4 including GHSA-hxh3-vqpv-xpqv, ip-address x4 and fast-uri x1.
  - On HEAD's lockfile it exits **0**.
  - I restored the HEAD lockfile and confirmed its sha256 (`ba3e736f…dac`) matches the committed one. `git status` was
    clean afterwards.
- CI shape: the CI security job has no `npm --prefix helio-mcp ci`, so I reran the test in a scratch directory holding
  only helio-mcp's `package.json`, lockfile and `.audit-ci.jsonc` (no `node_modules`), using the root-pinned
  audit-ci 7.1.0 binary. HEAD's lockfile exits 0. Main's lockfile exits 1 with 9 paths. This confirms the step reads
  helio-mcp's lockfile and needs no install (D4).
- Lockfile-only remediation (D1): the diff touches exactly 3 packages (hono 4.13.2->4.13.13, ip-address 10.5.0->10.7.3,
  fast-uri 3.1.7->3.1.8). Every patched floor is met, and `helio-mcp/package.json` is unchanged.
- Allowlist is empty and justified (D3; no unpatched advisory exists).
- AC "helio-mcp tests pass unchanged": see Phase 2.
- C1 (exact CI command): honoured. Every red/green claim in audit-evidence.md §3/4/8/9 uses the exact command; bare
  `npm audit` appears only as supplementary data or the C3 proxy.
- C2 (sha256 revert proof): honoured. The bump was committed first (5fb79639), and the before/after sha256 match is
  recorded in §9 and independently re-matched by me.
- C3 (Dependabot AC is post-merge only): honoured. The evidence header states `npm audit` 0 is a proxy.
- Scope: no helio-mcp source, backend or frontend changes. ci.yml has 3 additions (header comment,
  cache-dependency-path, step) and all are in scope.

Issue:
- `MISTAKES.md:216` was rewritten by this diff and now asserts something false. It says audit-ci runs "with `"high":
  true` and an empty allowlist in the root and `frontend/` trees". The root `.audit-ci.jsonc` carries the HEL-1246
  path-scoped entry `"GHSA-vfj7-8cjw-p6xm|*micromatch>braces*"`.
  - The design-gate skeptic flagged exactly this stale claim (skeptic-design-1.md, "MISTAKES.md. Lines 214-220 say both
    trees have an empty allowlist ... Task 2.3 fixes it").
  - Task 2.3 is ticked, but the sentence was re-authored with the false claim intact.
  - MISTAKES.md is a binding canonical doc that agents read before trusting a green check. A wrong statement about which
    advisories are suppressed is the kind of trap the file exists to prevent.

### Phase 2: Code Review — PASS

Gates were re-run by me in WORKTREE_PATH at `nice -n 19`. None of the changed files match `frontend/**` or `backend/**`,
so the frontend and backend gate sets do not trigger. I ran the gates that apply to this change:
- `npx jest helio-mcp/src --maxWorkers=2`: 36 suites / 353 tests passed, exit 0. `npm ls` confirms the installed tree
  is the bumped one (hono 4.13.13, ip-address 10.7.3, fast-uri 3.1.8).
- `npm run check:helio-mcp-types`: exit 0.
- `npm --prefix helio-mcp run build`: exit 0 (dist is gitignored).
- `prettier --check MISTAKES.md .github/workflows/ci.yml helio-mcp/.audit-ci.jsonc`: clean.
- The exact CI audit command: green on HEAD, red on main (Phase 1).

Code quality:
- The `.audit-ci.jsonc` header comment is accurate and mirrors the HEL-1246 allowlist convention.
- The CI step uses the root-pinned binary (no floating npx download).
- The cache path was added.
- No dead code, no over-engineering.

**Executor claim verified: the `npm run verify` failure is pre-existing drift, independent of this bump. It is a
spinoff, not a blocker for this ticket.**
- Static check: `helio-mcp/src/tools/pipelines.ts` registers `create_pipeline` with
  `inputSchema.roots: z.array(createPipelineRootSchema).min(1)`, which is required and has no default. The call in
  `helio-mcp/scripts/verify.ts:215-239` sends `source: {...}` and no `roots`.
  - verify.ts was last touched in e8bb4396 (HEL-907, #507), and `git merge-base --is-ancestor` confirms that predates
    4b953460 (HEL-913 multi-root, #543).
  - This diff touches neither file, and it does not change zod (only 3 lockfile packages changed).
- Fresh dynamic probe:
  - I ran a scratchpad stdio client against the worktree's built `helio-mcp/dist/index.js`, pointed at a dead backend
    address (`http://127.0.0.1:9`) with a dummy `helio_pat_` token.
  - `tools/list` returned 75 tools.
  - `create_pipeline` with verify.ts's argument shape was rejected with `MCP error -32602: Input validation error ...
    path ["roots"] "Required"`.
  - The rejection comes from the tool's own input-schema validation, before any network call, so neither the backend
    nor the hono/ip-address/fast-uri versions are involved.
  - No PAT was created and no servers were started. The probe's child process exited with the client (no leftover
    process).
- Spinoff suggestion: update `helio-mcp/scripts/verify.ts`'s `add_outputs_from_shape` setup to send
  `roots: [{ type: "static", ... }]`.

### Phase 3: UI Review — N/A

No changed file matches `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**` or
`openspec/specs/**`. The spec delta lives under `openspec/changes/`.

### Overall: FAIL

### Change Requests

1. `MISTAKES.md:216-218` — correct the false "empty allowlist in the root and `frontend/` trees" claim. Suggested
   wording: "`audit-ci` runs with `"high": true` in the root and `frontend/` trees (root carries one path-scoped,
   review-dated HEL-1246 allowlist entry; `frontend/`'s allowlist is empty), and with `"moderate": true` and an empty
   allowlist in `helio-mcp/` ...". Keep the rest of the entry as is. Re-run
   `npx prettier --check MISTAKES.md` afterwards.

### Non-blocking Suggestions

- File the verify.ts `roots[]` drift as a follow-up ticket (Follow-up label, relatedTo HEL-1204), so `npm run verify`
  is green again. Evidence for it is in Phase 2 above.
- `.github/dependabot.yml` has no helio-mcp entry. This is out of scope here (it is a proposal non-goal); it is noted
  only so the post-merge Dependabot-0 check (C3) knows that alerts there come from GitHub's default dependency graph,
  not a configured update job.
