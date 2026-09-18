## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Diff scope**: `git diff 19d16159c41ff17463436a6d502705e5c409ca41...HEAD` (BASE_SHA resolved
  live via `resolve-review-base.sh`, not a cached ref) — 32 files, confined to the file-field path
  (backend validation/storage/route, frontend control/hook/submit, plus spec deltas). No scope
  creep found.

- **Backend tests, re-run fresh** (not trusted from the evaluator's report):
  `sbt "testOnly com.helio.api.routes.panels.FormSubmitRoutesSpec com.helio.domain.panels.FormSubmissionSpec"`
  → 48/48 passed, including the file-field suites for success/path-traversal/required/extension/
  size/C3-sibling-fail/optional-unsupplied scenarios.

- **Frontend tests, re-run fresh**:
  `npx jest --testPathPatterns="FileField|FormFieldControl|FormPanelView|formSubmission|useFormPanelValues|formUploadConfig"`
  → 68/68 passed.

- **No HTTP-fetchable route for a `binary-ref` by `storageKey`**: independently confirmed via
  `grep` — `PublicUploadRoutes.scala` only serves `GET /api/uploads/image/:id` keyed by an
  `ImageUpload` DB id, not by `storageKey`; no route anywhere in `backend/src/main/scala/com/helio/api/routes/`
  resolves a `storageKey` to bytes, for either form uploads or pre-existing pipeline binary-refs.
  The evaluator's report discloses this openly rather than hiding it, and the AC's "resolves to a
  fetchable file" is satisfiable at the `FileSystem`-abstraction level (verified live below) —
  matching the pre-existing convention for every other `binary-ref` cell in the codebase (no
  regression, no new gap this ticket introduced).

- **Live write-path verification (C3), against the running app, my own requests (not trusting the
  evaluator's or the executor's numbers)** — started servers via
  `scripts/concertino/start-servers.sh`/`assert-phase.sh` (PASS), authenticated in-browser via
  `fetch()` (real session cookie + `X-Helio-Requested-With` CSRF header), against panel
  `6c585a6c-60af-4cd4-ae19-f0d25381d54d` / data source `8674b3b4-a461-4eae-9b7d-4a0da156958a`:
  - Baseline: 3 rows in `dataset_rows` (verified via `psql`), 3 files under
    `~/.helio/uploads/form-uploads/`.
  - Valid submit (`title` + `photo` file, 18 bytes) → `201`; row count → 4; file count → 4; the
    new file's on-disk bytes (`cat`) matched the uploaded content exactly
    (`skeptic test bytes`); row cell held `{"filename","mimeType","sizeBytes":18,"storageKey"}`
    matching the on-disk file.
  - Sibling-field-fails submit (`title` blank, valid `photo` attached) → `400`
    `fieldErrors:[{"field":"title","reason":"required"}]`; row count and file count **both
    unchanged** (4/4) — proves C3's "rejected submit stores no file" live, not just in a stubbed
    spec.
  - Path-traversal filename (`../../../../etc/passwd.txt`, allowed extension) → `201` accepted
    (valid submit); the appended row's `storageKey` was a plain
    `form-uploads/<uuid>.txt`; `find / -iname "passwd.txt"` (whole filesystem) found nothing —
    the caller-supplied path never escaped the uploads root, confirming D3/C3's path-traversal
    closure live, not just by code inspection.

- **C1 (computed ARIA state, not markup presence)**, verified via `browser_evaluate` DOM
  inspection of the live page (not the accessibility-tree snapshot alone): the file `<input>`'s
  accessible name is computed from a real `<label for="_r_9_">photo</label>` association (not a
  bare `aria-label` — `input.getAttribute('aria-label')` is `null`), and `aria-describedby`
  (`_r_d_`) points at a separate status span whose live text content is "No file selected".
  Keyboard operability verified by actually pressing Tab from the sibling `title` field and
  reading `document.activeElement` — landed on the file `<input type="file">` directly (native
  tab order, no custom key handling needed for Enter/Space per native `<input type=file>`
  semantics).

- **Light/dark parity, verified with a real theme toggle** (not a DOM attribute hack — my first
  attempt via `document.documentElement.setAttribute('data-theme', ...)` produced a stale
  `--panel-surface-override` inline style computed once at mount, which I recognized as an
  artifact of not going through React state and re-did via Settings → "Switch to dark theme").
  Screenshots (persisted):
  - `.concertino/runs/HEL-1086/evidence/skeptic-evidence/skeptic-light.png`
  - `.concertino/runs/HEL-1086/evidence/skeptic-evidence/skeptic-dark2.png`
  Both show the `FileField` control ("Choose File" / "No file chosen" / "No file selected")
  visually consistent with the sibling `title` text field and `Submit` button, no unthemed/
  hardcoded colors. `FileField.tsx`/`.css` read directly: uses only `--app-*`/`--space-*`/
  `--text-*` tokens throughout (`var(--app-text)`, `var(--app-border-subtle)`,
  `var(--app-surface-soft)`, `var(--space-1..3)`, `var(--text-sm)`/`var(--text-xs)`), no literal
  colors/spacing anywhere in the diff.

- **No genuine console errors**: the only console `[ERROR]` entries across my live session are
  the expected `400`/`403` resource-load logs from my own intentional rejected-submit probes —
  no application runtime errors.

### Non-blocking note (design risk, not a defect I could reproduce)

`PanelService.submitFormWithFiles` writes file bytes via `FileSystem.write` **before** the final,
lock-protected `buildRow` re-validation inside `DataSourceService.appendFormRow` — the same
"resolve declaration fresh under the source's own lock" pattern `appendFormRow`/`appendRows`
already rely on for every write path. If the dataset's declared schema changed concurrently
between the pre-lock placeholder check and the in-lock re-check (an already-accepted, pre-existing
race for every append path in this codebase), the in-lock `buildRow` could reject an already-bytes-
written file, producing an orphaned file — a narrow miss against design.md's own stated Goal ("A
rejected submit ... leaves neither a stored file nor an appended row") that the Non-Goals section
explicitly reasoned about when rejecting a two-step upload-then-reference flow for exactly this
orphan risk. I could not reproduce this live — it requires a genuine concurrent schema mutation
within a single request's two-buildRow window, which is not exercisable via a simple sequential
probe. Flagging for the record, not blocking: it's the same risk class as every other pre-lock-
read/in-lock-revalidate path in this service, not a novel regression, and no test or live probe
demonstrated an actual orphan.

### Verdict: CONFIRM

Every ticket AC traces to live-verified behavior: local-backend upload works and resolves to a
byte-for-byte-fetchable file at the storage-abstraction level (GCS explicitly, correctly disclosed
as not locally exercisable — no GCS-specific code was added, so the backend-agnostic `FileSystem`
coverage is the applicable evidence); the file picker is keyboard-operable with a computed
accessible name and a visible, `aria-describedby`-linked selected-file state (verified live, not
from markup presence, per C1); the write path is proven red-then-green by mutation at the
API/filesystem level for both the "rejected submit stores no file" and "path-traversal-safe
storage key" scenarios (C2/C3). Gates re-run fresh and green. No scope creep, no hidden AC
reinterpretation, no regression to the six pre-existing non-file controls.
