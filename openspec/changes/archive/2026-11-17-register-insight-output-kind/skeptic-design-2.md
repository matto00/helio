## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/{insight-output-kind,outputs-model}/spec.md against the
tree at 96ed5156bcbab59e32d2536186eef692ce00a5c3. The change dir is untracked, and no code has changed yet.

### Round-1 change requests: verification

1. **LegacyOutputConfigKeys removed from the total-map list. ADDRESSED.**
   - D8 now names exactly `KnownKeys`, `OutputBindingSpec.All` and `OutputPanelDefaultSize.Sizes`.
   - D8 states that insight needs no legacy entry and why.
   - Task 1.6 no longer mentions legacy keys.
   - Residue: the Context paragraph still lists `LegacyOutputConfigKeys.scala:43` among "per-kind maps" (nit N-a).
2. **D4 on restore paths and tolerance. ADDRESSED.**
   - D4 lists all six write paths and checks only paths 1-3.
   - Paths 4-6 (RestorePriorStored rollback, draft undo, raw `restoreBoundOutputs`) are skipped.
   - D4 judges `reads` only when it is introduced or changed, and keeps DraftDiff's short-circuit.
   - Tests: task 3.2 covers dangling-reads `PATCH {prompt}` returning 200 and rollback not being refused. The spec
     adds the scenario "Unrelated edit with dangling reads succeeds".
   - I checked the plumbing this relies on. `OutputService.update` already receives `policy`
     (`OutputService.scala` update signature), so gating the reads check on it is straightforward.
3. **KeysDoc. ADDRESSED with decision (a).**
   - D6 excludes Insight from `KeysDoc` until L8.
   - D6 updates `AssistantProposalToolSchemasSpec:273` and `RefinementEditShapeSpec:388`.
   - The drift table pins the exclusion, and the spec requirement states it.
   - A third spec also asserts this and was missed (note N-b).
4. **No-rows claim. ADDRESSED.**
   - D7 now says row fetching is unchanged (via `usePanelData`, as for markdown). The insight branch ignores
     `rawRows`.
   - Task 3.6 tests only the "Not yet rendered" text.
   - The spec says "SHALL NOT request a model render or call any new endpoint", which the plan can meet.
5. **Schema contract gap. ADDRESSED.**
   - D8a covers:
     - the five enums
     - node-capabilities prose
     - the per-kind key prose and `properties` in create-output-request, update-output-request,
       create-pipeline-transactional-output-request and draft-save-request
   - Task 1.7 matches D8a.

Round-1 non-blocking notes that were adopted:
- **N1.** D1 now says a non-exhaustive match is not a compile guard. It relies on the `all` round-trip spec and pins
  the `fromString` message.
- **N2.** null clears a key. This matches `mergeConfig = existing ++ patch` (the null is stored), so `InsightConfig`
  must treat JsNull as absent, and D4 says so.
- **N3.** `[]` and absent are defined differently.
- **N4.** An insight may not read another insight.
- **N6.** The drift check reads the live constraint via `pg_get_constraintdef`, and an empty extraction fails.
- **N5.** HEL-1733's draft files are covered by task 0.2's "incl. HEL-1733 draft files".

### Fresh checks (with evidence)

- **Highest migration.** The highest is still `V137__lock_pipelines_for_definition_writes.sql` (local listing), so
  V138 is free. `git fetch` of origin hung in this sandbox, so this is checked against local main at 96ed5156b only.
  D2 mandates re-checking before commit.
- **L3 dependency.** The L3 archive exists at `openspec/changes/archive/2026-11-17-insight-grounding-pack-validator/`.
  `InsightPreset` has exactly auto, delta, trend, leaders and summary, with `fromString`
  (`domain/insights/InsightPreset.scala:12-20`). This matches the spec's preset set.
- **Windows.** `OutputCompare.MaxWindow = 365 days` and `previous_run` is a distinct case
  (`domain/history/OutputCompare.scala:15,19,26`). The spec's window rule, "custom up to 365 days, previous_run
  rejected", is implementable by reuse as D3 says.
- **Tolerance semantics.** `OutputConfigValidation.validate` and its helpers `tolerated`/`changed`
  (`OutputConfigValidation.scala:57-82`) judge only written-and-changed keys. D4's "only when reads is introduced or
  changed" follows that existing idiom.
- **Minimal create stores `{}`.** `OutputService.create` writes `req.config.getOrElse(JsObject.empty)` unchanged, so
  the "stored config is `{}`" scenario holds if defaults are never written back, as D3 says.
- **Backend kind sites.** The backend kind sites are only the ones the design names. `OutputKind.Markdown`/`Timeline`
  appear outside `model.scala` only at `PanelPacker.scala:148-149`, `OutputConfigValidation.scala:27-28`,
  `LegacyOutputConfigKeys.scala:43`, `OutputBindingSpec.scala:91,106,168` and
  `AssistantProposalToolSchemas.scala:292`. I found no other `case OutputKind.` match.
- **Frontend kind sites.** All `"markdown"` and `kind ===` sites are in the files the design names, plus the
  `outputEditor/*` files and `outputRenderInputs.ts`/`historyRowRules.ts`/`conditionalFormatting.ts`. Those branch on
  specific kinds and fall through safely. The re-enumeration mandate in task 0.2 covers them.
  - `OutputPanelContent.tsx:271` already has an "Unsupported output kind" fallback, so an unhandled insight would
    degrade rather than crash.
- **Placeholders.** None: no TODO/TBD, and every range is concrete.
- **AC coverage.** Every ticket AC maps to a task:
  - fail-first: 0.1/D9
  - 400 cases: 3.1/3.2
  - drift + mutations: 3.4/3.5
  - not-yet-rendered: 2.2/3.6/3.8
  - reducer: 3.3
  - no model call: 3.7
- **Scope.** The plan stays inside the ticket. The `model` key is left out, as ticket.md's driver update says. I could
  not read the 23:30 comment itself, but leaving `model` out is consistent with the AC as written.

### Verdict: CONFIRM

All five round-1 change requests are concretely addressed, and I found no new blocking defect. The plan is specific
enough to implement and every AC is covered.

### Non-blocking notes

- **N-a.** design.md Context still lists `LegacyOutputConfigKeys.scala:43` among "per-kind maps". D8 corrects this,
  and D8 governs. The executor should follow D8.
- **N-b.** A third existing spec contradicts the KeysDoc exclusion and must be updated alongside the two D6 names:
  `OutputConfigValidationSpec.scala:174`, which asserts every KnownKeys key appears in KeysDoc.
- **N-c.** `OutputConfigValidationSpec.scala:26-30`, "accept every kind's full known set", writes the string `"x"`
  for every non-excluded key. Once insight value-range checks live in `validate`, Insight's `preset`/`refresh`/
  `maxSentences`/`maxChars`/`reads` placeholders will fail that test. Expect to adjust it with valid insight values,
  and treat it as a deliberate edit, not a fixture symptom.
- **N-d.** `PatchSetPreviewProjection` merges an output-update preview the same way `update` does (HEL-1239). If a
  preview runs `validateConfig` but not the new service-level reads check, a preview could pass and then the apply
  could 400. This is a low-impact case until L8 opens the proposal surface. Note it in sites.md if the preview path
  validates.
- **N-e.** The frontend has no `assertNever` helper; the existing idiom is `const _exhaustive: never = x`
  (`shared/chrome/resourceNavigation.ts:90`). Either use that idiom or add one shared helper.
- **N-f.** D3 still says the tolerance rule "applies unchanged since no insight row predates this change". That is
  true for value keys, and D4 now handles `reads` explicitly, so there is no conflict. The sentence could be
  tightened.
