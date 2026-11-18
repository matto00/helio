## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD ff667dd571ce2f86ba3298c2f742f1f08c138c22. The planning artifacts are untracked in the worktree.

### What I verified (with evidence)

- **Round-2 CR1 (the HEL-1504 requirement contradiction) is resolved.** The delta now has a `## MODIFIED Requirements`
  block. Its header matches the base requirement exactly: "An auto-run that finds the pipeline already running fires
  after that run completes" (base `openspec/specs/dataset-write-auto-run/spec.md` ~:209). It restates the body in full
  and adds an UNLESS carve-out that names the ADDED requirement and its admission-snapshot condition. It keeps both
  existing scenarios word for word and adds a third: "A write the in-flight run already read does not fire after it
  succeeds". proposal.md "Modified Capabilities" and the design Goals and D7 now say that the requirement is narrowed
  and that the firer mechanics are unchanged. D7 also says why the coalescing requirement is left alone: it is an
  upper bound.
- **The ADDED requirement is a one-way guarantee tied to the snapshot**, with a MAY for late upserts. It does not
  contradict the Risks section, and it matches D2's placement immediately before admission. That placement satisfies
  the ticket's literal line that "a write after the run started keeps its auto-run".
- **Every ticket bullet is covered:** cancel (D3, test 1), write during the run (D1/D2, test 2 with a deterministic
  backend seam), failure-path decision stated (D4: nothing is cancelled unless a winning `succeeded`), HEL-505 guards
  untouched (the cancel is outside `submit` and outside the admission transaction), HEL-1504 retry and re-arm
  untouched (`rearm`/`unclaim` leave `write_generation` alone and are asserted in test 5), multi-instance (D5, DB
  token), e2e workaround removed (D6, task 3.1), spec delta present.
- **The grant and RLS context hold.** The repo uses `ctx.withSystemContext` for every statement
  (PipelineAutoRunDebounceRepository.scala:14, 37, 55, 76, 88, 116). V144 adds an explicit sequence GRANT, and a
  NOSUPERUSER `has_sequence_privilege` test proves it (task 4.4). The table has RLS (V110:20-27) and is accessed only
  through the privileged pool, which is unchanged.
- **The migration number is free.** The highest migration on base is V140. There is no JSON-schema or API contract
  change, so `check:schemas` is not affected.
- **Existing backend tests stay compatible.** `DatasetWriteAutoRunEndToEndSpec`:216-228 submits a real run *before*
  the write, so no snapshot sees the row and nothing is cancelled. `OrphanedRunReaperSpec`:93-129 seeds runs directly
  and upserts afterwards. The `DroppedFireSpec` in-flight cases seed runs directly; round 2 confirmed this.
- **The e2e ripple is tolerated.** `e2e/hel1392-remount-staleness.spec.ts`:180-207 writes rows, then runs the pipeline
  in the app. The auto-run that its comment expects will now be cancelled. The loop is written as "within a few round
  trips", and having no auto-run makes reuse resume sooner, so the test should not break. Only the comment goes stale.
  `hel1094` makes its form submit after its manual run, so its auto-run is unaffected.

### Verdict: CONFIRM

### Non-blocking notes

- `CLAUDE.md`'s `PIPELINE_RUN_AUTO_RUN_MAX_RETRIES` row says "An auto-run that finds the pipeline already running ...
  stays pending (no retry used) and fires after that run completes". Add a clause like "unless that run succeeds
  having read its writes (HEL-1739)" so the doc does not drift from the MODIFIED requirement.
- Refresh the now-stale comment at `e2e/hel1392-remount-staleness.spec.ts`:207, which says the out-of-band write
  "also queues a server-side auto-run".
- Tests 2 and 3 are green on base, so their red comes from mutations. That is legitimate per the repo's red-vs-guard
  rule, but record each mutation and its red output, as tasks 4.2, 4.3 and 4.8 already require.
- Confirm that `PipelineRunExecutor`'s test construction lets a custom `PipelineExecutionBackend` be injected for the
  test-2 and test-6 seams. If it cannot, pick an equivalent deterministic hook rather than a timing-based one.
