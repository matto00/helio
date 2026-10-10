## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD = origin/main = 2951d0b8371b039ac38142726f2505f0a809e2e9 (change dir untracked, no code diff yet).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/fix-utils-readme-importers/HEL-1401`.
- Re-ran design.md Decision 1's importer grep in the worktree myself. Results:
  - formatRelativeTime: connectors/ConnectorsPage.tsx, panels/provenance/ProvenanceContent.tsx, pipelines/PipelineDetailFooter.tsx + PipelineListTable.tsx, sources/SourceListTable.tsx. Matches Context.
  - aggregate: 7 panels files + pipelines/ui/outputEditor/OutputPreviewPane.tsx. Matches Context.
  - chartAppearance: adminUsage/ui/UsageChart.tsx; **7** panels files (buildChartOption.ts, chartDataOptions.ts, chartOverlayOption.ts, editors/ChartDisplayFields.tsx, resolvePanelChartType.ts, useChartClickHandler.ts, useChartOption.ts); 5 pipelines outputEditor files; utils/chartClickSelection.ts; utils/chartTypeOptions.ts. **Context says "features/panels (8 files)". It is 7.**
  - chartTypeOptions: panels/ui/buildChartOption.ts, panels/ui/chartDataOptions.ts only. Matches.
  - prefersReducedMotion: buildChartOption.ts, shared/ui/Toast.tsx, utils/chartAppearance.ts. Matches. README paragraph 2 (lines 11-12) is accurate.
- Grep completeness: broad search for `"/<module>"` and `'<module>'` across non-test frontend/src found no importers that the regex missed (the only extra hits are `"aggregate"` op-id string literals). No tsconfig/vite path aliases. Each module name maps to exactly one file (all under frontend/src/utils), so the regex cannot match a same-named module elsewhere.
- Guard claim: `grep -n 'endsWith(".css")' frontend/src/theme/motionTokenGuard.css.test.ts` -> `32:    } else if (entry.isFile() && entry.name.endsWith(".css")) {`. Confirmed.
- Call site: buildChartOption.ts:233 `built = applyHoverEmphasis(built, themeTokens, prefersReducedMotion());`. Confirmed.
- Removed text: `git show 681a16478 -- frontend/src/utils/chartAppearance.ts` contains "existing `motionTokenGuard.css.test.ts` (which only scans `.css` files)". Confirmed.
- README replacement text in Decision 1: every claim checks out against the grep above. The embedded re-check command works when `<module>` is substituted.
- Decision 2 insertion point: prefersReducedMotion.ts line 4 ends "...`@media` block.", line 5 is ` *`, line 6 starts "Guards `matchMedia`". The anchor is unambiguous and the ` *  ` indentation matches the existing comment. Result is 15 lines, so the `sed -n 1,16p` check covers it.
- `.openspec.yaml` has `skip_specs: true`, so no spec delta is needed. Scope matches AC1-AC3, plus the self-approved widening, which is in-paragraph and in-intent.

### Verdict: REFUTE

The text that will ship is correct. The plan still carries one false fact and one wrong line range. The executor is Haiku and will follow both literally.

### Change Requests

1. **design.md Context, chartAppearance bullet: "features/panels (8 files)" is false. The live count is 7** (list above). tasks.md 1.1 tells the executor to "verify it matches design.md Context's lists (stop and report if not)". As written, a correct grep will not match the plan, so the executor will either stop or paper over the mismatch. Change "8 files" to "7 files". Better still, list the 7 paths explicitly, as was already done for the pipelines/aggregate bullets.
2. **design.md Decision 1 and tasks.md 1.2: "Replace lines 3-8" is wrong. The paragraph spans lines 3-9.** Line 9 is "docs-only.", and the design itself says "through 'docs-only.'". A literal lines-3-8 replacement leaves a dangling "docs-only." line. Change both places to "lines 3-9". Also make the tasks.md 1.2 check concrete: after the edit, `grep -n "docs-only" frontend/src/utils/README.md` must return nothing, and "exclusively" must not appear. The premise-validation note repeats the same "lines 3-8" error, so do not copy from it.

### Non-blocking notes

- AC1 also requires the grep output in the PR body. No task covers it. That is fine if the orchestrator owns PR-body assembly, but say so (for example, a note on task 1.1 that evidence.md's `## Importer grep` section is pasted into the PR body).
- tasks.md 3.2 `git diff --stat origin/main` will not show the untracked or uncommitted change dir unless committed. Consider `git status --short` alongside it so the executor does not misread a clean-looking stat.
