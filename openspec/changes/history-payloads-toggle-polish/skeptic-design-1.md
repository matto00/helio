## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD e4289e6c88e4d8d0c174b94f1359817fe0466514 (change dir untracked; artifacts only).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/history-payloads-toggle-polish/HEL-1372`.

### What I verified (with evidence)

- **react-router `<Link target="_blank">` hands off to the browser.** The installed version is react-router(-dom) 7.18.3.
  In `node_modules/react-router/dist/development/chunk-BV7QT456.mjs:7431` you find
  `shouldProcessLinkClick(event, target)`, which returns false unless `!target || target === "_self"`, so a `_blank`
  click gets no client-side navigation. Design D5 holds.
- **Cold-load scroll.** `frontend/src/features/settings/ui/useScrollToHashSection.ts` has a second effect
  (deps `[active, id, settledKey]`) that runs on mount whenever `hash === "#beta-access"` and runs again each time a
  loading flag settles. `SettingsPage.tsx:132` always renders `<section id="beta-access">`, with no condition on tier.
  A cold new tab should therefore scroll. The design already makes the e2e the proof and does not assume it.
- **`maxAge.toDays` is lossless for `fromEnv`.** `PayloadHistoryConfig.fromEnv` builds every tier age as
  `Duration.ofDays(read(...).toLong)`, and `Defaults` uses `Duration.ZERO`/`ofDays` too. Grepping
  `PayloadTierLimit(` across `backend/src` turned up no sub-day construction. One instance comes from
  `Main.scala:157`, and that same instance is passed to ApiRoutes (`:279`), to retention (`:291`) and to
  PipelineRunService (`ApiRoutes.scala:462`). The served figures are therefore the enforced ones.
- **Every `historyPayloadsAvailable` stamp goes through `withAvailability`.** Grepping `historyPayloadsAvailable` in
  `backend/src/main` shows exactly one setter, `OutputRoutes.scala:46` inside `withAvailability`. All five routes
  call it: nested GET `:59`, POST `:69`, GET/PATCH `:87`/`:93`, and list `:190`. `OutputResponse` currently has 13
  fields, so the planned `jsonFormat14` is correct. `PatchSetUndoService:293` decodes `OutputResponse`, and an
  `Option = None` default keeps that working.
- **helio-mcp passes the backend JSON through.** `outputsHandlers.ts:55-81` returns `api.getOutput/updateOutput/
  listOutputsByPipeline/listAllOutputs` unchanged. `helioApi.ts:1110-1129` makes plain `http.get/patch<T>` calls,
  and `outputs.ts:35` `jsonResult` JSON-stringifies the value. Nothing projects fields away.
- **A visually-hidden utility exists.** `frontend/src/theme/theme.css:505` defines `.sr-only`, which DESIGN.md:481
  names as shared. The fallback in D5 (aria-label) will not be needed.
- **Note styling.** `OutputEditorSheet.css:58` `__field-hint` = `--text-xs` + `--app-text-muted`, and `:64`
  `__type-hint` = `--text-sm`. That confirms the size mismatch the ticket reports, and D6's fix is correct.
  `__upsell-link` (`:135`) sets no font-size and inherits it.
- **The schema has room.** `schemas/outputs/output.schema.json` has `historyPayloadsAvailable` with `readOnly` and
  top-level `additionalProperties: false`, so task 1.3 is needed and is planned.
- **The MODIFIED spec text is faithful.** I diffed both against `openspec/specs/`:
  - `output-history-payloads-toggle`: both modified requirements keep every original sentence and scenario. The only
    changes are the intended ones: figures are parameterised, the absent case is defined, the link opens a new tab
    with an accessible cue, and note size equals help size, with three added scenarios. The untouched third
    requirement ("legible in both themes") is correctly left out.
  - `mcp-output-tools`: the original text is kept. "1,000 rows or 1 MiB" is replaced with a reference to the field,
    "free keeps none" becomes "by default", and the discoverability scenario is updated.
  - `output-routes-api`: an ADDED requirement. Its route list matches the existing "report history-payload
    availability" requirement exactly.
- **AC coverage.** AC1 → 2.3/2.4 (new page, heading in view, unsaved name survives). AC2 → 1.1–1.3, including an
  override-flow test and the client-cannot-set test. AC3 → 2.1/2.2 (formatter with 500-row override; constant
  deleted, grep check). AC4 → 3.1. AC5 → 2.3/2.4 (class, computed font-size equality, both-theme screenshots). I
  found no scope drift: item 4 and compareOptions.ts are explicitly excluded.
- `openspec validate history-payloads-toggle-polish --type change --strict` → "Change ... is valid". I found no
  TODO/TBD in the change dir.
- The owner rulings (new-tab, backend field) are applied as settled, and the design does not reopen them.

### Verdict: CONFIRM

### Non-blocking notes
- The proposal's Impact list says `types/output.ts`. The real path is `frontend/src/features/pipelines/types/output.ts`
  (line 56 holds `historyPayloadsAvailable`). It is easy to find, but use the full path.
- The help sentence never mentions the free tier. If an operator sets free retention above 0, the editor stays silent
  about it. This matches the current copy and the "free keeps none by default" wording, so it is acceptable, but the
  formatter could add a free clause when `free` allows payloads.
- `maxAgeDays` comes from `Duration.toDays`. It is lossless for every `fromEnv`/`Defaults` value, but a hand-built
  test config with a sub-day `Duration` would serve `0` while `allowsPayloads` is true. Keep test configs day-granular,
  or note this in the scaladoc of `from`.
- The existing e2e (`e2e/hel1331-history-payloads-toggle.spec.ts:153`) clicks via a non-exact name match. It will still
  match once " (opens in a new tab)" is appended, but it currently asserts same-tab URL (`:154`), so task 2.4 must
  rewrite that block and not just add to it.
