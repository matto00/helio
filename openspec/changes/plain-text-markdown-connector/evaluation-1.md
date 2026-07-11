## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs addressed explicitly: upload creation, URL creation, `StringBodyType` content field,
  `filename`/`sizeBytes` metadata fields, `.txt`/`.md` extension acceptance, and connector wiring
  structured for HEL-214/HEL-216 reuse (`ContentSourceSupport.metadataFields`/`fetchUrl`).
- No AC silently reinterpreted. All 7 spec.md requirement blocks (upload, URL, size limits, UTF-8,
  pipeline-bindability, refresh, delete) map 1:1 to implemented code + passing tests.
- All 27/27 tasks.md items verified done and matching implementation (spot-checked 1.1–1.6, 4.1–4.2,
  5.1, 7.1–7.4 directly against code).
- No scope creep: the `SourceDetailPanel.tsx`/`BoundSourceBar.tsx` `labelForKind` edits are
  compiler-mandated exhaustive-switch fixes from widening `DataSourceKind`, not incidental changes.
- No regressions: full backend suite (1072 tests) and full frontend suite (794 tests) pass fresh,
  including all pre-existing CSV/Static/REST/SQL route and service tests.
- API contracts: `DataSourceProtocol`/`DataSourceConfigCodec` updated in the same change;
  `check:schemas` and `check:scala-quality` both pass clean.
- Planning artifacts (design.md's Decisions section) match the implemented behavior exactly — verified
  the two hardened route-dispatch decisions and the `PayloadTooLarge` decision are all rendered
  faithfully in code (see Phase 2).

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Route dispatch matches hardened design decisions.** `DataSourceRoutes.scala` has exactly one
  `createMultipartUploadRoute` (lines 117–165) that runs `Sink.seq` once and branches internally via
  `if`/`match` on an optional `type` part (default `"csv"`) — no second
  `entity(as[Multipart.FormData])`. JSON create dispatch is a single `entity(as[JsValue])` route
  (`createStaticRoute`, lines 88–109) that inspects `type` once and dispatches to
  `TextSourceUrlRequest` or `StaticDataSourceRequest` via `convertTo`. Neither hardened decision was
  reverted to the unsafe two-sibling-route shape.
- **All four ADT closure points confirmed present**, not just claimed: `DataSourceRepository.rowToDomain`
  (line 39-41), `domainToRow` (line 56), `update` (line 131), and — the one missed in planning round 1 —
  `DataSourceService.update`'s separate match (`DataSourceService.scala:241`,
  `case t: TextSource => t.copy(...)`). Confirmed via direct read, not executor self-report.
- **`InProcessPipelineEngine.loadRows` has a working `TextSource` case** (lines 62–70) producing the
  single-row `{content, filename, sizeBytes}` shape via `loadTextRowFromBytes`; verified end-to-end in
  Phase 3 (a real pipeline run against a live `TextSource` produced exactly one row with correct
  values).
- **`ServiceError.PayloadTooLarge` exists and is wired to 413.** `ServiceError.scala:37` adds the
  variant; `ServiceResponse.scala:56` maps it to `StatusCodes.RequestEntityTooLarge`. Both 413
  scenarios from spec.md (oversized upload, oversized URL fetch) are exercised by
  `DataSourceServiceSpec` ("reject an oversized upload with PayloadTooLarge",
  "return PayloadTooLarge when the fetched content exceeds the max size") and both pass.
- **The `toStrict(30.seconds)` → `toStrict(timeout, maxBytes)` fix is present and correct** in
  `ContentSourceSupport.fetchUrl` (`ContentSourceSupport.scala:78`): `response.entity.toStrict(30.seconds,
  fetchSizeLimitBytes)` with `fetchSizeLimitBytes = 104857600L` (100 MiB) — well above the default 8 MiB
  `max-to-strict-bytes` ceiling and well above the 10 MB business-rule limit enforced separately in
  `DataSourceService.ingestText`/`refreshText`. This correctly decouples the raw fetch ceiling from the
  user-facing size limit, matching the executor's stated root cause and fix.
- **DRY**: shared `ContentSourceSupport` object is the single seam for metadata-field construction and
  URL fetch — no duplicated logic between upload and URL ingestion paths (`ingestText` is the single
  private helper both `createTextUpload`/`createTextUrl` call).
- **Readable/modular**: `DataSourceService` cleanly separates create/update/delete/refresh/preview
  sections; `ContentSourceSupport` is a focused, well-documented single-purpose object.
- **Type safety**: no `any`/untyped escape hatches introduced; frontend `TextSourceConfig`/`TextSource`
  types are properly narrowed via `isTextSource`.
- **Error handling**: all failure paths (bad extension, oversized, non-UTF-8, unreachable URL) map to
  distinct `ServiceError` variants with correct HTTP status codes; frontend surfaces errors inline via
  `role="alert"`, consistent with sibling forms.
- **Tests meaningful**: `ContentSourceSupportSpec` (metadata fields/extension validation/URL filename),
  `DataSourceServiceSpec` (upload/URL create, refresh, delete, update, all failure modes),
  `DataSourceRoutesSpec` (multipart + JSON dispatch, explicit CSV/Static regression tests),
  `InProcessPipelineEngineSpec` (single-row loader + missing-path diagnostic) all exercise real code
  paths, not implementation details.
- **No dead code**: no unused imports or leftover TODO/FIXME in the diff.
- **No over-engineering**: design.md explicitly documents why `loadRows`'s text case is *not*
  generalized with CSV's (avoiding premature abstraction over three data points); the code follows that
  decision.
- **check:scala-quality** ran clean (0 inline-FQN violations). `DataSourceService.scala` is 470 lines,
  over the ~250-line soft budget and near the ~400-line "propose a split" threshold — this is
  informational-only per the script's own exit code (0) and policy, and matches the executor's
  self-flagged spinoff-candidate note. **Confirmed non-blocking, correctly characterized** — not a
  defect introduced by careless growth; the file was already the largest CSV/Static service before this
  change and the addition is proportionate to the new connector's scope.
- **Missing CSS classes for form action buttons** (`.add-source-modal__btn`,
  `.add-source-modal__btn--primary/secondary`, `.add-source-modal__actions`) are referenced by
  `TextSourceForm.tsx` but have no corresponding rules in `AddSourceModal.css` (or anywhere in the
  frontend). **Confirmed pre-existing, not introduced by this change**: the identical class names are
  used unstyled in `StaticSourceForm.tsx` and `SqlTab.tsx`, both of which predate HEL-215 (verified via
  `grep` and a side-by-side screenshot of the pre-existing "Manual" source form showing the same
  unstyled "Cancel"/"Next: Add rows" buttons). `TextSourceForm.tsx` correctly mirrors the existing
  (imperfect) convention rather than introducing a new defect. This is a legitimate pre-existing gap
  worth a follow-up ticket, but out of scope for HEL-215 and correctly characterized by the executor.

### Phase 3: UI Review — PASS
Issues: none blocking.

Ran fresh via the canonical scripts (`start-servers.sh` / `assert-phase.sh` — both reported healthy) and
independently exercised the flow in-browser (not trusting the executor's self-report):

- **Happy path (URL ingestion) end-to-end**: created a `.md` source via URL against a local test HTTP
  server; DataSource created with `type: "text"`, linked DataType shows `content` (`string-body`),
  `filename` (`string`), `sizeBytes` (`integer`) exactly per spec. Bound a new pipeline to the source and
  ran it — produced exactly 1 row with `content`/`filename`/`sizeBytes` matching the source file byte-
  for-byte (73 bytes, verified against `wc -c`).
- **Unhappy path**: URL resolving to an unsupported extension (`.pdf`) surfaced an inline
  `role="alert"` error ("Failed to create text source.") without a blank screen or unhandled exception;
  the one console "error" entry observed is the browser's standard `Failed to load resource: 400` log
  for the network response itself (identical to existing CSV/REST error paths), not a JS exception.
- **Delete flow**: deleting the text source correctly warned about the dependent pipeline
  ("1 pipeline reads from this source and will stop working"), confirmed, and removed the source —
  existing `SourceService` behavior, unaffected by this change.
- **No console errors** during any tested flow (happy path, error path, pipeline bind/run, delete).
- **Entry points**: Text/Markdown source creation reachable from the "Add source" modal's type toggle
  (upload and URL sub-modes both render and submit correctly); bound-source label renders
  "Text/Markdown" correctly in both `SourceDetailPanel` and `BoundSourceBar`.
- **Accessibility**: all interactive elements have accessible names (form fields, toggle buttons,
  radiogroup); labelled inputs verified via `getByLabelText` in both manual testing and the Jest test
  suite.
- Did not verify the 3 breakpoints/no-CSS-styling visual judgment call in exhaustive detail beyond
  confirming (via screenshot comparison against the pre-existing "Manual" form) that the unstyled-button
  issue is pre-existing, not introduced — full breakpoint/visual-polish judgment is deferred to the
  skeptic per the design-standard split of mechanical vs. judgment concerns.

### Overall: PASS

### Non-blocking Suggestions
- Consider a follow-up ticket to add the missing `.add-source-modal__btn`/`.add-source-modal__actions`
  CSS rules (affects `StaticSourceForm`, `SqlTab`, and now `TextSourceForm` — all three render unstyled
  action buttons). Pre-existing, not introduced by HEL-215.
- `DataSourceService.scala` (470 lines) is approaching the point where a split (e.g. extracting the
  text-source create/refresh helpers into their own file, mirroring `ContentSourceSupport`) would keep
  it under the soft budget. Informational only; no action required for this change.
