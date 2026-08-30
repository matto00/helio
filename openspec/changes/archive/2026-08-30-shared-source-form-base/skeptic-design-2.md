## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read `skeptic-design-1.md` (the three round-1 change requests), then re-read the current
  `design.md` and `tasks.md` in full from disk.
- **CR 1 (mutation-failable assertions over the parameterized surface) — ADDRESSED.**
  - `tasks.md` 2.1/2.2/2.3 each now require adding assertions for the four previously unguarded
    properties (file `accept`, toggle group `aria-label`, file/url input `id`s, url
    `placeholder`), each spelled out with that form's own literal values, and each task
    explicitly requires confirming the assertions are **failable by mutation** ("temporarily
    swap in another form's config value and confirm the test goes red, then revert"). That is
    the demand-the-red property CR 1 asked for, not a restatement of "tests pass".
  - `design.md`'s Goals bullet no longer claims the existing tests verify byte-identical DOM.
    It now says verification comes from a **new** per-form assertion and explicitly concedes
    "The three existing test files, as they stand today, assert none of these four properties
    and so cannot detect a config transposition/omission on their own". The overstated claim
    is corrected, not papered over.
- **CR 2 (phantom `filePlaceholderAria`, design/tasks contradiction) — ADDRESSED.**
  `design.md` Decision 1 now enumerates exactly five fields
  (`idPrefix`, `groupAriaLabel`, `fileLabel`, `accept`, `urlPlaceholder`) with the rationale for
  the omission inline; `tasks.md` 1.1 names the same five and explicitly says
  "no `filePlaceholderAria`". Both documents now describe one identical surface.
- **CR 3 (task 3.3's non-existent baseline) — ADDRESSED.** `tasks.md` gains a new section 0 with
  task 0.1, ordered before any file is modified, capturing rendered DOM for all three forms in
  both upload and URL modes; 3.3 now says "diff against task 0.1's captured baseline". The
  ordering problem is gone. I confirmed via `git status --porcelain frontend/` that the three
  form files are still unmodified, so the baseline in 0.1 is genuinely still capturable.
- **Independent re-verification of the literals** (not taken from the artifacts): grepped
  `accept=`/`aria-label`/`id=`/`placeholder=` in `TextSourceForm.tsx`, `PdfSourceForm.tsx`,
  `ImageSourceForm.tsx`. All twelve literals now written into tasks 2.1–2.3 match ground truth
  character-for-character (`.txt,.md,text/plain,text/markdown` / `.pdf,application/pdf` /
  `.png,.jpg,.jpeg,.gif,.webp,.bmp,image/*`; `Text|PDF|Image ingestion method`;
  `source-{text,pdf,image}-{file,url}`; `https://example.com/{notes.md,report.pdf,photo.png}`).
  A wrong literal baked into a task would have been a fresh REFUTE; none is.
- Re-confirmed the round-1 findings that were already sound still hold: Decisions 1/2/3 unchanged
  and coherent, call-site surface (`AddSourceModal.tsx` only) untouched by the plan, no
  placeholders/TODOs, every ticket AC covered by a task, no scope drift, no API/schema surface
  touched so no spec delta is owed.

### Verdict: CONFIRM

All three round-1 change requests were substantively addressed — the artifacts changed, not just
acknowledged — and the one property the AC turns on ("no behavior change") now has a verification
plan that can actually go red. Sound enough to implement.

### Non-blocking notes

- `design.md` Risks/Trade-offs, second bullet, still says "the config surface is intentionally
  small (**6** string fields)". Stale count from the pre-CR-2 six-field version. The
  authoritative surface is enumerated as five in two places (Decision 1 and task 1.1) and is
  unambiguous, so this cannot mislead an implementer — but the numeral should be corrected to
  five when the file is next touched.
- Carried forward from round 1 and still true: the extracted component will keep raw
  `<button>`/`<input>` elements and hardcoded `add-source-modal__*` BEM classes rather than
  `frontend/src/shared/ui` primitives / `--app-*` tokens. Correctly scoped out as a Non-Goal for
  a pure extraction; if a design-token pass is wanted it belongs in a spinoff, not here.
- The ticket's scope line mentions a "name field" that exists in none of the three components;
  `design.md` correctly describes the real structure. Flagged only so no one "restores" it.
