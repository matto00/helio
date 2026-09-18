## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
- All three ticket ACs addressed: local-backend upload works (verified live); the resulting
  `binary-ref` cell resolves to the real stored bytes on the local `FileSystem` (verified live —
  written file's content matched the uploaded bytes exactly); the file picker is a native
  `<input type="file">` with a real `<label for>`-computed accessible name ("photo") and a
  separate, `aria-describedby`-linked visible/announced selected-file status span.
- GCS backend is explicitly NOT re-exercised (design.md Risks, tasks.md 3.2) — correctly flagged
  rather than silently implied; `FileSystem`'s abstraction is backend-agnostic and this change adds
  no GCS-specific code, so this is a reasonable, explicitly-called-out scope boundary, not a gap
  the executor tried to hide.
- No AC silently reinterpreted. No scope creep found — diff is confined to the file-field path
  (backend validation/storage/route, frontend control/hook/submit, plus the two spec deltas).
- No regressions: full backend suite (4679/4679) and full frontend suite (332 suites / 3608 tests)
  both green; the six previously-shipped non-file controls are untouched behaviorally (D5: JSON
  submit path unchanged when no file is attached).
- API/schema: no new persisted table (as design.md's Migration Plan states); `binary-ref` cell
  shape (`storageKey`/`mimeType`/`filename`/`sizeBytes`) matches the existing `BinaryRef` domain
  model's field names exactly — genuinely "the same wire convention already used elsewhere," not
  just claimed.
- Planning artifacts reflect the implemented behavior; tasks.md 1.1–3.3 correctly marked done, 3.4
  (post-archive spec Purpose-line edit) and 3.5 (live theme check) correctly left unchecked with an
  accurate, non-misleading note on each — 3.4 is genuinely an archive-time step not yet due, and 3.5
  is now closed by this evaluation (see Phase 3).
- Standing constraints (C1–C3, workflow-state.md CONSTRAINTS) are honored — see Phase 3 for the
  live evidence backing each.

### Phase 2: Code Review — PASS
Ran fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE`):
- `npm run lint` — clean (0 warnings).
- `npm run format:check` — clean.
- `npm test` (full suite) — 332 suites / 3608 tests passed.
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk warning, unrelated to
  this change).
- `cd backend && sbt test` (full suite) — 313 suites / 4679 tests passed.
- `npm run check:scala-quality` — clean (0 inline-FQN violations; only pre-existing soft
  file-size warnings, informational-only per the script's own semantics).
- `npx openspec validate file-upload-field --strict` — valid.

Code-quality findings:
- Design D1–D5 are implemented faithfully: `concat`-based multipart/JSON dispatch in
  `PanelRoutes.scala` mirrors `DataSourceRoutes.createMultipartUploadRoute`'s existing convention
  (including the same `toStrict(60.seconds)` no-explicit-size-limit trade-off already accepted
  there — not a new risk this ticket introduces); `PanelService.submitFormWithFiles` correctly
  implements the two-phase validate-then-store flow (D2), never writing bytes before the pre-lock
  `buildRow` pass returns `Right`; `FormUploadConfig`'s storage-key shape (`form-uploads/<uuid>.<ext>`)
  never uses the caller-supplied filename, closing path traversal by construction (D3) — verified
  live, not just read.
- `FormSubmission.buildRow`'s file-control branch reuses the existing required/undeclared/select
  branching structure cleanly; `validateFilePlaceholder` correctly handles both the pre-lock
  placeholder and the final real `binary-ref` object (same `filename`/`sizeBytes` shape).
- No dead code, no leftover TODO/FIXME, no untyped escape hatches. Tests are meaningful — the new
  `FormSubmitRoutesSpec` file-field suite specifically covers the C3 "sibling field fails, valid
  file must not be written" scenario with real before/after write-call counts against a stub
  `FileSystem`, not just a happy-path check.
- Non-blocking: `PanelService.scala` was already over the file-size soft budget before this ticket
  and grew by ~108 lines to 707 lines. Not a gate failure (informational warning only), but a
  reasonable candidate for a future decomposition pass (e.g. extracting the file-submit path into
  its own collaborator) if the file keeps growing.

### Phase 3: UI Review — PASS
Frontend changes (and a modified spec area) triggered this phase. Servers started via
`scripts/concertino/start-servers.sh`/`assert-phase.sh` (PASS). Built a live form panel (`Manual`
dataset source with a `title` string field and a `photo` binary-ref field, bound to a new form
panel) and exercised it directly against the running app rather than trusting the code:

- **C1 (computed ARIA state, not presence)**: confirmed via DOM inspection of the live page — the
  file `<input>` has a real `<label for="…">photo</label>` association (not a bare `aria-label`),
  computing the accessible name "photo" (matches the a11y-tree snapshot's `button "photo"`), and
  `aria-describedby` points at a separate status span whose text ("No file selected") is part of
  the control's computed accessible description. Tab order was verified live: focus moves from the
  `title` textbox directly to the file `<input type="file">` — correct keyboard operability.
- **C2 (mutation-style proof, one layer at a time)**: submitted a live multipart request with a
  `.exe` file — rejected `400` with `fieldErrors: [{"field":"photo","reason":"invalid"}]`, and no
  new file appeared on disk (file count in `~/.helio/uploads/form-uploads/` unchanged before/after)
  — proves the extension check is real and not masked by a different validation layer (e.g. the
  select-branch or the generic type check).
- **C3 (write-path caution)**:
  - Local backend upload → real bytes verified byte-for-byte on disk under
    `~/.helio/uploads/form-uploads/<uuid>.<ext>` (read the file directly from the filesystem after
    a live submit; content matched exactly what was uploaded). The stored `storageKey` in the
    appended row's cell matched the on-disk filename.
  - Rejected-submit-stores-no-file, live: submitted a valid file alongside a sibling required field
    left empty (`title` required, blank) — response `400`, row count unchanged (2 before/after),
    and no new file written to `form-uploads/` (3 files before/after). This is the exact C3
    "valid file + sibling failure" scenario, exercised live, not just in the stubbed route spec.
  - Path-traversal-safe storage key, live: submitted a file whose filename was
    `../../../../etc/passwd.txt` — the appended row's `storageKey` was still a plain
    `form-uploads/<uuid>.txt`, and no file appeared outside the configured uploads root (confirmed
    via `find` for the literal string `passwd` under the uploads root — none found).
- **DESIGN.md compliance (mechanical)**: `FileField.tsx`/`.css` use only `--app-*`/`--space-*`/
  `--text-*` tokens (visually confirmed against the running app in both themes — screenshots
  persisted, see below); no hardcoded colors/spacing found in the diff.
- Screenshots captured live and persisted (tasks.md 3.5, previously unchecked, is now closed by
  this evaluation): dark theme
  (`.concertino/runs/HEL-1086/evidence/filefield-dark.png`) and light theme
  (`.concertino/runs/HEL-1086/evidence/filefield-light.png`) — the file control's "Choose File" /
  "No file chosen" / "No file selected" rendering is visually consistent with its sibling `title`
  text field and the panel's `Submit` button in both themes; no unthemed/hardcoded colors visible.
- No console errors observed across the full live flow (panel creation, field configuration,
  successful submit, rejected submits ×3).
- "Resolving to a fetchable file" (AC): confirmed for the local backend at the storage-abstraction
  level — `FileSystem.write`'s bytes are readable back byte-for-byte at the stored `storageKey`.
  Note for the record (not a defect in this ticket's scope): there is currently no HTTP route that
  serves a `binary-ref` file back by `storageKey` for either form uploads or pre-existing pipeline
  binary-refs — this mirrors the existing convention exactly (proposal.md's Impact section never
  lists a download route, and no such route exists for `BinaryRefRepository`-backed pipeline
  binary-refs either), so this is a pre-existing, out-of-scope gap, not a regression or an
  unmet AC for this ticket.

### Overall: PASS

### Non-blocking Suggestions
- `PanelService.scala` (707 lines) is well past the file-size soft budget and grew further with
  this ticket's file-submit path. Consider extracting `submitFormWithFiles`/`foldFilePlaceholders`/
  `storeFormFiles` into a small collaborator (e.g. `FormFileSubmitSupport`) in a future pass if the
  file keeps growing — not required for this ticket.
- Consider filing a follow-up ticket for a generic `binary-ref` download/serve route (form-upload
  and pipeline binary-refs both currently lack one) if "fetchable via HTTP" becomes a real product
  requirement rather than storage-level resolvability.
