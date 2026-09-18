## 1. Backend — file storage + validation

- [x] 1.1 Add a form-upload constant/config (`FORM_UPLOAD_MAX_FILE_SIZE_BYTES`, extension allowlist) following
      `ImageUploadService`'s pattern (design.md D4).
- [x] 1.2 Add multipart handling to `POST /api/panels/:id/submit` (`PanelRoutes.scala`): dispatch on
      `Content-Type`, alongside the existing JSON `entity(as[FormSubmitRequest])` branch, following
      `DataSourceRoutes.createMultipartUploadRoute`'s pattern (design.md D1).
- [x] 1.3 In `PanelService.submitForm`, fold attached files into a presence-marker `values` map (design.md
      D2), call `FormSubmission.buildRow` unchanged, then on `Right`: validate each file's extension/size,
      write bytes via `FileSystem.write("form-uploads/<uuid>.<ext>", bytes)` (design.md D3), substitute the
      real `binary-ref` JSON object into the row, then `appendBuiltRow` under the existing lock.
- [x] 1.4 Remove `FormSubmission.scala`'s unconditional `file`-control rejection (line ~64-66); replace with
      required/undeclared/unconfigured handling identical to other controls, using the presence marker.
- [x] 1.5 Confirm the file-extension/size rejection path returns `400` with `fieldErrors` reason `invalid`
      (or `required` when missing) and writes neither file nor row — no partial writes on any failure path,
      including when the file itself is valid but a sibling field fails.

## 2. Frontend — render + capture

- [x] 2.1 Add a `file` case to `FormFieldControl.tsx`: an `<input type="file">`-based control with a visible
      selected-file/no-file-selected state, wired to the field's `label`/`helpText`/error the same way the
      other six controls are (reuse `FormField` wrapper).
- [x] 2.2 Remove the "file upload is not yet available" not-yet-supported branch for `control: "file"` from
      the renderer's inconsistent-field handling (`FormFieldControl.tsx`/`FormRenderer.tsx`).
- [x] 2.3 Extend `useFormPanelValues.ts` (or a sibling hook) to hold a `File | null` per file field, with
      required/empty semantics matching every other field.
- [x] 2.4 Extend `formSubmission.ts`/`panelService.ts`: build `FormData` (multipart) when any file field is
      populated, else keep sending plain JSON (design.md D5) — zero behavior change for existing forms.
- [x] 2.5 Client-side file validation (extension/size) before submit, mirroring the server's rules, with the
      error surfaced exactly like every other field's validation error (spec: computed accessible
      description, focus move).

## 3. Verification

- [x] 3.1 Backend unit tests: `FormSubmission` file-field required/optional/undeclared cases;
      `PanelService.submitForm` file-storage success, rejected-submit-stores-no-file (including the
      valid-file-but-sibling-fails case), extension/size rejection, path-traversal-safe storage key.
- [x] 3.2 Backend test exercising `HELIO_UPLOADS_BACKEND=local` (`FormSubmitRoutesSpec`'s file-field suite,
      via a spy `FileSystem`, mirroring the route-level tests' existing convention for the whole
      `POST /api/panels/:id/submit` route). `gcs` is NOT separately re-exercised here — this change adds no
      new GCS-specific code (only a new `form-uploads/` storage-key prefix and a new inline metadata shape,
      both backend-abstraction-agnostic), so `GcsFileSystemSpec`'s existing coverage of the `FileSystem`
      abstraction itself is the applicable evidence (design.md Risks, as flagged there).
- [x] 3.3 Frontend unit tests for `FormFieldControl`'s file case: computed accessible name, selected-file
      visible state (initial + after selection), required/optional validation (`formSubmission.test.ts`,
      `FormFieldControl.test.tsx`, `FormPanelView.test.tsx`). Keyboard-operability (Enter/Space opens the
      platform picker) is NOT separately asserted in jsdom — a native `<input type="file">` gets this for
      free from the browser and jsdom cannot open a real OS file-picker to observe it; this is the same gap
      task 3.5 (a live/Playwright check) is positioned to close, not yet exercised here (see 3.5 below).
- [ ] 3.4 Update `openspec/specs/form-panel-rendering/spec.md` and `openspec/specs/form-panel-submit/spec.md`
      via archive (this file's own spec deltas apply on `openspec archive`). `openspec archive` does NOT
      rewrite an existing spec's `## Purpose` section from a delta — after archiving, manually edit
      `openspec/specs/form-panel-rendering/spec.md`'s Purpose line from "...renders its non-file fields..."
      to drop "non-file" (file fields are now in scope), as its own follow-up edit/commit. NOT done by the
      executor — `openspec archive` is a later delivery-workflow step, run once this change is accepted.
- [ ] 3.5 Manual/Playwright check against the running app in both light and dark theme (DESIGN.md binding).
      NOT executed this cycle — no dev server was running in this environment and standing this one up was
      out of this pass's scope/budget. Flagged explicitly rather than claimed: the `FileField` component
      reuses existing `--app-*`/`--space-*`/`--text-*` tokens (`ui-input`/`ui-toggle`'s own convention) and
      passes the repo's mechanical token-adoption guards (`focusRingTokenGuard`, `motionTokenGuard`,
      `elevationTokenGuard`), but has not been visually compared against the running app in both themes.

## Standing Constraints

- [C1] Assert computed ARIA state, never presence.
- [C2] Prove behavior red by mutation, one layer at a time.
- [C3] Write-path caution: uploads target only the configured backend; a rejected submit stores no file and
      writes no row; a stored reference cannot resolve outside the uploads root.
