## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: faeb2234 on `task/shared-source-form-base/HEL-720` (diff vs `main`).

### Phase 1: Spec Review — PASS

Issues: none.

- AC1 ("one shared implementation backs all three forms"): met — `UnstructuredSourceForm.tsx`
  owns the whole toggle/file/URL/error/actions tree; the three source-type files are 40-line
  config + wrapper.
- AC2 ("no behavior change; validation/error messages consistent"): met — verified live
  (Phase 3), not just by reading code.
- Tasks 0.1–3.2 done as described. Task 3.3 was self-flagged by the executor as done via a jsdom
  DOM-diff rather than a live Playwright pass; I performed the live pass myself this cycle (see
  Phase 3), so the gap is closed. No change request — the executor disclosed it accurately rather
  than claiming it.
- Scope: `StaticSourceForm`/`useRestSourceForm` untouched, `AddSourceModal.tsx` untouched, no
  spec deltas (`skip_specs: true` correct for a pure internal refactor). No scope creep.
- Design/proposal match what shipped (Decisions 1–3 all implemented as written).

### Phase 2: Code Review — PASS

Gates re-run by me in `WORKTREE_PATH` (fresh, not the executor's report):

- `npm run lint` — clean (`--max-warnings=0`).
- `npm run typecheck` — clean.
- `npm run format:check` — "All matched files use Prettier code style!".
- `npm test` — 274 suites / 2963 tests passed.
- `npm --prefix frontend run build` — succeeded.

Issues: none.

- Behavior-preserving: the shared component's JSX is character-for-character the old per-file JSX
  with five literals swapped for `config.*` / template-literal ids. No drive-by behavior change.
- DRY: ~294 lines of triplication removed for 135 shared lines. Config objects are 5 string fields
  each — data, not logic.
- DESIGN.md [mechanical]: no new CSS, no new tokens, no hand-rolled containers; existing
  `add-source-modal__*` BEM classes and shared `TextField`/`InlineError` reused verbatim. Nothing
  in scope for `PageShell`/`PageHeader`/`PageStatus` (this is an in-modal form, not a page).
- CONTRIBUTING [mechanical]: imports at top, no inline fully-qualified names, no `any`, no dead
  code/TODO, new file 135 lines (well within budget).
- Type safety: `UnstructuredSourceFormConfig`/`UnstructuredSourceFormProps` explicit; the three
  per-form mode aliases are structurally identical `"upload" | "url"` unions so the wrapper
  `onSubmit` pass-through is sound (typecheck confirms).
- Tests: the three new `it("renders this form's config-specific surface (HEL-720)")` cases assert
  literal, per-form values (`accept` string, group `aria-label`, `source-<type>-file` /
  `-url` ids, URL placeholder) in both upload and URL sub-modes. Read directly in the diff: they
  are literal-value-specific and non-tautological — transposing any one form's config value into
  another form makes them red. This is a genuine guard against exactly the config-transposition
  failure mode the extraction introduces.

### Phase 3: UI Review — PASS

Servers started via `scripts/concertino/start-servers.sh` (frontend 6152 / backend 9059, both
healthy) and driven live in Chromium via Playwright against `/sources` → "Add source".

- **DOM parity (the real AC)**: dumped `.add-source-modal__form` `outerHTML` for all six states
  (Text/PDF/Image × upload/URL) from the running app and compared against the deleted per-file
  JSX in the diff. Byte-identical in every case — same element order, same class strings, same
  ids (`source-text-file`, `source-text-url`, `source-pdf-file`, `source-pdf-url`,
  `source-image-file`, `source-image-url`), same `accept` filters, same labels, same placeholders,
  same `role="group"` aria-labels, same active-toggle class flip.
- **Happy paths, end to end (real creates against the real backend)**:
  - Text / URL mode → created "HEL-720 Eval Text URL" (`text/0b29d05f-….md`), modal closed, row
    appeared.
  - PDF / upload mode → created "HEL-720 Eval PDF Upload" (`pdf/6877b7f0-….pdf`).
  - Image / upload mode → created "HEL-720 Eval Image Upload" (`image/78ca829c-….png`), submitted
    via **keyboard** (focus submit + Enter) — keyboard support intact.
- **Unhappy paths**: submitting with no name renders "Name is required." inline; submitting a
  deliberately malformed PDF returns 400 and renders "Failed to create PDF source." inline —
  modal stays open, no blank screen, no unhandled exception.
- **Console**: the only error across the whole session is the expected
  `400 (Bad Request) /api/data-sources` from my intentional bad-PDF probe. No React errors, no
  warnings.
- **Accessibility**: toggle group exposes `role="group"` + per-type accessible name; file/url
  inputs are label-associated via `htmlFor`/`id`; URL field keeps `aria-label="URL"`.
- **Breakpoints**: 1440 / 768 / 380 all render the modal and form without layout breakage
  (screenshots taken and reviewed; stray PNGs removed afterward).

### Overall: PASS

### Change Requests

(none)

### Non-blocking Suggestions

- `UnstructuredIngestMode` now coexists with three identical per-form aliases
  (`TextIngestMode`/`PdfIngestMode`/`ImageIngestMode`). Design Decision/Non-goal deliberately
  keeps them for call-site compatibility; when P1.5 (HEL-908) touches `AddSourceModal.tsx`
  anyway, collapsing them onto the shared alias would be a natural, free cleanup.
- Dev-DB side effect: this review created three throwaway sources
  (`HEL-720 Eval Text URL`, `HEL-720 Eval PDF Upload`, `HEL-720 Eval Image Upload`) in the shared
  local dev database. Harmless, but they will show up in future `/sources` listings.
