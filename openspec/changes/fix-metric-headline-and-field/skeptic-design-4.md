## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD 0614c979a1007fcb0a4cae3b60b4128b3d8950a5 (the change dir is untracked on top of it).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/metric-headline-field-correctness/HEL-1326`.
`openspec validate fix-metric-headline-and-field --strict` → "Change 'fix-metric-headline-and-field' is valid".

### What I verified (with evidence)

**Round-3 CRs and notes**
- **CR1 (D5 escalation): mostly addressed.** D5 says "PENDING OWNER RULING" and lists options (a)/(b)/(c). The Planner
  Notes list the D5 labelling and the D4 backfill as owner escalations. Task 2.6 implements "ONLY the owner's ruling".
  **Gap:** `proposal.md` "What Changes" still says the client-fallback value is "already labelled by the shipped
  'N of M loaded rows match.' disclosure (design.md D5). No new wording." That pre-decides option (a). See CR2.
- **CR2 (field-less shape): addressed consistently.**
  - D2 says "`"metric": null` (present, null)".
  - The `output-routes-api` ADDED text says "present as `null`", and its scenario says `"metric": null`.
  - Task 1.5's schema allows "object … OR `null`".
  - D6 covers "present `metric: null` … shows no value".
  - Task 3.2 has a red test for "field-less metric → `"metric": null` present".
- **N1: added.** I extracted "Active viewer filter hides the comparison" from `openspec/specs/metric-history-delta-ui/spec.md:78`
  and diffed it against the delta. The only change is that "show the headline computed from the filtered rows" became
  "show the filtered headline as defined by 'Metric headline uses …'". Both scenarios are byte-identical. The only
  other diff is a trailing blank line at EOF. Nothing was dropped. (The pre-existing truncated scenario line
  "…tooltip … is" is inherited verbatim and is not introduced here.)
- **The other three MODIFIED blocks were re-diffed against `openspec/specs/`.** All original text and scenarios are
  preserved. The only changes are the inserted sentences and the added scenarios:
  - Headline: the filtered, client-cross-filter and no-field sentences, plus 3 added scenarios.
  - Delta: the identity-equality clause with the older-server fallback (N2), plus 1 added scenario.
  - Comparison resolution: the `metric` read-out sentence, plus 1 added scenario.
- **N2:** the fallback is now in the "Metric delta" requirement text. **N3:** D3 and task 1.7 make the measurement spec
  opt-in through `HELIO_MEASURE=1`. **N4:** the cross-reference sentence is present in the `output-routes-api` requirement.

**Code facts re-derived**
- `OutputSummaryReducer.metric` still has `if (mapping.size == 1) mapping.headOption`.
- `resolveServerMetricField` still has `strings.length === 1 ? strings[0]`. D1 is still correct.
- `PublicDashboardViewerPage.tsx:132` passes `crossFilterMode="none"`.
- `output-rows-response.schema.json` has title `OutputRowsResponse` and `additionalProperties: false`.
  `check-schema-drift.mjs:136-146` pairs schemas to case classes by `title`, as D2 says.
- `OutputRowsResponse` is at `api/protocols/pipelines/OutputProtocol.scala:74`, and `testkit/HelioRouteTest.scala` exists.
- `useCrossFilterServerOps.ts:76-92` returns `client-fallback` when a control `eq` is on the dimension.
- `PanelContent.tsx:254` has `isCrossFiltered = isEligibleTarget && filteredRawRows !== rawRows`, a reference
  inequality. `filterRowsByDimension` (`utils/crossFilterRows.ts:42-51`) returns `rawRows.filter(...)`, which is a
  new array whenever the column exists. So `isCrossFiltered` is true even when every row matches.
- `cellMatchesValue` (`crossFilterRows.ts:30-35`) matches when `cell === value` OR `parseFloat(cell) === parseFloat(value)`.

**New finding: D5's self-decided "same-column control `eq`" sub-cases contradict the spec and are ambiguous.**
1. *Spec vs design.* The `metric-history-delta-ui` headline requirement says: "A cross-filter applied client-side to the
   loaded rows SHALL use the loaded-rows value". The same-column case is mode `client-fallback`, and `filterRowsByDimension`
   does run there. D5 and task 2.4, however, say "equal values → the server value is exact (use it)". The two values
   differ whenever rows are truncated, because the server value covers the full set and the loaded value covers 200
   rows. An implementer following tasks.md fails the spec, and one following the spec fails the task. The evaluator
   checks the spec.
2. *"Equal"/"different" is undefined.* The client cross-filter matches with numeric-loose `cellMatchesValue`. For
   example, control `eq` "10" and cross value "10.0" are different strings but match the same rows. If the design means
   string equality, the "different values → empty set, the loaded value is exact" premise is false here: the client
   keeps the loaded rows, they are truncated, and the loaded value is not the full set. A competent implementer could
   pick either string equality or `cellMatchesValue`, with different headlines as a result.
3. Under the "use the server value" branch, `isCrossFiltered && rowsTruncated` still renders "200 of 200 loaded rows
   match." under a full-set headline. That is exactly the labelling question D5 escalates, and it is not mentioned there.

### Verdict: REFUTE

### Change Requests

1. **Reconcile D5's same-column sub-cases with the spec, using a well-defined rule.** Pick one:
   - (i) **Simplest:** drop the sub-case refinement. Every `client-fallback` narrowing keeps the loaded-rows value, as
     the spec already says. Remove "equal values → the server value is exact (use it)" from D5, D6 ("or the
     same-column-eq case of D5") and task 2.4.
   - (ii) Keep the refinement, but define it by observed outcome rather than value equality. For example: same-column
     control `eq`, and the client narrowing kept every loaded row (`filteredRawRows.length === rawRows.length > 0`)
     → server value; it kept none → loaded (empty) value; otherwise → loaded value. Then amend the spec sentence to
     carve out this case, add a scenario, and say in D5 what the disclosure does in that state (it currently renders
     "N of N loaded rows match.").

   Whichever you pick, the spec headline requirement, D5, D6 and task 2.4 must state the same rule.
2. **Remove the pre-decided D5 outcome from `proposal.md` "What Changes".** It currently says the value is "already
   labelled by the shipped … disclosure (design.md D5). No new wording." Make it ruling-neutral and point to the
   pending D5 escalation, as design.md and the spec already do.

### Non-blocking notes

- D5 cites `PanelContent.tsx:384-391` for the `LoadedScopeDisclosure` render. On this HEAD it is at `:363-370`
  (`grep -n LoadedScopeDisclosure`).
- tasks.md lists 2.6 before 2.5, so execution order reads oddly. 2.6 depends on the ruling, and 2.4 depends on CR1.
- The worktree is at 0614c979; `main` has since moved to 835b57d9 (HEL-1321 #785, HEL-1296 #782), and HEL-1321
  touches the pipeline-editor frontend. Rebase before execution to confirm the cited line numbers still hold.

### Items for the post-gate owner escalation (beyond D5 labelling and D4 backfill)

- None new, if CR1 takes option (i).
- If CR1 takes option (ii), add this to the D5 question: in the same-column state, whether a full-set headline beside
  "N of N loaded rows match." is acceptable.
