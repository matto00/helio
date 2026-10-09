## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD `eda9ed491428c904ab9d486146ed65b47c003ba7`; the change dir is still untracked. Read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-output-sheet/spec.md, skeptic-design-1.md and skeptic-design-2.md. Then checked each decision against `buildOutputConfig.ts`, `OutputEditorSheet.tsx` (state seeding and Save), `useOutputTableColumns.ts`, `useBoundOrLiteralState.ts`, `outputConfigTypes.ts` and `OutputConfigValidation.scala`.

### What I verified (with evidence)

**Round-2 CR1 is addressed in the text.**
- (a) D4a adds two rules: the metric builder always includes `fieldMapping.value`, and metric `fieldMapping` and `aggregation` are sent together.
- (b) D4's raw comparison now only detects stale slots.
- (c) Task 1.1 pins the `{agg}` + `fieldMapping.value` fixture for two cases: an untouched save, and a label-only edit with a merge assertion.
- (d) Task 3.2 includes the `{agg}`-shape metric.
- The round-2 non-blocking notes are partly reflected: the baseline uses identical seeding, and Risks covers the HEL-1388 kind change.

**D4a holds up against the server.**
- `metricShape` (`OutputConfigValidation.scala`) accepts `fieldMapping.value` equal to `aggregation.value`. It rejects them only if they conflict, or if neither is set.
- Pairing is necessary, not decorative. Today's editor writes the shape `{fieldMapping:{}, aggregation:{value,agg}}`. If a user sets agg to none on that shape, `aggregation: null` goes out, and without pairing the stored `fieldMapping` would stay `{}`, leaving the metric unbound. With pairing, `fieldMapping:{value}` goes too.

**D3 table rule holds up against the hook.**
- `useOutputTableColumns.ts:93-105` returns `undefined` for any visible subset kept in natural relative order. That is the bug D3 corrects.
- The hook re-seeds from `initialColumnOrder` when `fieldKeys` changes (`:53-56`). So a baseline computed by the same function over the same current `fieldKeys` matches the built value both before and after capabilities load.
- Stale keys in a stored order are filtered identically on both sides (`buildOutputColumns`, `:21-24`).

**Red-first claims (C1) are plausible for each bullet-test against today's code.**
- `layout`/`sort` are hard-coded (`buildOutputConfig.ts:129,133`).
- Metric literal→field sends `label: undefined`, so the key is omitted (`:112-119`).
- Table all-visible-natural and `["b","a"]`→`["a","b"]` both produce `columnOrder: undefined`, so the key is omitted (hook `:105`).
- Chart annotation removal keeps the stored slot through the spread (`:69-74`, seeded at `OutputEditorSheet.tsx` `useState(chartConfig.fieldMapping)`).

**Damaged-row detection works.**
- A chart with a literal `annotation` opens in literal mode, because the mode is `annotation !== undefined && !== null`. The builder adds no slot, so the stale raw `fieldMapping.annotation` triggers D4(ii).
- A metric with a literal `label` opens in literal mode; `readMetricConfig` reads `label` only if it is a string. `fieldMappingValue` is `undefined` outside field mode (`useBoundOrLiteralState.ts:55`), so the stale raw `fieldMapping.label` triggers D4(ii).

**The null/absent round-trip is consistent.**
- A stored `label: null` reads as `undefined`, which opens in field mode, which builds `null`. That equals the baseline, so nothing is sent.
- Stored defaults stay unchanged on an untouched save:
  - collection `format` absent: seeded `"number"` in both the baseline and the built value, so not sent;
  - `columnFormats` `{}`: equal on both sides;
  - `compare`: seeded `"none"`, which is equal on both sides.

**Validation is no stricter under a patch.** `validate` only checks keys in the written body (`written.fields`), so sending fewer keys cannot introduce a new 400.

### Verdict: REFUTE

The design is sound and every round-1 and round-2 defect is fixed. One remaining contradiction between artifacts will force the implementer to pick one of two readings. It will also make whichever the implementer does not choose a spec divergence at the final gate. The fix is a wording change.

### Change Requests

1. **The damaged-metric repair scenario contradicts D4/D4a.**
   - D4 says that when stale-slot repair fires on an untouched save, the request carries "the repaired `fieldMapping` (plus whatever D4a requires) and nothing else".
   - D4a requires that, for the metric kind, "`fieldMapping` and `aggregation` are sent together whenever either is sent".
   - So a damaged metric's untouched save MUST also send `aggregation`. That is `{value, agg}` for an aggregated metric, and `null` for a non-aggregated one, which also turns a stored-absent `aggregation` into a stored `null`.
   - But two artifacts say no other key is sent:
     - `specs/pipeline-output-sheet/spec.md`, scenario "Already-damaged fieldMapping is repaired on save": "THEN the PATCH request sends `fieldMapping` without the stale slot, **and no other config key**";
     - `tasks.md` 1.1: "already-damaged chart ... and metric ..., untouched save → **only repaired `fieldMapping` sent**".
   - Under D4a, a correct implementation cannot satisfy that scenario or test for the metric case.

   **Required:** make the three artifacts agree.
   - Reword the spec scenario and the task 1.1 bullet. For example: "sends `fieldMapping` without the stale slot and no other config key, except that for a metric the paired `aggregation` is also sent (D4a)".
   - State in D4a whether sending `aggregation: null` for a non-aggregated metric whose stored config has no `aggregation` key is acceptable. Readers treat `null` as absent, so it is acceptable, but it is a deliberate departure from byte-for-byte and should be written down.
   - Alternatively, narrow D4a so pairing only applies when either side carries a non-null aggregation, and keep "no other key" for the non-aggregated case.

### Non-blocking notes

- Task 1.1(b) is not red-first. That is the aggregated-metric label-only edit, asserting the merged result stays bound. Today's code always re-sends `aggregation: {value, agg}`, so the merged metric is already bound and the test passes on pre-fix code. Under C1 it is a GUARD against the regression this design would otherwise introduce. Label it as one and show it fails under a mutation, e.g. dropping D4a's `value`, or dropping the pairing.
- D4(ii) would also fire for a stored `fieldMapping.<slot>` whose value is not a string or is empty, e.g. `annotation: null` or `""`. `safeRecord` drops non-string values, and an empty `fieldValue` adds no slot. The result is a one-time rewrite of `fieldMapping` on an untouched save. This is harmless and arguably a repair, but the untouched-save tests should not use such fixtures by accident.
- Task 1.1(b)'s "assert via the merge" in a frontend test means applying a shallow `{...stored, ...patch}` in the test. Name that explicitly, or rely on 3.2's live row for the real seam.
