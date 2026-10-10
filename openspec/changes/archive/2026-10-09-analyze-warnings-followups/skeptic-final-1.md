## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `519a03ef3ce3af53a0eed078dcd9ec1bf988ae8e`. The review base, resolved live with `resolve-review-base.sh` (exit 0), is `365d824c8f2eba017e150e9b5f67743920f56619`. The spawn-cwd guard printed `READY`.

### What I verified (with evidence)

**Gates (my own fresh runs in WORKTREE_PATH)**
- Backend: `nice -n 19 sbt -J-Xmx3g testOnly` covering five suites:
  - `AnalyzeSchemaWarningsSpec`
  - `PipelineAnalyzeSchemaWarningsSpec`
  - `AutoRunTriggerServiceSpec` (HEL-1279)
  - `DataSourceServiceDeniedPipelinesSpec` (HEL-1279)
  - `PipelineAnalyzeServiceSpec`
  - Result: "Tests: succeeded 237, failed 0", "All tests passed.", EXIT 0.
- I did not re-run the full `sbt testFull`. evaluation-2.md pastes 6500/0 at this SHA. The backend main-code delta since the evaluator's cycle-1 run is an import refactor only (`git diff e88dc69bb 519a03ef3 -- backend/src/main` shows only the `Try` import).
- helio-mcp: `npx jest helio-mcp` gave 43 suites / 425 tests passed, EXIT 0.
- Frontend: `npm test -- --testPathPatterns='pipelines/ui/(StepCard|PipelineRiverView|PipelineDetailPage)'` gave 12 suites / 298 tests passed, EXIT 0.
- `npm run lint`, frontend `npm run typecheck` and `npm run format:check` all exited 0.
- Red-first evidence in `.concertino/runs/HEL-1414/evidence/`:
  - `backend-red.txt`: 5 HEL-1414 tests FAILED before the fix.
  - `mcp-red.txt`: the workspace-context warnings tests failed in both concise modes.
  - `frontend-red.txt`: compile-red.

**Live backend (port 9753)**
- The process cwd is this worktree's `backend/`. It started at 17:19, which is after e88dc69bb (17:04), and the only later backend main change is the import refactor. So it is not a stale foreign server.
- Throwaway user `49fc942d-25d0-4200-914d-83997d80737b`. Sources:
  - CSV orders `4bb46647-…57fc3` (all string)
  - CSV customers `11133106-…f45` (unused)
  - typed dataset `000da3f9-…e8e` (id is float)
- Pipeline `9f6889b0-…b553` runs filter(region) → lookup(source, customer_ref→id, [name,tier]) → lookup(source, customer_ref→cust_no, [tier]) → sort. `GET /analyze` returned:
  - filter: `field-not-in-input-schema`.
  - lookup1, AC3 + AC4 over a SOURCE secondary:
    - `join-column-renamed` ('name' → 'right_name');
    - `join-key-type-mismatch` "lookup: source key 'customer_ref' is string on the input but lookup key 'id' is float on the secondary input…".
  - lookup2:
    - D1b `field-not-in-input-schema` "lookup: key 'cust_no' not found in this step's inferred secondary input schema (available: id, name, tier)";
    - rename 'tier'.
  - Every step has `validationError` None. `costVerdict.canRun` is true, and the only reason is `row-estimate-unavailable`.
- Pipeline `c653966b-…d747` (compute `$amount * 2` over a string column) returned `numeric-op-on-text-field`, so all four codes are live.
- A dry run of the warned pipeline (`POST /run?dry=true`) returned `"blocked":false` and run `04f28bb4-…` with status `dry_run`. Warnings do not stop runs firing (AC1/AC7).

**AC trace**
- **AC1:**
  - Code: `StepCard.tsx` adds a header chip (`role="img"`, aria-label "N schema warning(s)", count shown only when N > 1) and a `role="region"` block. The block renders only when expanded, sits after the header and before `<OutputsRail>`, and uses the copy "Check before running (these don't block runs)". The card has no errored class.
  - Data flows from the `usePipelineDetailPage.ts` memoised group-by through `PipelineDetailPage` → `PipelineRiverView` → `RootColumn` → `LaneColumn` (both compact and full StepCard sites) → `StepCard`.
  - Live, in light and dark: `[class*="--errored"]` count is 0. Copy never says "can't run".
- **AC2:** `helio-mcp/src/context.ts` groups `analyzed.warnings` by stepId (`?? []` for older servers) and attaches `{code,message}` in both modes, omitted when empty. The `read.ts` description is updated. Covered by `context.test.ts`/`server.test.ts`, which are red-first per `mcp-red.txt`.
- **AC3:** `AnalyzeSchemaWarnings.lookupKeyWarnings`:
  - It uses the same `family()` and the same `in.types && s.flags.types` gate as join.
  - Unit tests cover lane and source secondaries, plus guards for integer vs float, untrusted input after compute, and an unresolved source.
  - Confirmed live (see above).
- **AC4:**
  - `PipelineAnalyzeService.secondarySourceIdOf` covers both join and lookup. It feeds `resolveSecondarySourceSchemas`, which `PipelineService.scala:1106` now calls through every call site (363, 974, 1130, 1348, 1446), and `secondaryOf` resolves through it too.
  - `sourceDependencyOf` stays join-only, so `analyzeNodes` projections are unchanged (`PipelineAnalyzeService.scala:280`).
  - The `viaLane` flag keeps a source-lookup's output type-untrusted, and a guard test covers it.
  - Confirmed live.
- **AC5:** The `read.ts` `analyze_pipeline` description no longer says "no column lists". It now says concise mode omits the per-step column lists, though a message may name up to 20 columns. This agrees with `MaxListedFields = 20`.
- **AC6:**
  - The `PipelineAnalyzeSchemaWarningsSpec` header now points at archive `evaluation-1.md` ("My own mutation runs", which exists at line 28) and `evaluation-2.md`, which states that D6b/D6d are synthetic (line 10).
  - Archive `tasks.md` 1.3 has a correction line whose rationale matches the shipped `typeTrusted` scaladoc (AnalyzeSchemaWarnings.scala:55-62).
- **AC7 / C1:**
  - `grep` shows that `AnalyzeSchemaWarnings.compute` is consumed only at the three warning sites (`PipelineService.scala:1010/1149/1471`). There is no new path into validationError, costVerdict, stepConfigProblem, validateRawConfig or RunConfigGate.
  - The only edit in `PipelineAnalyzeSchemaWarningsSpec` is the AC6-mandated header comment plus new tests. No guard assertion was changed.
  - The HEL-1279 specs are untouched and green in my run.
- **D1b** (beyond the ACs, absorbed on a driver ruling). It is genuinely the same code path: the same new function and the same `sec` gate, mirroring `joinWarnings`' right-side check. The `missingMessage` wording widening is one condition. There is no double report: live, one warning for `cust_no` and no validationError.

**UI / design judgment** (screenshots in my own isolated `chromium.launch()`/`newContext()` per theme; I never touched the shared MCP browser)
- Evidence files are in `/home/matt/Development/helio/.concertino/runs/HEL-1414/evidence/`:
  - `sk-p1-collapsed-{light,dark}.png`, `sk-p1-expanded-{light,dark}.png`, `sk-p2-*`
  - `sk-zoom-lookup-{light,dark}-{1440,400}.png`
- These were captured directly into the durable runs directory, which is outside the worktree and not touched by cleanup.
- **Fidelity to the owner-ruled option A mockup** (`mockups/optionA-{light,dark}.png`):
  - The header chip matches: a TriangleAlert beside the collapse caret, with "2" shown only for multi-warning steps.
  - The region matches: placed under the header and above "+ Output", with a warning-tinted block, a bold heading with an icon, and a regular-weight "(these don't block runs)".
  - Bulleted messages match.
- **Tokens:** the region shares the `.pipeline-detail-page__truncation-banner` rule through a combined selector, and the additions are token-only (`--space-*`, `--weight-*`, `--text-xs`, `--app-warning`). Computed values:
  - light: color `rgb(133,85,26)`, surface warning/0.11
  - dark: color `rgb(245,185,68)`, surface warning/0.14
  - both: border warning/0.35
- **Cohesion:** the region is visually consistent with the pre-existing row-estimate warning bar in the page's bottom dock, in both themes.
- **400px:** the heading wraps cleanly onto two lines. The region has no horizontal overflow (`scrollWidth == clientWidth`: 332/332 and 764/764).
- **Console:** only the pre-login `/api/auth/me` 401s and the known no-schedule 404s.

**Cleanup**
- Pipelines `9f6889b0-0758-4195-b685-e5571233b553` and `c653966b-c7eb-4a74-966f-bc407007d747`: 204.
- Data sources `4bb46647-c28e-4247-9ac7-121eaa857fc3`, `11133106-ba65-458c-8e01-8e88ccab0f45` and `000da3f9-aa9d-4bd6-b750-735d91605a8e`: 204.
- `pipeline_run_rate_window` rows for the user id: DELETE 1. The user row: DELETE 1. 0 remain.

### Verdict: CONFIRM

### Non-blocking notes
- Lookup warning copy uses the config key names (`source key`, `lookup key`), but the StepCard labels those fields "Match on field" and "Reference match field". A later copy pass could align them. Join's existing messages have the same property.
- A grantee's analyze response can now show a lookup source's column names in the "available: …" lists. This matches how join source secondaries already behaved (and step writes already enforce `checkOwnedSource` for lookup sources), so it is not a new class of exposure.
- I agree with the evaluator's notes: `StepCard.tsx` and `usePipelineDetailPage.ts` are over the line budget, and a duplicate `id="lookup-key"` exists from before this change.
- Environment hygiene: while locating `DATABASE_URL`, sourcing `backend/.env` as shell made bash echo one unrelated line of that file into my tool output, because the file is not shell-safe. That line includes a cloud DB credential. Nothing was written to any artifact. The owner may want to rotate that value if this transcript is shared.
