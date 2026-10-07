- `backend/src/test/scala/com/helio/services/pipelines/DatasetWriteAutoRunEndToEndSpec.scala` — row 1 (D1): FakeClock 999/1000 ms boundary case added; `>= 1000` assertion removed, latency println gated behind HELIO_MEASURE=1; real-clock pollUntil state wait kept
- `backend/src/test/scala/com/helio/services/pipelines/PipelineCycleDetectionServiceSpec.scala` — row 2 (D2): test-held raw-JDBC advisory lock + mandatory ungranted-waiter wait (`AdvisoryWaiterStateWaitDeadline`)
- `backend/src/test/scala/com/helio/domain/connectors/SqlEgressSocketFactoriesSpec.scala` — rows 3, 4 (D3/D4): `awaitAccepted` state wait; sentinel-port barrier
- `backend/src/test/scala/com/helio/domain/connectors/SqlConnectorRebindingSpec.scala` — row 5 (D4): sentinel-port barrier (x2)
- `backend/src/test/scala/com/helio/domain/connectors/SqlConnectorConfigShapeSpec.scala` — row 6 (D4): sentinel-port barrier
- `backend/src/test/scala/com/helio/testsupport/AcceptRecordingListener.scala` — the one shared D4 helper; `AcceptStateWaitDeadline = 5.seconds`
- `backend/src/test/scala/com/helio/infrastructure/persistence/sources/ConnectorRepositorySpec.scala` — row 7 (D5): blocked-lock barrier (`RotationBlockedStateWaitDeadline = 10.seconds`) before the unchanged 1500 ms poll
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunCrossInstanceSpec.scala` — row 8 (D6): ordered marker barrier (`SelfEchoMarkerStateWaitDeadline = 10.seconds`); D6 precondition confirmed (B's marker reaches A's subscriber on its single LISTEN connection)
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` — row 8a (D9): explicit `eventually(timeout(BackfillMaterializedStateWaitDeadline = 5.seconds), interval(50.millis))`
- `openspec/changes/audit-wall-clock-spec-races/tasks.md`, `files-modified.md`, `evidence/**` — change artifacts (D7 P/M transcripts, full-suite summary)

PR-body follow-up (task 3.5; the driver files it): `OutputRoutesSpec:780` is a 200 ms "nothing happened" negative check
(row 9, left as-is); fixing it needs a production backfill-completion hook.
