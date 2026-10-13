## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `08906f0d1d6ef2922725e6bc30923ba7d1a17ccd` (executor `ae143e509` + orchestrator `08906f0d1`), diff base
`38ee89f34282da1e05a754d6749046f6f5aa7285` (resolved live via `resolve-review-base.sh main origin`).

### Phase 1: Spec Review — PASS
- AC1 (`Dashboard` type has `layoutVersion`): `helio-mcp/src/types.ts` `DashboardResponse.layoutVersion: number`.
  I confirmed it live: `get_dashboard` returned a numeric `layoutVersion` (seam check, check "D1").
- AC2 (layout writes send `expectedLayoutVersion`): `update_dashboard_layout` requires it (zod
  `z.number().int().min(0)`), `auto_layout_dashboard` takes it as optional, and both forward it in the body
  (`helioApi.ts` `updateDashboardLayout`/`autoLayoutDashboard`). The ticket asks both tools to send it. Making it
  optional on auto-layout is recorded as assumed product call A2 (design D3), and A1 records the breaking required
  input. Neither is silently reinterpreted: both are written down and flagged for OWNER REVIEW in workflow-state.
- AC3 (409 surfaced, never retried blindly): `withLayoutConflict` maps a 409 that has a `dashboard` body to
  `HelioLayoutConflictError` and never re-sends. `layoutConflictResult` renders it with the current dashboard and a
  `nextStep`. A 409 without a `dashboard` body stays verbatim.
- AC4 (tests cover the 409 path): `layoutPreconditionSeam.test.ts` uses a real MCP client and server. It covers the
  409 for both tools with exactly one request, a verbatim 409, and the place_outputs pack 409. It also covers
  required-input rejection with zero requests.
- AC5 (server requires the precondition): explicitly optional and deferred. Correctly out of scope.
- tasks.md: every item is ticked and matches the diff. files-modified.md has the D5 table covering 48 call sites,
  and I spot-checked it against `helioApi.ts`.
- Scope: helio-mcp, README and the change dir only. No backend, frontend or schema change. No scope creep.
- Spec delta: the MODIFIED requirements keep every scenario from the base spec (`openspec/specs/mcp-panel-composition-tools/spec.md`
  lines 167-185, 293-305) and add the new ones. `check:openspec` and `check:spec-structure` are clean.
- CONSTRAINTS in workflow-state.md: `[]`. Nothing to honor.

Issues: none.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH at HEAD `08906f0d1`. The changed files match neither `frontend/**` nor
`backend/**`. I still ran every gate that covers `helio-mcp/**`:
- `npm run lint`: exit 0
- `npm run format:check`: exit 0 ("All matched files use Prettier code style!")
- `npm run check:helio-mcp-types` (tsc over src/, scripts/, e2e/): exit 0
- root `jest` (the half of `npm test` that collects helio-mcp; capped at 3 workers, nice 19): 50 suites and
  468 tests passed, exit 0. I did not run the frontend half of `npm test`, because no frontend file changed.
- `npm run check:openspec` / `check:spec-structure`: clean

Live seam check: I re-ran it myself against the worktree backend on :9863, started with `start-servers.sh` and
stopped with `stop-servers.sh`.
- Normal run (`BASE_URL=http://localhost:9863 npx tsx scripts/layoutPreconditionSeam.ts`): **GREEN**, exit 0,
  15/15 checks pass. Throwaway user `55e4c200-5d33-4152-a04a-95439d08166f`, deleted by exact (id, email).
- Mutation run (`SEAM_STRIP_PRECONDITION=1`, which strips the top-level `expectedLayoutVersion` from every request):
  **RED**, exit 1, 5 failed. The stale `update_dashboard_layout` lands and overwrites the second writer's `lg`
  ("stored lg layout still equals the second writer's" FAIL). The stale `auto_layout_dashboard` is not refused.
  Throwaway user `5f3fccb1-8977-47b2-8591-ccd0c506ae2c` was deleted.
- The executor said the patch-set nested precondition is not covered by the mutation. That is accurate: the strip
  only removes the top-level key. The green run still proves the nested key reaches the server. A patch with no
  precondition would apply cleanly, but the stale patch-set got the server's
  `failure: "This dashboard's layout was changed elsewhere; the layout was not saved."` and the layout stayed as it
  was. That conflict can only happen if `patch.expectedLayoutVersion` was forwarded. `applyPatchSet` is a plain
  pass-through POST, and `editSchema.patch` is `z.record(z.string(), z.unknown())`.

Checklist:
- Canonical code quality: no inline FQNs, no `any` in src. The seam script has one `Record<string, any>` with an
  inline eslint-disable, in a script and not shipped code. Acceptable.
- DRY: one shared `layoutConflictResult`/`PlaceOutputsPackConflictError` module (D6), wired into both `guarded` copies.
- Type safety: `err.body` is `unknown` and narrowed before use. `HelioApiError`'s constructor stays backward
  compatible.
- Error handling: no silent failures. A 409 without a dashboard body re-throws unchanged. A non-conflict pack error
  re-throws.
- Tests are meaningful. Exact-body equality would catch a missing or extra key. `calls.toHaveLength(1)` would catch
  any retry. The required-input test goes through real `callTool`, so it exercises the registered zod schema.
- Design standard: N/A (no `frontend/**` change).

Issues: none blocking. See the suggestions below.

### Phase 3: UI Review — N/A
None of the Phase-3 triggers match. The changed paths are `helio-mcp/**` (src, scripts, README) and
`openspec/changes/mcp-layout-version-precondition/**`. There are no changes under `frontend/**`,
`backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`. MCP tool results reach no
rendered UI. I started the dev servers only to run the live seam check, and stopped them with `stop-servers.sh`.

### Overall: PASS

### Non-blocking Suggestions
- `helio-mcp/src/tools/layoutPreconditionSeam.test.ts:4`: the header comment names the live counterpart
  `openspec/changes/mcp-layout-version-precondition/seam-check.ts`, which does not exist. The script is
  `helio-mcp/scripts/layoutPreconditionSeam.ts`. Point the comment at the real path. This is a one-line fix and
  could ride along with the PR.
- `helio-mcp/src/helioApi.ts` (1410 lines) and `helio-mcp/src/tools/write.ts` (1171 lines) were already far over
  CONTRIBUTING's ~400-line threshold. This change adds about 40 and 25 lines to them. Per CONTRIBUTING, mention a
  split proposal in the PR description. Do not split them in this ticket.
- The `place_outputs` pack-conflict message says the created panels "sit at their default position". That is
  accurate, because the server appends created panels. Consider also suggesting `auto_layout_dashboard` with the
  returned `dashboard.layoutVersion` as the recovery step.
