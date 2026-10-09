## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 5791c5d1d44eca67f48361bac9e8c3116afae0af (base 7b93817898b7ddbae0af7da720934c0f52317e8d, resolved live via resolve-review-base.sh)

Verdict: ESCALATION
Question: The stored Output `schema` is always alphabetical on the server, so this frontend-only change has no visible effect: live Inspect still shows `amount_usd, category, date, merchant`. Should HEL-1394 grow to cover the backend schema order, ship as inert plumbing with a follow-up, or re-source the order from somewhere else?
Options: (a) expand scope: make the server derive Output `schema` in declared/source column order (backend change), (b) ship as-is as plumbing and file a backend follow-up, which leaves AC1 unmet in practice, (c) re-scope the frontend to take its order from a source that keeps it, such as the data source's `inferredSchema` or the pipeline analyze schema, (d) close as won't-fix (alphabetical stays)
Context: see "Root cause of the escalation" below. Nothing in the diff is wrong. The ticket and design assume the Output's declared schema keeps the source order, and it does not.

### Root cause of the escalation (self-authenticating evidence)

- `backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala:192-193` sorts the merged key set
  explicitly. The comment there says "Sort the merged key set globally for order-independence":
  `accByKey.toSeq.sortBy(_._1)`.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunSucceededWrites.scala:136-143` writes every Output's
  `schema` from `SchemaInferenceEngine.inferShallowFromJsObjects(nodeJsRows)` after each successful run. So every Output that has been run
  ends up with an alphabetical `schema`.
- Live measurement (throwaway user, see ids below). I uploaded a CSV with header `date,category,merchant,amount_usd`. The data source's
  `inferredSchema` came back in source order: `date, category, merchant, amount_usd`. A raw (no-step) pipeline with a chart Output was
  created and run. `GET /api/outputs/7277a176-…/` then returned `schema: ["amount_usd","category","date","merchant"]`
  with config `{chartType: bar, fieldMapping:{xAxis: category, yAxis: amount_usd}}` (no columnOrder). The first-run
  table Output from the same source also stored `["amount_usd","category","date","merchant"]`.
- The `columnOrder` branch cannot be reached for chart Outputs, as the skeptic noted and design D4 already states.
- Result: the helper's inputs are already alphabetical, so the rendered order is identical to pre-change behavior.
  The spec scenario "a chart Output declares schema `date, category, merchant, amount_usd`" cannot occur on the
  server today.

The orchestrator's premise check ("for real chart Outputs the ruling resolves to schema order") missed this. Choosing
between (a)/(b)/(c)/(d) changes the ticket's scope: either backend schema derivation, or an Output-metadata source the
owner ruling did not name. Deciding that is outside the evaluator's authority, so this is an escalation and not a
FAIL with a guessed change request.

### Phase 1: Spec Review — PASS (literal), intent unmet live
- AC1–AC5 are implemented as written. The helper puts columnOrder first, then schema, then leftover keys natural-sorted
  (`inspectColumnOrder.ts`). Both mounts are covered because the hint travels on `chartInspectConfig`. Both row paths
  are covered because the order is memoised over `gridRows` (`PanelInspectView.tsx:122-127`). No column is dropped. No
  new fetch: the order comes from the existing `useOutputMeta`. Unit tests cover schema order, columnOrder precedence,
  stale keys, extra keys, and dedupe/non-string entries.
- AC1's "never in alphabetical order" is **not observable in the running app**. The rendered order is alphabetical
  because the schema it follows is alphabetical (see above). That gap is the reason for the escalation.
- Tasks: 1.1–2.4 are done and match the code. 2.5 (live check) was not done by the executor. I ran it here (Phase 3).
- Scope: frontend plus OpenSpec artifacts only. No creep, and no API/schema change needed for the change as designed.
- CONSTRAINTS: C1 is honored. The new tests use the ticket's example and assert the exact header order on both the raw
  and aggregate paths. They would fail before this change, because `DataGrid.deriveColumns` (`DataGrid.tsx:396-404`)
  natural-sorts whenever `columns` is absent, which gives `amount_usd, category, date, merchant`. C2 is honored.
  `usePanelCardInspect.test.tsx` asserts the derived `schema` array and the `columnOrder` value. The helper skips
  non-string entries, and a test covers that.

### Phase 2: Code Review — PASS
Gates, run fresh in WORKTREE_PATH with nice -n 19 and --maxWorkers=3:
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm test`: exit 0. 494 suites, 5169 tests passed.
- `npm --prefix frontend run build`: exit 0
No backend files changed, so `sbt testFull` did not apply.

Code quality: the helper is small and pure, and it reuses DataGrid's collator settings and 50-row scan window. Types
are sound: `unknown[]` input for columnOrder with a runtime string guard. No dead code. No over-engineering. There are
no DESIGN.md [mechanical] concerns because there are no style or markup changes.

### Phase 3: UI Review — PASS (mechanics) / intent not demonstrated (see escalation)
Servers came up with start-servers.sh on 6826/9733, and assert-phase reported `PASS servers`.
- Happy path: clicking a bar opens Inspect in both the grid-card mount and the fullscreen-overlay mount. Rows are correct
  (Travel: Airline 320, Hotel 210). Header order in both mounts and both themes is **`amount_usd, category, date,
  merchant`**, which is alphabetical. This is the expected result given the stored schema. It is not schema-source order.
- Console: 0 errors during the tested flows after login.
- Light and dark themes both render with no layout breakage at 1440.
- Evidence (persisted):
  - /home/matt/Development/helio/.concertino/runs/HEL-1394/evidence/eval-shots/03-inspect-grid-dark.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1394/evidence/eval-shots/05-fullscreen-inspect-dark.png
  - /home/matt/Development/helio/.concertino/runs/HEL-1394/evidence/eval-shots/06-inspect-grid-light.png
  - The live API response for the Output `schema` is quoted above. It does not depend on mtime or ordering evidence.

Live-check residue. Ids were recorded at creation, all residue was deleted by exact id, and the post-check lists are empty:
- user e14b1168-25fa-4505-a60c-a9cbe256a877 (hel1394-eval-1791543677@example.test). There is no user-delete API, so
  I deleted it via psql by exact id and email, together with its 2 `pipeline_run_rate_window` rows keyed on that user_id.
- source d758897f-bbf1-4e89-8b22-39fd4883b436
- pipelines f4ad969e-255f-416c-990e-c0255bdda93e (first-run) and e136e2d7-b071-45b4-8664-bfbf80cb64dc (raw)
- outputs a25a2e2d-c365-4780-8e41-fa75619f856a, dc9daa0d-13f0-45bd-ab4d-c33eb9148118,
  d87f842b-5cdf-4977-b15f-5fd6f2d35854, 7277a176-0e1c-429f-885e-5a8189643019
- dashboards dc98976a-804e-4fa1-af4b-39add9b1513b (first-run) and 56126379-bc2e-4169-8772-904c4ce2d87b
- panels fe83da5e-27dc-46ba-9eaa-4242d084292e, 4d2e8e15-9133-458f-bc22-a8625592d709,
  90e019c7-35b8-4fc8-8907-f11ecffdcd49, 8a4500a2-165a-4d78-a35d-612e2b04bac5

### Overall: ESCALATION

### Change Requests
None for code. If the ruling is (b), tick task 2.5 and record that the live order is alphabetical. Also note in
design.md that the server-side `SchemaInferenceEngine.inferShallowFromJsObjects` sort is the reason.

### Non-blocking Suggestions
- `frontend/src/utils/chartClickSelection.ts:13` now imports a type from `features/panels/ui/`. That is a utils→ui
  dependency. Consider moving `InspectColumnOrderHint` to `features/panels/types/` (the file already imports from
  there).
