## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 032321ada8880dbfce4a1197c28e34d55b964388. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/auto-run-trigger-badge-style/HEL-1822`.
- **Baseline CSS matches design Context.** I checked `frontend/src/features/pipelines/ui/RunHistoryModal.css`:
  - The base `.run-history-modal__trigger` (lines 58-65) has no background, a `--app-border-subtle` border and `--app-text-muted` text.
  - `--scheduled` (67-71) and `--external` (73-77) exist. There is no `--auto-run` rule.
  - `.run-history-modal__row` (10-16) has an opaque `--app-surface-soft` fill.
  - In `theme.css`, `--app-surface-soft` is `#efece6` in light and `#161514` in dark. Both are opaque.
- **The modifier class is already emitted.** `RunHistoryModal.tsx:62` emits `run-history-modal__trigger--${triggerSource}`. So D2(a) is green before the change and (b) is the real red. The design says so.
- **Every Run History surface gets the new rule.** `MobileRunsTab.tsx` reuses `RunHistoryList` from `RunHistoryModal.tsx`, so it uses the same class. No other stylesheet overrides `.run-history-modal__row` or `__trigger`; I grepped `frontend/src/**/*.css`.
- **Round-1 Change Request 1 is resolved, and I checked it against the code.**
  - `runHistory.contract.test.ts:32` really does hold the five-label `toContain` list that includes "Unknown".
  - `triggerSourceLabel.ts:4-9` defines `KNOWN_LABELS`.
  - The mutation `KNOWN_LABELS["auto-run"] = "Unknown"` maps to "Unknown", which is in the old list, so the old test passes. It fails the sorted-equality check against the literal `["Auto-run","External","Manual","Scheduled"]`. So the red/green pair is achievable.
  - The literal list is not a tautology of line 31.
  - The design correctly says why a fixture mutation cannot be used: lines 29 and 31 already catch an unknown source, and `normalizeRunRecord` defaults a missing one to `manual`.
- **The round-1 notes were adopted.** D2 now covers three things: placeholder substitution (the fixture really does carry `{{TIMESTAMP}}`, `{{RUN_*}}` and `{{PIPELINE_1}}`), a check that the text colour differs from manual, and treating mutation 3 as a sensitivity probe rather than a red.
- **The migration leftover is real, and the planned wording is accurate.**
  - `TriggerSourceMigrationSpec.scala:17-20` names only `manual`/`scheduled`/`external`.
  - `V110__pipeline_auto_run_debounce.sql:32-36` drops the V63 CHECK and re-adds it with `'auto-run'`.
- **The test tooling exists.**
  - `e2e/support/stateContrast.mjs` exports `parseColor` (which handles `rgb[a]`, `color(srgb …)` and `transparent`), `compositeStack` and `contrastRatio`.
  - `evidencePath` exists in `e2e/support/evidencePath.ts:11`, and `registerAndLogin` in `e2e/support/auth.ts:82`.
  - The theme-switch pattern exists: the `helio-theme` localStorage value plus a `data-theme` assertion, in `modalScrollExtent.ts:84-87` and `hel1582Phone.ts:212-215`.
  - Run History opens through the pipeline menu (`modalScrollExtent.ts:211-215`).
  - `page.route("**/api/pipelines/*/run-history")` already has a precedent at `hel1582Phone.ts:456`.
- **The owner ruling is honoured.** D1 uses `--app-surface-raised`, `--app-border-strong` and `--app-text`, with no hue and no icon. All three tokens exist in both themes in `theme.css`. The plan measures contrast on the rendered page, as the ruling requires, and treats the hex numbers only as estimates. It stops and escalates if dark fill-vs-row falls below 1.10.
- **The spec delta is complete.** I compared it with `openspec/specs/pipeline-run-provenance/spec.md`. The MODIFIED requirement keeps all three existing scenarios word for word and adds the new sentence and one new scenario. No API, schema or migration change is needed, so no contract delta is missing.
- **Every AC is covered by a task.**
  - AC1 ("fails first" plus its own modifier plus visible difference in both themes) is covered by tasks 1.1 and 3.1, and design D2(a)/(b).
  - AC2 ("measured, stated" contrast) is covered by D2(c) plus the evidence file in task 3.1.
  - Both leftovers are covered by tasks 1.2 and 2.1.
  - Nothing is out of scope: the non-goals exclude the TimelineMark and the StatusChip.
- I found no placeholders or TBDs that block implementation.

### Verdict: CONFIRM

### Non-blocking notes

- **The red has to show for both themes.** Task 1.1 requires "both themes fail (b)". Playwright stops a test at its first failed `expect`, so one test that loops over the themes would only ever show the light failure. Write one test per theme, or use `expect.soft`, so the committed red transcript shows a failure in each theme.
- **Small tidy-ups.**
  - The "Standing Constraints" heading in `tasks.md` is empty. Either fill it in or remove it.
  - Task 1.2's command should run from the repo root as written. `npm --prefix frontend test -- --testPathPatterns=...` is the narrowing form CLAUDE.md documents, so it is correct as is.
- **A watch item for the final gate, carried over from round 1.** The chosen pairing is identical to the hover state of the adjacent `.run-history-modal__row-toggle` (`RunHistoryModal.css:91-97`). At the final gate I will judge on the rendered page whether the badge reads as interactive. This is not a reason to reopen the ruling.
