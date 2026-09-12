## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `03480817df8a6fa9811c3291f1a1f50900c65464`, branch
`task/fix-stale-datatype-comments/hel-1118`. Spawn-cwd guard:
`READY ambient=/home/matt/Development/helio branch=task/fix-stale-datatype-comments/hel-1118`.

### What I verified (with evidence)

Every load-bearing factual claim in the plan was checked against the live repo rather
than accepted from the artifacts.

1. **Decision 1 — "the ticket's literal quoted defect is already gone" — CONFIRMED.**
   `backend/src/main/scala/com/helio/domain/model/DataSource.scala:155-158` now reads
   "`DataSourceRepository.readDatasetRows` materializes the `{columns, rows}` blob on
   demand from `dataset_schema` + `dataset_rows` for the legacy in-process / Spark
   engines and the preview endpoint". The ticket's quoted text ("...on demand from the
   DataType row (or the stored config blob...)") does not exist in the file. The
   confirm-only (not re-fix) call is correct. `git log --grep` confirms HEL-1073
   (369add79) and HEL-1074 (730b42d8) both landed.

2. **Item 4 — `helio-mcp/src/helioApi.ts:456` really says `type: "static"` — CONFIRMED.**
   Verified in place inside `createDataSource`. The fix is real work, not a no-op.

3. **Decision 3's behavior-preserving premise — CONFIRMED.** `DataSource.scala:281-282`:
   `def canonicalize(s: String): String = if (s == Static) Dataset else s`, consumed by
   `parseKind`. The backend does accept `"static"`, so flipping the MCP literal to
   `"dataset"` is genuinely behavior-preserving as claimed.

4. **`CSV_LIKE_TYPES` exclusion is justified — CONFIRMED.** `helioApi.ts:91-93` carries
   its own HEL-1073 comment marking it a deliberate read-side alias. Leaving it alone is
   right.

5. **Both flagged suspects are correctly flagged, and they land in different buckets —
   CONFIRMED (good sign for the taxonomy).** `PanelServiceHelpers.scala:186-197` is
   plainly `accurate-historical` ("...the DataType-binding resolvers ... were removed
   here"). `DashboardAuthoringService.scala:258-261` is the harder case and the taxonomy
   handles it: the comment "One per-DataType capability fetch" is stale prose, but it
   sits on live code that still uses a real `workspace.dataTypes` field and `OutputId`.
   The plan's split between `genuinely-stale` (comment) and `unrelated-identifier` (live
   name) is the right instrument for this.

6. **Sweep sizing — the ticket's number is right and design.md's is wrong.**
   `grep -rniE "DataType\b|type registry|snapshot.?row" backend/src/main --include=*.scala`
   returns exactly **225 hits across 77 files**, matching ticket.md. design.md Decision 2
   cites "~280 raw grep hits from a dozen-hit sample" — see note 1.

7. **Scope arithmetic.** The same grep without `--include=*.scala` returns 260 hits; the
   35-hit delta is non-Scala (`.sql` migrations and other resources). See note 2.

8. **AC-to-task tracing.** ACs 1/3/4/5/6 each map to a concrete task (1.1-1.2, 2.3, 3.1,
   3.2 + the "only genuinely-stale" rule, 2.5). AC 2 is only partly covered — see note 3.
   `.openspec.yaml` really does set `skip_specs: true`, consistent with the proposal's
   no-capability-change claim, which is itself correct: comments plus one wire literal
   the server already canonicalizes.

No placeholders, TODOs, or deferred decisions found. Proposal, design, and tasks agree
with each other on substance (the one numeric disagreement is note 1). The escalation
valve (task 2.5) is a genuine strength on a sweep ticket of this shape.

### Verdict: CONFIRM

The plan is sound enough to implement. Its central judgment call — that item 1 is a
confirm, not a fix — is the one most likely to be wrong, and it is correct. Every
premise I could check against the repo held. The remaining items are cheap and
non-structural, so they are notes rather than change requests.

### Non-blocking notes

1. **design.md Decision 2's "~280 raw grep hits from a dozen-hit sample" is factually
   wrong and internally contradicts ticket.md's "~225 raw hits across ~77 files".** The
   measured value is 225/77 — the ticket is right. The phrase "from a dozen-hit sample"
   is also incoherent (a sample does not yield a raw total). Because this number is the
   stated sizing basis for the ">~15" escalation threshold, correct it to 225 so the
   threshold rests on the real figure. The threshold itself is fine as written.

2. **Sweep scope is stated two ways.** ticket.md says "across `backend/src/main`";
   tasks.md 2.1 says `backend/src/main/**/*.scala`. That silently excludes 35 non-Scala
   hits, mostly Flyway migrations. Migration comments are historical by nature and almost
   certainly should stay excluded — but say so explicitly in the triage record rather
   than leaving the gap implicit, so a future reader knows it was a decision.

3. **AC 2 says the findings go "in the change dir and in the PR body", but only the
   change dir has a task** (2.4 → `triage-findings.md`). Add the PR-body half to tasks.md
   so the AC is not half-covered at delivery.

4. **An adjacent stale comment sits one line above the item-4 fix, outside the sweep's
   scope.** `helioApi.ts:444` documents the method as "Create a `static` data source",
   directly above the `type: "static"` being changed to `"dataset"`. The sweep covers
   only `backend/src/main`, so nothing in the plan catches it. Fixing it in the same edit
   is near-free and squarely in the ticket's spirit; leaving it would ship a fix whose
   own docstring still uses the retired word.

5. **tasks.md §4 is vague about gates** — "relevant Scala checks" and "any helio-mcp
   build/lint check". Naming the actual commands would make the verification step
   reproducible rather than a judgment call at execution time.
