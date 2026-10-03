## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: dea17b3bd35818e635f30f2f3c32800ebb29a6e6 (base 22dd0bad).

### What I verified (with evidence)
- Diff read for DataSourceService.delete / DataSourceRepository.rootReferences / 409 body: any-reference check runs before deleteFileF; total counted on the privileged pool, names only from findReadEdgesVisibleToFuture (owner-or-grant), hidden pipelines contribute an unnamed count only. Matches the owner ruling and HEL-1002 semantics.
- Fresh run: `nice -n 19 sbt "testOnly ...DataSourceRoutesSpec"` -> 137 passed, 0 failed (sbt --client shutdown run separately).
- THE PARTICULAR QUESTION (red on main = panel destroyed). The committed test's red on main fails first at the 204-vs-409 status line, so by itself it never displays the panel vanishing. I closed that gap with a direct probe against the real dev-DB schema (BEGIN ... ROLLBACK, nothing persisted), replicating seedSoleRootPipeline + seedPanelOnRootOutput row-for-row (2 sources, 1 pipeline with 2 roots, an Output on root 1, dashboard, panel on that Output), then `DELETE FROM data_sources WHERE id=<root-1 source>` (what main's multi-root delete does):
  before: panels count = 1 ; DELETE 1 (succeeded, no trigger raised) ; after: panels count = 0.
  So the fixture is faithful: on main the delete succeeds and the panel is destroyed via pipeline_roots -> outputs -> panels cascade; the test's `panels WHERE id = ... shouldBe 1` assertion and its 409 assertion both fail on main for the real reason. The requirement is substantively met; the only weakness is that the test's own red output didn't show it (see non-blocking note).
- Mutation-failability: not executed (read-only role); by reading, reverting rootReferences to a sole-root-only predicate flips the multi-root delete to 204, failing the status, row-survival and V100 hidden-pipeline specs. The cascade premise it depends on is now probe-confirmed above.
- Live API (start-servers + assert-phase servers PASS): created 2 CSV sources + a 2-root pipeline; DELETE of one source -> 409 with resourceKind=data_source, pipelines:[{id,name}] naming only the pipeline, reason/message naming it.
- Live UI, both themes (screenshots persisted: /home/matt/Development/helio/.concertino/runs/HEL-989/evidence/skeptic-989-dark.png and skeptic-989-light.png): pending-confirm warning copy updated; on Confirm a SourceDeleteConflictNotice appears between filter and list, names the pipeline with a /pipelines link and a Dismiss button, source stays in the list, no navigation, no generic toast. Token-based tinted error surface, readable contrast and consistent with sibling sidebar styling in dark and light. Console: only the browser's expected 409 network line.
- Test data cleaned by exact ids (pipeline then 2 sources, all 204); theme restored to dark; stray screenshots removed from worktree.
- helio-mcp description/error mapping and caller (first-run/proposal rollback) ordering changes present in the diff and covered per evaluator's pasted runs (not re-run by me).

### Verdict: CONFIRM

### Non-blocking notes
- The regression test asserts status before the row-survival counts, so on main it stops at the status line and never prints the panel loss. A cheap hardening: capture the status, run the three countRows assertions first (or assert panel survival in a separate `in` block). Not blocking because the probe above shows the assertions fail on main for the intended reason.
- Pre-existing (not in diff): the sidebar actions-menu trigger is a 3px-wide target that automation can't click without a JS click; unrelated to this change.
- No component test for the EmptySchemaAffordance conflict rendering (evaluator's note stands).
