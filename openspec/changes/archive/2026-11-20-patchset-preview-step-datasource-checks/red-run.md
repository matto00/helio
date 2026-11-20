# HEL-1722 red run (unmodified main code)

Command (from `backend/`, `SBT_OPTS=-J-Xmx3g`, `ANTHROPIC_API_KEY` empty, `nice -n 19`):
`sbt "testOnly com.helio.services.patchsets.PatchSetPreviewWriteParitySpec"` against main at 31094b154 plus only the new
spec and `check-inventory.md`. Result: 57 tests, 16 passed, 41 FAILED. Full log:
`.concertino/runs/HEL-1722/evidence/red-run-main.log` (main checkout, not tracked).

Two failure shapes, both genuine (the oracle is the direct service write, which refuses these inputs):
- "preview accepted? (expected false)": preview accepts what the service refuses (a missing check).
- a message/status mismatch: preview refuses but with the resolver's own wording (`edit 0: Pipeline not found` vs
  `edit 0: Pipeline not found: <id>`, `edit 0: data source not found` vs `Data source not found`, an unprefixed
  `Forbidden`). Design D3/D4 moves these to the service's wording behind the `edit N: ` prefix.

## Gap 1: pipelineStep create (addStep checks)
Missing check (preview accepted): unknown type; lane to a missing step; lane to a prospective ancestor; lane to a re-parented
descendant; upsert target owned by someone else; upsert target is the editor's own source; placement: both ids named,
unknown root, unknown parent, position out of range, several roots none named; rejectIfReparents when the insert would move steps.
Wording/prefix mismatch: unknown pipeline; stranger (no grant); viewer grantee (`Forbidden` unprefixed); secondary source owned by someone else.
Green already (checks the resolver has today): accepts tail append / position 1; raw config problem; config that does not
decode (both sides 400/422 same text via rawConfigProblem); editor grantee; rejectIfReparents with nothing to move.

## Gap 2: pipelineStep update (updateStep checks)
Missing check: type change; lane to a missing step; lane to itself; lane to an ancestor; lane to a lane-dependent; upsert target owned by someone else.
Wording/prefix mismatch: unknown step; stranger (invisible pipeline); viewer grantee; secondary source owned by someone else.
Green already: accepts config change / enabled flip; editor grantee; raw config problem.

## Gap 3: dataSource create / update
Missing check: create blank name; row cap (501 rows); bad column type; bad default; row that does not validate; required
column left null; update blank name. Mismatch: update blank name on an unowned source (preview 404, service 400);
update of an unowned source (wording `data source not found` vs `Data source not found`).
Green already: valid create; valid rename.

## Gap 4: pipeline create, roots but no steps or Outputs
Missing check (preview accepted): inline static root with a row that does not validate; inline static root over the row cap;
inline static root with a bad column type; inline sql root whose query is not a read; inline rest root naming both
connectorId and url. Green already: existing-source root; valid inline static root.

## Same-set entries (design D7), through PatchSetApplyService / preview
- "apply two creates at position N then N+1": GREEN on main (must stay green).
- "apply a lane drop then a reverse lane update": GREEN on main (must stay green).
- "still judge a step create's graph checks at preview when an earlier edit touches a DIFFERENT pipeline": RED on main
  (preview accepts `position: 99`).

## Per-test list (failing test names with the first assertion message)
```
- should [step create] unknown type *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step create] unknown pipeline *** FAILED ***
  "[Pipeline not found]" was not equal to "[edit 0: Pipeline not found: 0ef5fe71-0bdd-4a20-963f-2bc8aa69e873]"
- should [step create] stranger (no grant) *** FAILED ***
  "[Pipeline not found]" was not equal to "[edit 0: Pipeline not found: 60d50c75-4da0-44e0-a242-74b63415aee4]"
- should [step create] viewer grantee *** FAILED ***
  "[]Forbidden" was not equal to "[edit 0: ]Forbidden"
- should [step create] secondary source owned by someone else *** FAILED ***
  "edit 0: [d]ata source not found..." was not equal to "edit 0: [D]ata source not found..."
- should [step create] lane to a missing step *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step create] lane to a prospective ancestor *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step create] lane to a step the insert re-parents (descendant) *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step create] upsert target owned by someone else *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step create] upsert target is the editor's own source (targets stay owner-owned) *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step create] placement: parentStepId and rootId both named *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step create] placement: unknown root *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step create] placement: unknown parent *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step create] placement: position out of range *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step create] placement: several roots, none named *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step create] rejectIfReparents when the insert would move steps *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step update] unknown step *** FAILED ***
  "edit 0: [pipeline step not foun]d" was not equal to "edit 0: [Pipeline step not found: 54226b61-5988-46a6-8cb1-ba73b4974c9]d"
- should [step update] stranger (invisible pipeline) *** FAILED ***
  "edit 0: [pipeline step not found]" was not equal to "edit 0: [Pipeline step not found: 373acbbe-281a-45d1-a8fd-41659bc273f8]"
- should [step update] viewer grantee *** FAILED ***
  "[]Forbidden" was not equal to "[edit 0: ]Forbidden"
- should [step update] type change *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step update] secondary source owned by someone else *** FAILED ***
  "edit 0: [d]ata source not found..." was not equal to "edit 0: [D]ata source not found..."
- should [step update] lane to a missing step *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step update] lane to itself *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step update] lane to an ancestor *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step update] lane to a step that depends on it through a lane link *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [step update] upsert target owned by someone else *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [dataSource create] blank name *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [dataSource create] row cap (501 rows) *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [dataSource create] bad column type *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [dataSource create] bad default for the column type *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [dataSource create] row that does not validate *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [dataSource create] required column left null *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [dataSource update] blank name *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [dataSource update] blank name on a source the caller does not own *** FAILED ***
  class com.helio.services.ServiceError$NotFound was not equal to class com.helio.services.ServiceError$BadRequest
- should [dataSource update] source the caller does not own *** FAILED ***
  "edit 0: [d]ata source not found" was not equal to "edit 0: [D]ata source not found"
- should [pipeline create (roots only)] inline static root with a row that does not validate *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [pipeline create (roots only)] inline static root over the row cap *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [pipeline create (roots only)] inline static root with a bad column type *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [pipeline create (roots only)] inline sql root whose query is not a read *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should [pipeline create (roots only)] inline rest root naming both connectorId and url *** FAILED ***
  preview accepted? (expected false) -> None: true was not equal to false
- should still judge a step create's graph checks at preview when an earlier edit touches a DIFFERENT pipeline *** FAILED ***
  Right(PatchSetPreviewResponse(Vector(EditPreview(0, "pipelineStep", "create", None, Some({"config":{"count":1},"id":"(pending)","type":"limit"}), Vector(), None), EditPreview(1, "pipelineStep", "create", None
*** 41 TESTS FAILED ***
No tests to run for Test / testSelected
[error] [hel1468-guard] ScalaTest reported 41 failed test(s), but sbt considered the run passed (sbt 2 can lose forked-test result events, HEL-1468). See the failing suite's header line and its `*** FAILED ***`
[error] (Test / testSelected) sbt.TestsFailedException: Tests unsuccessful
```
