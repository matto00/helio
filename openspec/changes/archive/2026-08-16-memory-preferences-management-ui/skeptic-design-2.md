## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **The round-1 gap (namingConventions non-string-value corruption on save) is closed, and I
   re-derived the underlying facts from ground truth myself rather than trusting the claim.**
   - `schemas/agent-preferences.schema.json`: `namingConventions` is `{"type": "object"}` with no
     `additionalProperties` restriction — confirmed unconstrained.
   - Independently re-grepped (not just re-read round 1's citation) for non-string round-trip
     coverage: `backend/src/test/scala/com/helio/api/routes/AgentPreferencesRoutesSpec.scala:83,129`,
     `backend/src/test/scala/com/helio/infrastructure/AgentPreferencesRepositorySpec.scala:76,93`,
     and `backend/src/test/scala/com/helio/services/AgentPreferencesServiceSpec.scala:113` **all**
     use `namingConventions = Some(JsObject("titleCase" -> JsBoolean(...)))` — a boolean is a
     first-class, multiply-tested case, confirming this was never a hypothetical.
   - design.md Decision 2 now states the editor is explicitly **string-values-only**: "the editor
     lists and edits only the keys whose fetched value is a JSON string; any key whose fetched
     value is not a string ... is never rendered as an editable row and is instead carried through
     untouched on save, via the same overlay mechanism Decision 4 uses for `defaultPanelStyle`'s
     unexposed keys — never silently coerced to a string."
   - Decision 4 now explicitly extends the "preserved verbatim" guarantee to
     `namingConventions` ("any non-string-valued (or otherwise editor-unexposed) keys in
     `namingConventions` are all preserved verbatim on save, never dropped or coerced") and
     specifies the mechanism precisely: `settingsSlice` keeps the full fetched object and performs
     "a shallow merge of the edited/recognized keys over the fetched object, not a wholesale
     replacement of either object." Because the overlay set (string-valued, editor-recognized
     keys) is by construction disjoint from the never-rendered non-string keys, a shallow merge
     of that overlay onto the fetched base is logically sufficient to guarantee preservation —
     this isn't just asserted, it follows from how the two pieces (Decision 2's row-filtering +
     Decision 4's merge-over-fetched-base) compose.
   - tasks.md 3.2 mirrors this exactly for the implementer ("string-values-only... never rendered
     as a row and is carried through untouched... shallow-merge the edited/recognized
     `defaultPanelStyle`/`namingConventions` keys onto the full fetched objects").
   - tasks.md 4.2 now requires a concrete regression test: "a non-string `namingConventions` value
     (e.g. `{"titleCase": true}`) survives an edit-and-save cycle unchanged — asserting it is
     neither dropped nor coerced to a string in the dispatched save payload."
   - `specs/settings-preferences-ui/spec.md` gained a new scenario, "A non-string namingConventions
     value is preserved, not coerced," under the "Saving preferences persists edits and preserves
     unexposed fields" requirement, giving this an explicit acceptance signal, not just an
     implementation-task footnote.

2. **The folded-in non-blocking note (App.tsx breadcrumb) is present and accurate.** Re-read
   `frontend/src/app/App.tsx` lines 82-90 myself: `breadcrumbLabel()` has cases for `/`,
   `/sources`, `/pipelines`, `/registry`, `/metrics`, `/chat`, and falls through to "Dashboards" —
   confirmed no `/settings` case exists. tasks.md 3.1 now carries the one-line addendum verbatim
   ("`App.tsx`'s `breadcrumbLabel()` helper has no `/settings` case and falls through to
   'Dashboards'; add one if a breadcrumb ends up rendered for this route").

3. **No regression in the other four decisions — re-verified independently, not by trusting
   round 1's report.**
   - `frontend/src/features/auth/ui/UserMenu.tsx` lines 121 and 137: two `role="menuitem"` items
     (theme toggle, sign-out) — confirmed the shape a new "Settings" entry would match.
   - `frontend/src/features/metrics/ui/MetricListTable.tsx`: `confirmDeleteId` state (line 35) and
     a header comment citing the deliberate removal of `window.confirm` — confirmed.
   - `grep -rn "window.confirm" frontend/src`: zero live calls; only two comments
     (`PanelCreationModal.tsx:92`, `PipelineDetailPage.tsx:98`) referencing its historical removal
     — confirmed the "never `window.confirm`" premise still holds.
   - `frontend/src/store/store.ts` lines 21-33: a flat `reducer: {...}` map of ten existing slices
     — confirmed `settings` would register the same way.
   - `frontend/src/app/App.tsx` lines 583-594: `<Route element={<ProtectedRoute />}>` wrapping
     `<Route element={<AppShell />}>` with a flat list of authenticated routes — confirmed a
     `/settings` route slots in identically.
   - `backend/src/main/scala/com/helio/services/AgentPreferencesService.scala`: `put()` builds the
     stored record directly from `req.defaultPanelStyle`/`req.namingConventions` (lines 32-33),
     confirming the full-replace semantics Decision 4 depends on are still accurate.

4. **AC traceability holds with the updated docs.** AC1 (view/edit/persist preferences) →
   tasks 1.1-1.3/2.1/3.1-3.2, now including the non-string-preservation guarantee, and
   `settings-preferences-ui` spec's new scenario. AC2 (memory list/delete/clear-all) →
   tasks 1.3/2.1/3.3, `settings-agent-memory-ui` spec — unchanged from round 1, re-checked and
   still intact. AC3-AC5 → tasks 3.4/4.1-4.5 — unchanged, re-checked and still intact. No AC is
   left uncovered.

5. **No placeholders or new hand-waving introduced by the revision.**
   `grep -rni "TODO|TBD|placeholder|figure out later"` across the change dir returns zero hits in
   actual content (the only match is the grep command itself, quoted inside
   `skeptic-design-1.md`'s own report text).

### Minor point considered and not escalated

design.md Decision 2 / tasks.md 3.2 describe the `namingConventions` editor as "editable rows"
without repeating the explicit "add/remove/edit" language tasks.md gives `defaultSeriesColors`.
This could be read as intentionally scoping `namingConventions` to edit-existing-string-keys-only
(no add/remove of keys) — which would make the shallow-merge-over-fetched-object mechanism fully
sufficient with no deletion-tombstone question ever arising. Checked whether any AC or spec
scenario requires add/remove of `namingConventions` keys specifically: none does — both the
`settings-preferences-ui` spec's display and save-preservation scenarios only exercise
pre-existing keys. So this omission doesn't leave any acceptance-relevant behavior unspecified or
contradicted; it reads as a defensible (if implicit) scope narrowing, not a new gap. Flagged below
as non-blocking only, not a required revision — the round-1 defect (silent type corruption) is
fully closed regardless of how this resolves.

### Verdict: CONFIRM

The round-1 required revision is fully and correctly addressed: the string-values-only scoping
(Decision 2) plus the extended shallow-merge preservation guarantee (Decision 4) together give
`namingConventions` the same non-corruption guarantee `extras` and `defaultPanelStyle` already
had, tasks.md 3.2/4.2 give the implementer an unambiguous mechanism and a concrete regression
test, and the spec gained a matching acceptance scenario. The plan is internally consistent, every
AC still traces to concrete tasks/specs, and no new placeholders, contradictions, or scope drift
were introduced by the revision.

### Non-blocking notes

- Consider making explicit in tasks.md 3.2 whether the `namingConventions` rows editor supports
  adding a brand-new key or removing an existing string-valued row, or whether it is
  view/edit-existing-only. Not required — no AC or spec scenario mandates add/remove — but an
  explicit one-line statement either way would remove the only remaining reader-dependent
  interpretation in this decision, the same class of ambiguity that produced the round-1 finding.
