## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` in
  `openspec/changes/shared-source-form-base/`.
- Read the actual sources: `frontend/src/features/sources/ui/forms/TextSourceForm.tsx`,
  `PdfSourceForm.tsx`, `ImageSourceForm.tsx` (118 lines each). Confirmed the triplication
  claim is true and structural: identical imports, identical `mode`/`file`/`url` state,
  identical `handleFileChange`/`handleSubmit`, identical JSX element order and BEM class
  strings, identical Cancel/Submit block (`Creating…` / `Create source`).
- Enumerated **every** actual difference between the three files:
  1. group `aria-label` — `Text|PDF|Image ingestion method`
  2. file `<label>` text — `Text/Markdown file` / `PDF file` / `Image file`
  3. file input `id` — `source-text-file` / `source-pdf-file` / `source-image-file`
  4. url input `id` — `source-text-url` / `source-pdf-url` / `source-image-url`
  5. `accept` — `.txt,.md,text/plain,text/markdown` / `.pdf,application/pdf` /
     `.png,.jpg,.jpeg,.gif,.webp,.bmp,image/*`
  6. url `placeholder` — `.../notes.md` / `.../report.pdf` / `.../photo.png`
  7. exported mode-type alias name (all three are the same `"upload" | "url"` union)
  8. header comment text
  The URL `TextField`'s `aria-label` is the constant `"URL"` in all three; the file input
  has no placeholder and no aria-label.
  → design.md Decision 1's config surface (`idPrefix`, `groupAriaLabel`, `fileLabel`,
  `accept`, `urlPlaceholder`) **covers items 1–6** (`idPrefix` yields both ids). Complete.
- Verified call-site compatibility: `grep` for the six exported symbols outside the three
  files returns only `AddSourceModal.tsx` (lines 210/238/266 for the mode types, 402/426/450
  for the components). Decision 2 (keep file names + exported type names) genuinely reduces
  the diff to the three files.
- Read all three `.test.tsx` (67 lines each). They assert **only** on: the file label text,
  the literal `"URL"` label, toggle button names, `onSubmit` call args, error text, and the
  disabled `Creating…` button. **None** asserts on `accept`, on the group `aria-label`, on
  the URL placeholder, or on any element `id`.

### Verdict: REFUTE

The decomposition itself (Decisions 1/2/3) is sound and I would confirm it as designed —
component-level extraction over a hook is the right call given the JSX is what is triplicated,
and the config surface is complete against ground truth. The blocking problem is **section 3**:
the verification plan cannot detect the single most likely regression this refactor introduces.

Once the differing values move into per-file `*_CONFIG` constants, the characteristic new
failure mode is **config transposition or omission** — e.g. `PDF_CONFIG` carrying the text
`accept` string, or an `idPrefix` typo. The existing tests are green under every one of those
mutations (they never read `accept`, the group `aria-label`, the placeholder, or the ids), so
tasks 2.1/2.2/2.3's "verify `*.test.tsx` passes unmodified" is evidence-shaped non-evidence
for exactly the property the AC ("no behavior change") turns on.

### Change Requests

1. **Add per-form automated assertions over the newly parameterized surface.** Amend tasks
   2.1/2.2/2.3 (and the section-3 gate) to require each of `TextSourceForm.test.tsx`,
   `PdfSourceForm.test.tsx`, `ImageSourceForm.test.tsx` to assert the four values the current
   tests leave unguarded, with the literals recorded above: the file input's `accept`
   attribute, the toggle group's `aria-label`, the file/url input `id`s, and the URL
   placeholder. State in the task that these assertions must be **failable by mutation** —
   swapping two configs must turn them red. Without this, "no behavior change" is unproven,
   not proven. (design.md's Goals bullet asserting DOM is "byte-identical … verified by
   running the existing `.test.tsx` files" overstates what those files verify; correct that
   sentence too.)

2. **Fix the design/tasks contradiction on the config surface, and drop the phantom field.**
   design.md Decision 1 lists six config fields including `filePlaceholderAria`; tasks.md 1.1
   lists five and omits it. `filePlaceholderAria` corresponds to no actual difference in the
   three files (the file input has neither a placeholder nor an aria-label; the URL field's
   aria-label is the constant `"URL"`). Remove it from Decision 1 so design.md and tasks.md
   name the same five-field surface, and so the implementer does not invent a DOM attribute
   that does not exist today.

3. **Task 3.3 asks for a baseline that will no longer exist when the task runs.** It says to
   compare against "pre-refactor screenshots/DOM", but it sits in section 3, after tasks 1–2
   have already rewritten the three files. Either move the baseline capture to a new task 0.1
   executed **before** any file is modified (capture the rendered DOM/screenshots for all three
   forms in both upload and URL modes), or restate 3.3 to compare against the explicit literal
   values enumerated in this report and in CR 1 rather than against a baseline that will not
   have been taken.

### Non-blocking notes

- The ticket's scope line describes the forms as "upload control + **name field** + submit".
  There is no name field in any of the three components. design.md correctly describes the
  real structure; flagging only so no one "restores" a field that never existed.
- The extracted component will carry forward raw `<button>`/`<input>` elements and hardcoded
  `add-source-modal__*` BEM classes rather than shared `frontend/src/shared/ui` primitives or
  `--app-*` tokens. design.md's Non-Goals scope this out explicitly and I accept that for a
  pure extraction — but the final UI gate will see it. If a design-token/shared-component pass
  over this form is wanted, it should be a spinoff, not silent scope creep here.
- `TextField` is imported from `../../../../shared/ui/index`; the new file sits at the same
  depth, so the relative specifier carries over unchanged. No barrel/path work needed.
