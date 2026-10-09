## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD `eda9ed491428c904ab9d486146ed65b47c003ba7` (change dir untracked). Read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-output-sheet/spec.md and skeptic-design-{1,2,3}.md. Re-checked the decisions against `buildOutputConfig.ts`, `OutputEditorSheet.tsx`, `useBoundOrLiteralState.ts`, `useOutputColumnFormats.ts`, `PipelineDetailPage.tsx`, `types/output.ts` and `OutputConfigValidation.scala`.

### What I verified (with evidence)

**Round-3 CR1 (damaged-metric repair contradicted D4/D4a) is resolved.**
- The spec scenario "Already-damaged fieldMapping is repaired on save" now says: "...and no other config key, except that for a metric the paired `aggregation` is sent with it so the metric stays bound".
- The matching task 1.1 bullet says: "repaired `fieldMapping` sent (for the metric, together with the paired `aggregation`, D4a) and no other key".
- D4a now records the two accepted departures from byte-for-byte preservation: `{agg}` normalized to `{value, agg}`, and an explicit `aggregation: null` where no key was stored.

**Round-3 non-blocking notes were also taken up.**
- The aggregated-metric label-only case is labelled a GUARD with a mutation requirement.
- The test merge is named explicitly as `{...stored, ...payload.config}`.
- D4 excludes a null or empty stored slot from stale detection.
- Fixtures for untouched saves avoid null and empty slots.

**Independent re-check against the code:**
- **Defect sites (C1 red-first is achievable for each bullet).** Collection `layout: "grid"` and timeline `sort: "asc"` are hard-coded at `buildOutputConfig.ts:129,133`. Metric `label`/`unit` are `undefined` outside literal mode (`:112-119`), so the key is omitted on the literal-to-field switch. The chart `fieldMapping` spreads the stored base, including `annotation` (`:69-74`), and is seeded once via `useState(chartConfig.fieldMapping)` at `OutputEditorSheet.tsx`.
- **Server contract.** `mergeConfig = existing.fields ++ patch.fields` (`OutputConfigValidation.scala:199`). `tolerated` accepts `JsNull` for a stored key (`:64-68`). `validate` only inspects `written` keys, so a smaller patch cannot introduce a new 400. The scatter/aggregation check runs on the merged config (`:114`); under D1 a switch to scatter sends `aggregation: null` because the built value differs from the baseline.
- **Client type.** `UpdateOutputPayload.config` is optional (`types/output.ts:84-87`), so "omit `config`" is expressible with no type change.
- **Baseline stability for table formats.** `useOutputColumnFormats` seeds `specs` from the stored map unchanged (`:57`) and does not re-seed when capabilities load. Baseline and built therefore agree on an untouched save, and no spurious `columnFormats` key goes out.
- **Bound/literal round-trips.** Mode comes from literal presence (`OutputEditorSheet.tsx`: annotation is non-null/undefined, metric label/unit is `!== undefined`). `fieldMappingValue` exists only in field mode with a field chosen (`useBoundOrLiteralState.ts:55`). Under D3 a stored literal `""` builds as `null` on both sides, so an untouched save still sends nothing. A damaged row opens in literal mode with the stale slot in `fieldValue`, so D4(ii) fires as designed.
- **Metric under D4a.** The builder's `value`-only-when-unaggregated rule (`:100`) is the coupling the design replaces. Untouched saves send no `config` for both the today-editor shape `{fieldMapping:{}, aggregation:{value,agg}}` and the canonical `{fieldMapping:{value}, aggregation:{agg}}` shape. In both, `built.fieldMapping` equals the baseline (both carry `value`), and `aggregation` matches as well.
- **Scope.** Each AC bullet maps to a 1.1 test, a 2.x implementation task and a 3.2 live row. HEL-1394 and HEL-1388 are correctly kept out of scope. No API or schema delta is needed, since the server already supports the semantics; the backend change is a guard test only.

### Verdict: CONFIRM

### Non-blocking notes
- **Spec wording.** The requirement prose and the "Untouched save sends no config" scenario ("any existing Output") read as absolute. The damaged-row scenario is a stated exception. Specific-over-general resolves it, and tasks.md scopes the untouched fixtures to clean rows. Prefixing the untouched scenario with "a non-damaged Output" (or adding "except the stale-slot repair below") would remove any final-gate ambiguity.
- **Sheet remounting.** `OutputEditorSheet` is mounted without a `key` (`PipelineDetailPage.tsx:333-343`), and most per-kind `useState` seeds run only on mount. If the user could open a different Output while the sheet stays mounted, the built state (seeded from the old Output) would be diffed against the new Output's baseline. This is not a regression: today it would send the whole stale config. If the implementer touches this, `key={output?.id ?? "create"}` is the cheap fix, but it is outside the ticket.
- **Kind-change behaviour.** When `kind !== output.kind`, D1 sends the full config, which is today's behaviour. Make sure the final report flags the overlap with HEL-1388, as the Risks section promises.
