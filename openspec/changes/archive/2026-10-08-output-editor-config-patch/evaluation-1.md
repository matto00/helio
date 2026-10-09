## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `626db3eea38e749213627f032772bfedc6dae1a0` (base `eda9ed491428c904ab9d486146ed65b47c003ba7`, resolved live via `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 ("send only changed fields or explicit null clears; untouched keys preserved byte-for-byte"): edit Save now diffs the builder output for the current state against the builder output for the opening state (`configPatch.ts` `buildConfigPatch`/`buildBaselineConfig`) and omits `config` when nothing changed (`OutputEditorSheet.tsx` `handleSave`). The design's two documented exceptions (D4 stale-slot repair, D4a metric fieldMapping/aggregation pairing, which can write `aggregation: null` on a metric that had no stored key) are implemented as specified and are confined to a key the editor owns.
- All three ticket bullets are covered: layout/sort no longer sent; metric label/unit literal-to-field and table columnOrder reset send explicit `null`; chart base mapping drops the stored `annotation` slot, and already-damaged rows are repaired.
- AC2 ("red-first tests per bullet", constraint C1): I checked this independently, not from the executor's log. I put the new `OutputEditorSheet.configPatch.test.tsx` into a scratch worktree at the base commit and ran it: **20 failed / 2 passed**. The 2 that pass are the collection/timeline create-default guards, which is expected. Every bug-bullet test fails on the user-visible symptom: the stored `layout:"grid"` or `sort:"asc"` is overwritten, the merged `label` is still `"Revenue"`, the merged `fieldMapping` keeps `annotation:"c"`, and the table sends no `columnOrder` change. Each also fails on its wire-shape assertion.
- Tasks 1.1–4.1 are all marked done and match the diff. No scope creep: HEL-1388 and HEL-1394 were not touched. A kind change still sends the full config, as the design says.
- C1 guard requirement: the D4a guard is failable by mutation. I verified this myself by replacing the metric pairing condition in `configPatch.ts` with `if (false)` in a scratch worktree at HEAD: 2 tests failed (the label-only aggregated-metric guard and the damaged-metric repair). I then reverted the change and removed the scratch worktree. For the backend guard, I confirmed the mutation evidence in the executor's `be-mut.txt` shows `HEL-1389 guard ... *** FAILED ***`. That is the executor's artifact, not my own run.
- No API/schema change is needed: the backend is unchanged and has a test-only guard. A spec delta was added (`specs/pipeline-output-sheet/spec.md`) and reflects the implemented behaviour.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH at 626db3ee:
- `npm run lint`: exit 0
- `npm run format:check`: all files pass
- `npm run typecheck`: clean
- `npm test` (`--maxWorkers=3`): 480 suites, 5062 tests passed
- `npm --prefix frontend run build`: exit 0
- `cd backend && sbt testFull`: 6386 tests run, 0 failed, 4 canceled, "All tests passed". The new guard `HEL-1389 guard: an omitted key is kept, an explicit null is stored as null, fieldMapping is replaced whole` ran and passed.

Code review:
- The baseline seeding in `openingParams` (`configPatch.ts:46-95`) matches the sheet's state seeding expression for expression. I checked `OutputEditorSheet.tsx:213-268`. Chart annotation uses `!== undefined && !== null`. Metric label/unit use `!== undefined`, because `readMetricConfig` maps a stored `null` to `undefined`, so a cleared label reopens in field mode; I confirmed this live. The metric field uses the `fieldMapping.value ?? aggregation.value` fallback. Table `columnOrder` goes through the same `buildOutputColumns` + `deriveColumnOrder` pair the hook uses.
- `deriveColumnOrder` correctly limits "default" to all columns visible in natural order. Before capabilities load it returns the stored order unchanged, so an untouched table save before load is a no-op. A test covers this.
- `sameValue` treats `undefined` and `null` as equal and otherwise compares structurally. That is adequate for JSON config values.
- Type safety: no `any`. The casts are narrow `Record<string, unknown>` casts.
- Tests are meaningful. They assert both the sent keys and the merged result, which is the shallow merge the server performs and which the backend guard pins.
- No dead code, TODOs or inline FQNs were added.

### Phase 3: UI Review — PASS
Servers: `start-servers.sh` reused healthy servers on 6821/9728 and `assert-phase.sh servers` printed PASS. I confirmed both listener processes' cwd is this worktree (`/proc/<pid>/cwd` resolves to `.../HEL-1389/backend` and `.../HEL-1389/frontend`), and Vite serves this branch's new `configPatch.ts`.

Seam proof: I ran real edit-mode saves through the running app myself, using a throwaway user I created plus my own source, pipeline and 5 Outputs. DB `outputs.config` before and after:

| Output | Before | UI action | After |
|---|---|---|---|
| collection | `{format:number, layout:list, fieldMapping:{value:amt}}` | Format → Percent, Save | `{format:percent, layout:list, ...}`: **layout `list` preserved** |
| table | `{columnOrder:[b,a], fieldMapping:{}}` | check c and amt, move a up, Save | `{columnOrder:null, fieldMapping:{}}`: **reset to null** |
| metric | `{unit:$, label:Revenue, fieldMapping:{value:amt}}` | Label → Bind to field `b`, Save | `{unit:$, label:null, aggregation:null, fieldMapping:{label:b, value:amt}}`: literal cleared, untouched `unit` preserved, `aggregation:null` is the documented D4a pairing |
| chart | `{chartType:bar, fieldMapping:{xAxis:a, yAxis:amt, annotation:b}}` | Annotation field → None, Save | `{chartType:bar, fieldMapping:{xAxis:a, yAxis:amt}}`: stale annotation gone |
| damaged chart | `{..., annotation:Plain, fieldMapping:{..., annotation:b}}` | open, untouched Save | `{..., annotation:Plain, fieldMapping:{xAxis:a, yAxis:amt}}`: repaired |

I then reopened the metric. Label shows "Bind to field" with `b`, and Unit shows "Fixed text" with `$`. Untouched re-saves of the metric and the table left their rows unchanged. Every PATCH returned 200.

Console: the only error was the pre-existing `GET /api/pipelines/:id/schedule` 404 for a pipeline with no schedule. The only warnings were ECharts DOM-size warnings from the chart preview inside the dialog. Neither relates to this diff.

Breakpoints: the diff has no markup or CSS change. The sheet opened and saved normally at 768px.

Cleanup was by exact id. I deleted pipeline `c93dab4c-7bd5-4964-a872-95bfba0c9c01` and source `23859fbd-0444-4040-a812-291f4f46a2f1` via the API (both 204), confirmed 0 remaining outputs, pipelines and sources for those ids, and then deleted user `7f864706-a0e8-44f6-86f7-a1a5e3aa6a3d` by id.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `OutputEditorSheet.configPatch.test.tsx:246-247`: the guard comment says the test "passes on the pre-fix code". It does not. On base it fails at line 252 (`after.fieldMapping` lacks `value`), because pre-fix aggregated metrics omit `fieldMapping.value`. The metric is not actually unbound pre-fix, because `aggregation.value` still carries it. Reword the comment to say it guards the D4a pairing and is failable by removing the pairing.
- `openingParams` (`configPatch.ts:46-95`) duplicates the sheet's state-seeding expressions (`OutputEditorSheet.tsx:213-268`). Today they agree and the untouched-save tests catch drift for each kind, but the robust shape is for the sheet to seed its `useState` initials from `openingParams(...)`, so there is a single source of truth for the opening state.
- `OutputEditorSheet.tsx` is 729 lines, up from 713 and over the ~400-line CONTRIBUTING threshold. The new logic correctly went into `configPatch.ts`; per CONTRIBUTING, note a proposed split in the PR description.
