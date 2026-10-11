## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed: `design.md`, `tasks.md`, both spec deltas, `ticket.md`, and `skeptic-design-2.md`. Worktree HEAD is
b3a7efc9639386784c888347770800189662a380. The change dir is still untracked. Owner rulings 1-7 were not reopened.

### What I verified (with evidence)

**Round-2 CR1 (marks fade on hover): ADDRESSED.**
- **D5 carrier bullet.** It now states that `emphasis.disabled` does NOT stop ECharts blurring the marks when a
  data series with `focus: "series"` is hovered. It cites the r2 probe figures (line 0.1, band 0.012).
- **D5 mechanism.** It specifies `markLine.blur` with line and label opacity 1, and `markArea.blur` with band
  opacity 0.12 and label opacity 1. These are exactly the values the r2 browser probe showed hold the marks at full
  strength.
- **Fallback.** D5 notes the blur styles apply to the series[0] fallback too. The fallback rationale is now only
  "a legend toggle must not hide the target", with no "emphasis" claim.
- **Typings.** The option is valid in the installed library. `frontend/node_modules/echarts` is 6.1.0. In
  `types/dist/shared.d.ts`, `MarkLineOption` (:11036) and `MarkAreaOption` (:4619) both extend
  `StatesOptionMixin<…StateOption, StatesMixinBase>`, which carries `blur`. `lib/component/marker/MarkerView.js`
  still carries `toggleBlurSeries`, the code path the r2 finding traced.
- **Task 5.3.** It now asserts "marks carry `blur` opacities (line 1, band 0.12)".
- **Task 5.5.** It adds "hovering a data series (marks must not fade)" to the running-app check, light and dark.
  That is the level at which the defect is observable.
- **Spec.** The chart-reference-lines spec gained the scenario "Hovering a data series does not fade the marks":
  the line and its label stay fully opaque, and the band keeps its normal translucency. It sits under the
  "always visible and inert" requirement, so it is consistent with it.

**Round-2 CR2 (D9 sanitizer clause): ADDRESSED.** D9's frontend seam bullet now asserts `sanitizeReferenceMarks`
case by case:
- an invalid item is dropped;
- an over-cap list is truncated to the cap;
- a non-array reads as none;
- the kind-mismatch case is excluded as server-only.

This agrees with D7 (drop invalid items, apply caps), and every clause is satisfiable.

**Round-2 note (D3 pattern): ADDRESSED.** D3 now lists `minLength 1`/`maxLength 60`/`pattern "\\S"`. That matches
D1, task 2.1, and the output-routes-api delta ("1 to 60 characters containing at least one non-whitespace
character (stored as sent)").

**Regression scan (nothing newly broken):**
- I re-read D1-D9 against the proposal, the ticket's 3 ACs and rulings 1-7. They are still covered:
  - AC1 is covered by D5 and the spec's first requirement.
  - AC2 is covered by D1-D3, D8 and D9.
  - AC3 is covered by D4 and task 3.1.
- I found no new placeholders or contradictions.
- The label rule is consistent across the editor, schema and server. The editor trims and blocks a trimmed label
  over 60, so it can only emit a value the 1-60 + `\S` server/schema rule accepts.
- The pass order and the dataMin/dataMax mechanism are unchanged from the probe-confirmed r2 design.

### Verdict: CONFIRM

### Non-blocking notes
- D9 still lists "whitespace-only label" under `serverOnly`, but the schema now rejects it via `pattern "\\S"`. The
  seam test should not assert that `serverOnly` cases pass schema validation. Moving the case to `schemaRejects`
  (r2's optional suggestion) would make the fixture's grouping self-describing.
- In task 5.5, persist the hover before/after evidence via `persist-evidence.sh` when it is captured. A
  markLine/markArea element opacity reading is more self-authenticating than a screenshot pair.
- No `files-modified.md` or evaluation exists at the design gate, so there is no gate-defect finding.
