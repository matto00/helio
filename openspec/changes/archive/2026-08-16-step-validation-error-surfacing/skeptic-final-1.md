## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established independently** (cold read, not from evaluator's narrative):
- `git diff main...HEAD --stat` on commit `9e9091ab` (base `e2fa88b1`): 3 code files touched —
  `StepCard.tsx` (+20/-2), `StepCard.test.tsx` (+62/-3), `PipelineDetailPage.css` (+17) — plus
  OpenSpec artifacts only. No scope creep.
- Read `ticket.md`, `proposal.md`, `design.md`, `spec.md`, `tasks.md`, `skeptic-design-1.md`,
  `evaluation-1.md`, `files-modified.md` in full before touching code, then verified each claim
  against the actual diff/files rather than trusting the narrative.

**AC1 (inline message for every op kind) — traced to code, not re-implemented (correctly, per
ticket's delivery notes):**
- `StepCard.tsx:349` — `{step.opType.id !== "compute" && <InlineError error={validationError ??
  null} />}` renders for every non-compute op.
- `ComputeFieldConfig.tsx:84` — `<InlineError error={validationError ?? null} />` is compute's own
  render (no double-render; read both files directly).
- `PipelineDetailPage.tsx:235-241` (`getAnalyzeValidationError`) → `PipelineDetailPage.tsx:514`
  → `PipelineRiverView.tsx:180` (`validationError={getAnalyzeValidationError(step.id)}`, inside the
  unconditional `steps.map`) — genuinely wired for every op, confirmed by reading the call chain
  myself, not by grepping the evaluator's claim.

**AC2 (collapsed-card visual marking) — the new code, read directly:**
- `StepCard.tsx`: `--errored` modifier applied via template-literal ternary on `validationError`
  truthiness (card root); header chip `<span role="img" aria-label="Step has a validation error">`
  with `<FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />` inside, rendered
  between the label and row-count chip inside the toggle `<button>`.
- `PipelineDetailPage.css`: `.step-card--errored { border-color: color-mix(in srgb,
  var(--app-error) 50%, transparent); }` and `.step-card-error-chip { color: var(--app-error); }`.
  Both classes are single-class selectors of equal specificity; `--errored` is declared *after*
  `--expanded` in source order, so it wins the border-color tie when both apply — verified by
  reading the CSS file directly (not just the code comment's claim) and confirmed visually live
  (below).

**AC3 (no false errors / clears on fix) — single source of truth, verified live, not just in
jsdom:** see live-check section.

**AC4 (DESIGN.md + tests):**
- Token-only: `--app-error` is defined in both theme blocks (`theme.css:112`/`:156`); the
  `color-mix(in srgb, var(--app-error) N%, transparent)` recipe at 50% sits squarely inside the
  40–60% range already used for error borders elsewhere (`AgentMemoryList.css:15/42/142/155` at
  60%, `PanelGrid.css:206` at 40%) and matches DESIGN.md:171's "hairline `color-mix(error 60%)`"
  pattern. No hardcoded colors, no new tokens.
- DESIGN.md:229 "Color is never the sole carrier of meaning" — satisfied: the chip carries an icon
  shape, not color alone (confirmed both in code and visually, both themes).
- The `SidebarItemList.renderRowAction` precedent design.md Decision 2 leans on for "static content
  may nest inside the toggle, interactive content must be a sibling" is real — I read
  `SidebarItemList.tsx:60-67` directly myself (not relying on the design-gate skeptic's paraphrase)
  and confirmed the comment matches the code exactly.
- Tests: ran `npx jest --testPathPatterns=StepCard` fresh — **32/32 pass**, including the 3 new
  HEL-409 tests (collapsed-errored marking, collapsed-valid no-marking, clears-on-fix). Full suite:
  **179/179 suites, 1810/1810 tests pass** (`npx jest --config jest.config.cjs`).

**AC5 (backward compatible, no wire change):** confirmed via `git diff --stat` — frontend-only,
no backend/schema/service files touched.

**Gates (fresh, this run, in `frontend/`):**
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm run build` — succeeds (pre-existing >500kB chunk warning, unrelated).
- `wc -l StepCard.tsx` on this branch (529) vs. `git show main:...StepCard.tsx | wc -l` (513) —
  confirms `files-modified.md`'s "+16 lines" claim exactly.

**Live verification** (dev 5841 / backend 8748, started via `start-servers.sh`, `assert-phase.sh
servers` → `PASS servers`):
- Built a throwaway pipeline ("HEL-409 skeptic final check") on "Skeptic Dry-Run Test Source":
  a `rename` step (`email → full_name`) followed by an `unpivot` step with `full_name` as its id
  field, then moved `unpivot` *above* `rename` via the Move-up control. This produced a **real,
  backend-computed** `validationError` (`"Unknown field(s): 'full_name'"`) on a genuine non-compute
  op via the actual `/analyze` endpoint — not a mock.
- **AC1 confirmed live:** expanding the errored `unpivot` card showed
  `"Unknown field(s): 'full_name'"` inline in the body.
- **AC2 confirmed live, both themes:** collapsed, the card showed a distinct error-tinted border
  and a red triangle-exclamation chip in the header in both light and dark theme (screenshots
  reviewed, then deleted — see cleanup below). Icon shape present in both, not color-only.
- **Accessible-name judgment item confirmed live via the a11y snapshot:** the toggle button's
  computed accessible name became `"Unpivot (wide → long) Step has a validation error"` while
  errored, and a nested `role="img"` element with name `"Step has a validation error"` was
  independently queryable — exactly matching design.md's claim and the evaluator's Phase-3 report.
- **AC3 (clears on fix) confirmed live, full round trip:** moving `unpivot` back below `rename`
  triggered the debounced analyze refresh; the border, header chip, and inline message all
  disappeared, and the toggle's accessible name reverted to the plain `"Unpivot (wide → long)"` —
  verified via a11y snapshot and screenshot both before and after.
- **No new console errors:** one `404` on `GET /api/pipelines/:id/schedule` appeared, matching the
  evaluator's report of this being a pre-existing, unrelated condition (every pipeline with no
  schedule set shows it) — not introduced by this change.
- Cleanup: deleted the throwaway pipeline via `DELETE /api/pipelines/:id` (confirmed gone from the
  list; pre-existing "HEL-407 eval reorder test" / "Skeptic Test *" / "HEL-454 eval smoke" /
  "Skeptic Dry-Run Test Pipeline" fixtures untouched), removed the 3 screenshot PNGs I wrote to the
  repo root, killed the backend (java/sbt) and frontend (vite) processes by PID, confirmed ports
  5841/8748 free (`lsof -ti` empty).

### My own judgment on the accessible-name question (asked explicitly)

Nesting the `role="img"` chip inside the unlabeled toggle button does fold "Step has a validation
error" into the button's accessible name for errored steps — confirmed live, not just in theory.
I considered the alternative (keep the chip `aria-hidden` and instead point the button at an
`aria-describedby` reference, so the *name* stays stable as "Limit rows" and the *description*
carries the error state) — that would be a more textbook-idiomatic name/description separation per
WAI-ARIA practice for disclosure-button patterns.

That said, I don't think it rises to a blocking defect: the codebase's own row-count chip
(`step-card-count`, an unconditional plain-text sibling in the same button) already does the exact
same thing — folds state (`"12,345 rows"`) into the button's name — and that's pre-existing,
accepted convention, not something HEL-409 introduces. DESIGN.md's only binding rule here
("interactive elements have accessible names") is satisfied, and WCAG 4.1.2 doesn't prohibit
additional name content. Given the precedent and the concrete, verified benefit (a screen-reader
user tabbing through the list now hears the error state on the very control that expands to show
detail, with zero extra navigation), this is a reasonable, consistent choice — not the purest
possible pattern, but not wrong either. I'm noting the `aria-describedby` alternative as a
non-blocking idea for a future pass across both this chip and the row-count chip together (so they
stay consistent with each other), not a required change for this ticket.

### Verdict: CONFIRM

Every AC traces to real code and (where practical) live-confirmed behavior; the "already shipped"
half genuinely holds on this branch; the new code is minimal, token-only, and follows a real,
independently-verified codebase precedent; gates are clean; no scope drift; no regressions (full
suite green). Ships.

### Non-blocking notes

- Consider `aria-describedby` instead of in-name chip content for both the new error chip and the
  pre-existing row-count chip in a future pass, for closer WAI-ARIA disclosure-button idiom — not
  required now given the established precedent and lack of a DESIGN.md/WCAG violation.
- `StepCard.tsx` at 529 lines remains over CONTRIBUTING.md's ~400-line soft-budget trigger; already
  tracked under HEL-682, no action needed here.
