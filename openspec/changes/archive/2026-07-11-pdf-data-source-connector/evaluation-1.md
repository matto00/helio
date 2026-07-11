## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

Verification detail:
- All ticket ACs addressed: new `.pdf` connector, per-page text extraction,
  `filename`/`sizeBytes`/`pageCount`/`pageNumber`/`characterCount` metadata
  fields, `StringBodyType` content, file upload + URL ingestion via
  `ContentSourceSupport.fetchUrl`, HEL-215 wiring parity (Flyway, route/service
  matches, frontend step/config card).
- No AC silently reinterpreted; the one documented Non-Goal (single
  full-document-string mode) is explicitly out of scope per ticket's "either
  shape" phrasing and is consistent with HEL-215's own precedent.
- All 28 `tasks.md` items checked and each verified against the diff — matches
  actual implementation exactly (no task marked done without corresponding
  code).
- No scope creep: every file touched is listed in the proposal's Impact
  section; the two extra frontend touch-points
  (`SourceDetailPanel.tsx`/`BoundSourceBar.tsx` `labelForKind` switches) are a
  required consequence of widening `DataSourceKind` (exhaustive switch), not
  unrelated work, and are called out in `files-modified.md`.
- No regressions: full backend suite (1123 tests) and full frontend suite (804
  tests) pass fresh (re-run by me, not trusted from executor's self-report).
- API contracts updated: `DataSourceProtocol`/`DataSourceConfigCodec`/OpenAPI
  spec delta (`specs/pdf-connector/spec.md`) all present and consistent with
  the implementation.
- Planning artifacts (proposal/design) match the final implementation with no
  drift.

### Phase 2: Code Review — PASS
Issues: none blocking.

Verification detail:
- **Canonical code-quality (`npm run check:scala-quality`)**: exits clean, 0
  hard errors. The three large files flagged by the task prompt
  (`DataSourceService.scala` 634 lines, `DataSourceRoutesSpec.scala` 893 lines,
  `InProcessPipelineEngineSpec.scala` 817 lines) are correctly **informational
  only** — confirmed directly against `CONTRIBUTING.md:123`: "File-size
  warnings (~250 lines per source, ~80 for aggregators) are informational
  only," and the check script (`scripts/check-scala-quality.mjs`) treats file
  size as a `softWarnings` push, never a `hardErrors` push. This is not a gate
  failure.
- **No inline FQNs (hard rule)**: script confirms 0 hard errors across the
  whole `backend/src/{main,test}/scala` tree, including all HEL-214 files.
  One **non-blocking** observation: `DataSourceService.scala:500`
  (`case _: java.nio.file.NoSuchFileException =>` in the new `refreshPdf`) and
  `InProcessPipelineEngine.scala:120` (`java.nio.file.Paths.get(...)` in the
  new `loadPdfRowsFromBytes`) are inline FQNs in the prose sense of
  CONTRIBUTING.md's "Imports & Qualifiers" rule — but `java.nio.file.` is not
  in the check script's `FQN_PREFIXES` list (only `java.nio.charset.` is), so
  it is not currently a **[mechanical]** violation, and both lines exactly
  mirror 3 pre-existing occurrences of the identical pattern already in the
  same file (CSV/Text `refresh`, predating this change). Not a regression;
  logged as a non-blocking suggestion below.
- **DRY**: `pdfFields`/`ingestPdf`/`refreshPdf`/`finishPdfRefresh` factor
  shared logic correctly; `PdfSourceForm.tsx` mirrors `TextSourceForm.tsx`
  almost verbatim (diffed directly — only PDF-specific strings/accept-type
  differ), which is the intended "connector parity" pattern, not duplication
  that should have been abstracted (HEL-215's design explicitly calls for
  per-connector forms).
- **Design-standard mechanical rules**: `PdfSourceForm.tsx` introduces zero
  new CSS — it reuses existing `add-source-modal__*` classnames exclusively.
  Grepped the new files for hardcoded hex/px: zero hits. Token compliance is
  inherited, not re-implemented.
- **Type safety**: no `any`; discriminated unions extended correctly on both
  sides (Scala sealed trait, TS union) with exhaustive-match compiler
  enforcement (`DataSourceSpec` explicitly tests the exhaustive match covers
  all 6 subtypes).
- **Security**: URL ingestion goes through `ContentSourceSupport.fetchUrl`
  unchanged — confirmed by direct code read (`createPdfUrl`/`refreshPdf`) and
  by live-fired SSRF-guard tests (both automated `DataSourceRoutesSpec` cases
  and my own manual curl against a loopback URL, which was correctly
  rejected — see Phase 3). No bespoke HTTP client exists anywhere in the diff.
- **Error handling**: ingest-time `PdfTextSupport.validate` returns
  descriptive `Left` for encrypted/corrupt files (mapped to 400); pipeline-run
  extraction failures fail loudly via `IllegalArgumentException`
  (`InProcessPipelineEngine.loadPdfRowsFromBytes`), not a silent empty result.
- **Tests meaningful**: exercised every new code path — `PdfTextSupportSpec`
  (validate/extractPages incl. corrupt/encrypted), `DataSourceServiceSpec`
  (upload/URL/refresh/delete/**update-rename regression** — the exact miss
  design.md flagged), `DataSourceRoutesSpec` (multipart + JSON routes, SSRF
  regression), `InProcessPipelineEngineSpec` (per-page row shape),
  `DataSourceSpec` (ADT exhaustiveness). All independently re-run by me
  (fresh, not trusting executor's self-report) and pass.
- **No dead code**: no leftover TODO/FIXME; no unused imports (would have
  failed `check:scala-quality`/ESLint).
- **No over-engineering**: single-pass `PDFTextStripper` subclass is the
  minimum necessary abstraction; no premature generalization of PDF's
  multi-row shape into the shared `ContentSourceSupport` helper (correctly
  deferred per design.md's rebase-surface rationale).
- **Single-pass, non-quadratic extraction — explicitly confirmed**: grepped
  `PdfTextSupport.scala` for `setStartPage`/`setEndPage` — zero hits (only a
  doc-comment describing the anti-pattern being avoided). `extractPages`
  calls `stripper.getText(document)` exactly once; per-page text is
  accumulated via `writeString`/`endPage` overrides during that single walk.
- **Four closed-match touch points — all confirmed present**:
  `DataSourceRepository.rowToDomain`/`domainToRow`/`update` (all three `case
  p: PdfSource =>` present) **and** `DataSourceService.update`'s separate
  match (`case p: PdfSource => p.copy(name = newName, updatedAt = now)` at
  the exact spot design.md flagged as the easy miss). Live-verified via curl
  `PATCH /api/data-sources/:id` on an uploaded PDF source → 200 (not a 500
  `MatchError`).

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via canonical script; `assert-phase.sh servers` → PASS.

Verified end-to-end with fresh evidence (not trusting executor's report):
- **Happy path — URL ingestion (UI)**: created a PDF source via the browser
  against a real 4-page external PDF
  (`https://css4.pub/2015/textbook/somatosensory.pdf`); schema correctly shows
  all 6 fields (`content`/`filename`/`sizeBytes`/`pageNumber`/`pageCount`/
  `characterCount`, all typed correctly); label reads "PDF" (not
  fallback/blank) in both the source list and pipeline `BoundSourceBar`.
- **Happy path — pipeline row-loading (UI)**: created a pipeline bound to the
  4-page PDF source and ran it — result: **"Snapshot replaced: 4 rows"**
  (exactly one row per page). Opened the preview table:
  `pageNumber` = 1,2,3,4 (1-indexed, in order); `pageCount` = 4 on every row;
  `sizeBytes` = 145349 on every row (matches the actual downloaded file size);
  `characterCount` differs per row (1423/1427/2127/1444) — confirms per-page
  text is genuinely distinct, not a single concatenated blob repeated across
  rows (which would indicate a single-pass extraction bug).
  `characterCount == content.length` is additionally asserted directly by the
  automated `InProcessPipelineEngineSpec`/`PdfTextSupportSpec` tests (re-run
  fresh, passing).
- **Happy path — file upload (backend, curl** since the Playwright MCP tool
  set available to me does not expose a file-chooser handler for native
  `<input type=file>` dialogs — confirmed via `browser_click` producing an
  unhandleable "Modal state: File chooser" that no available tool could
  dismiss): `POST /api/data-sources` multipart with `type=pdf` and a valid
  2-page PDF → 201 with correct `config.path`.
- **Unhappy paths (backend, curl + automated)**: corrupt bytes → 400;
  encrypted/password-protected PDF → 400; wrong extension → 400; oversized
  (automated, `PayloadTooLarge`) → 413; unreachable URL → 502; **loopback URL
  SSRF probe** (`http://127.0.0.1:8294/health`) → rejected with "URL host
  '127.0.0.1' resolves to a disallowed address" (guard intact, live-fired, not
  just from the automated suite).
- **Rename/refresh/delete (curl, live)**: `PATCH` (rename) → 200; `POST
  .../refresh` → 200; `DELETE` → 204. Confirms the `DataSourceService.update`
  closed-match fix works against the running server, not just in unit tests.
- **No console errors** during any of the above UI flows (checked via
  `browser_console_messages`; the only errors present in the session were
  from my own out-of-band manual `fetch()` calls made outside the app's auth
  context, not from the application itself).
- **Loading/empty/error states**: PDF form reuses `add-source-modal__error`
  (shared error-display pattern) and the existing schema/preview
  loading-state components — no new ad-hoc state UI introduced.
- **Entry points**: PDF is reachable via the standard "Add source" →
  `SourceTypeToggle` flow (only entry point for any connector type; verified
  present and correctly labeled).
- **Accessible names / keyboard**: `PdfSourceForm`'s ingestion-method toggle
  has `role="group"` + `aria-label="PDF ingestion method"`; file input and
  URL field both have associated `<label htmlFor>`; all buttons have visible
  text names. Consistent with `TextSourceForm`'s established pattern.
- **Breakpoints**: screenshotted the Add-Source modal (PDF selected) at 1440,
  1100, 768, and 375px — no layout breakage, no overflow, no clipped
  controls at any width.
- **Light/dark parity**: screenshotted light theme — the PDF form introduces
  zero new CSS (100% reused classnames), so parity is inherited automatically
  from the existing `add-source-modal__*` styles; visually confirmed no
  regression.

### Overall: PASS

### Non-blocking Suggestions
- `DataSourceService.scala:500` and `InProcessPipelineEngine.scala:120` use
  inline `java.nio.file.NoSuchFileException` / `java.nio.file.Paths.get(...)`
  rather than a top-of-file `import java.nio.file.{NoSuchFileException,
  Paths}`. This isn't currently caught by `check-scala-quality.mjs` (its
  `FQN_PREFIXES` list has `java.nio.charset.` but not `java.nio.file.`), and
  both instances exactly mirror 3 pre-existing occurrences of the identical
  pattern already in `DataSourceService.scala` (CSV/Text `refresh`,
  predating this change) — so this is following established (if imperfect)
  local precedent, not a new anti-pattern. Worth a follow-up cleanup pass
  across the file (and possibly widening the lint script's `FQN_PREFIXES`
  list to catch `java.nio.file.` too) but not a reason to block this PR.
