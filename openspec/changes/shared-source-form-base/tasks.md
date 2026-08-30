## 0. Baseline

- [x] 0.1 Before modifying any of the three form files, capture the current rendered DOM for
      `TextSourceForm`, `PdfSourceForm`, `ImageSourceForm` in both upload and URL mode (e.g. via
      Playwright snapshots/screenshots of `AddSourceModal.tsx`'s three source-type flows, or
      `render()` + `container.innerHTML` dumps in a scratch test) as the literal baseline task
      3.3 compares against later, since sections 1–2 will have already rewritten these files by
      the time 3.3 runs.

## 1. Shared base component

- [x] 1.1 Create `frontend/src/features/sources/ui/forms/UnstructuredSourceForm.tsx` implementing
      the toggle/file/URL/error/actions structure per design.md Decision 1, parameterized by a
      five-field `config` prop (`idPrefix`, `groupAriaLabel`, `fileLabel`, `accept`,
      `urlPlaceholder` — no `filePlaceholderAria`; the file input has neither a placeholder nor
      an aria-label today, and the URL field's aria-label is the constant `"URL"` in all three
      forms), and verify it type-checks (`npm run typecheck`).

## 2. Thin per-source-type wrappers

- [x] 2.1 Rewrite `TextSourceForm.tsx` as a thin wrapper around `UnstructuredSourceForm`, keeping
      its exported `TextIngestMode`/`TextSourceFormProps` names unchanged. Add assertions to
      `TextSourceForm.test.tsx` for the file input's `accept` attribute, the toggle group's
      `aria-label`, the file/url input `id`s, and the URL placeholder — using this form's own
      literal values (`.txt,.md,text/plain,text/markdown`, `"Text ingestion method"`,
      `source-text-file`/`source-text-url`, `https://example.com/notes.md`) — and confirm each
      new assertion is failable by mutation (temporarily swap in another form's config value and
      confirm the test goes red, then revert). Verify `TextSourceForm.test.tsx` passes.
- [x] 2.2 Rewrite `PdfSourceForm.tsx` as a thin wrapper, keeping its exported
      `PdfIngestMode`/`PdfSourceFormProps` names unchanged. Add the same four mutation-failable
      assertions to `PdfSourceForm.test.tsx` using this form's literals (`.pdf,application/pdf`,
      `"PDF ingestion method"`, `source-pdf-file`/`source-pdf-url`,
      `https://example.com/report.pdf`). Verify `PdfSourceForm.test.tsx` passes.
- [x] 2.3 Rewrite `ImageSourceForm.tsx` as a thin wrapper, keeping its exported
      `ImageIngestMode`/`ImageSourceFormProps` names unchanged. Add the same four
      mutation-failable assertions to `ImageSourceForm.test.tsx` using this form's literals
      (`.png,.jpg,.jpeg,.gif,.webp,.bmp,image/*`, `"Image ingestion method"`,
      `source-image-file`/`source-image-url`, `https://example.com/photo.png`). Verify
      `ImageSourceForm.test.tsx` passes.

## 3. Verification

- [x] 3.1 Run the full frontend test suite (`npm test`) and confirm no regressions beyond the
      three source-form test files touched above.
- [x] 3.2 Run `npm run lint` and `npm run typecheck` clean (zero warnings/errors).
- [x] 3.3 Manually drive `AddSourceModal.tsx`'s text/PDF/image creation flows in the running dev
      app (upload mode + URL mode for each) via Playwright and diff against task 0.1's captured
      baseline — ids, labels, accept filters, placeholders, error text, and overall DOM/visual
      output must be unchanged. This is the UI gate for this frontend ticket.
