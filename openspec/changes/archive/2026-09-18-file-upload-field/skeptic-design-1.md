## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/file-upload-form-field/HEL-1086` — proceeded normally.
- **Read all planning artifacts**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/form-panel-rendering/spec.md`, `specs/form-panel-submit/spec.md`.
- **`binary-ref` wire convention** (`backend/src/main/scala/com/helio/domain/model/model.scala:679-692`):
  confirmed `BinaryRefType -> "binary-ref"` exists exactly as ticket.md/design.md claim.
- **`ImageUploadService.scala`** (full read): confirmed the claimed pattern — extension/size validation,
  `FileSystem.write(storageKey, bytes)` at `images/<uuid>.<ext>`, no separate DB "reference" abstraction
  beyond its own `ImageUpload` metadata row. `BinaryRef` (`model.scala:920-942`) is confirmed
  pipeline/`nodeStepId`-keyed, matching design.md's "not directly reusable for a literal form row" claim.
- **`FormSubmission.scala`** (full read): confirmed the exact current rejection
  (`field.control == "file" && supplied.isDefined => Left(FieldError(..., "file fields are not yet supported"))`,
  line 65-66) that tasks.md 1.4 targets, and confirmed `buildRow` is pure
  (`Map[String, JsValue] => Either[...]`) — consistent with design.md D2's presence-marker approach (no bytes
  needed inside `buildRow`).
- **`PanelRoutes.scala`** (`api/routes/panels/PanelRoutes.scala:108-113`): confirmed
  `POST /api/panels/:id/submit` currently only accepts `entity(as[FormSubmitRequest])` (JSON), matching
  design.md's D1 premise.
- **Multipart precedent** (`api/routes/sources/DataSourceRoutes.scala:88-113, 252-259`): confirmed
  `concat(createStaticRoute, createMultipartUploadRoute)` — Pekko's per-branch `entity(as[X])` unmarshaller
  rejection is what makes the two branches dispatch on Content-Type, which is the real mechanism behind
  design.md D1's "same pattern" claim (worth being precise about in the design: it's unmarshaller-rejection
  fallthrough via `concat`, not an explicit `Content-Type` header switch — a minor terminology nit, not a
  blocker).
- **Client-side extension-allowlist precedent**: `ImageEditor.tsx:19-22` already hardcodes
  `ACCEPTED_UPLOAD_EXTENSIONS` "kept in sync manually" with `ImageUploadService.allowedExtensions" — this
  resolves what looked like an open question (how does client-side validation in task 2.5 know the server's
  allowlist without a new config-exposing endpoint?): there's direct precedent for exactly this
  hardcoded-and-manually-synced approach, so it's not a design gap.
- **The disclosed "wart"**: reproduced with a live `openspec validate --strict` run. Baseline (as-is)
  validates clean. I then edited a **scratch copy** (`/tmp/.../scratchpad/test-openspec`, never the worktree)
  to drop the awkward "File control is surfaced as not yet supported" scenario outright —
  `openspec validate` failed with: `MODIFIED "Inconsistent or not-yet-supported fields are surfaced, never
  dropped" omits scenario(s) the current spec still has... Copy them into the MODIFIED block`. This confirms
  the constraint is real, not an excuse. I then tried the alternative the orchestrator's prompt raised —
  **splitting the requirement** via `REMOVED Requirements` (retiring the old combined requirement with a
  `Reason`/`Migration`) + `ADDED Requirements` (a fresh "Inconsistent fields are surfaced, never dropped"
  requirement retaining only the orphaned-field scenario, alongside the already-planned new file-picker
  requirement) — this **validates clean**, with no awkward no-op scenario. This is a concrete, mechanically
  proven cleaner alternative.
- **Purpose-text staleness**: proposal.md claims "the spec's Purpose already scopes itself to 'non-file
  fields', which this change supersedes." Checked `specs-apply.js` (openspec CLI's archive-merge logic,
  `/usr/lib/node_modules/@fission-ai/openspec/dist/core/specs-apply.js`) — the only place `Purpose` is
  referenced is a template string used when a spec is created fresh by archiving; there is no logic that
  merges/replaces an existing spec's `## Purpose` section from a change delta. The live spec's Purpose line
  (`openspec/specs/form-panel-rendering/spec.md:4-6`, read directly) currently reads "renders its non-file
  fields on a dashboard." Since the change's delta file has no `## Purpose` section, archiving this change
  will leave that stale "non-file fields" sentence in place even though `file` becomes a fully rendered field
  after this ships — the proposal's "supersedes" claim is not actually backed by any task or delta.

### Verdict: REFUTE

### Change Requests

1. **`specs/form-panel-rendering/spec.md` — replace the "N/A" no-op scenario with a `REMOVED
   Requirements` + `ADDED Requirements` split**, proven above to validate cleanly: retire the old
   "Inconsistent or not-yet-supported fields are surfaced, never dropped" requirement (with a `Reason`/
   `Migration` note) and re-add it under a new name (e.g. "Inconsistent fields are surfaced, never dropped")
   containing only the surviving orphaned-field scenario. Keep the already-planned new "A `file` field
   renders a keyboard-operable picker..." requirement in the `ADDED` section as-is. This avoids permanently
   landing a confusing "**THEN** N/A" scenario in the archived spec — an eyebrow-raising artifact for anyone
   reading `openspec/specs/form-panel-rendering/spec.md` after archive who has no context on why a scenario's
   outcome is "N/A."
2. **Add a task to update the `form-panel-rendering` spec's `## Purpose` line** (currently "renders its
   non-file fields on a dashboard," `openspec/specs/form-panel-rendering/spec.md:4-6`) once file rendering
   ships. Confirmed via reading `specs-apply.js` that `openspec archive` never rewrites an existing spec's
   Purpose section from a delta — proposal.md's claim that this change "supersedes" that Purpose framing is
   currently unbacked by any task or mechanism. Either add a manual post-archive edit step to `tasks.md`
   section 3.4, or (if openspec's delta format is later found to support a `## Purpose` override — I did not
   find one in the shipped CLI version in this environment) apply it there instead.

### Non-blocking notes

- Design.md's description of D1 ("Pekko HTTP dispatches on `Content-Type`, same pattern
  `DataSourceRoutes.createMultipartUploadRoute` already uses") is slightly imprecise — the actual mechanism
  is `concat` + per-branch unmarshaller rejection, not an explicit Content-Type switch. Doesn't change the
  implementation plan, just a wording nit worth tightening so the executor doesn't go looking for an explicit
  `Content-Type` match that isn't the real pattern.
- Everything else — D2 (presence-marker before `buildRow`), D3 (storage key namespace), D4 (config +
  allowlist), D5 (client sends multipart only when a file is attached), and the tasks/spec-delta correspondence
  for `form-panel-submit` — checked out cleanly against ground truth and is internally consistent.
