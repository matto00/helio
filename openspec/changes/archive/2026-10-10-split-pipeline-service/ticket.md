# HEL-1463: Split PipelineService.scala (~2650 lines) behaviour-preserving

## Description

origin_kind: followup
origin_ticket: HEL-1417

Split out of HEL-1417 (item 5), per that ticket's own allowance ("its own ticket or this one's last item, at the
implementer's call").

`backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` is 2651 lines on origin/main c804b4296
(2571 lines on 1b765f59d, after HEL-1417 #906 and HEL-1469 #918). Split it behaviour-preserving, to the same standard
as HEL-1253/1187/1234/1371/1385:

* byte-move in both directions, with red runs proving the moved bodies are what the tests exercise;
* `javap -public` diff of the compiled classes empty after normalising per-file lambda renumbering;
* `sbt testFull` results identical per suite before/after;
* test changes import-only.

Why separate from HEL-1417: HEL-1417 changes behaviour (patch-set step-create resolve-time rejection,
compute-without-type analyze) and edits three `validateRawConfig` call sites inside PipelineService.scala; a byte-move
proof is only meaningful on a diff that changes no behaviour, so mixing them would make both unreviewable. Do this
after HEL-1417 merges (it rebases over HEL-1417's helper call sites).

## Acceptance Criteria

1. `PipelineService.scala` is split into concern-focused files in `com.helio.services.pipelines`; no behaviour change.
2. Forward and reverse byte-move check passes, with recorded red runs for both directions.
3. `javap -public` of `PipelineService` and `PipelineService$` identical before/after, after the synthetic-member
   normalisation declared in design.md D6(b) (red run recorded).
4. `sbt testFull` per-suite results identical before/after (`[hel1468-guard]` present in both runs).
5. `git diff <base>...HEAD -- backend/src/test` is import-only (expected: empty).
6. Any real defect found becomes a follow-up ticket, not a fix in this change.

## Driver context (owner-approved, 2026-10-10)

- A ticket comment suggests also splitting `PatchSetApplyResolvers.scala` (~853 lines). Planning decision: it becomes
  its OWN ticket (see design.md "Planner Notes"), not part of this PR.
- No inline FQNs; `[hel1468-guard]` must appear in sbt runs; `-J-Xmx3g` on sbt invocations.
