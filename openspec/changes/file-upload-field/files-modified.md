## Backend

- `backend/src/main/scala/com/helio/domain/panels/FormUploadConfig.scala` — new: form-file-field extension allowlist/size-bound constants (design.md D4), pure (`sys.env` read once at object-init).
- `backend/src/main/scala/com/helio/domain/panels/FormSubmission.scala` — replaced the unconditional `file`-control rejection with real required/undeclared/extension/size validation against a presence-marker or real `binary-ref` placeholder (design.md D2).
- `backend/src/main/scala/com/helio/services/panels/PanelService.scala` — `submitForm` gains an optional `files` param and a two-phase (pre-lock validate, then write-then-atomic-append) file-attached path (`submitFormWithFiles`, `foldFilePlaceholders`, `storeFormFiles`); new nullable-optional `fileSystem` constructor dependency.
- `backend/src/main/scala/com/helio/api/routes/panels/PanelRoutes.scala` — `POST /api/panels/:id/submit` gains a multipart branch (`submitFormMultipartRoute`) alongside the existing JSON branch, dispatched via `concat`/unmarshaller-rejection (design.md D1).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `fileSystem` into `PanelService`'s constructor.
- `backend/src/test/scala/com/helio/domain/panels/FormSubmissionSpec.scala` — replaced the obsolete "file rejected" test with placeholder validate/required/extension/size coverage.
- `backend/src/test/scala/com/helio/api/routes/panels/FormSubmitRoutesSpec.scala` — new file-field route-level suite: local-backend store + resolvable `binary-ref` cell, path-traversal-safe storage key, required/extension/size rejections, "no file written on sibling-field failure" (C3), optional-unsupplied.

## Frontend

- `frontend/src/shared/ui/FileField.tsx`,
  `frontend/src/shared/ui/FileField.css` — new file-picker primitive (native `<input type="file">` + a visible, `aria-describedby`-linked "selected file" status span).
- `frontend/src/features/panels/state/formUploadConfig.ts` — new client-side mirror of the backend's extension/size defaults (UX-only convenience check).
- `frontend/src/features/panels/ui/form/useFormPanelValues.ts` — `FormFieldValue` widened to `File | null`; a `file` control's empty representation is `null`.
- `frontend/src/features/panels/ui/form/FormFieldControl.tsx` — removed the "not yet available" disabled branch; added a real `file` case to the control switch.
- `frontend/src/features/panels/state/formFieldValidation.ts` — `isEmptyValue` treats an unset `file` control (no `File`) as empty.
- `frontend/src/features/panels/state/formSubmission.ts` — `file` is now editable (extension/size validated via `formUploadConfig.ts`); new `buildSubmitFiles`; `mapServerFieldErrors` routes a file field's server error to `fieldMessages` like any other editable field.
- `frontend/src/features/panels/ui/form/FormPanelView.tsx` — submits `buildSubmitFiles`'s output alongside `buildSubmitValues`.
- `frontend/src/features/panels/services/panelService.ts` — `submitFormPanel` gains an optional `files` param; switches to a multipart `FormData` body only when at least one file is attached (design.md D5).
- `frontend/src/features/panels/state/formSubmission.test.ts`, `frontend/src/features/panels/ui/form/FormFieldControl.test.tsx`, `frontend/src/features/panels/ui/form/FormPanelView.test.tsx`, `frontend/src/features/panels/ui/form/useFormPanelValues.test.ts` — updated for file-as-editable behavior; added file-specific scenarios (computed accessible name, initial/post-selection visible state, required/extension/size field errors, multipart submit).
- `frontend/src/theme/motionTokenGuard.css.test.ts`, `frontend/src/theme/elevationTokenGuard.css.test.ts` — bumped the hardcoded CSS-file-count assertion (115 → 116) for the new `FileField.css`.

## OpenSpec

- `openspec/changes/file-upload-field/tasks.md` — marked 1.1–3.3 done; 3.4 (archive-time spec sync) and 3.5 (live/Playwright theme check) left unchecked with an explicit note on what's outstanding and why.
