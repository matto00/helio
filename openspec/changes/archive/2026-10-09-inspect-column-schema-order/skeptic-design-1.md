## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 7b93817898b7ddbae0af7da720934c0f52317e8d (= origin/main; change dir untracked, no code changes yet).

### What I verified (with evidence)

- **Root-cause premise (alphabetical order comes from DataGrid, not server key order): TRUE.**
  `PanelInspectView.tsx` renders `<DataGrid rows={gridRows} variant emptyText>` with no `columns` prop.
  `shared/ui/DataGrid.tsx:437` resolves `columns ?? deriveColumns(rows)`; `deriveColumns` (:396-403) takes the union of
  keys over `rows.slice(0, 50)` and sorts them with `naturalKeyCollator` (:392,
  `Intl.Collator(undefined, {numeric:true, sensitivity:"base"})`). So passing explicit `columns` (D3) is the right
  lever. The Linear ticket's "Object.keys(rows[0]) / server order" explanation is wrong. The orchestrator's premise
  check is correct to override it.
- **Both mounts share one config object: TRUE.** `chartInspectConfig` is computed once in
  `features/panels/hooks/usePanelCardInspect.ts` from `useOutputMeta(outputId)`. `PanelCard.tsx:246` and
  `PanelFullscreenOverlay.tsx:253` both pass it to `PanelInspectView`. Putting the hint on `ChartInspectConfig` (D2)
  reaches both mounts with no new fetch, so AC4 holds.
- **Both row paths go through one `gridRows` → one `DataGrid`: TRUE.** The aggregate path is `Object.entries(record)`
  and the raw path is `headers.map(...)` (PanelInspectView.tsx `gridRows` memo). One `columns` memo over `gridRows`
  covers both (AC2).
- **Inputs exist with the claimed shapes.** `Output.schema: OutputSchemaField[]` with `name`
  (`features/pipelines/types/output.ts:16-19,46`). `readTableConfig(config).columnOrder`
  (`outputConfigTypes.ts:253-256`). `ColumnDef` needs only `{key}` (`DataGrid.tsx:29`).
- **Optional field keeps existing fixtures valid: TRUE.** `PanelInspectView.test.tsx:27` builds a
  `ChartInspectConfig` with only `chartType` and `fieldMapping`.
- **The alternative in D1 was rejected for the right reason.** `TableRenderer.orderedColumns`
  (`renderers/TableRenderer.tsx:171`) is module-private and treats `columnOrder` as the visible subset, so it would
  violate AC3.
- **AC coverage.** AC1 → D1–D3 + tasks 1.1–1.4. AC2 → D3 + test 2.2. AC3 → D1/D4 + test 2.1. AC4 → D2 + task 1.3.
  AC5 → tests 2.1/2.2. Each AC maps to a task.
- **No placeholders or contradictions.** The only deferral is "name finalised by executor" for the hint field. That
  is a naming choice and does not block anything. The proposal, design, tasks, and spec delta agree with each other.
- **Contract.** Frontend-only, with no API or schema change. The `chart-drilldown-inspect` spec delta adds the
  ordering requirement and its scenarios.
- **Is "columnOrder orders but never hides" an overreach of the owner ruling? No.** The ticket asks "which order is
  canonical", and all three options are about order. Option 2 picks the source of the order. It says nothing about
  visibility. AC3 keeps Inspect's existing invariant (it lists the underlying rows), so there is no change beyond the
  ruling. In practice it makes no difference either way (see the first note).

### Verdict: CONFIRM

### Non-blocking notes

- **The `columnOrder` branch can never run for a real chart Output, and the design understates this.** D4 says
  `columnOrder` is honoured "only if a chart Output's config happens to carry it". The backend rules that out:
  - `backend/.../services/pipelines/OutputConfigValidation.scala:22-24` allows `columnOrder` only for `OutputKind.Table`
    (a chart write returns 400, "not a chart config key").
  - V117 / `LegacyOutputConfigKeys.scala:33` strips stored `columnOrder` from every non-Table Output, and also applies
    on journal restore.

  Because Inspect exists only for `kind === "chart"`, the ruling resolves to schema order for every real Output.
  Implementing the `columnOrder` branch in the pure helper is cheap and follows the ruling literally, so this does not
  block. Still:
  - The executor should state in a code comment that the branch is defensive and server-unreachable for chart Outputs,
    citing the validation.
  - The `columnOrder`-precedence tests must work at the pure-helper / `PanelInspectView` level with a hand-built hint.
    They cannot work through a live Output.
  - Task 2.5 (live check) can only show schema order. That is expected, not a gap.
- `readTableConfig` casts `columnOrder` as `string[]` without filtering out non-strings (`outputConfigTypes.ts:256`).
  If the helper `String()`s or skips non-string entries, a malformed config cannot inject a bogus column key. This is
  low risk given server validation.
- There is no existing `usePanelCardInspect` test file. Task 2.3's "(or PanelCard)" leaves room, but the test must
  actually assert the hint's `schema` and `columnOrder` values derived from a mocked `useOutputMeta` Output. A test
  that only checks the field exists is not enough.
- Test 2.2 must be red against the pre-change code. Use a schema order that differs from natural order (the ticket's
  `date, category, merchant, amount_usd` works) for both the raw path and the aggregate path. Assert the header cell
  order, not just which headers are present.
- The follow-up recorded in the planner notes (table panel `TableRenderer.deriveKeys` fallback) should be filed. That
  path natural-sorts in the same way. Once this ships, Inspect will differ from a no-`columnOrder` table panel bound
  to the same source.
