## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `eda9ed491428c904ab9d486146ed65b47c003ba7`; the change dir is still untracked. Read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-output-sheet/spec.md and skeptic-design-1.md, then checked each design claim against the code.

### What I verified (with evidence)

**Round-1 change requests: all six addressed in the text.**
- CR1: D3 now uses "all visible AND natural order", and task 1.1 has the `["b","a"]`/c-hidden test.
- CR2: the spec scenario now says "renders the same as an Output with no stored `columnOrder`", with the HEL-1394 dependency recorded.
- CR3: the metric narrative is corrected to the literal→field case, with red tests for that path.
- CR4: option (a) is chosen. D4 compares against the raw stored mapping, and the damaged-row tests are in 1.1.
- CR5: 3.2 now covers chart annotation and table reset.
- CR6: 1.1 has the table before/after-capabilities timings.
- All round-1 non-blocking notes are also folded in: the null/undefined rule, the D7 markdown comment, the 3.1 guard label, and omitting `config` when the diff is empty.

**Premises re-checked against the code:**
- **Server merge.** `OutputConfigValidation.scala:199` `mergeConfig = existing ++ patch`. This is a shallow merge: a sent `fieldMapping` replaces the stored one whole.
- **Builder.** `buildOutputConfig.ts:129/133` hard-code `layout`/`sort`. The chart mapping at `:69-74` spreads the stored mapping, including `annotation`. Metric `label`/`unit` are `undefined` in field mode (`:112-119`).
- **Metric `fieldMapping.value`.** `buildOutputConfig.ts:100` emits `fieldMapping.value` **only when `metricAggFn === ""`**. An aggregated metric's built `fieldMapping` never carries `value`.
- **Metric field seeding.** `OutputEditorSheet.tsx:241` seeds `metricField` from `fieldMapping.value ?? aggregation.value`. The builder then re-emits it inside `aggregation` (`:108-111`).
- **The `{ agg }` metric shape is canonical, not just legacy.**
  - `OutputConfigValidation.scala:46` is the text the server gives Claude for every write surface: "metric aggregation = { agg } (field from fieldMapping.value) or { value, agg }".
  - `metricShape` (`:139-151`) accepts `{agg}` + `fieldMapping.value`.
- **Aggregation validation only runs when `aggregation` changes.** `validateAggregation` (`:108-127`) runs only when `changed(written, stored, "aggregation")`. A PATCH that sends only `fieldMapping` is never checked against the stored aggregation.
- **`validateFieldMapping` checks unknown slot keys only.** `OutputBindingSpec.validateFieldMapping` (`:160-163`) never checks that the required `value` slot is present.
- **Table hook today.** `useOutputTableColumns.ts:325-337` returns `undefined` for any visible subset kept in natural relative order. With `fieldKeys = []` it also returns `undefined`. D3's new rule (all visible, plus pass-through before capabilities load) is a real behaviour change and is correctly planned in 2.3.
- **Readers already treat `null` as absent.** `outputConfigTypes.ts:256, 268-269`: `columnOrder` is read only if it is an array, `label`/`unit` only if they are strings.

### Verdict: REFUTE

One blocking defect. The per-key diff (D1), combined with D4's raw `fieldMapping` comparison, breaks a cross-key invariant on metric Outputs. It corrupts metrics stored in the server-canonical `{ agg }` shape, and today's code does not. Every other part of the design is sound.

### Change Requests

1. **Metric `fieldMapping.value` ↔ `aggregation` coupling: D1/D4 as written silently unbind aggregated metrics.**

   Take a metric stored as `{fieldMapping: {value: "amt"}, aggregation: {agg: "sum"}}`. This is the canonical shape at `OutputConfigValidation.scala:46`, which AI authoring is told to write.
   - **On open:** `metricField = "amt"`, `metricAggFn = "sum"`.
   - **Built config:** `built.fieldMapping = {}` (`buildOutputConfig.ts:100` drops `value` when aggregated). `built.aggregation = {value: "amt", agg: "sum"}`.
   - **Baseline:** the baseline aggregation is identical to the built one, so under D1 **`aggregation` is not sent**.
   - **Untouched save:** under D4 `fieldMapping` is compared to the raw stored `{value: "amt"}`. It differs, so **`fieldMapping: {}` is sent**. A label-binding edit triggers the same thing even without D4: `fieldMapping: {label: "x"}` is sent.
   - **On the server:** the merge stores `fieldMapping` without `value`, while the stored `aggregation` is still `{agg: "sum"}`. `validateAggregation` does not run because `aggregation` was not written. `validateFieldMapping` only rejects unknown keys. So the write **succeeds**, and the metric is left with no field: it renders nothing.
   - **Today's code** avoids this by always sending `aggregation: {value, agg}`. This is a regression introduced by the plan.

   D4's caveat ("must not be rewritten unless it actually differs") names the symptom but gives no rule. Its literal rule (compare to the raw mapping) produces the failure. Task 1.1's "untouched aggregated metric" test does not pin the fixture shape, so it can pass on a `{value, agg}` fixture while the `{agg}` shape breaks.

   **Required:**
   - (a) In design.md D1/D4, state an explicit rule for metric so that `fieldMapping` and `aggregation` stay consistent after the server merge. For example, either:
     - whenever the metric `fieldMapping` is sent, the builder includes `value: metricField` whenever `metricField` is set (the server accepts equal values in both, `:148`); or
     - `fieldMapping` and `aggregation` are always sent together when either one is sent.
   - (b) Restrict D4's raw comparison so that it only detects stale **slot** keys (`annotation`/`label`/`unit` present in the stored mapping but not bound by the editor state). Do not compare whole objects; whole-object comparison causes spurious sends on any normalization difference (for example `safeRecord` dropping non-string values).
   - (c) In task 1.1, pin the fixtures to the `{agg}` + `fieldMapping.value` shape. Cover two cases:
     - an untouched save sends no `config`;
     - binding only the Label to a field sends a payload whose server-merged result still resolves a metric field.

     Optionally add a seam assertion through the backend merge or `metricShape`.
   - (d) Add the `{agg}`-shape metric to the 3.2 live before/after check.

### Non-blocking notes

- D1's baseline is "the builder fed from the stored config's read-back values". `useBoundOrLiteralState` holds state objects, so the implementer has to build equivalent plain `BoundOrLiteralState` values for the baseline. Seeding them from the same expressions at `OutputEditorSheet.tsx:221-253` (ideally a shared helper) avoids drift.
- `config` is memoized on the `output` prop (`OutputEditorSheet.tsx:204`). If the prop refreshes while the sheet is open, the baseline moves while the editor state does not. This is rare and does not block, but a short comment would help.
- The HEL-1388 overlap is handled correctly: when the kind changes, the full config is sent.
