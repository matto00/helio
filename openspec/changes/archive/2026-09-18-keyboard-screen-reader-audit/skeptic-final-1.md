## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Diff scope**: `git diff 3471d891...146f51c4 --stat` — 11 files, only production-code touch is
  `FormPanelView.tsx` (11 lines) + `FormPanel.css` (6 lines), plus the new e2e spec and OpenSpec
  artifacts. Matches `files-modified.md`.
- **The fix itself**: read the actual diff. `disabled={submitState === "pending"}` →
  `aria-disabled={submitState === "pending" ? "true" : undefined}`, with a code comment naming the
  root cause (native-`disabled` force-blurs focus to `<body>`) and citing that `handleSubmit`'s own
  `submitState === "pending"` guard (not the removed `disabled` attribute) blocks re-entrant submit.
  CSS selectors updated in lockstep (`:hover:not(:disabled)` → `:hover:not([aria-disabled="true"])`,
  `:disabled` → `[aria-disabled="true"]`) — same tokens, no visual regression.
- **All 5 e2e tests, run by me, fresh, against the live dev server** (`DEV_PORT=6522
  BACKEND_PORT=9429 npx playwright test e2e/hel1090-form-panel-assembled-a11y.spec.ts`): 5 passed
  (17.8s). Console output included the HEL-1158 re-measurement numbers.
- **C7 mutation, reproduced independently by me** (not trusted from the executor/evaluator report):
  reverted `aria-disabled={...}` back to `disabled={submitState === "pending"}`, reran only the
  focus-management test — failed at exactly `expect(submitButton).toHaveAttribute("aria-disabled",
  "true")` (received `""`), i.e. the exact guard the fix is claimed to protect. Restored the file
  from a saved copy and confirmed `git diff --stat` on the file is empty (byte-identical). Reran the
  same test — passed again. This is a genuinely load-bearing, mutation-provable fix.
- **C8 spot-check**: read the spec directly — assertions use `toBeFocused()`, `toBeChecked()`
  (explicitly not `aria-checked` presence, with an inline comment explaining why),
  `page.accessibility.snapshot()` for role/name, and `alert.textContent()` before/after for
  live-region text. No bare attribute-presence check found standing in for computed state.
- **Date-field tab-trap claim, independently reproduced via Playwright MCP** on the actual running
  app (seeded my own dataset/dashboard/8-field form panel via `fetch`, no test-harness code): tabbed
  from Quantity into the date input (confirmed via `document.activeElement.outerHTML`), pressed Tab
  again — focus stayed on the date input. Then reproduced the identical trap on a bare
  `data:text/html` page with three plain `<input>`s (one `type="date"`) and zero Helio code — Tab
  from the text input before it landed on the date input as expected, but Tab from the date input
  did not advance past it either. This corroborates the executor's claim that this is a
  Playwright/CDP automation limitation on this one native control shape, not an app-level keyboard
  trap.
- **HEL-1158 re-measurement, independently reproduced twice** (once via the full spec run, once by
  reading its own console output): `overflowPx=403.19` (dark) / `overflowPx=-11.81` (light) — matches
  both the executor's and evaluator's reported numbers exactly. Screenshotted the live panel in both
  themes via Playwright MCP: dark theme shows the panel body cut off after "Quantity" with the
  scrollbar visible (visual corroboration of the dark-only overflow); light theme parity holds (same
  tokens, same layout, `data-theme="light"` correctly applied via the command palette).
- **Role/name (C8)**: `page.getByRole("form", { name: "Skeptic Assembled Form" })` resolved via my
  own MCP snapshot — `form "Skeptic Assembled Form"` present with all 8 controls (textbox, textbox,
  spinbutton, textbox[date], combobox, switch, file-attachment button, counter spinbutton) plus
  Submit, matching the spec's own accessibility.snapshot() assertion (`role: "form"`, `name:
  "HEL-1090 Assembled Form"` in the spec's own fixture).
- **HEL-1158 duplicate-ticket check**: fetched HEL-1158 from Linear directly — status `Backlog`,
  single ticket, references HEL-1090 as "related... should land before or alongside it," no
  duplicate filed by this ticket's work.
- **Gates**: `npx tsc --noEmit -p frontend/tsconfig.json` clean; `npx eslint` on the two touched
  frontend files clean; `git status --short` in the worktree shows only the (expected, untracked)
  `evaluation-1.md` report file — no stray test artifacts.
- **Stray screenshots**: my own MCP session initially wrote two PNGs to the main-checkout root
  (`/home/matt/Development/helio/hel1090-skeptic-{dark,light}.png`) — the documented parallel-
  Playwright-session hazard. Viewed them (both confirm the findings above), then deleted them; none
  remained from the executor's or evaluator's own runs at either repo root.
- **Fixture hygiene**: deleted my own manually-seeded dashboard/data-source via `DELETE` API calls
  after use; no new files under `~/.helio/uploads/` from this review session (the shipped file-field
  test never actually drives the OS file picker, matching its documented scope).

### Verdict: CONFIRM

### Non-blocking notes

- The date-field Tab-trap documentation is solid and I could not find daylight between the claim and
  reality — reproduced identically on bare HTML with zero app code, exactly as claimed.
- HEL-1158's submit-below-fold finding (dark only) remains open there, correctly not duplicated here.
