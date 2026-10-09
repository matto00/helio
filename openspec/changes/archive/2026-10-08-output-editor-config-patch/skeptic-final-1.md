## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `626db3eea38e749213627f032772bfedc6dae1a0`. The base `eda9ed491428c904ab9d486146ed65b47c003ba7` was resolved live via `resolve-review-base.sh` (exit 0).
Spawn guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/output-editor-config-clobber/HEL-1389`.

### What I verified (with evidence)

**Diff read in full** (`git diff eda9ed49...HEAD`). The source changes are confined to `configPatch.ts` (new), `OutputEditorSheet.tsx`, `buildOutputConfig.ts` and `useOutputTableColumns.ts`. On the backend, only a test was added (`OutputRoutesSpec.scala`). The diff makes no markup or CSS change.

**Design conformance (D1–D7)**
- D1: `buildEditConfig` (`OutputEditorSheet.tsx`) builds the baseline through the same builder as the current state, using `openingParams` (`configPatch.ts`). It diffs per top-level key with `sameValue`, which treats `undefined` and `null` as equal. When the patch is empty, `config` is omitted from the request. I compared `openingParams` with the sheet's `useState` seeding at `OutputEditorSheet.tsx:213-268`, expression by expression, and they match. The chart options seed is `{}` in the baseline and `EMPTY_CHART_OPTIONS = {}` in the sheet. Table `columnOrder` uses the same `buildOutputColumns` + `deriveColumnOrder` pair as the hook. Table formats use the same `{...(initial ?? {})}` seed as `useOutputColumnFormats`.
- D2: the builder still writes `"grid"`/`"asc"`, but these values are identical in the built and baseline configs, so they are never sent on edit. A kind change falls back to the full config, as the design says (overlap with HEL-1388).
- D3: `literalOrNull` returns `null` for field mode and for an emptied literal. `deriveColumnOrder` treats the order as default only when every column is visible in natural order. Before the columns load, it passes the stored order through unchanged.
- D4: `withoutAnnotation` removes the stored chart annotation slot. `hasStaleSlot` only checks for stale slots: a non-empty string slot in the stored mapping that the built mapping does not carry with the same value. It never compares whole objects.
- D4a: the metric builder always sets `fieldMapping.value`, and `buildConfigPatch` always sends `fieldMapping` and `aggregation` together for metrics.
- D5: `withHistoryPayloads` is unchanged and create mode still builds the full config. `buildAggregateTailConfigs` does not call `buildOutputConfig`, so it is unaffected.
- D7: the comment was updated, and the legacy markdown test now asserts that no config is sent.

**Red-first (constraint C1), reproduced by me.** I extracted the base commit's `frontend/` into my scratchpad with `git archive eda9ed49`, symlinked `node_modules`, and copied in the new `OutputEditorSheet.configPatch.test.tsx`. Result: **20 failed, 2 passed, 22 total**. The 2 passing tests are the create-mode collection/timeline guards, which is expected because create behaviour is unchanged. Every edit-mode test for each bug bullet is red at base. The tests assert both the keys sent and the shallow-merged result the user would see.

**Gates I re-ran at HEAD (changed area):**
- `jest src/features/pipelines/ui/outputEditor`: 11 suites, 194 tests passed.
- `npm run typecheck`: exit 0.
- `eslint --max-warnings=0` on the outputEditor directory: exit 0.
- `prettier --check`: clean.

I relied on the evaluator's pasted full-suite run (5062 tests) and on its `sbt testFull` result (6386 run, 0 failed, with the new guard passing).

**Backend guard (D6b).** I read the test. It asserts that an omitted key is kept, that `annotation` is stored as `JsNull`, and that `fieldMapping` is replaced as a whole, checked both through the PATCH response and through a GET read-back. Either of the named mutations (dropping `JsNull` keys, or deep-merging `fieldMapping`) would necessarily break those assertions. The mutation run itself is evidenced only by the executor's `be-mut.txt`; I did not re-run sbt under mutation.

**Seam: live edit-mode saves through the running app.** I ran these myself.
- Servers: `start-servers.sh` reused healthy servers and `assert-phase.sh servers` printed PASS. `/proc/<pid>/cwd` shows the 6821 listener in `HEL-1389/frontend` and the 9728 listener in `HEL-1389/backend`. Vite serves this branch's `configPatch.ts`.
- Data: I registered my own throwaway user (`3a634a38-94bb-4b78-92fa-40277d7bf2b0`) and instantiated the `finance` template (pipeline `3a3d7ebc-…`, source `06fd8170-…`, dashboard `79569036-…`). I then added two Outputs of my own with configs chosen to cover cases the evaluator did not test.
- DB `outputs.config` before and after, read with psql:

| Output | Before | UI action | After |
|---|---|---|---|
| timeline `dab34fb8` | `{"sort":"desc","fieldMapping":{"time":"date","event":"merchant"}}` | Event field changed to `category`, Save | `{"sort":"desc","fieldMapping":{"time":"date","event":"category"}}`: **`sort: desc` preserved** (bullet 1) |
| metric `c4e96e16` | `{"unit":"$","label":"Spend","compare":"7d","aggregation":{"agg":"sum"},"fieldMapping":{"value":"amount_usd"}}` | Unit text emptied, Save | `{"unit":null,"label":"Spend","compare":"7d","aggregation":{"agg":"sum"},"fieldMapping":{"value":"amount_usd"}}`: **emptied literal cleared to null; the legacy `{agg}` aggregation, label, compare and fieldMapping are byte-identical** (bullet 2) |
| table `e6a2e93a` (template) | `{"columnOrder":["date","category","merchant","amount_usd"]}` | open, untouched Save | identical: an untouched save does not rewrite the config, including a stored full order that differs from the node's schema order |

  - All three PATCH requests returned 200.
  - When I reopened the metric, Unit shows "Bind to field / — None —" and Label still shows "Fixed text: Spend".
  - The evaluator's run separately covers the other cases: collection `layout: list`, table `columnOrder` reset to null, metric literal-to-field, chart annotation removal, and repair of a damaged chart.
- Cleanup, by exact id only:
  - Dashboard, pipeline and source deleted via the API (all 204).
  - psql then confirmed 0 remaining rows for each of those ids, and 0 outputs for the pipeline.
  - User row deleted by id, after first deleting its single `pipeline_run_rate_window` row (FK) by `user_id`; the user count is now 0.
  - I also removed my two stray screenshots from the repo root and `.playwright-mcp/`.

**UI / design judgment.** No markup, CSS or token changes, so there is no new visual surface to judge. The sheet renders as before. The only visible behaviour change is that an emptied Unit or Label now reopens in "Bind to field / None" mode instead of an empty "Fixed text" box. That is coherent, because it is the same state as a never-set slot.

**ACs traced**
- AC1 ("only changed fields or explicit null clears; untouched keys byte-for-byte"):
  - Traced to `buildConfigPatch` and the omitted-`config` branch in `handleSave`.
  - The untouched-save tests cover every kind, plus a table saved before its columns load.
  - My live rows above show it end to end.
  - The documented exceptions (D4 stale-slot repair; D4a `aggregation` normalization or `aggregation: null` when a metric's `fieldMapping` is written anyway) are confined to keys the editor owns, and the design gate approved them.
- AC2 (red-first per bullet): reproduced 20/22 red at base, as above.

### Verdict: CONFIRM

### Non-blocking notes
- `OutputEditorSheet.configPatch.test.tsx:246-247`: the comment says the D4a guard "passes on the pre-fix code". It does not: at base it fails on the `fieldMapping.value` assertion, as the evaluator also noted. Reword it.
- `openingParams` duplicates the sheet's seeding expressions. Today the per-kind untouched-save tests catch any drift between the two. Seeding the sheet's `useState` initial values from `openingParams` would make it one source of truth.
- The backend guard's mutation evidence comes from the executor alone (`be-mut.txt`). The assertions make the claim logically sound, but nobody independent of the executor has re-run it.
- `OutputEditorSheet.tsx` is about 729 lines. Mention a split proposal in the PR body, per CONTRIBUTING.
