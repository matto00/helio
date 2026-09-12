## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed at HEAD `184ef08d8fa9510439c8efd772ec2e1ea868263e`, base
`03480817df8a6fa9811c3291f1a1f50900c65464` (live-resolved via `resolve-review-base.sh`,
exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/fix-stale-datatype-comments/hel-1118`.

### What I verified (with evidence)

**Gates re-run fresh by me (not taken from any report):**

- `sbt -batch compile` → `[success] Total time: 1 s`, `SBT_EXIT=0`
- `npm run check:scala-quality` → `clean (164 soft warning(s))`, `EXIT=0`
- `npm run check:openspec` → `openspec/ is clean`, `EXIT=0`
- `npm run check:helio-mcp-types` (`tsc --noEmit`) → no errors, `EXIT=0`

**UI review (Step 4): N/A, verified not assumed.** The diff touches zero `frontend/**`
files (see diffstat: backend scaladoc, one `helio-mcp/src/helioApi.ts` doc+literal change,
change-dir artifacts). No servers started, no screenshots, so no evidence artifacts to
persist.

**Scope containment — the explicitly-requested check, done mechanically rather than by eye.**
Every added/removed line in every changed `.scala` file, stripped of leading whitespace and
filtered for lines *not* beginning with `*`, `//`, `/*`, or `/**`, is the **empty set**:

```
git diff <base>...HEAD -- 'backend/***.scala' | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
  | sed 's/^[+-][[:space:]]*//' | grep -vE '^(\*|//|/\*\*|/\*)' | grep -vE '^$'
  → (no output)
```

So the entire backend half of this change is comment-only; the sole functional edit in the
whole diff is the AC-mandated `helioApi.ts:456` `type: "static"` → `"dataset"` wire literal
(plus its docstring). The `overwriteForDataType` → `overwriteForNode` references are
doc-only, exactly as the brief required me to confirm: `grep -rn "def overwriteForNode"`
finds the already-existing definition in `BinaryRefRepository.scala:45` (untouched by this
diff), and `overwriteForDataType` now survives only inside comments/SQL migration text.
No rename happens in this change.

**Round-1 change requests — all four genuinely fixed, verified against the files:**

1. **CR1 (WorkspaceContextService stale paragraph) — FIXED.** The
   "takes `dataTypeService: DataTypeService`" paragraph is deleted outright (diff hunk at
   `WorkspaceContextService.scala:33-40`). No contradiction remains in that scaladoc.
2. **CR2 (`DashboardAuthoringService.scala:66`) — FIXED.** Now reads "a per-Output
   panel-capability menu".
3. **CR3 (false "currently unreferenced" claim) — FIXED, and the correction is itself
   accurate.** Both blocks now say "no callers remain in `backend/src/main`, though
   `ExpressionEvaluatorSpec` still exercises it". My grep confirms exactly that state:
   zero `main` callers, six call sites in `ExpressionEvaluatorSpec.scala`
   (lines 105/109/113/117/413). The "Spinoff candidates" section now correctly splits
   `validateTolerant` from `validateMetricName` and warns it is NOT safe to delete
   unilaterally.
4. **CR4 (census reconciliation) — NOT fully fixed.** See the single change request below.

**Independent verification of the newly-expanded round-2 edits (the second thing the brief
asked me to scrutinize). Each load-bearing factual claim checked against the code, not the
narrative:**

- `WorkspaceContextProtocol`'s "always `None` / `pipelineOutput` always `true`" —
  corroborated: `toDataTypeEntry`'s body literally has `sourceId = None,` and
  `pipelineOutput = true,`.
- `WorkspaceResourceSearchProtocol`'s "`WorkspaceContextDataType` doesn't exist" —
  corroborated: `grep -rn "WorkspaceContextDataType" backend/src` returns nothing, and
  `WorkspaceContextOutput` is the real type. The edit correctly preserves the note that the
  wire discriminator string is still `"dataType"`.
- `PipelineProposalProtocol`'s "zero or more Outputs" — corroborated:
  `outputs: Vector[CreatePipelineTransactionalOutputRequest] = Vector.empty` at line 126,
  documented OPTIONAL at line 114. "Singular output DataType contract" was indeed wrong.
- `DataSourceService`'s nine "`inferred_schema` upsert" rewrites — corroborated at the
  call site, not inferred: `dataSourceRepo.upsertInferredSchema(ds.id, fields, now, user)`
  (line ~366) is what the ingestion paths actually call. No companion-row write exists.
- `ConnectorDriver`'s `inferredSchema` field-name correction — corroborated in round 1
  against `DataSourceProtocol.scala:209-213`; unchanged here.
- `model.scala`'s `BinaryRef` re-key claim — corroborated by
  `overwriteForNode(pipelineId, nodeStepId, ...)`'s actual signature.
- I found **no** newly-introduced false claim of the kind CR3 caught last round. The
  expanded batch is accurate on the merits.

**AC tracing:**

- AC1 (`DatasetSource` scaladoc matches behaviour) — **MET** (already correct; untouched,
  confirmed).
- AC3 (every genuinely-stale comment corrected) — **MET.** The two CR1/CR2 misses are fixed,
  and the full re-read caught real siblings of the same pattern (notably the three
  `RefinementGrounding.scala` sites six lines from a round-1 fix).
- AC4 (`helioApi.ts:456` sends `"dataset"`) — **MET**, verified in place.
- AC "no unrelated comments edited" — **MET.** `helioApi.ts:93`'s `CSV_LIKE_TYPES` untouched;
  `PanelServiceHelpers.scala:192` correctly left as accurate-historical.
- AC2 (findings listed with counts) — **NOT MET.** See CR1.

### Verdict: REFUTE

One narrow defect, and it is the same AC that failed last round. Everything substantive —
every comment edit, the wire literal, scope containment, all four prior CRs — is now
correct and independently verified. I am refuting solely because `triage-findings.md` again
asserts an exactness its own numbers contradict, and false-confidence documentation is the
precise defect class this ticket exists to eliminate. This is a one-line fix to one
document; no code change is required.

### Change Requests

1. **`triage-findings.md`'s classification table does not sum, and the "uncertain" bucket's
   enumeration contradicts its own count.** Two reproducible arithmetic facts:

   - The table's buckets total **187**, not the 188 the Total row states:
     `unrelated 108 + accurate-historical 73 + uncertain 6 + genuinely-stale 0 = 187`.
     Column-wise the Total row is internally inconsistent with itself: it reads
     `87 | 100 | 188`, but `87 + 100 = 187`. My independent census reproduces the
     **188** figure exactly (`grep -rniE "DataType\b|type registry|snapshot.?row"
     backend/src/main --include=*.scala | wc -l` → `188`; `-l | wc -l` → `65`; `type
     registry` → 0; `snapshot.?row` → 3, all live `node_snapshots` references). So the
     document's own total is right and one hit is unclassified.
   - The likely missing hit is identifiable: the uncertain bucket says "**6** comment lines,
     4 distinct sites" but then enumerates **7** — `DashboardAuthoringPrompt.scala:49,72`
     (2) + `RefinementPrompt.scala:108-109` (2) + `AssistantSystemPrompt.scala:7,9` (2) +
     `WorkspaceAssistantTools.scala:55` (1). That last one is flagged in the document as
     "**added in this revision**", which is consistent with it being appended to the list
     without incrementing the count from 6 to 7. Setting uncertain to **7** makes the table
     sum to 188 and the Total row read `87 | 101 | 188`.

   Fix the two numbers so the census actually reconciles, and drop or requalify the sentence
   "every one of the 100 comment-matching lines is accounted for" — as written it is a
   verification claim the table itself disproves. (Round 1's CR4 asked for exactly this:
   buckets exact, every hit accounted for, or an honest statement that a bucket was sampled.)

### Non-blocking notes

- The comment/code split is heuristic-sensitive and I am **not** refuting on it: my own
  crude split (leading-token test) gives comment-like 106 / code-like 82, versus the
  document's 100 / 87. Trailing end-of-line comments on code lines classify differently
  under the two methods, which plausibly explains the gap. Only the 187-vs-188 internal
  inconsistency above is method-independent, and that is what CR1 rests on.
- `DashboardAuthoringPrompt.scala:48` ("One line per pipeline-output DataType") is the same
  loose-terminology category as `:49`/`:72` immediately below it, which *are* listed as
  uncertain. It appears in no enumerated bucket line. Classification-completeness nit only —
  leaving it un-edited remains the right call.
- `AssistantSystemPrompt.scala:74,87` and `WorkspaceAssistantTools.scala:22` are live
  LLM-facing prompt/enum strings using "DataType" the same way `:55` does. Presumably folded
  into unrelated-identifier as wire-discriminator text; a one-line note saying so would make
  the uncertain-vs-unrelated boundary auditable.
- AC2 also requires the findings summary in the **PR body**. No PR exists yet, so this stays
  an outstanding delivery obligation (tasks.md 2.4), not a defect at this gate.
- No gate defect to report: no artifact I relied on discloses unsound evidence-directory
  mtimes, and no conclusion here rests on mtime ordering or directory placement. Every
  finding is content-addressed (cited file:line, pasted grep/command output, exit codes).
