## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Independently verified (not just trusted from executor's report):

- **84-fix count is accurate, not fabricated.** `git diff main...HEAD -- 'frontend/src/**/*.css' | grep '^+' | grep -o 'var(--space-[0-9]*)' | wc -l` → exactly **84**. Matches the commit message and `files-modified.md` exactly.
- **Spot-checked ~15 substitutions directly in the diff against `theme.css`'s scale** (`--space-1`=4px … `--space-10`=64px): every substitution I checked is an exact match — `12px→--space-3`, `8px→--space-2`, `1rem→--space-4`, `0.5rem→--space-2`, `16px→--space-4`, `20px→--space-5`, `1.5rem→--space-6`, `0.75rem→--space-3`. Crucially, near-miss values on the **same line** as a fix were correctly left untouched: `padding: 4px var(--space-2) 4px 4px` (the `4px`s are the ≤4px optical allowance), `padding: 6px var(--space-2)` (6px off-scale, left literal), `padding: var(--space-2) 14px` (14px off-scale, left literal), `padding: 0.4375rem var(--space-2)` (0.4375rem/7px off-scale, left literal). No tolerance substitutions found — the exact-value discipline design.md mandates is genuinely honored.
- **Color exclusions verified as legitimate, not missed violations.** Excluding tests, only 5 non-`theme.css` files contain any hex/rgb literal at all: `MfaEnrollModal.tsx`/`.css` (QR white/black — `MfaEnrollModal.css:40` has an explicit code comment justifying the fixed-white QR quiet-zone, independently confirmed correct), `PreferencesEditor.tsx` (documented appearance-default exclusion), and `DividerEditor.tsx`'s `#cccccc` (verified this is a UI-fallback/equality-sentinel value in application logic, not a rendered style — legitimately outside the CSS-styling scope of this ticket).
- **Font-family: confirmed 10/10 non-token hits are `inherit`**, zero ad-hoc families — matches design.md's claim exactly.
- **Font-weight: confirmed 0 numeric-literal hits** anywhere in `frontend/src`.
- **Font-size: found a real discrepancy.** design.md states font-size is "currently clean (0 live violations)" using the same em/%-widened pattern as spacing. Re-running that exact pattern (`font-size:\s*[0-9.]+(px|rem|em|%)`) turns up **3 hits**, not 0: `MarkdownPanel.css:79`, `MobileNavSheet.css:161`, `EmptyState.css:171` — all `0.8em`/`0.85em` relative multipliers. These are legitimately unfixable (relative em has no absolute `--text-*` equivalent) and would correctly land in `flag: no-token`, so the *fix outcome* is unaffected — but the audit's own completeness claim ("0 violations," not "0 fixable, 3 flagged") is factually wrong, which matters specifically because this ticket's entire premise is a complete, non-silent, mechanically-derived enumeration (ticket.md AC #1 restated, design.md's "Verification (both directions)" section). This is the same em-widening gap design.md explicitly called out as a known past failure mode for spacing (citing these same three files) — it was fixed for spacing but not re-applied to font-size.
- **Guard test scope does not match the ticket AC or design.md's own guard-test spec.** Ticket AC: "New guard test(s) fail if a raw hex/px-font-size/numeric-weight is reintroduced into the swept files." design.md's "Guard test" section: assert "(a) **the five grep patterns** find no new disallowed hits ... (b) every fixed literal stays substituted." The delivered `tokenAuditSweep.css.test.ts` implements only the spacing pattern (`SPACING_PATTERN`, one of five). It does not check for hex/rgb color, font-size, font-weight, or font-family reintroduction in any of the 15 swept files. Even though those categories currently have zero live violations in the swept files (verified above), the AC's literal wording ("if a raw hex/px-font-size/numeric-weight is reintroduced") is not satisfied — reintroducing a hardcoded color or font-size into e.g. `PipelineDetailPage.css` today would pass this test.

Everything else in Phase 1 checks out: task items match implementation, no scope creep (only the 15 files + new test file touched), planning artifacts (ticket/design/tasks) accurately reflect the final state modulo the font-size completeness gap above, no regressions.

### Phase 2: Code Review — PASS

Fresh gate runs (not trusting the executor's report):
- `npm run lint` → clean, 0 warnings.
- `npm run format:check` → all files formatted.
- `npx tsc --noEmit` (`npm run typecheck`) → clean.
- `npm test` → 256 suites / 2770 tests, all passing.
- `npm --prefix frontend run build` → succeeds (pre-existing chunk-size warning, unrelated).
- **RED-demonstrated myself**: reverted `TypeDetailPanel.css`'s `gap: var(--space-4)` back to `gap: 1rem` → `tokenAuditSweep.css.test.ts` fails (1 of 16 tests, exact expected/received diff on line 9). Reverted the change → back to 16/16 green. Confirms the guard mechanism genuinely works for what it does check (spacing).
- No new tokens added to `theme.css` (`git diff main...HEAD -- frontend/src/theme/theme.css` empty). `.husky/**` untouched (empty diff).
- DRY/readable/modular: substitutions are pure value swaps, no structural changes; guard test is well-commented and follows the `Modal.css.test.ts` precedent per design.md.
- No dead code, no over-engineering.

Only issue found belongs to Phase 1 (AC/guard-scope gap above) and is repeated as a Change Request below since it also touches the guard test's implementation.

### Phase 3: UI Review — PASS

Started dev servers via `scripts/concertino/start-servers.sh` / `assert-phase.sh` (both healthy, reused). Used Playwright to independently visually verify surfaces the executor claimed "no visual check needed" for (since Playwright wasn't available in their worktree, this is the actual missing verification):

- `/pipelines` list — dark theme, renders correctly, no layout issues.
- `/pipelines/:id` (PipelineDetailPage.css + PipelineDetailHeader.css, the largest batch of substitutions) — dark theme: header meta bar, step card, footer all render with correct spacing, no visible gaps/overlaps. Re-checked in **light theme**: identical layout, spacing, and alignment — confirms the exact-value substitution is genuinely visually inert as claimed.
- `/registry/:id` (TypeDetailPanel.css) — dark theme, renders correctly (empty schema/preview states shown cleanly).
- `/metrics` (MetricsPage.css) — dark theme, table renders correctly.
- `/settings` → Agent memory section (AgentMemoryList.css) — empty state shown via shared `EmptyState` component; no data present to exercise the table row spacing directly, but no regression visible.
- Breakpoint check at 768px on `/pipelines/:id` — mobile bottom-nav layout renders correctly, no overlap/breakage.
- No console errors attributable to this change (one pre-existing 404 on `/api/pipelines/:id/schedule` — unrelated to CSS, present regardless of this change).

No visual regression found in any tested surface/theme/breakpoint — the executor's "mathematically identical substitution ⇒ no visual regression" claim holds up under actual rendering, though it should not be treated as license to skip Playwright checks when available in future cycles.

### Overall: FAIL

### Change Requests

1. **Guard test doesn't satisfy the ticket AC.** `frontend/src/theme/tokenAuditSweep.css.test.ts` currently only re-runs the spacing pattern. Per ticket.md's AC ("guard test(s) fail if a raw hex/px-font-size/numeric-weight is reintroduced") and design.md's "Guard test" section ("the five grep patterns"), extend the guard to also check color (`#[0-9a-fA-F]{3,8}\b|rgba?\(`), font-size (`font-size:\s*[0-9.]+(px|rem|em|%)`), font-weight (`font-weight:\s*[0-9]+`), and font-family (non-token, non-`inherit`/`initial`/`unset`) patterns against the same `SWEPT_FILES` list, with the already-documented exclusions (MfaEnrollModal QR, PreferencesEditor, DividerEditor sentinel) as additional pinned allowlist entries where they fall inside a swept file. This is a same-shape addition to the existing `findRawSpacingHits`/`BASELINE` mechanism, not a redesign.
2. **Font-size enumeration completeness gap.** design.md/the executor's report state font-size is "0 live violations," but re-running the stated widened (em/%-inclusive) pattern finds 3 relative-em hits (`MarkdownPanel.css:79`, `MobileNavSheet.css:161`, `EmptyState.css:171`). These don't need fixing (relative em has no absolute token equivalent — correctly `flag: no-token` if enumerated), but the deliverable's enumeration table/PR description must state this accurately (3 flagged, not 0 found) to honor the ticket's "complete, not silently dropped" enumeration commitment. Update the executor's report / PR description counts accordingly.

### Non-blocking Suggestions

- Once CR1 is resolved, consider adding a one-line comment cross-referencing which BASELINE entries came from which of the five grep categories, to keep future maintenance of the guard test easy to audit at a glance.
