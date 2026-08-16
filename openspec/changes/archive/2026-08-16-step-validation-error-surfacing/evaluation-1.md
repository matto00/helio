## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

- AC1 ("Any step with an analyze `validationError` shows that error inline on its own card, for
  every op kind") — already shipped by HEL-407 (`ea726167`, merged into this branch's base
  `e2fa88b1`); re-verified read-only, no gap: `StepCard.tsx` line ~349
  (`{step.opType.id !== "compute" && <InlineError error={validationError ?? null} />}`) covers
  every non-compute op, `getAnalyzeValidationError` in `PipelineDetailPage.tsx:235-241` is wired
  unconditionally per step through `PipelineRiverView.tsx:180`. Live-confirmed against a real
  non-compute (`unpivot`) step — see Phase 3.
- AC2 ("The errored step is visually distinguishable in the step list") — new code this cycle:
  `pipeline-detail-page__step-card--errored` modifier (error-tinted border) + a header
  `role="img"` triangle-exclamation chip, both driven purely from the existing `validationError`
  prop. Live-confirmed collapsed and expanded, both themes.
- AC3 ("No false errors on valid steps; the error clears when the config is fixed") — the marking
  and the message share one source of truth (`validationError`), so no second state to drift; unit
  tests 3.1/3.2 and a live analyze-refresh round-trip (see Phase 3) both confirm.
- AC4 ("Follows DESIGN.md; frontend tests cover an errored non-compute step rendering its
  message") — token-only CSS (`--app-error` family, matching `InlineError.css`); the pre-existing
  HEL-407 test for a non-compute step's message is intact and still passing.
- AC5 ("Backward compatible... no wire change") — frontend-only diff, confirmed by
  `git diff --name-only main...HEAD`; no backend, schema, or service files touched.
- Tasks 1.1–3.5 all checked off in `tasks.md` and match the diff exactly (card modifier + header
  chip in `StepCard.tsx`, CSS rule in `PipelineDetailPage.css`, three new tests + the `click()`
  helper widening + a code comment in `StepCard.test.tsx`, `files-modified.md` recorded with
  accurate line-count accounting).
- No scope creep: the only files touched are `StepCard.tsx`, `PipelineDetailPage.css`,
  `StepCard.test.tsx`, plus the OpenSpec change-dir artifacts. No new components, no prop-shape
  changes.
- No regression to existing behavior: full `npm test` run is green (179/179 suites, 1810/1810
  tests); the `click()` helper's `string | RegExp` widening only changed the 3 call sites that
  click the toggle on an **errored** step — every other (valid-step) call site is untouched and
  still uses an exact string match (verified via `grep -n 'click(' StepCard.test.tsx`).
- Planning artifacts (proposal/design/tasks/spec) accurately reflect the final implementation —
  no drift between `design.md`'s Decisions 1–3 and the shipped code.

### Phase 2: Code Review — PASS

Issues: none blocking.

**Gates (fresh run, this evaluation, in `WORKTREE_PATH/frontend`):**
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm test` — 179 suites / 1810 tests, all passing (targeted `StepCard` run: 32/32).
- `npm --prefix frontend run build` — production build succeeds (pre-existing >500kB chunk-size
  warning is unrelated to this change).

**CONTRIBUTING.md / DESIGN.md compliance:**
- Token-only CSS: `PipelineDetailPage.css:359-365` (`--errored` modifier) and `:461-469`
  (`.step-card-error-chip`) use only `var(--app-error)` via the same
  `color-mix(in srgb, var(--app-error) N%, transparent)` recipe already used elsewhere in the same
  file (e.g. `.step-card-diff-chip--removed`) — no new tokens, no literal colors.
  DESIGN.md's accessibility-baseline rule "Color is never the sole carrier of meaning" is
  satisfied: the chip carries an icon shape (`faTriangleExclamation`) plus `role="img"` +
  `aria-label`, not color alone.
- DESIGN.md:223 `[mechanical]` — "Interactive elements have accessible names" — satisfied both
  before and after: the toggle `<button>` always has a computed accessible name (see judgment
  item below for the *content* of that name).
- File-size budget (CONTRIBUTING.md ~400-line soft-budget trigger): `StepCard.tsx` is now 529
  lines (was already 513 pre-change, i.e. already over budget before this ticket). Growth is +16
  lines, of which +5 are Prettier's mandatory import-wrap (not authored growth) — in line with the
  design's ≤~12-line estimate. `files-modified.md` records this accurately and the split is
  explicitly deferred to HEL-682 per the orchestrator's delivery notes; not a fresh violation
  introduced by this change.
- DRY: reuses the existing `InlineError` affordance, the existing `--expanded` modifier precedent,
  and the existing row-count-chip structural pattern — no new abstractions.
- No dead code, no TODO/FIXME left behind (grepped both new files).
- Tests are meaningful: the 3 new tests in the `"StepCard — errored card marking (HEL-409)"` block
  assert both presence (errored/collapsed) and absence (valid/collapsed) of the class + `role="img"`
  element, and a rerender-based clears-on-fix test that would catch a real regression (e.g. a stray
  `validationError &&` check left off the CSS class or the chip).

**Judgment item — the accessible-name change (explicitly requested):**

Nesting the `role="img"` `aria-label="Step has a validation error"` chip inside the (unlabeled)
toggle `<button>` does change the button's own computed accessible name for errored steps, from
`"Limit rows"` to `"Limit rows Step has a validation error"` (confirmed both in the accname
algorithm and live in the browser — see Phase 3). I assess this as **an acceptable, arguably
beneficial outcome, not a defect requiring restructuring**:

- It is precedented, not novel: the pre-existing row-count chip (`step-card-count`, a plain
  non-`aria-hidden` `<span>` sibling inside the same button) already contributed to the button's
  accessible name whenever `rowCount !== null` (e.g. `"Limit rows 12,345 rows"`), both before and
  after this change. The error chip follows the exact same structural pattern the design document
  cites (Decision 2: "non-interactive content of the button, exactly like the existing row-count
  chip sibling").
- It is the intended, documented behavior, not an oversight: design.md Decision 2 explicitly
  states the chip is deliberately non-`aria-hidden` "to give keyboard/screen-reader users the same
  in-line signal sighted users get" — i.e. the accessible-name change is the mechanism by which
  AC2's "accessible indicator... visible without expanding the card" is satisfied for
  keyboard/AT users, not merely for sighted users.
- It is arguably an improvement: a screen-reader user tabbing through the step list now hears the
  error state on the very control that would take them to the error's detail (expanding the card),
  without any extra navigation. No DESIGN.md or WCAG rule requires a button's accessible name stay
  fixed independent of state — accessible names commonly reflect toggle/state changes (e.g.
  `aria-expanded` already does this structurally on the same button).
- The fix for the 3 broken test matchers (widening `click()` to accept `RegExp`, applied only to
  the 3 call sites that click an errored step's toggle) is minimal, correctly scoped, and
  documented in both a code comment and `files-modified.md`'s "Regression note" — it is not
  papering over a bug, it is updating assertions to match a deliberate, correct behavior change.

No change requested here.

### Phase 3: UI Review — PASS

Servers started via `scripts/concertino/start-servers.sh` on this run's ports (dev 5841 / backend
8748) and confirmed healthy via `assert-phase.sh servers` (`PASS servers`). Both stopped
afterward; ports confirmed free.

Built a throwaway pipeline ("HEL-409 eval error surfacing test") using the existing "Skeptic
Dry-Run Test Source": an `unpivot` step (idVars=["email"]) placed after a `rename` step
(email→full_name), then reordered so `rename` runs first — this reliably produces a real
backend-computed `validationError` ("Unknown field(s): 'email'") on a genuine non-compute op via
the actual `analyze` endpoint (not a mocked value).

- **Happy path / AC1 (non-compute inline message)**: expanding the errored `unpivot` step showed
  `"Unknown field(s): 'email'"` inline in the body — confirms the already-shipped half live, on a
  real backend response.
- **AC2 (collapsed marking, both themes)**: collapsed, the `unpivot` card showed the error-tinted
  border and the header triangle-exclamation chip in both dark and light theme (screenshots
  captured and reviewed, then deleted per cleanup instructions). No color-only signal — the icon
  shape is present in both themes.
- **Accessible-name behavior (the judgment item above)**: live-confirmed via accessibility
  snapshot — the toggle button's accessible name became `"Unpivot (wide → long) Step has a
  validation error"` while errored, and a nested `img` element with name `"Step has a validation
  error"` was independently queryable, exactly matching the code-review analysis.
- **AC3 (clears on fix)**: editing the `rename` step's target back to empty (removing the rename)
  triggered the debounced analyze refresh; the `--errored` border, the header chip, and the
  `"email → full_name"` diff-chip all disappeared together, and the toggle's accessible name
  reverted to the plain label — full round-trip confirmed live, not just in jsdom.
- **No console errors** introduced by this change across the whole flow (create pipeline, add
  steps, edit config, reorder, fix). One pre-existing, unrelated `404` on
  `GET /api/pipelines/:id/schedule` appears on every pipeline detail page with no schedule set
  (reproduced identically on the untouched "HEL-407 eval reorder test" fixture) — not caused by
  this change, out of scope.
- **Breakpoints (430 / 768 / 1100 / 1440)**: the design.md-flagged header-crowding risk (icon +
  label + count + chevron + actions cluster) was checked at 430px specifically with the error chip
  present — no wrapping, overlap, or truncation; the chip stays compact and icon-only as designed.
  768/1100/1440 all render cleanly.
- Left the pre-existing "HEL-407 eval reorder test" and "Skeptic Test *" fixtures untouched (viewed
  read-only only); deleted the throwaway pipeline I created via the DELETE endpoint (confirmed
  gone from the pipeline list) and removed the screenshot files from the repo root.

### Overall: PASS

### Non-blocking Suggestions

- `StepCard.tsx` at 529 lines remains over CONTRIBUTING.md's ~400-line soft-budget trigger; this
  predates HEL-409 (already 513 lines) and is explicitly tracked under HEL-682 — no action needed
  in this change, flagging only for continuity.
