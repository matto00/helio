## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Precedent files exist with the claimed shapes.**
   - `frontend/src/features/pipelines/{services,state,ui}` — confirmed (`pipelineService.ts`,
     `pipelinesSlice.ts`, dozens of `ui/*.tsx`).
   - `frontend/src/features/metrics/ui/MetricsPage.tsx` + `MetricListTable.tsx` — read both in
     full. `MetricsPage.tsx` has exactly the fetch-on-mount + `status === "loading"/"failed"/
     "succeeded"` + empty-state shape design.md claims.
   - `frontend/src/features/auth/ui/UserMenu.tsx` — confirmed: a `role="menu"` popover with
     `role="menuitem"` buttons for theme toggle (line 121) and sign-out (line 137), plus an
     `AccentPicker` section. A new "Settings" `role="menuitem"` entry is a natural, minimal
     addition matching this exact shape.
   - `frontend/src/app/App.tsx` (route table, `ProtectedRoute`/`AppShell` nesting) and
     `frontend/src/store/store.ts` (`reducer: {...}` registration) — both confirmed as claimed.

2. **`window.confirm` removal claim — confirmed verbatim.** `grep -rn "window.confirm"
   frontend/src` returns zero live matches (only comments referencing its historical removal).
   `MetricListTable.tsx`'s header comment (lines 1-4) states verbatim: "an inline delete-confirm
   affordance (HEL-553 task 2.5) since no `window.confirm` is used anywhere else in this codebase
   (see `PipelineDetailPage.tsx`'s own inline discard-confirm)." design.md's Decision 5 quotes
   this claim accurately.

3. **Backend wire shapes — confirmed matching tasks.md 1.1/1.2.**
   `AgentPreferencesProtocol.scala`: `AgentPreferencesResponse(defaultSeriesColors:
   Option[Vector[String]], defaultPanelStyle: Option[JsObject], namingConventions:
   Option[JsObject], extras: JsObject)` and `PutAgentPreferencesRequest` (same four fields,
   `extras: Option[JsObject]`). `AgentMemoryProtocol.scala`: `AgentMemoryEntryResponse(id, kind,
   content, createdAt, lastUsedAt: Option[String])`. Both match tasks.md's field lists exactly
   (Option → `| null`, JsObject → `Record<string, unknown>`).

4. **`AppearanceEditor.tsx` coupling claim — confirmed.** Read the file in full: its props are
   individual `Dispatch<SetStateAction<...>>` setters wired to `PanelDetailModal`'s own
   `useState` calls, it takes a `panelTitle`/`title`/`setTitle` pair that has nothing to do with
   `defaultPanelStyle`, a `showChartSection`/`chartAppearance`/`setChartAppearance` sub-form
   entirely irrelevant to a bare `{background, color, transparency}` triple, and its markup is
   hardcoded to `panel-detail-modal__*` CSS classes. Design.md's characterization ("tightly
   coupled ... not meaningfully extractable") is accurate, not hand-waved.

5. **AC traceability.** All 5 ACs map to concrete tasks: AC1 → tasks 1.1-1.3/2.1/3.1-3.2/spec
   `settings-preferences-ui`; AC2 → tasks 1.3/2.1/3.3/spec `settings-agent-memory-ui`; AC3 →
   tasks 3.4/4.5; AC4 → tasks 4.1-4.4; AC5 → tasks 1.1-1.3/4.5. No AC is left uncovered, no task
   is unmoored from an AC. `grep -rni "TODO|TBD|placeholder"` across the change dir: zero hits.

6. **Decision 4's read-modify-write requirement is technically necessary, not just plausible.**
   Read `AgentPreferencesService.put` and its doc comment directly: `PUT` is a genuine full
   replace — "An absent `defaultSeriesColors`/`defaultPanelStyle`/`namingConventions` key decodes
   to `None` ... clearing any previously-stored value; an absent `extras` key normalizes to
   `JsObject.empty`." `AgentPreferencesServiceSpec.scala` has a test explicitly named "is a full
   replace: a second put omitting a previously-set field clears it (not a merge)." Decision 4's
   premise is ground-truth-confirmed, not invented.

### Verdict: REFUTE

### Change Requests

1. **`namingConventions`'s generic key/value editor plan (Decision 2 + task 3.2) has no
   preservation story for non-string values, and this is a real, already-tested gap — not a
   hypothetical.**
   - `schemas/agent-preferences.schema.json` types `namingConventions` as a bare `"type":
     "object"` with no `additionalProperties` restriction — genuinely arbitrary JSON (strings,
     booleans, numbers, nested objects/arrays are all legal).
   - The backend's own test suites already exercise **non-string** values there:
     `AgentPreferencesServiceSpec.scala` line ~113 and `AgentPreferencesRoutesSpec.scala` line
     ~83/129 both use `namingConventions = Some(JsObject("titleCase" -> JsBoolean(true)))` — a
     boolean, not a string — as a first-class round-trip case.
   - design.md Decision 2 commits to "a generic list-of-**string**-key/**string**-value rows
     editor" for `namingConventions`, and task 3.2 repeats "a `namingConventions` generic
     key/value rows editor." Neither specifies how a boolean/number/nested-object value already
     stored under a key that editor didn't create would survive a save. If the editor's rows are
     `string → string` (the only sane way to build a rows-of-text-inputs UI), then loading
     `{"titleCase": true}`, not touching that row, and clicking "Save" would coerce it to
     `{"titleCase": "true"}` — silently changing its JSON type, exactly the class of bug Decision
     4 exists to prevent for `extras` and `defaultPanelStyle`'s unexposed keys, but Decision 4's
     text explicitly scopes the "preserved verbatim" guarantee to only those two, never mentioning
     `namingConventions`.
   - The design's own "Risks/Trade-offs" section acknowledges only a *read-side* validation risk
     for `namingConventions` ("can't validate structure a future consumer might expect") and
     dismisses it because "no consumer ... exists anywhere yet." That mitigation doesn't address
     the *write-side* corruption risk this ticket itself introduces the first time this UI's Save
     button is used against a row it doesn't understand.
   - There is also no existing precedent in this codebase for a generic arbitrary-JSON key/value
     editor to fall back on (`grep -rn "Record<string, unknown>"` across `frontend/src` turns up
     typed row/config shapes, never a free-form JSON-object editor) — this is a genuinely new
     problem the design needs to solve, not an already-solved one being reused.
   - **Required revision:** either (a) extend Decision 4's "preserved verbatim" guarantee
     explicitly to `namingConventions` — e.g., the editor only surfaces/edits rows whose fetched
     value is a string, and any row whose value isn't a string (or any key the editor doesn't
     recognize) is carried through untouched into the `PUT` payload, mirroring the
     `defaultPanelStyle`-unexposed-key overlay approach — or (b) explicitly document a narrower,
     intentional scope (e.g., "this editor is string-values-only; a non-string value is
     [overwritten/rejected/flagged], which is an acceptable trade-off because ___"). Silence,
     as currently written, is the failure mode. Add a corresponding test to task 4.2 (or a new
     task) asserting a non-string `namingConventions` value survives an edit-and-save cycle
     unchanged, mirroring the existing `extras`-preservation test already planned there.

### Non-blocking notes

- `App.tsx`'s `breadcrumbLabel()` helper (lines 82-90) has no `/settings` case and would fall
  through to "Dashboards" if a `/settings` breadcrumb is ever rendered. Not an AC or a design.md
  requirement, and the design correctly scopes navigation to `UserMenu` rather than the
  sidebar/breadcrumb system, but worth a one-line mention in tasks.md if `SettingsPage.tsx` ends
  up needing a page heading of its own (it likely will, per `DESIGN.md`'s page-header
  conventions) — trivial to fix at implementation time either way.
