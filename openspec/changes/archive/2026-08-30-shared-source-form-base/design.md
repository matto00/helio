## Context

`TextSourceForm.tsx`, `PdfSourceForm.tsx`, `ImageSourceForm.tsx` (all in
`frontend/src/features/sources/ui/forms/`) are structurally identical: a local `mode` state
(`"upload" | "url"`), a toggle `<div role="group">` with two buttons, a conditional file `<input>`
or `TextField` URL input, `InlineError`, and Cancel/Submit actions using the shared
`add-source-modal__*` BEM class names. Each is consumed by exactly one call site in
`AddSourceModal.tsx` (lines ~402/426/450), passed `onSubmit`, `isLoading`, `error`, `onCancel`.
Every difference between the three is data, not structure: field label text, `accept` filter,
group `aria-label`, id suffix (`source-text-file` / `source-pdf-file` / `source-image-file`),
placeholder text, and the exported mode type name (`TextIngestMode` / `PdfIngestMode` /
`ImageIngestMode`) — the three mode types are structurally the same `"upload" | "url"` union.
See proposal.md - Why / What Changes.

## Goals / Non-Goals

**Goals:**

- One shared component owns the toggle/file/URL/error/actions structure and CSS class usage.
- Each of the three source-type files keeps its own file, its own exported prop-type name
  (`TextSourceFormProps` etc.) and its own exported mode-type alias, purely as thin config +
  re-export, so `AddSourceModal.tsx` and existing imports/tests need no call-site changes.
- Rendered DOM (ids, aria-labels, class names, button text, placeholders) is byte-identical to
  today's output for all three forms — verified by a **new**, per-form assertion added to each
  `.test.tsx` covering the parameterized surface (`accept`, group `aria-label`, file/url input
  `id`s, url `placeholder`) with each form's own literal values, failable by mutation (e.g.
  transposing two forms' configs must turn the new assertions red). The three existing test
  files, as they stand today, assert none of these four properties and so cannot detect a config
  transposition/omission on their own — see skeptic-design-1.md CR 1.

**Non-Goals:**

- No behavior change to `StaticSourceForm`/`useRestSourceForm` (different shape, out of scope
  per proposal.md - Non-goals).
- No visual redesign — this is a pure extraction (`DESIGN.md` conformance means "don't regress
  it", not "restyle it").
- No consolidation of the three mode-type aliases into one shared type at the call-site level —
  `AddSourceModal.tsx`'s per-branch `onSubmit` signatures are untouched.

## Decisions

**Decision 1 — a config-driven shared component, not a hook.** Introduce
`UnstructuredSourceForm.tsx` (co-located in `forms/`) that takes the existing four behavioral
props (`onSubmit`, `isLoading`, `error`, `onCancel`) plus a `config` object:
`{ idPrefix, groupAriaLabel, fileLabel, accept, urlPlaceholder }` (five fields — the file input
has no placeholder and no aria-label today, and the URL field's aria-label is the constant
`"URL"` in all three forms, so neither needs a config slot). It owns
the `mode`/`file`/`url` state and the toggle/input/error/actions JSX verbatim as it exists today.
Alternative considered: a `useUnstructuredSourceForm()` hook returning state + handlers, with each
form keeping its own JSX. Rejected — the JSX (not just the state logic) is what's triplicated;
a hook-only extraction would still leave three near-identical render trees to keep in sync, which
is the actual maintenance cost row 0d exists to remove.

**Decision 2 — each of the three files keeps its public prop-type name and becomes ~10 lines.**
`TextSourceForm.tsx` keeps exporting `TextIngestMode` and `TextSourceFormProps`, and its
`TextSourceForm` function becomes a thin wrapper: `return <UnstructuredSourceForm {...props}
config={TEXT_CONFIG} />`. Same for Pdf/Image. Alternative considered: delete the three files and
have `AddSourceModal.tsx` import `UnstructuredSourceForm` directly three times with inline config.
Rejected — call-site imports (`TextSourceForm`, `PdfSourceForm`, `ImageSourceForm`) and their
`.test.tsx` companions stay valid with zero edits to `AddSourceModal.tsx`, minimizing diff surface
and risk on a "no behavior change" ticket.

**Decision 3 — config objects are plain per-file constants, not a shared registry.** Each thin
wrapper file defines its own `const TEXT_CONFIG = {...}` (etc.) rather than a
`SOURCE_FORM_CONFIGS` map keyed by source type living in a fourth file. Alternative considered: a
central config map. Rejected as unnecessary indirection — nothing outside each file needs its own
config, and a shared map would need its own type import wiring for a marginal DRY gain.

## Risks / Trade-offs

- [Risk: an existing test snapshots/asserts a class name or DOM structure this refactor
  incidentally reorders] → Mitigation: keep `UnstructuredSourceForm`'s JSX byte-identical to the
  current per-file JSX (same element order, same class strings), and run all three `.test.tsx`
  files before and after to confirm identical pass/fail status.
- [Risk: three near-identical config objects reintroduce the same drift risk one level up] →
  Mitigation: the config surface is intentionally small (5 string fields) and each field maps
  1:1 to a place the DOM already differs today; this is data-shape triplication, not
  logic-shape triplication, which is the actual thing row 0d's acceptance criteria target.

## Planner Notes

- Component name `UnstructuredSourceForm` chosen to match the existing "unstructured source"
  terminology used in code comments (`ImageSourceForm.tsx`'s header comment, `sources` feature
  naming) — self-approved, not escalated (naming only, no scope/architecture impact).
- Placed the new file in `forms/` (not a new `shared/` subfolder) since it is feature-internal
  (only these three forms in this one feature consume it) — self-approved per the same reasoning.
