# Files modified — HEL-951

- `.github/workflows/ci.yml` — replaced the two per-spec `npx playwright test <file>` allowlist steps in the `e2e` job with a single `npx playwright test` glob invocation (discovery governed by `playwright.config.ts`'s `testIgnore`); rewrote the stale HEL-813-era comment (lines 199-205) that asserted only two specs were ever meant to run here and that broadening was "a natural follow-up, not bundled into this change" — every clause of that comment was false after this change, so it was replaced (not appended to) with a comment describing the glob, pointing at the orphan investigation, and re-stating the `*.regression.spec.ts` exclusion and its reason.
- `playwright.config.ts` — converted the bare `testIgnore: ["**/*.regression.spec.ts"]` into a commented quarantine register: kept the regression-harness exclusion (now with an expanded, still-accurate comment naming all three independent exclusion layers) and added four new `testIgnore` entries, one per red orphan spec found in task 1 (`hel665-message-composer.spec.ts`, `hel666-single-assistant-entry.spec.ts`, `hel716-panel-detail-tall-viewport-footer.spec.ts`, `hel908-tail-attach.spec.ts`, `hel909-output-picker-panel-sheet.spec.ts`), each carrying the observed symptom and its real, filed follow-up ticket (HEL-960/961/962/963 — see below; **cycle 2** replaced the cycle-1 placeholder identifiers with these once filed).
- `e2e/hel813-mobile-touch-target-floor.regression.spec.ts` — repaired Case B against `.mobile-nav-sheet__item` (`MobileNavSheet.css`) after its original anchor `.panel-list__add` was confirmed removed from the codebase; the wrong-axis discriminator now imports and compares against `DEFAULT_MIN_PX - RENDERED_BOX_EPSILON_PX` instead of a re-typed bare `44`. **Cycle 2** additionally repaired Case A: `TOAST_BASE_RULE_MARKER` was keyed on a `/* Close button */` comment deleted by an unrelated HEL-851 comment sweep (the rule itself was untouched); re-anchored on `"\n.toast__close {"` (the rule, not the prose), with a new `assertToastBaseRuleMarkerUnique()` that asserts exactly 1 match at runtime and throws a clear "source drifted" error otherwise, so a future comment sweep fails loudly instead of silently breaking the harness again.
- `e2e/README.md` — documented the three-layer regression-harness exclusion more fully, and added notes on both Case B's anchor change and (cycle 2) Case A's marker repair, pointing at the respective search/mutation-proof evidence files.
- `openspec/changes/wire-orphaned-e2e-specs/orphan-status-report.md` — the task 1 deliverable: full 14-spec enumeration, per-orphan pass/fail verdict and observed error, root-cause grouping, and the whole-suite (task 7) result. **Cycle 2:** disposition column and the ticket-filing note updated with the real HEL-960/961/962/963 ids.
- `openspec/changes/wire-orphaned-e2e-specs/caseb-search-and-mutation-proof.md` — the task 6 deliverable: the P1-P4 candidate search (by runtime measurement, not grep) and the two mutation-proof transcripts for the repaired Case B's three assertions.
- `openspec/changes/wire-orphaned-e2e-specs/casea-marker-repair-and-mutation-proof.md` (new, cycle 2) — the Case A repair deliverable: the marker diagnosis (confirmed against the tree before acting), the runtime-uniqueness-assertion repair, and the per-assertion mutation-proof (baseline vs. mutated pairing for all three assertions, since Case A's single mutation shape makes all three co-vary together by construction).
- `openspec/changes/wire-orphaned-e2e-specs/regression-harness-run.log`, `glob-proof-transcript.log`, `final-whole-suite-run.log`, `caseA-repair-run.log` (persisted evidence) — transcripts for the cycle-1 regression-harness on-demand run, the D4 glob-fails-loudly proof, the whole-suite run, and (cycle 2) the repaired Case A's end-to-end baseline→mutated→reverted run.
- `openspec/changes/wire-orphaned-e2e-specs/tasks.md` — checked off completed tasks with brief inline notes; task 6.7's note updated in cycle 2 to reflect Case A now being repaired rather than deferred.

## Follow-up tickets — filed (cycle 2)

All four red-orphan follow-up tickets are now filed in Linear:

1. **HEL-960** — `hel665-message-composer.spec.ts` + `hel666-single-assistant-entry.spec.ts` (shared root cause): both fail at `/chat` on `getByLabel("Message")` not found/visible, immediately after a fresh register/login, despite `ANTHROPIC_API_KEY` being present in this worktree's `backend/.env`. See `orphan-status-report.md` Group 1.
2. **HEL-961** — `hel716-panel-detail-tall-viewport-footer.spec.ts`: panel-creation `POST` returns `400` in test setup, expected `201`, before the file's actual footer-visibility assertions run. See Group 2.
3. **HEL-962** — `hel908-tail-attach.spec.ts`: `getByRole('button', { name: 'Add tail step' })` resolves to 0 elements (expected 2); all four tests in the file fail. See Group 3.
4. **HEL-963** — `hel909-output-picker-panel-sheet.spec.ts`: a panel placed via the OutputPicker never becomes visible in the grid/mobile stack; all four tests in the file fail. See Group 4.

The cycle-1 fifth candidate (HEL-813 regression harness Case A) is no
longer a follow-up — it was repaired in this ticket (cycle 2), per
product-owner direction. No ticket needed.

## Cycle 3 (evaluator change request)

- `openspec/changes/wire-orphaned-e2e-specs/tasks.md` — task 4.2's line still read "NOTE: ticket identifiers are placeholders (HEL-951-FOLLOWUP-1..4) pending actual filing — see final report" after cycle 2 updated `playwright.config.ts`, `orphan-status-report.md`, and `files-modified.md` but missed this file. Replaced with the plain, unhedged real identifiers: HEL-960 (hel665 + hel666, shared cause), HEL-961 (hel716), HEL-962 (hel908-tail-attach), HEL-963 (hel909) — all filed in Linear.
- `openspec/changes/wire-orphaned-e2e-specs/evaluation-1.md` (new) — the evaluator's cycle-3 report, committed as part of the change's audit trail (same treatment as the cycle-1 skeptic-design-*.md reports).

Grepped the whole change directory and the whole worktree (excluding
`node_modules`/`.git`) for `FOLLOWUP-[0-9]`, `not yet filed`, and `pending
actual filing`: at the moment this grep was actually run (before this
paragraph itself was written), the only hits were inside `evaluation-1.md`,
quoting the stale text as its own finding. **Correction, cycle 4:** that
"zero hits anywhere else" claim went stale the instant this very paragraph
was written, because describing the grep's own search terms in prose
necessarily contains a substring the same grep matches. See the "Count
discrepancy" subsection under Cycle 4 below for the re-derived, honest
statement of what this file's own self-matches are and why pinning an exact
frozen line-number set here would just repeat the same mistake — the
invariant that actually matters (zero hits in any LIVE config or planning
artifact) is verified there, not asserted here.

Whole-suite glob (task 7) was NOT re-run this cycle — nothing under `e2e/`,
`playwright.config.ts`, or `.github/workflows/ci.yml` changed; this cycle
touched only `tasks.md` and added `evaluation-1.md`, both planning/report
artifacts.

## Gate bypass note

None. All gates in task 8.1 were run directly (no `git commit -n`).

**Correction (cycle 2):** cycle 1's report of "`npm test`'s pre-existing
failure — 5 helio-mcp Jest suites fail to compile" was WRONG. That
diagnosis compared against an incorrectly-invoked baseline (`git stash` +
re-run, which still lacked `helio-mcp/node_modules` — the actual cause —
and additionally risked cross-worktree stash contamination, since git's
stash stack is shared across all worktrees of a repo; confirmed no stash
entries were left outstanding). The canonical root invocation (`npm test`
== `jest && npm --prefix frontend test`, run from the repo root) is fully
clean: `22 suites / 216 tests` (root jest, includes `helio-mcp/`) +
`252 suites / 2588 tests` (frontend jest), **0 failures**, confirmed
freshly in cycle 2 after `helio-mcp/node_modules` was installed (which was
genuinely missing and is what cycle 1 actually fixed before committing —
the pre-commit hook's own jest run at commit time already showed
`216`/`2588` passing with 0 failures, which cycle 1's own report
contradicted itself on). There is no pre-existing `npm test` breakage
introduced by or discovered in this change.

## Cycle 4 (final-gate skeptic's two non-blocking notes, product-owner approved to fix in-scope)

- `playwright.regression.config.ts` — was `testIgnore: []`, which was safe
  only while the base register (`playwright.config.ts`'s `testIgnore`) held
  exactly one entry. HEL-951 grew that register to six entries (the
  permanent `**/*.regression.spec.ts` entry plus five quarantines:
  HEL-960/961/962/963's specs). Clearing the whole list therefore silently
  un-quarantined all five known-red specs for anyone who ran this config
  without an explicit file argument — dormant only because
  `e2e/README.md`'s documented recipe happens to always pass one, which is
  a usage convention, not a guarantee. Fixed to clear ONLY the permanent
  regression entry: `testIgnore: (baseConfig.testIgnore as
  string[]).filter((pattern) => pattern !== REGRESSION_ENTRY)` — DERIVED
  from `baseConfig.testIgnore`, not a second hand-copied literal list (a
  hand-copied duplicate would be the same class of drift-prone register one
  layer further down). Also corrected the file's header comment, which
  claimed the empty array existed "solely so the harness can still be
  invoked on demand, without weakening that default-run protection" — true
  when written, false once the register grew (it no longer just "doesn't
  weaken" anything; it now has to actively preserve five quarantines). The
  comment now describes the derivation and names the failure mode the
  filter avoids.

  **Type-check coverage finding (asked for explicitly, not assumed):**
  `playwright.regression.config.ts` is NOT type-checked by
  `check:e2e-types` (`tsc --noEmit -p e2e/tsconfig.json`). That tsconfig's
  `include` is `["**/*.ts", "../playwright.config.ts"]`, resolved relative
  to `e2e/` — the first pattern only reaches files under `e2e/`, and the
  second explicitly lists `playwright.config.ts` by name but not
  `playwright.regression.config.ts`. Confirmed via `tsc --noEmit -p
  e2e/tsconfig.json --listFiles | grep playwright.regression.config` (no
  output). No other npm script type-checks it either — the repo-root
  `tsconfig.json` (which, having no `include`, would default to catching
  it) is never invoked by any script; only `frontend`'s own `typecheck` and
  `check:e2e-types`/`check:helio-mcp-types` run `tsc` anywhere in this repo.
  So today this file has zero gate coverage. The edit was verified
  ad-hoc instead — `tsc --noEmit --strict --esModuleInterop --skipLibCheck
  --moduleResolution bundler --module esnext --target es2022
  playwright.regression.config.ts` (the same compiler options
  `playwright.config.ts`'s own project uses) exits 0 — plus a runtime check
  (`npx playwright test --config=playwright.regression.config.ts --list`
  with no file argument) confirming the derived list actually excludes the
  five quarantined specs (41 tests listed, none from
  hel665/hel666/hel716/hel908-tail-attach/hel909) while still including the
  regression harness (2 tests). Per the item's strict scope (no
  `playwright.config.ts` changes, no other config changes named), the
  `e2e/tsconfig.json` include list was left untouched rather than expanded
  to close this gap — flagged here as a real, separate gap rather than
  silently fixed or silently left unremarked.

- `openspec/changes/wire-orphaned-e2e-specs/files-modified.md` (this file)
  — cycle 3's "zero hits anywhere else" grep claim was false the moment it
  was written (see the correction inline above); replaced with the true,
  re-derived statement and the count-discrepancy resolution below.

### Count discrepancy: resolved, not guessed

The final-gate skeptic's own sweep found 1 matching line in this file; the
evaluator's cycle-3 report cited 2, at `:28,32`. Ran the exact command
verbatim rather than picking a number:

```
$ grep -rniE "FOLLOWUP-[0-9]|not yet filed|pending actual filing" --exclude-dir=node_modules --exclude-dir=.git -- . | grep -v evaluation-1.md
```

At the point cycle 3 committed, this printed exactly 2 lines — both in
THIS file, `files-modified.md:28` (a historical quote of the note fixed in
cycle 3) and `files-modified.md:32` (this file's own prose naming the grep's
search terms) — matching the evaluator's count and line numbers exactly.
The skeptic's "1" almost certainly came from a narrower pattern (e.g.
anchored on the literal `HEL-951-FOLLOWUP` string rather than the broader
`FOLLOWUP-[0-9]`): the cycle-3 `:28` line contains `HEL-951-FOLLOWUP-1..4`
(matches either pattern), but `:32` contained only the bare grep-pattern
fragment `FOLLOWUP-[0-9]` with no `HEL-951-` prefix — this file quoting the
search term, not the ticket placeholder — and would not match a pattern
anchored on `HEL-951-FOLLOWUP`. Root cause of cycle 3's false "zero" claim:
the grep was run BEFORE the paragraph describing its own search terms was
added to this file — correct at the moment it was run, stale the instant
the file was then edited, never re-verified after. No genuine disagreement
remained; the evaluator's count was confirmed correct by direct re-run.

**This count is inherently unstable and will not be re-pinned as a frozen
number going forward.** Every paragraph in this file (including this one)
that names the grep's search terms, or quotes a historical note that
contained them, necessarily matches the same grep — that is unavoidable for
an honest audit trail describing what was searched for and found, and cycle
4's instruction was explicit: do not reword this file to make the count go
to zero. Trying to pin an exact line-number set here would just reproduce
cycle 3's mistake one paragraph later. The claim that actually matters, and
that DOES hold as a stable invariant rather than a one-time snapshot, is:
**zero hits in any live config or planning artifact** — verified directly
above for `tasks.md`, `orphan-status-report.md`, `playwright.config.ts`, and
`playwright.regression.config.ts` specifically (not just "everything except
this file and evaluation-1.md"). Anyone auditing this later should re-run
the command themselves against those four files, not trust a number frozen
in this prose.

### Gates (cycle 4)

`lint` / `typecheck` / `check:e2e-types` / `format:check` all re-run clean.
Whole-suite glob (task 7) NOT re-run — nothing under `e2e/`,
`playwright.config.ts`, or `.github/workflows/ci.yml` changed this cycle;
only `playwright.regression.config.ts` (out-of-band, on-demand config, never
referenced by CI or `npm run e2e`) and this file changed. No `git stash`
used.
