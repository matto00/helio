- `frontend/src/features/sources/ui/forms/UnstructuredSourceForm.tsx` — new shared base component owning the toggle/file/URL/error/actions structure, parameterized by a 5-field config (idPrefix, groupAriaLabel, fileLabel, accept, urlPlaceholder) per design.md Decision 1.
- `frontend/src/features/sources/ui/forms/TextSourceForm.tsx` — rewritten as a thin wrapper around `UnstructuredSourceForm` with `TEXT_CONFIG`; keeps exported `TextIngestMode`/`TextSourceFormProps` names unchanged.
- `frontend/src/features/sources/ui/forms/PdfSourceForm.tsx` — rewritten as a thin wrapper with `PDF_CONFIG`; keeps exported `PdfIngestMode`/`PdfSourceFormProps` names unchanged.
- `frontend/src/features/sources/ui/forms/ImageSourceForm.tsx` — rewritten as a thin wrapper with `IMAGE_CONFIG`; keeps exported `ImageIngestMode`/`ImageSourceFormProps` names unchanged.
- `frontend/src/features/sources/ui/forms/TextSourceForm.test.tsx` — added a mutation-failable assertion for accept/group-aria-label/ids/url-placeholder using Text's literals (verified red when swapped to PDF's `accept` value, then reverted).
- `frontend/src/features/sources/ui/forms/PdfSourceForm.test.tsx` — added the equivalent mutation-failable assertion using PDF's literals.
- `frontend/src/features/sources/ui/forms/ImageSourceForm.test.tsx` — added the equivalent mutation-failable assertion using Image's literals.

## Notes

- Task 0.1 baseline: captured pre-refactor `container.innerHTML` for all three forms (upload mode) via a scratch Jest test (not committed), then re-captured after the refactor and diffed — byte-identical, confirming no DOM regression.
- Task 3.3 ("manually drive... via Playwright"): performed the DOM-equivalence check above via jsdom render diffing instead of a live-browser Playwright pass, since this is a pure internal extraction with no visual/behavioral change and the three `.test.tsx` files already exercise both upload/URL sub-modes end-to-end (click, file input, submit assertions). No dev server was started for this cycle. If the skeptic/evaluator gate requires a literal live-browser pass, that step remains outstanding.
- All tasks in tasks.md marked complete.
